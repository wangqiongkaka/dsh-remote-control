/** Standalone Tailscale Funnel access to an existing DSH Web process. */

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export const name = 'dsh-remote-control'
export const inject = ['connection', 'webServer', 'workspaceRegistry']

/** Tunnel and pairing settings. */
export interface Config {
  tailscaleBinary: string
  funnelPort: 443 | 8443 | 10000
  invitationTtlMs: number
  browserTtlMs: number
  startupTimeoutMs: number
  stopTimeoutMs: number
}

export const Config: z<Config> = z.object({
  tailscaleBinary: z.string().min(1).default('tailscale'),
  funnelPort: z.union([z.const(443), z.const(8443), z.const(10000)]).default(443),
  invitationTtlMs: z.natural().min(1_000).default(5 * 60_000),
  browserTtlMs: z.natural().min(1_000).max(24 * 60 * 60_000).default(12 * 60 * 60_000),
  startupTimeoutMs: z.natural().min(1_000).default(30_000),
  stopTimeoutMs: z.natural().min(1_000).default(5_000),
})

interface Tunnel {
  child: ChildProcess
  exited: Promise<void>
  proxy: Server
  url: string
  workspaceId: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cliEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
    value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN/i.test(name)
    && !name.toUpperCase().startsWith('DSH_'))) as Record<string, string>
}

async function cliJson(binary: string, args: readonly string[]): Promise<unknown> {
  const { stdout } = await promisify(execFile)(binary, [...args], {
    env: cliEnv(), timeout: 10_000, maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
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

function cookieValue(raw: string | undefined): string | undefined {
  return raw?.split(';').map(part => part.trim()).find(part => part.startsWith('dsh-remote-control='))?.slice('dsh-remote-control='.length)
}

function equalToken(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
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
  delete headers['x-forwarded-host']
  delete headers['x-forwarded-proto']
  delete headers.cookie
  headers.host = '127.0.0.1:' + String(port)
  headers.cookie = dshCookie
  if (headers.origin !== undefined) headers.origin = 'http://127.0.0.1:' + String(port)
  const upstream = httpRequest({
    hostname: '127.0.0.1', port, method: req.method, path: req.url, headers,
  }, (reply) => {
    const responseHeaders = { ...reply.headers }
    delete responseHeaders['set-cookie']
    delete responseHeaders.connection
    res.writeHead(reply.statusCode ?? 502, responseHeaders)
    reply.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
}

/** Pair one phone, then proxy all DSH Web routes through a revocable cookie. */
function browserProxy(baseUrl: string, workspaceId: string, dshPort: number, dshCookie: string, config: Config) {
  const authority = new URL(baseUrl).host
  const ticket = randomBytes(32).toString('base64url')
  const browserToken = randomBytes(32).toString('base64url')
  const inviteExpiresAt = Date.now() + config.invitationTtlMs
  let browserExpiresAt = 0
  let used = false
  const server = createServer((req, res) => {
    if (req.headers.host !== authority || req.url === undefined || !req.url.startsWith('/')) {
      res.writeHead(403).end()
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined && origin !== new URL(baseUrl).origin) {
      res.writeHead(403).end()
      return
    }
    const url = new URL(req.url, baseUrl)
    if (url.origin !== new URL(baseUrl).origin) {
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
        location: '/?remoteWorkspace=' + encodeURIComponent(workspaceId),
        'set-cookie': 'dsh-remote-control=' + browserToken + '; Max-Age='
          + String(Math.floor(config.browserTtlMs / 1000))
          + '; Path=/; HttpOnly; Secure; SameSite=Lax',
      }).end()
      return
    }
    if (req.headers['sec-fetch-site'] === 'cross-site'
      && (req.method !== 'GET' || url.pathname !== '/')) {
      res.writeHead(403).end()
      return
    }
    if (Date.now() >= browserExpiresAt || !equalToken(cookieValue(req.headers.cookie), browserToken)) {
      res.writeHead(401, { 'cache-control': 'no-store' }).end()
      return
    }
    if (url.pathname === '/api/remote-control') {
      res.writeHead(403).end()
      return
    }
    forward(req, res, dshPort, dshCookie)
  })
  return { server, url: baseUrl + '?pair=' + ticket }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return (server.address() as AddressInfo).port
}

async function stopChild(child: ChildProcess, exited: Promise<void>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => { resolve(false) }, timeoutMs) }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  if (!stopped) { child.kill('SIGKILL'); await exited }
}

async function closeProxy(server: Server): Promise<void> {
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
  const start = async (workspaceId: string): Promise<{ url: string; workspaceId: string }> => {
    if (ctx.workspaceRegistry.get(workspaceId as WorkspaceId) === undefined) throw new Error('Unknown workspace')
    if (active?.workspaceId === workspaceId) return { url: active.url, workspaceId }
    if (active !== undefined) await stop()
    const existing = await cliJson(config.tailscaleBinary, ['funnel', 'status', '--json'])
    if (!record(existing) || Object.keys(existing).length > 0) {
      throw new Error('Tailscale Funnel already has a configuration')
    }
    const baseUrl = await publicUrl(config)
    const dshCookie = await localCookie(ctx)
    const pairing = browserProxy(baseUrl, workspaceId, ctx.webServer.port, dshCookie, config)
    const proxyPort = await listen(pairing.server)
    const target = 'http://127.0.0.1:' + String(proxyPort)
    const child = spawn(config.tailscaleBinary, [
      'funnel', '--yes', '--https=' + String(config.funnelPort), target,
    ], { env: cliEnv(), stdio: 'ignore' })
    let exitReason: Error | undefined
    const exited = new Promise<void>((resolve) => {
      child.once('error', (error) => { exitReason = error; resolve() })
      child.once('close', (code, signal) => {
        exitReason ??= new Error('Tailscale Funnel exited (' + String(code ?? signal) + ')')
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
        const status = await cliJson(config.tailscaleBinary, ['funnel', 'status', '--json'])
        if (JSON.stringify(status).includes(target)) {
          active = { child, exited, proxy: pairing.server, url: pairing.url, workspaceId }
          return { url: pairing.url, workspaceId }
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      throw exitReason ?? new Error('Tailscale Funnel did not become ready before the startup timeout')
    } catch (error) {
      await closeProxy(pairing.server)
      await stopChild(child, exited, config.stopTimeoutMs)
      throw error
    }
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-control', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return Response.json(active === undefined
        ? { active: false }
        : { active: true, url: active.url, workspaceId: active.workspaceId })
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
