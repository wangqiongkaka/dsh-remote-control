/** Paired mobile access to an existing DSH Web process through a managed SSH reverse tunnel. */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer, request as httpRequest, STATUS_CODES,
  type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { DEFAULT_AGENT_BOARD_ROWS, phoneDocument, remoteErrorDocument } from './phone-document.ts'
import { computerFiles } from './remote-files.ts'
import { notificationSettings, pushBark, watchSessions, type BarkConfig } from './notify.ts'

export const name = 'dsh-remote-control'
export const inject = ['connection', 'webServer', 'workspaceRegistry']

/** An explicit SSH reverse tunnel to an HTTPS reverse proxy on the server. */
interface SshConfig {
  destination: string
  publicUrl: string
  binary: string
  port: number
  remotePort: number
  identityFile?: string
}

/** Tunnel and pairing settings. */
export interface Config {
  /** SSH reverse tunnel to the public server; credentials stay in OpenSSH. */
  ssh?: SshConfig | undefined
  /** When set, push waiting and finished Sessions to the phone through Bark. */
  bark?: BarkConfig | undefined
  invitationTtlMs: number
  /** Phone access lifetime; 0 disables time-based expiry. */
  browserTtlMs: number
  startupTimeoutMs: number
  stopTimeoutMs: number
  /** How long a phone's live stream may send nothing before it counts as gone. */
  phoneSilenceMs: number
  /** Maximum visible rows in the phone Agent board list before scrolling inside. */
  agentBoardRows: number
}

const SSH_DESTINATION = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|[A-Fa-f0-9:]+|\[[A-Fa-f0-9:]+\])$/u

export const Config: z<Config> = z.object({
  ssh: z.union([z.object({
    destination: z.string().pattern(SSH_DESTINATION).required(),
    publicUrl: z.string().min(1).required(),
    binary: z.string().min(1).default('ssh'),
    port: z.natural().min(1).max(65_535).default(22),
    remotePort: z.natural().min(1).max(65_535).default(18_080),
    identityFile: z.string().min(1),
  }), z.const(undefined)]),
  bark: z.union([z.object({
    key: z.string().min(1).required(),
    server: z.string().pattern(/^https?:\/\/[^\s]+$/u).default('https://api.day.app'),
  }), z.const(undefined)]),
  invitationTtlMs: z.natural().min(1_000).default(5 * 60_000),
  browserTtlMs: z.union([z.const(0), z.natural().min(1_000).max(24 * 60 * 60_000)]).default(0),
  startupTimeoutMs: z.natural().min(1_000).default(30_000),
  stopTimeoutMs: z.natural().min(1_000).default(5_000),
  phoneSilenceMs: z.natural().min(1_000).default(60_000),
  agentBoardRows: z.natural().min(1).default(DEFAULT_AGENT_BOARD_ROWS),
})

/** Public proxy plus the upgraded sockets `closeAllConnections()` does not reach. */
interface Proxy {
  server: Server
  sockets: Set<Duplex>
}

interface Tunnel {
  child: ChildProcess
  exited: Promise<void>
  proxy: Proxy & {
    invite: (refresh?: boolean) => Invitation
    paired: () => boolean
    /** Access expiry, -1 for unlimited access, or 0 while nobody is paired. */
    pairedUntil: () => number
  }
}

/** A usable pairing link and phone access expiry (-1 unlimited, 0 unpaired). */
type Invitation = { url: string; expiresAt: number; pairedUntil: number }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cliEnv(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
    value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN/i.test(name)
    && !name.toUpperCase().startsWith('DSH_'))) as Record<string, string>
  // Apps launched from Finder or the Dock get /usr/bin:/bin:/usr/sbin:/sbin, which misses
  // Homebrew CLIs; spawn looks the binary up in this PATH.
  env.PATH = [env.PATH, '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':')
  return env
}

/** Keep the public origin usable by Secure cookies and the existing Host/Origin fence. */
function sshPublicUrl(ssh: SshConfig): string {
  if (!SSH_DESTINATION.test(ssh.destination)) throw new Error('Invalid SSH destination')
  if (![ssh.port, ssh.remotePort].every(port => Number.isSafeInteger(port) && port >= 1 && port <= 65_535)) {
    throw new Error('Invalid SSH port')
  }
  if (ssh.identityFile !== undefined && !isAbsolute(ssh.identityFile) && !ssh.identityFile.startsWith('~/')) {
    throw new Error('SSH identityFile must be absolute or start with ~/')
  }
  let url: URL
  try { url = new URL(ssh.publicUrl) } catch { throw new Error('Invalid SSH publicUrl') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('SSH publicUrl must be an HTTPS origin without credentials, path, query or fragment')
  }
  return url.origin + '/'
}

function sshArguments(ssh: SshConfig, proxyPort: number): string[] {
  const args = ['-N', '-T', '-v',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ForkAfterAuthentication=no',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', String(ssh.port),
    '-R', '127.0.0.1:' + String(ssh.remotePort) + ':127.0.0.1:' + String(proxyPort)]
  if (ssh.identityFile !== undefined) {
    const file = ssh.identityFile.startsWith('~/') ? join(homedir(), ssh.identityFile.slice(2)) : ssh.identityFile
    args.push('-i', file, '-o', 'IdentitiesOnly=yes')
  }
  return [...args, ssh.destination]
}

/** Exchange DSH's process token on loopback; this cookie never reaches the phone. */
async function localCookie(ctx: Context): Promise<string> {
  const url = ctx.connection.authenticatedUrl('http://127.0.0.1:' + String(ctx.webServer.port) + '/')
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  await response.body?.cancel()
  if (response.status !== 303 || cookie === undefined || cookie === '') {
    throw new Error('DSH Web browser authentication is unavailable')
  }
  return cookie
}

/** A paired phone's access as it outlives the plugin instance: its cookie's hash and expiry (-1 unlimited). */
interface Pairing { hash: string; expiresAt: number }

/** DSH keeps user data under `$DSH_HOME`, or `~/.dsh` when that is unset or blank. */
function pairingFile(): string {
  const home = process.env.DSH_HOME?.trim()
  return join(home === undefined || home === '' ? join(homedir(), '.dsh') : home, 'dsh-remote-control', 'pairing.json')
}

/** The stored pairing while it still grants access. */
function loadPairing(): Pairing | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(pairingFile(), 'utf8'))
    if (record(value) && typeof value.hash === 'string' && typeof value.expiresAt === 'number'
      && (value.expiresAt === -1 || Date.now() < value.expiresAt)) return { hash: value.hash, expiresAt: value.expiresAt }
  } catch { /* never paired, stopped, or unreadable */ }
  return undefined
}

function savePairing(pairing: Pairing | undefined): void {
  const file = pairingFile()
  if (pairing === undefined) { rmSync(file, { force: true }); return }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  rmSync(file, { force: true })
  writeFileSync(file, JSON.stringify(pairing), { mode: 0o600 })
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function cookieValue(raw: string | undefined): string | undefined {
  return raw?.split(';').map(part => part.trim()).find(part => part.startsWith('dsh-remote-control='))?.slice('dsh-remote-control='.length)
}

function equalToken(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Present an admitted request to DSH as its own loopback browser. */
function loopbackHeaders(headers: IncomingHttpHeaders, port: number, dshCookie: string): IncomingHttpHeaders {
  delete headers['x-forwarded-host']
  delete headers['x-forwarded-proto']
  headers.host = '127.0.0.1:' + String(port)
  headers.cookie = dshCookie
  if (headers.origin !== undefined) headers.origin = 'http://127.0.0.1:' + String(port)
  return headers
}

/** Largest HTML document worth rewriting; anything bigger streams through untouched. */
const HTML_LIMIT = 512 * 1024

/** Forward a document with the narrow-screen layer after `<head>`. */
function sendHtml(reply: IncomingMessage, res: ServerResponse, headers: IncomingHttpHeaders, agentBoardRows: number): void {
  const chunks: Buffer[] = []
  let size = 0
  let streamed = false
  reply.on('data', (chunk: Buffer) => {
    if (streamed) return
    size += chunk.length
    if (size <= HTML_LIMIT) { chunks.push(chunk); return }
    // Too large to rewrite: hand the document over as it arrives instead.
    streamed = true
    const passthrough = { ...headers }
    delete passthrough['content-length']
    res.writeHead(reply.statusCode ?? 502, passthrough)
    for (const buffered of chunks) res.write(buffered)
    chunks.length = 0
    reply.pipe(res)
  })
  reply.on('error', () => { res.destroy() })
  reply.on('end', () => {
    if (streamed) return
    const encoding = reply.headers['content-encoding']
    if (encoding !== undefined && encoding !== 'identity') {
      // Rewriting bytes this function cannot read would corrupt the document.
      res.writeHead(reply.statusCode ?? 502, headers)
      res.end(Buffer.concat(chunks))
      return
    }
    const body = Buffer.concat(chunks).toString('utf8')
    const out = Buffer.from(phoneDocument(body, { agentBoardRows }), 'utf8')
    const rewritten: IncomingHttpHeaders = { ...headers, 'content-length': String(out.length) }
    delete rewritten['transfer-encoding']
    res.writeHead(reply.statusCode ?? 502, rewritten)
    res.end(out)
  })
}

/** Forward an admitted browser request to the existing loopback Web server. */
function forward(
  req: IncomingMessage, res: ServerResponse, port: number, dshCookie: string, agentBoardRows: number,
): void {
  const headers = { ...req.headers }
  for (const field of req.headers.connection?.split(',') ?? []) delete headers[field.trim().toLowerCase()]
  delete headers.connection
  delete headers['proxy-connection']
  delete headers['keep-alive']
  delete headers.te
  delete headers.trailer
  delete headers.upgrade
  if (String(req.headers.accept ?? '').includes('text/html')) {
    // Documents are rewritten for narrow screens, so they have to arrive uncompressed.
    delete headers['accept-encoding']
  }
  const upstream = httpRequest({
    hostname: '127.0.0.1', port, method: req.method, path: req.url,
    headers: loopbackHeaders(headers, port, dshCookie),
  }, (reply) => {
    const responseHeaders = { ...reply.headers }
    delete responseHeaders['set-cookie']
    delete responseHeaders.connection
    if (req.method === 'GET' && String(reply.headers['content-type'] ?? '').includes('text/html')) {
      sendHtml(reply, res, responseHeaders, agentBoardRows)
      return
    }
    res.writeHead(reply.statusCode ?? 502, responseHeaders)
    reply.pipe(res)
  })
  upstream.on('error', () => {
    // A cut stream must not look complete to the phone.
    if (res.headersSent) res.destroy()
    else res.writeHead(502).end()
  })
  // Streaming responses otherwise keep the loopback request open after the phone leaves or is revoked.
  res.on('close', () => { if (!res.writableFinished) upstream.destroy() })
  req.pipe(upstream)
}

function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end('HTTP/1.1 ' + String(status) + ' ' + (STATUS_CODES[status] ?? '')
    + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
}

/** An empty masked Pong: a client frame DSH accepts at any time as proof of life. */
const PONG = Buffer.from([0x8a, 0x80, 0, 0, 0, 0])

/** Follow a client's WebSocket byte stream; each call reports whether it now rests between two frames. */
function frameBoundary(): (chunk: Buffer) => boolean {
  let header = Buffer.alloc(0)
  let payload = 0
  return (chunk) => {
    for (let offset = 0; offset < chunk.length;) {
      if (payload > 0) {
        const skipped = Math.min(payload, chunk.length - offset)
        payload -= skipped
        offset += skipped
        continue
      }
      header = Buffer.concat([header, chunk.subarray(offset, ++offset)])
      if (header.length < 2) continue
      const short = (header[1] ?? 0) & 0x7f
      const extended = short === 126 ? 2 : short === 127 ? 8 : 0
      if (header.length < 2 + extended) continue
      // The mask key counts as payload here: only where the frame ends matters.
      payload = (((header[1] ?? 0) & 0x80) === 0 ? 0 : 4)
        + (extended === 0 ? short : extended === 2 ? header.readUInt16BE(2) : Number(header.readBigUInt64BE(2)))
      header = Buffer.alloc(0)
    }
    return payload === 0 && header.length === 0
  }
}

/** Splice an admitted WebSocket handshake (DSH live streams) onto the loopback Web server. */
function tunnel(
  req: IncomingMessage, socket: Duplex, head: Buffer, port: number, dshCookie: string, sockets: Set<Duplex>,
  phoneSilenceMs: number,
): void {
  sockets.add(socket)
  const upstream = httpRequest({
    hostname: '127.0.0.1', port, method: req.method, path: req.url,
    headers: loopbackHeaders({ ...req.headers }, port, dshCookie),
  })
  socket.once('close', () => { sockets.delete(socket); upstream.destroy() })
  upstream.on('error', () => { socket.destroy() })
  upstream.on('response', (reply) => {
    reply.resume()
    refuseUpgrade(socket, reply.statusCode ?? 502)
  })
  upstream.on('upgrade', (reply, upSocket, upHead) => {
    upSocket.on('error', () => { socket.destroy() })
    socket.once('close', () => { upSocket.destroy() })
    upSocket.once('close', () => { socket.destroy() })
    const lines = ['HTTP/1.1 101 Switching Protocols']
    for (const [field, value] of Object.entries(reply.headers)) {
      if (field === 'set-cookie' || value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) lines.push(field + ': ' + item)
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n')
    if (upHead.length > 0) socket.write(upHead)
    // DSH ends a stream that leaves two Pings, sent two seconds apart, unanswered. On a relayed
    // tunnel the phone's Pong can spend longer than that queued behind a session snapshot, so a
    // healthy phone was cut off and made to fetch the snapshot again. Answer DSH from here, where
    // the answer cannot be delayed, and judge the phone by a silence a slow link does not reach.
    const between = frameBoundary()
    let idle = head.length === 0 || between(head)
    // A Pong may only go between two of the phone's frames. One frame in flight for longer than
    // DSH waits still ends the stream, as it did before.
    const pongs = setInterval(() => { if (idle) upSocket.write(PONG) }, 1_000)
    // The phone answers the Pings forwarded to it, so it is never this quiet while it is reachable.
    const silence = setTimeout(() => { socket.destroy() }, phoneSilenceMs)
    socket.on('data', (chunk: Buffer) => { idle = between(chunk); silence.refresh() })
    socket.once('close', () => { clearInterval(pongs); clearTimeout(silence) })
    if (head.length > 0) upSocket.write(head)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
  })
  upstream.end()
}

/** Explain a refused page without exposing the scanned token or loading protected assets. */
function remoteFailure(res: ServerResponse, status: number, reason: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-dsh-remote-control': status === 401 ? 'unpaired' : 'refused',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  }).end(remoteErrorDocument(reason))
}

/** Pair one phone, then proxy all DSH Web routes through a revocable cookie. */
function browserProxy(baseUrl: string, dshPort: number, dshCookie: string, config: Config) {
  const sockets = new Set<Duplex>()
  const responses = new Set<ServerResponse>()
  let ticket = ''
  // Only the hash is kept, so the stored pairing cannot be replayed as the phone's cookie.
  const restored = loadPairing()
  let browserHash = restored?.hash ?? ''
  let inviteExpiresAt = 0
  let browserExpiresAt = restored === undefined ? 0 : restored.expiresAt === -1 ? Infinity : restored.expiresAt
  let used = false
  const paired = (): boolean => browserHash !== '' && Date.now() < browserExpiresAt
  // Browsers cap persistent cookies at 400 days. Renew the same credential on phone visits
  // without imposing an expiry on server authorization or keeping it after revocation.
  const browserCookie = (browserToken: string): string => 'dsh-remote-control=' + browserToken + '; Max-Age='
    + String(config.browserTtlMs === 0 ? 400 * 24 * 60 * 60 : Math.floor(config.browserTtlMs / 1000))
    + '; Path=/; HttpOnly; Secure; SameSite=Lax'
  /** Renew invitations on request, expiry, or use without disturbing the current phone. */
  const invite = (refresh = false): Invitation => {
    if (refresh || used || Date.now() >= inviteExpiresAt) {
      ticket = randomBytes(32).toString('base64url')
      inviteExpiresAt = Date.now() + config.invitationTtlMs
      used = false
    }
    return { url: baseUrl + '?pair=' + ticket, expiresAt: inviteExpiresAt, pairedUntil: pairedUntil() }
  }
  /** The dialog follows the pairing state without being reopened. */
  const pairedUntil = (): number => paired() ? (browserExpiresAt === Infinity ? -1 : browserExpiresAt) : 0
  /** Host/Origin fence: the request URL on the public origin, or undefined to refuse with 403. */
  const target = (req: IncomingMessage): URL | undefined => {
    const { host: authority, origin } = new URL(baseUrl)
    if (req.headers.host !== authority || req.url === undefined || !req.url.startsWith('/')) return undefined
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return undefined
    const url = new URL(req.url, baseUrl)
    return url.origin === origin ? url : undefined
  }
  /** Status refusing a paired-browser request, or undefined when it may reach DSH. */
  const refuse = (req: IncomingMessage, url: URL): number | undefined => {
    if (req.headers['sec-fetch-site'] === 'cross-site' && (req.method !== 'GET' || url.pathname !== '/')) return 403
    const browserToken = cookieValue(req.headers.cookie)
    if (Date.now() >= browserExpiresAt || browserToken === undefined
      || !equalToken(tokenHash(browserToken), browserHash)) return 401
    if (url.pathname === '/api/remote-control') return 403
    return undefined
  }
  const server = createServer((req, res) => {
    const url = target(req)
    if (url === undefined) {
      if (req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html')) {
        remoteFailure(res, 403, '请求来源不符合远程入口要求，请直接用手机浏览器打开二维码链接。')
      } else res.writeHead(403).end()
      return
    }
    if (url.searchParams.has('pair')) {
      const pair = url.searchParams.getAll('pair')
      if (req.method !== 'GET' || url.pathname !== '/' || url.searchParams.size !== 1
        || pair.length !== 1 || pair[0] === '') {
        remoteFailure(res, 401, '二维码链接格式不正确，请使用完整的二维码链接。')
        return
      }
      const invalid = !equalToken(pair[0], ticket)
      if (used || Date.now() >= inviteExpiresAt || invalid) {
        // A spent QR may still be on screen before the desktop polls. Reopening it in the
        // paired browser uses its existing access; the invitation still admits nobody else.
        if (refuse(req, url) === undefined) {
          res.writeHead(303, {
            'cache-control': 'no-store', 'referrer-policy': 'no-referrer', location: '/',
          }).end()
        } else {
          remoteFailure(res, 401, invalid ? '二维码链接无效或已更新，旧链接不能用于新的配对。'
            : used ? '二维码已使用，只能配对一次。' : '二维码已过期。')
        }
        return
      }
      used = true
      const browserToken = randomBytes(32).toString('base64url')
      browserHash = tokenHash(browserToken)
      browserExpiresAt = config.browserTtlMs === 0 ? Infinity : Date.now() + config.browserTtlMs
      // Without the record this phone still works; it only has to pair again after a reload.
      try {
        savePairing({ hash: browserHash, expiresAt: browserExpiresAt === Infinity ? -1 : browserExpiresAt })
      } catch { /* unwritable DSH home */ }
      // Replace only admitted old-phone streams; the new pairing response must remain open.
      for (const socket of sockets) socket.destroy()
      for (const response of responses) response.destroy()
      res.writeHead(303, {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        location: '/',
        'set-cookie': browserCookie(browserToken),
      }).end()
      return
    }
    const status = refuse(req, url)
    if (status !== undefined) {
      if (req.method === 'GET' && url.pathname === '/') {
        remoteFailure(res, status, cookieValue(req.headers.cookie) === undefined
          ? '浏览器未提供访问凭据，请允许保存网站数据，并在同一手机浏览器里重新扫码。'
          : browserHash !== '' && Date.now() >= browserExpiresAt ? '手机访问权限已过期。'
            : '访问凭据无效或配对已被替换，需要重新扫码。')
        return
      }
      res.writeHead(status, {
        'cache-control': 'no-store', 'x-dsh-remote-control': status === 401 ? 'unpaired' : 'refused',
      }).end()
      return
    }
    // Admitted, so the presented cookie is the credential itself.
    if (config.browserTtlMs === 0) res.setHeader('set-cookie', browserCookie(cookieValue(req.headers.cookie) ?? ''))
    responses.add(res)
    res.once('close', () => { responses.delete(res) })
    forward(req, res, dshPort, dshCookie, config.agentBoardRows)
  })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => { socket.destroy() })
    const url = target(req)
    const status = url === undefined || req.headers.upgrade?.toLowerCase() !== 'websocket' ? 403 : refuse(req, url)
    if (status === undefined) tunnel(req, socket, head, dshPort, dshCookie, sockets, config.phoneSilenceMs)
    else refuseUpgrade(socket, status)
  })
  return { server, sockets, invite, paired, pairedUntil }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return (server.address() as AddressInfo).port
}

/** Keep startup diagnostics bounded. */
function captureOutput(child: ChildProcess): () => string {
  let text = ''
  const append = (chunk: Buffer): void => { text = (text + chunk.toString()).slice(-2_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return () => text.replace(/\s+/gu, ' ').trim()
}

/**
 * Signal the child's whole process group so a wrapper script or ProxyCommand grandchild is not
 * left running when the tunnel stops.
 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try { process.kill(-child.pid, signal) } catch { child.kill(signal) }
}

function settled(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => { setTimeout(() => { resolve(false) }, timeoutMs).unref() }),
  ])
}

async function stopChild(child: ChildProcess, exited: Promise<void>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  killTree(child, 'SIGTERM')
  if (await settled(exited, timeoutMs)) return
  killTree(child, 'SIGKILL')
  // A surviving grandchild holding the pipes must not keep `exited` pending.
  child.stdout?.destroy()
  child.stderr?.destroy()
  await settled(exited, timeoutMs)
}

async function closeProxy({ server, sockets }: Proxy): Promise<void> {
  for (const socket of sockets) socket.destroy()
  if (!server.listening) return
  const closed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  server.closeAllConnections()
  await closed
}

export function apply(ctx: Context, config: Config): void {
  let active: Tunnel | undefined
  let disposed = false
  let recoveryEpoch = 0
  let operation: Promise<void> = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = operation.then(run)
    operation = result.then(() => {}, () => {})
    return result
  }
  const stop = async (): Promise<void> => {
    recoveryEpoch++
    const current = active
    active = undefined
    if (current === undefined) return
    await closeProxy(current.proxy)
    await stopChild(current.child, current.exited, config.stopTimeoutMs)
  }
  // The tunnel serves every Workspace; a paired phone stays connected when the desktop changes Workspace.
  const start = async (workspaceId?: string, refresh = false): Promise<Invitation & { workspaceId?: string }> => {
    if (workspaceId === undefined) return open(refresh)
    if (ctx.workspaceRegistry.get(workspaceId as WorkspaceId) === undefined) throw new Error('Unknown workspace')
    return { ...await open(refresh), workspaceId }
  }
  const open = async (refresh = false): Promise<Invitation> => {
    if (active !== undefined) return active.proxy.invite(refresh)
    const ssh = config.ssh ?? undefined
    if (ssh === undefined) throw new Error('SSH tunnel is not configured')
    const baseUrl = sshPublicUrl(ssh)
    const dshCookie = await localCookie(ctx)
    const pairing = browserProxy(baseUrl, ctx.webServer.port, dshCookie, config)
    const proxyPort = await listen(pairing.server)
    const child = spawn(ssh.binary, sshArguments(ssh, proxyPort), {
      env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    let sshReady = false
    // OpenSSH emits this only after the server acknowledges the requested reverse listener.
    const confirmation = 'debug1: remote forward success for: listen 127.0.0.1:' + String(ssh.remotePort) + ','
    let pending = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = pending + chunk.toString('utf8')
      sshReady ||= text.includes(confirmation)
      pending = text.slice(-confirmation.length)
    })
    const output = captureOutput(child)
    const failure = (message: string): Error => {
      const detail = output()
      return new Error(detail === '' ? message : message + ' — ' + detail)
    }
    let exitReason: Error | undefined
    const exited = new Promise<void>((resolve) => {
      child.once('error', (error) => { exitReason = failure(error.message); resolve() })
      child.once('close', (code, signal) => {
        exitReason ??= failure('SSH tunnel exited (' + String(code ?? signal) + ')')
        resolve()
      })
    })
    void exited.then(async () => {
      if (active?.child === child) {
        const current = active
        const epoch = recoveryEpoch
        active = undefined
        await closeProxy(current.proxy)
        void restore(epoch)
      }
    })
    try {
      const deadline = Date.now() + config.startupTimeoutMs
      while (Date.now() < deadline && exitReason === undefined) {
        if (sshReady) {
          active = { child, exited, proxy: pairing }
          return pairing.invite()
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      throw exitReason ?? failure('SSH tunnel did not become ready before the startup timeout')
    } catch (error) {
      await closeProxy(pairing)
      await stopChild(child, exited, config.stopTimeoutMs)
      throw error
    }
  }
  // Keep recovering across network changes while the phone's pairing still grants access.
  const restore = async (epoch: number): Promise<void> => {
    while (!disposed && epoch === recoveryEpoch) {
      try {
        await serialize(async () => {
          if (!disposed && epoch === recoveryEpoch && loadPairing() !== undefined) await open()
        })
        return
      } catch { /* not ready yet */ }
      await new Promise((resolve) => { setTimeout(resolve, 2_000).unref() })
    }
  }
  const bark = config.bark ?? undefined
  const notifications = notificationSettings(join(dirname(pairingFile()), 'notifications.json'))
  if (bark !== undefined) watchSessions(ctx, (notice) => {
    if (notifications.allows(notice.sessionId, notice.kind)) void pushBark(bark, notice)
  })
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-control/notifications', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: notifications.fetch,
  }), 'remote-control: session notifications')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-control/files', methods: ['GET'], requestBody: 'buffered', fetch: computerFiles,
  }), 'remote-control: computer directory route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-control', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return Response.json(active === undefined
        ? { active: false }
        : { active: true, paired: active.proxy.paired(), pairedUntil: active.proxy.pairedUntil() })
      let body: unknown
      try { body = await request.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
      if (!record(body)) return new Response('Invalid request', { status: 400 })
      try {
        if ((body.action === 'start' || body.action === 'refresh')
          && (body.workspaceId === undefined || typeof body.workspaceId === 'string')) {
          return Response.json(await serialize(() => start(body.workspaceId as string | undefined, body.action === 'refresh')))
        }
        if (body.action === 'stop') {
          // Stopping revokes the phone; a reload or DSH exit only closes the tunnel.
          await serialize(async () => { await stop(); savePairing(undefined) })
          return Response.json({ active: false })
        }
        return new Response('Invalid request', { status: 400 })
      } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), { status: 409 })
      }
    },
  }), 'remote-control: local control route')
  ctx.effect(() => () => { disposed = true; return serialize(stop) }, 'remote-control: tunnel shutdown')
  // A reload or DSH restart closes the tunnel, usually while nobody is at the desktop to reopen it.
  // Reopen it for a phone that is still paired. The previous instance may still hold the remote
  // port or the network may still be coming up, so retry while the pairing is valid.
  if (config.ssh !== undefined) void restore(recoveryEpoch)
}
