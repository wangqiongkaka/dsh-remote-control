/** Paired mobile access to an existing DSH Web process through a managed CLI tunnel. */

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer, request as httpRequest, STATUS_CODES,
  type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse,
} from 'node:http'
import { promisify } from 'node:util'
import { connect, type AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { phoneDocument } from './phone-document.ts'

export const name = 'dsh-remote-control'
export const inject = ['connection', 'webServer', 'workspaceRegistry']

/** Tunnel and pairing settings. */
export interface Config {
  tailscaleBinary: string
  /** `public` opens an internet ingress; `tailnet` serves Tailscale peers only. */
  access: 'public' | 'tailnet'
  funnelPort: 443 | 8443 | 10000
  invitationTtlMs: number
  /** Phone access lifetime; 0 disables time-based expiry. */
  browserTtlMs: number
  startupTimeoutMs: number
  stopTimeoutMs: number
}

export const Config: z<Config> = z.object({
  tailscaleBinary: z.string().min(1).default('tailscale'),
  access: z.union([z.const('public'), z.const('tailnet')]).default('public'),
  funnelPort: z.union([z.const(443), z.const(8443), z.const(10000)]).default(443),
  invitationTtlMs: z.natural().min(1_000).default(5 * 60_000),
  browserTtlMs: z.union([z.const(0), z.natural().min(1_000).max(24 * 60 * 60_000)]).default(0),
  startupTimeoutMs: z.natural().min(1_000).default(30_000),
  stopTimeoutMs: z.natural().min(1_000).default(5_000),
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
    invite: () => Invitation
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
  // Apps launched from Finder or the Dock get /usr/bin:/bin:/usr/sbin:/sbin, which misses the Mac App
  // and Homebrew CLIs; spawn looks the binary up in this PATH.
  env.PATH = [env.PATH, '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':')
  return env
}

async function cliRun(binary: string, args: readonly string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(binary, [...args], {
    env: cliEnv(), timeout: 10_000, maxBuffer: 1024 * 1024,
  })
  return stdout
}

async function cliJson(binary: string, args: readonly string[]): Promise<unknown> {
  return JSON.parse(await cliRun(binary, args))
}

/** The port of a loopback proxy target, or undefined for any other address. */
function loopbackPort(target: string): number | undefined {
  let url: URL
  try { url = new URL(target) } catch { return undefined }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return undefined
  const port = Number(url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : url.port)
  return Number.isSafeInteger(port) && port > 0 && port < 65_536 ? port : undefined
}

/** Whether a loopback port accepts connections right now. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const settle = (result: boolean): void => { socket.destroy(); resolve(result) }
    socket.once('connect', () => { settle(true) })
    socket.once('error', () => { settle(false) })
    socket.setTimeout(1_000, () => { settle(false) })
  })
}

/** TCP listeners are shared by Serve and Funnel, including foreground sessions. */
function portAvailable(status: unknown, port: number): boolean {
  if (!record(status)) return false
  if (Object.keys(status).length === 0) return true
  if ('TCP' in status && (!record(status.TCP) || String(port) in status.TCP)) return false
  if ('Foreground' in status && (!record(status.Foreground)
    || Object.values(status.Foreground).some(session => !portAvailable(session, port)))) return false
  // An unrecognised nonempty config cannot safely prove that the port is free.
  return record(status.TCP) || record(status.Foreground)
}

/**
 * A DSH process can exit without stopping its tunnel, leaving a foreground serve session whose
 * loopback proxy died with that process. Cleanup may retire the orphaned CLI only when there is
 * no background configuration or other listener port that a reset would also remove.
 */
async function abandoned(status: Record<string, unknown>, port: number): Promise<boolean> {
  if (Object.keys(status).length !== 1 || !('Foreground' in status)) return false
  if (!record(status.Foreground) || Object.values(status.Foreground).some(session =>
    !record(session) || !record(session.TCP) || Object.keys(session.TCP).length !== 1
    || !(String(port) in session.TCP))) return false
  const targets: string[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!record(value)) return
    for (const [key, item] of Object.entries(value)) {
      if (key === 'Proxy' && typeof item === 'string') targets.push(item)
      else walk(item)
    }
  }
  walk(status)
  if (targets.length === 0) return false
  for (const target of targets) {
    const port = loopbackPort(target)
    if (port === undefined || await listening(port)) return false
  }
  return true
}

function publicUrl(config: Config, status: unknown): string {
  if (!record(status) || status.BackendState !== 'Running' || !record(status.Self)
    || typeof status.Self.DNSName !== 'string' || status.Self.DNSName === '') {
    throw new Error('Tailscale must be connected and have a MagicDNS name')
  }
  const hostname = status.Self.DNSName.replace(/\.$/u, '')
  const port = config.funnelPort === 443 ? '' : ':' + String(config.funnelPort)
  const result = new URL('https://' + hostname + port + '/')
  if (result.hostname !== hostname || result.pathname !== '/') throw new Error('Invalid Tailscale DNS name')
  return result.href
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
function sendHtml(reply: IncomingMessage, res: ServerResponse, headers: IncomingHttpHeaders): void {
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
    const out = Buffer.from(phoneDocument(body), 'utf8')
    const rewritten: IncomingHttpHeaders = { ...headers, 'content-length': String(out.length) }
    delete rewritten['transfer-encoding']
    res.writeHead(reply.statusCode ?? 502, rewritten)
    res.end(out)
  })
}

/** Forward an admitted browser request to the existing loopback Web server. */
function forward(req: IncomingMessage, res: ServerResponse, port: number, dshCookie: string): void {
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
      sendHtml(reply, res, responseHeaders)
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

/** Splice an admitted WebSocket handshake (DSH live streams) onto the loopback Web server. */
function tunnel(req: IncomingMessage, socket: Duplex, head: Buffer, port: number, dshCookie: string, sockets: Set<Duplex>): void {
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
    if (head.length > 0) upSocket.write(head)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
  })
  upstream.end()
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
  /** Renew expired or spent invitations without disturbing the current phone. */
  const invite = (): Invitation => {
    if (used || Date.now() >= inviteExpiresAt) {
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
      res.writeHead(403).end()
      return
    }
    if (url.searchParams.has('pair')) {
      const pair = url.searchParams.getAll('pair')
      if (req.method !== 'GET' || url.pathname !== '/' || url.searchParams.size !== 1
        || pair.length !== 1 || used || Date.now() >= inviteExpiresAt
        || !equalToken(pair[0], ticket)) {
        res.writeHead(401).end()
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
      res.writeHead(status, {
        'cache-control': 'no-store', 'x-dsh-remote-control': status === 401 ? 'unpaired' : 'refused',
      }).end()
      return
    }
    // Admitted, so the presented cookie is the credential itself.
    if (config.browserTtlMs === 0) res.setHeader('set-cookie', browserCookie(cookieValue(req.headers.cookie) ?? ''))
    responses.add(res)
    res.once('close', () => { responses.delete(res) })
    forward(req, res, dshPort, dshCookie)
  })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => { socket.destroy() })
    const url = target(req)
    const status = url === undefined || req.headers.upgrade?.toLowerCase() !== 'websocket' ? 403 : refuse(req, url)
    if (status === undefined) tunnel(req, socket, head, dshPort, dshCookie, sockets)
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
 * Signal the child's whole process group: the `tailscale` on PATH is a wrapper script that does not
 * exec, so the CLI is a grandchild that a plain `child.kill()` would leave running.
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
  let operation: Promise<void> = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = operation.then(run)
    operation = result.then(() => {}, () => {})
    return result
  }
  const stop = async (): Promise<void> => {
    const current = active
    active = undefined
    if (current === undefined) return
    await closeProxy(current.proxy)
    await stopChild(current.child, current.exited, config.stopTimeoutMs)
  }
  // The tunnel serves every Workspace; a paired phone stays connected when the desktop changes Workspace.
  const start = async (workspaceId: string): Promise<Invitation & { workspaceId: string }> => {
    if (ctx.workspaceRegistry.get(workspaceId as WorkspaceId) === undefined) throw new Error('Unknown workspace')
    return { ...await open(), workspaceId }
  }
  const open = async (): Promise<Invitation> => {
    if (active !== undefined) return active.proxy.invite()
    const command = config.access === 'public' ? 'funnel' : 'serve'
    const label = 'Tailscale ' + (config.access === 'public' ? 'Funnel' : 'Serve')
    const baseUrl = publicUrl(config, await cliJson(config.tailscaleBinary, ['status', '--json']))
    const existing = await cliJson(config.tailscaleBinary, [command, 'status', '--json'])
    if (!portAvailable(existing, config.funnelPort)) {
      if (!record(existing) || !await abandoned(existing, config.funnelPort)) {
        throw new Error(label + ' port ' + String(config.funnelPort) + ' already has a configuration')
      }
      // Either verb can own the leftover, so clear both before claiming the port.
      for (const other of ['serve', 'funnel']) await cliRun(config.tailscaleBinary, [other, 'reset'])
    }
    const dshCookie = await localCookie(ctx)
    const pairing = browserProxy(baseUrl, ctx.webServer.port, dshCookie, config)
    const proxyPort = await listen(pairing.server)
    const target = 'http://127.0.0.1:' + String(proxyPort)
    const child = spawn(config.tailscaleBinary, [command, '--yes', '--https=' + String(config.funnelPort), target], {
      env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    const output = captureOutput(child)
    // Funnel prints why it refuses to start and then waits for an admin instead of exiting, so the
    // reason has to travel with whichever failure ends the wait.
    const failure = (message: string): Error => {
      const detail = output()
      return new Error(detail === '' ? message : message + ' — ' + detail)
    }
    let exitReason: Error | undefined
    const exited = new Promise<void>((resolve) => {
      child.once('error', (error) => { exitReason = failure(error.message); resolve() })
      child.once('close', (code, signal) => {
        exitReason ??= failure(label + ' exited (' + String(code ?? signal) + ')')
        resolve()
      })
    })
    void exited.then(() => {
      if (active?.child === child) {
        const current = active
        active = undefined
        void closeProxy(current.proxy)
      }
    })
    try {
      const deadline = Date.now() + config.startupTimeoutMs
      while (Date.now() < deadline && exitReason === undefined) {
        const ready = JSON.stringify(await cliJson(config.tailscaleBinary, [command, 'status', '--json'])).includes(target)
        if (ready && exitReason === undefined) {
          active = { child, exited, proxy: pairing }
          return pairing.invite()
        }
        // A public ingress the tailnet has not enabled is a setup step, not a slow start: report it
        // without the wait. `serve` needs no such permission.
        if (config.access === 'public' && /funnel is not enabled/iu.test(output())) {
          throw failure('Tailscale Funnel could not start')
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      throw exitReason ?? failure(label + ' did not become ready before the startup timeout')
    } catch (error) {
      await closeProxy(pairing)
      await stopChild(child, exited, config.stopTimeoutMs)
      throw error
    }
  }
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
        if (body.action === 'start' && typeof body.workspaceId === 'string') {
          return Response.json(await serialize(() => start(body.workspaceId as string)))
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
  let disposed = false
  ctx.effect(() => () => { disposed = true; return serialize(stop) }, 'remote-control: tunnel shutdown')
  // A reload or DSH restart closes the tunnel, usually while nobody is at the desktop to reopen it.
  // Reopen it for a phone that is still paired. The previous instance may still hold the port and
  // Tailscale may still be connecting after login, so keep trying for a minute.
  void (async () => {
    const deadline = Date.now() + 60_000
    while (!disposed && Date.now() < deadline) {
      try {
        // Checked in turn with the control route, so a stop that got in first is not undone.
        await serialize(async () => { if (!disposed && loadPairing() !== undefined) await open() })
        return
      } catch { /* not ready yet */ }
      await new Promise((resolve) => { setTimeout(resolve, 2_000).unref() })
    }
  })()
}
