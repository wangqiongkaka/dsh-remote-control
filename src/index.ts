/** Standalone Tailscale Funnel access to an existing DSH Web process. */

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createServer, request as httpRequest, STATUS_CODES,
  type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse,
} from 'node:http'
import { promisify } from 'node:util'
import { connect, type AddressInfo } from 'node:net'
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
  /** `public` opens a Funnel ingress to the internet; `tailnet` serves Tailscale peers only. */
  access: 'public' | 'tailnet'
  funnelPort: 443 | 8443 | 10000
  invitationTtlMs: number
  browserTtlMs: number
  startupTimeoutMs: number
  stopTimeoutMs: number
}

export const Config: z<Config> = z.object({
  tailscaleBinary: z.string().min(1).default('tailscale'),
  access: z.union([z.const('public'), z.const('tailnet')]).default('public'),
  funnelPort: z.union([z.const(443), z.const(8443), z.const(10000)]).default(443),
  invitationTtlMs: z.natural().min(1_000).default(5 * 60_000),
  browserTtlMs: z.natural().min(1_000).max(24 * 60 * 60_000).default(12 * 60 * 60_000),
  startupTimeoutMs: z.natural().min(1_000).default(30_000),
  stopTimeoutMs: z.natural().min(1_000).default(5_000),
})

/** Public proxy plus the upgraded sockets `closeAllConnections()` does not reach. */
interface Proxy {
  server: Server
  sockets: Set<Duplex>
}

interface Tunnel {
  baseUrl: string
  dshCookie: string
  child: ChildProcess
  exited: Promise<void>
  proxy: Proxy & {
    invite: () => Invitation
    paired: () => boolean
    /** When the paired phone's access ends, or 0 while nobody is paired. */
    pairedUntil: () => number
    admits: (req: IncomingMessage) => boolean
  }
  preview?: { child: ChildProcess; exited: Promise<void>; proxy: Proxy & { invite: () => string }; port: number }
}

/** A pairing link, or the expiry of the phone already paired through the tunnel. */
type Invitation = { url: string; expiresAt: number } | { paired: true; expiresAt: number }

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

/**
 * A DSH process can exit without stopping its tunnel, leaving a foreground serve session whose
 * loopback proxy died with that process. Nothing else `tailscale funnel` wrote has this shape, so
 * clearing it is what retires the orphaned CLI; any other existing config stays untouched.
 */
async function abandoned(status: Record<string, unknown>): Promise<boolean> {
  if (Object.keys(status).length !== 1 || !('Foreground' in status)) return false
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

async function publicUrl(config: Config): Promise<string> {
  const status = await cliJson(config.tailscaleBinary, ['status', '--json'])
  if (!record(status) || status.BackendState !== 'Running' || !record(status.Self)
    || typeof status.Self.DNSName !== 'string' || status.Self.DNSName === '') {
    throw new Error('Tailscale must be connected with MagicDNS and Funnel enabled')
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

function cookieValue(raw: string | undefined, name = 'dsh-remote-control'): string | undefined {
  return raw?.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1)
}

function equalToken(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Cookies owned by DSH must never reach, or be replaced by, a frontend service. */
function privateCookie(cookie: string, dshCookie: string): boolean {
  const name = cookie.split('=', 1)[0]?.trim()
  return name === dshCookie.split('=', 1)[0] || name === 'dsh-remote-control' || name === 'dsh-frontend-preview'
}

/** Present an admitted request to its loopback backend. */
function loopbackHeaders(headers: IncomingHttpHeaders, port: number, dshCookie: string, frontend = false): IncomingHttpHeaders {
  delete headers['x-forwarded-host']
  delete headers['x-forwarded-proto']
  headers.host = '127.0.0.1:' + String(port)
  if (frontend) {
    const cookies = headers.cookie?.split(';').filter(cookie => !privateCookie(cookie, dshCookie)).join(';').trim()
    if (cookies) headers.cookie = cookies
    else delete headers.cookie
    // Incoming forwarding headers belong to the public client; replace them with our own.
    delete headers.forwarded
    delete headers['x-forwarded-for']
    headers['x-forwarded-proto'] = 'https'
  } else headers.cookie = dshCookie
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
function forward(req: IncomingMessage, res: ServerResponse, port: number, dshCookie: string, frontend = false): void {
  const headers = { ...req.headers }
  for (const field of req.headers.connection?.split(',') ?? []) delete headers[field.trim().toLowerCase()]
  delete headers.connection
  delete headers['proxy-connection']
  delete headers['keep-alive']
  delete headers.te
  delete headers.trailer
  delete headers.upgrade
  if (!frontend && String(req.headers.accept ?? '').includes('text/html')) {
    // Documents are rewritten for narrow screens, so they have to arrive uncompressed.
    delete headers['accept-encoding']
  }
  const upstream = httpRequest({
    hostname: '127.0.0.1', port, method: req.method, path: req.url,
    headers: loopbackHeaders(headers, port, dshCookie, frontend),
  }, (reply) => {
    const responseHeaders = { ...reply.headers }
    if (frontend) {
      const cookies = reply.headers['set-cookie']?.filter(cookie => !privateCookie(cookie, dshCookie))
        .map(cookie => cookie.replace(/;\s*Domain=[^;]*/giu, ''))
      if (cookies?.length) responseHeaders['set-cookie'] = cookies
      else delete responseHeaders['set-cookie']
      if (responseHeaders.location !== undefined) {
        try {
          const location = new URL(responseHeaders.location)
          if (loopbackPort(location.href) === port) {
            responseHeaders.location = 'https://' + req.headers.host + location.pathname + location.search + location.hash
          }
        } catch { /* Relative redirects already use the preview origin. */ }
      }
    } else delete responseHeaders['set-cookie']
    delete responseHeaders.connection
    if (!frontend && req.method === 'GET' && String(reply.headers['content-type'] ?? '').includes('text/html')) {
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
function tunnel(req: IncomingMessage, socket: Duplex, head: Buffer, port: number, dshCookie: string, sockets: Set<Duplex>, frontend = false): void {
  sockets.add(socket)
  const upstream = httpRequest({
    hostname: '127.0.0.1', port, method: req.method, path: req.url,
    headers: loopbackHeaders({ ...req.headers }, port, dshCookie, frontend),
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
function browserProxy(baseUrl: string, dshPort: number, dshCookie: string, config: Config, preview: (port: number) => Promise<string>) {
  const { host: authority, origin } = new URL(baseUrl)
  const sockets = new Set<Duplex>()
  let ticket = ''
  let browserToken = ''
  let inviteExpiresAt = 0
  let browserExpiresAt = 0
  let used = false
  const paired = (): boolean => used && Date.now() < browserExpiresAt
  const admits = (req: IncomingMessage): boolean => paired() && equalToken(cookieValue(req.headers.cookie), browserToken)
  /** Renew the invitation once expired or spent, never while a phone is paired. */
  const invite = (): Invitation => {
    if (paired()) return { paired: true, expiresAt: browserExpiresAt }
    if (used || Date.now() >= inviteExpiresAt) {
      ticket = randomBytes(32).toString('base64url')
      browserToken = randomBytes(32).toString('base64url')
      inviteExpiresAt = Date.now() + config.invitationTtlMs
      used = false
    }
    return { url: baseUrl + '?pair=' + ticket, expiresAt: inviteExpiresAt }
  }
  /** The dialog follows the pairing state without being reopened. */
  const pairedUntil = (): number => paired() ? browserExpiresAt : 0
  /** Host/Origin fence: the request URL on the public origin, or undefined to refuse with 403. */
  const target = (req: IncomingMessage): URL | undefined => {
    if (req.headers.host !== authority || req.url === undefined || !req.url.startsWith('/')) return undefined
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return undefined
    try {
      const url = new URL(req.url, baseUrl)
      return url.origin === origin ? url : undefined
    } catch { return undefined }
  }
  /** Status refusing a paired-browser request, or undefined when it may reach DSH. */
  const refuse = (req: IncomingMessage, url: URL): number | undefined => {
    if (req.headers['sec-fetch-site'] === 'cross-site' && (req.method !== 'GET' || url.pathname !== '/')) return 403
    if (!admits(req)) return 401
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
      browserExpiresAt = Date.now() + config.browserTtlMs
      res.writeHead(303, {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        location: '/',
        'set-cookie': 'dsh-remote-control=' + browserToken + '; Max-Age='
          + String(Math.floor(config.browserTtlMs / 1000))
          + '; Path=/; HttpOnly; Secure; SameSite=Lax',
      }).end()
      return
    }
    const status = refuse(req, url)
    if (status !== undefined) {
      res.writeHead(status, { 'cache-control': 'no-store' }).end()
      return
    }
    if (url.pathname === '/api/remote-control/preview') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return }
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 1024) chunks.push(chunk) })
      req.on('end', () => {
        if (size > 1024) { res.writeHead(413).end(); return }
        let body: unknown
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
        if (!record(body) || typeof body.port !== 'number' || !Number.isInteger(body.port)
          || body.port < 1 || body.port > 65535 || body.port === dshPort) {
          res.writeHead(400).end('请输入有效的前端开发端口'); return
        }
        void preview(body.port).then(link => {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            .end(JSON.stringify({ url: link }))
        }, (error: unknown) => {
          res.writeHead(409, { 'cache-control': 'no-store' }).end(error instanceof Error ? error.message : String(error))
        })
      })
      return
    }
    forward(req, res, dshPort, dshCookie)
  })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => { socket.destroy() })
    const url = target(req)
    const status = url === undefined || url.pathname === '/api/remote-control/preview'
      || req.headers.upgrade?.toLowerCase() !== 'websocket' ? 403 : refuse(req, url)
    if (status === undefined) tunnel(req, socket, head, dshPort, dshCookie, sockets)
    else refuseUpgrade(socket, status)
  })
  return { server, sockets, invite, paired, pairedUntil, admits }
}

/** An independent origin preserves frontend root paths and never exposes DSH credentials. */
function frontendProxy(baseUrl: string, port: number, dshCookie: string, parent: Tunnel['proxy'], config: Config) {
  const { host, origin } = new URL(baseUrl)
  const sockets = new Set<Duplex>()
  const token = randomBytes(32).toString('base64url')
  let ticket = ''
  let expiresAt = 0
  const invite = (): string => {
    ticket = randomBytes(32).toString('base64url')
    expiresAt = Math.min(Date.now() + config.invitationTtlMs, parent.pairedUntil())
    return baseUrl + '?__dsh_preview=' + ticket
  }
  const status = (req: IncomingMessage): number | undefined => {
    if (req.headers.host !== host || req.url === undefined || !req.url.startsWith('/')
      || (req.headers.origin !== undefined && req.headers.origin !== origin)
      || req.headers['sec-fetch-site'] === 'cross-site') return 403
    try { if (new URL(req.url, baseUrl).origin !== origin) return 403 } catch { return 403 }
    if (!parent.admits(req)) return 401
    return undefined
  }
  const server = createServer((req, res) => {
    const denied = status(req)
    if (denied !== undefined) { res.writeHead(denied, { 'cache-control': 'no-store' }).end(); return }
    const url = new URL(req.url!, baseUrl)
    if (url.searchParams.has('__dsh_preview')) {
      if (req.method !== 'GET' || url.pathname !== '/' || url.searchParams.size !== 1
        || url.searchParams.getAll('__dsh_preview').length !== 1 || ticket === '' || Date.now() >= expiresAt
        || !equalToken(url.searchParams.get('__dsh_preview') ?? undefined, ticket)) { res.writeHead(401).end(); return }
      ticket = ''
      res.writeHead(303, { location: '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'set-cookie': 'dsh-frontend-preview=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='
          + Math.max(0, Math.floor((parent.pairedUntil() - Date.now()) / 1000)),
      }).end()
      return
    }
    if (!equalToken(cookieValue(req.headers.cookie, 'dsh-frontend-preview'), token)) {
      res.writeHead(401, { 'cache-control': 'no-store' }).end(); return
    }
    forward(req, res, port, dshCookie, true)
  })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => { socket.destroy() })
    const denied = req.headers.upgrade?.toLowerCase() !== 'websocket' ? 403 : status(req)
    const authentication = denied ?? (equalToken(cookieValue(req.headers.cookie, 'dsh-frontend-preview'), token) ? undefined : 401)
    if (authentication === undefined) tunnel(req, socket, head, port, dshCookie, sockets, true)
    else refuseUpgrade(socket, authentication)
  })
  return { server, sockets, invite }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return (server.address() as AddressInfo).port
}

/** The tail of a child's output: Tailscale explains there why a Funnel command refuses to start. */
function captureOutput(child: ChildProcess, limit = 2_000): () => string {
  let text = ''
  const append = (chunk: Buffer): void => { text = (text + chunk.toString()).slice(-limit) }
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

/** Start one foreground HTTPS listener without replacing other Tailscale listeners. */
async function launchTunnel(config: Config, command: 'serve' | 'funnel', port: number, proxy: Proxy):
  Promise<{ child: ChildProcess; exited: Promise<void> }> {
  const proxyPort = await listen(proxy.server)
  const target = 'http://127.0.0.1:' + String(proxyPort)
  const label = command === 'funnel' ? 'Funnel' : 'Serve'
  const child = spawn(config.tailscaleBinary, [command, '--yes', '--https=' + String(port), target],
    { env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const output = captureOutput(child)
  const failure = (message: string): Error => {
    const detail = output()
    return new Error(detail === '' ? message : message + ' — ' + detail)
  }
  let exitReason: Error | undefined
  const exited = new Promise<void>((resolve) => {
    child.once('error', (error) => { exitReason = failure(error.message); resolve() })
    child.once('close', (code, signal) => {
      exitReason ??= failure('Tailscale ' + label + ' exited (' + String(code ?? signal) + ')')
      resolve()
    })
  })
  try {
    const deadline = Date.now() + config.startupTimeoutMs
    while (Date.now() < deadline && exitReason === undefined) {
      const status = await cliJson(config.tailscaleBinary, [command, 'status', '--json'])
      if (JSON.stringify(status).includes(target)) return { child, exited }
      if (command === 'funnel' && /funnel is not enabled/iu.test(output())) throw failure('Tailscale Funnel could not start')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw exitReason ?? failure('Tailscale ' + label + ' did not become ready before the startup timeout')
  } catch (error) {
    await closeProxy(proxy)
    await stopChild(child, exited, config.stopTimeoutMs)
    throw error
  }
}

/** A listener on this port may belong to another application; never replace it. */
function usesPort(status: unknown, port: number): boolean {
  if (!record(status)) return false
  if (record(status.TCP) && String(port) in status.TCP) return true
  return Object.values(status).some(value => usesPort(value, port))
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
    const preview = current.preview
    if (preview !== undefined) {
      delete current.preview
      await closeProxy(preview.proxy)
      await stopChild(preview.child, preview.exited, config.stopTimeoutMs)
    }
    await closeProxy(current.proxy)
    await stopChild(current.child, current.exited, config.stopTimeoutMs)
  }
  const preview = async (port: number): Promise<string> => {
    const current = active
    if (current === undefined || !current.proxy.paired()) throw new Error('远程配对已过期，请重新连接')
    if ([current.proxy.server, current.preview?.proxy.server].some(server =>
      (server?.address() as AddressInfo | null | undefined)?.port === port)) throw new Error('不能预览远程控制代理端口')
    if (!await listening(port)) throw new Error('该端口没有运行前端服务，请先在电脑上启动服务')
    if (current.preview?.port === port) return current.preview.proxy.invite()
    const httpsPort = config.funnelPort === 8443 ? 10000 : 8443
    const previous = current.preview
    if (previous !== undefined) {
      delete current.preview
      await closeProxy(previous.proxy)
      await stopChild(previous.child, previous.exited, config.stopTimeoutMs)
    }
    if (usesPort(await cliJson(config.tailscaleBinary, ['serve', 'status', '--json']), httpsPort)) {
      throw new Error('Tailscale HTTPS 端口 ' + httpsPort + ' 已被占用，未修改现有配置')
    }
    const base = new URL(current.baseUrl)
    base.port = String(httpsPort)
    const proxy = frontendProxy(base.href, port, current.dshCookie, current.proxy, config)
    const { child, exited } = await launchTunnel(config, 'serve', httpsPort, proxy)
    const started = { child, exited, proxy, port }
    current.preview = started
    const expiry = setTimeout(() => { void serialize(async () => {
      if (current.preview !== started) return
      delete current.preview
      await closeProxy(proxy)
      await stopChild(child, exited, config.stopTimeoutMs)
    }) }, Math.max(0, current.proxy.pairedUntil() - Date.now())).unref()
    void exited.then(() => {
      clearTimeout(expiry)
      if (current.preview?.child === child) delete current.preview
      void closeProxy(proxy)
    })
    return proxy.invite()
  }
  // The tunnel serves every Workspace; a paired phone stays connected when the desktop changes Workspace.
  const start = async (workspaceId: string): Promise<Invitation & { workspaceId: string }> => {
    if (ctx.workspaceRegistry.get(workspaceId as WorkspaceId) === undefined) throw new Error('Unknown workspace')
    if (active !== undefined) return { ...active.proxy.invite(), workspaceId }
    // `serve` reaches Tailscale peers only; `funnel` adds the public ingress in front of the same config.
    const command = config.access === 'public' ? 'funnel' : 'serve'
    const label = config.access === 'public' ? 'Funnel' : 'Serve'
    const existing = await cliJson(config.tailscaleBinary, [command, 'status', '--json'])
    if (!record(existing) || Object.keys(existing).length > 0) {
      if (!record(existing) || !await abandoned(existing)) {
        throw new Error('Tailscale ' + label + ' already has a configuration')
      }
      // Either verb can own the leftover, so clear both before claiming the port.
      for (const other of ['serve', 'funnel']) await cliRun(config.tailscaleBinary, [other, 'reset'])
    }
    const baseUrl = await publicUrl(config)
    const dshCookie = await localCookie(ctx)
    const pairing = browserProxy(baseUrl, ctx.webServer.port, dshCookie, config,
      port => serialize(() => preview(port)))
    const { child, exited } = await launchTunnel(config, command, config.funnelPort, pairing)
    active = { child, exited, proxy: pairing, baseUrl, dshCookie }
    void exited.then(() => {
      if (active?.child === child) void serialize(stop)
    })
    return { ...pairing.invite(), workspaceId }
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
          await serialize(stop)
          return Response.json({ active: false })
        }
        return new Response('Invalid request', { status: 400 })
      } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), { status: 409 })
      }
    },
  }), 'remote-control: local control route')
  ctx.effect(() => () => serialize(stop), 'remote-control: Funnel shutdown')
}
