import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { gzipSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, type Config } from '../dist/index.js'

let directory: string | undefined
let backend: Server | undefined
let stop: (() => Promise<void>) | undefined
/** Serve the document gzipped even though the proxy asks for identity. */
let compressedHtml = false

afterEach(async () => {
  compressedHtml = false
  await stop?.()
  stop = undefined
  await new Promise<void>(resolve => { backend?.close(() => resolve()) ?? resolve() })
  backend = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

it.skipIf(process.platform === 'win32')('pairs once, forwards the full Web UI, and revokes the phone', async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-remote-control-'))
  const state = join(directory, 'funnel-target')
  const binary = join(directory, 'tailscale')
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs')
const state = ${JSON.stringify(state)}
const args = process.argv.slice(2)
if (args[0] === 'status') console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'host.tailnet.ts.net.' } }))
else if (args[1] === 'status') console.log(fs.existsSync(state) ? JSON.stringify({ Web: { Proxy: fs.readFileSync(state, 'utf8') } }) : '{}')
else if (args[0] === 'funnel') {
  fs.writeFileSync(state, args.at(-1))
  process.on('SIGTERM', () => { fs.unlinkSync(state); process.exit(0) })
  setInterval(() => {}, 1000)
} else process.exit(1)
`)
  await chmod(binary, 0o700)
  backend = createServer((req, res) => {
    if (req.url === '/?token=launch') {
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=signed; Path=/; HttpOnly' }).end()
      return
    }
    if (req.headers.cookie !== 'dsh-session=signed') { res.writeHead(401).end(); return }
    if (req.url === '/') {
      const html = '<head></head><main>DSH Web</main>'
      if (compressedHtml || (req.headers['accept-encoding'] ?? '').includes('gzip')) {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync(html))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(html)
      return
    }
    if (req.url === '/api/echo') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          origin: req.headers.origin, cookie: req.headers.cookie,
          body: Buffer.concat(chunks).toString('utf8'),
        }))
      })
      return
    }
    res.writeHead(404).end()
  })
  backend.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    socket.on('error', () => {})
    if (req.url !== '/api/remote.mux' || req.headers.cookie !== 'dsh-session=signed'
      || req.headers.origin !== 'http://127.0.0.1:' + String(dshPort)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.pipe(socket)
  })
  await new Promise<void>(resolve => { backend?.listen(0, '127.0.0.1', resolve) })
  const dshPort = (backend.address() as AddressInfo).port
  let route: ConnectionFetchRoute | undefined
  const ctx = {
    connection: {
      authenticatedUrl: (url: string) => url + '?token=launch',
      fetch: { register(value: ConnectionFetchRoute) { route = value; return async () => {} } },
    },
    webServer: { port: dshPort },
    workspaceRegistry: { get: (id: string) => id.startsWith('workspace-') ? { workspaceId: id } : undefined },
    effect(register: () => (() => void | Promise<void>)) {
      const dispose = register()
      if (route !== undefined) stop = async () => { await dispose() }
    },
  }
  const config: Config = {
    tailscaleBinary: binary, access: 'public', funnelPort: 443, invitationTtlMs: 60_000,
    browserTtlMs: 60_000, startupTimeoutMs: 5_000, stopTimeoutMs: 5_000,
  }
  apply(ctx as never as Context, config)
  if (route === undefined) throw new Error('Control route not installed')
  const control = route as ConnectionFetchRoute
  const post = (body: object) => control.fetch(new Request('http://localhost/api/remote-control', {
    method: 'POST', body: JSON.stringify(body),
  }))
  expect((await post({ action: 'start', workspaceId: 'missing' })).status).toBe(409)
  const started = await post({ action: 'start', workspaceId: 'workspace-1' })
  expect(started.status).toBe(200)
  const { url: first } = await started.json() as { url: string }
  expect(first).toMatch(/^https:\/\/host\.tailnet\.ts\.net\/\?pair=/u)
  const invite = async (workspaceId: string) => (await post({ action: 'start', workspaceId })).json() as Promise<Record<string, unknown>>
  expect(await invite('workspace-2'))
    .toMatchObject({ url: first, workspaceId: 'workspace-2', expiresAt: expect.any(Number) })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 61_000)
  const { url } = await invite('workspace-2') as { url: string }
  vi.useRealTimers()
  expect(url).not.toBe(first)
  const proxy = await readFile(state, 'utf8')
  const local = new URL(proxy)
  const headers = { host: 'host.tailnet.ts.net' }
  const request = (path: string, more: Record<string, string> = {}, method = 'GET', body = ''): Promise<Response> =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: local.hostname, port: Number(local.port), path, method,
        headers: { ...headers, ...more },
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        incoming.on('end', () => {
          const responseHeaders = new Headers()
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (typeof value === 'string') responseHeaders.set(name, value)
            else if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item)
          }
          resolve(new Response(Buffer.concat(chunks).toString('utf8'), {
            status: incoming.statusCode ?? 502, headers: responseHeaders,
          }))
        })
        incoming.on('error', reject)
      })
      outgoing.on('error', reject)
      outgoing.end(body)
    })
  const upgrade = (more: Record<string, string>): Promise<{ status?: number; socket?: Duplex }> =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: local.hostname, port: Number(local.port), path: '/api/remote.mux',
        headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket', ...more },
      })
      outgoing.on('upgrade', (_reply, socket) => { resolve({ socket }) })
      outgoing.on('response', (reply) => { reply.resume(); resolve({ status: reply.statusCode ?? 502 }) })
      outgoing.on('error', reject)
      outgoing.end()
    })
  expect((await request('/api/echo')).status).toBe(401)
  expect((await upgrade({})).status).toBe(401)
  expect((await request('//other.invalid/?pair=x')).status).toBe(403)
  expect((await request('/?pair=wrong')).status).toBe(401)
  const paired = await request(new URL(url).pathname + new URL(url).search, { 'sec-fetch-site': 'cross-site' })
  expect(paired.status).toBe(303)
  expect(paired.headers.get('location')).toBe('/')
  const cookie = paired.headers.get('set-cookie')?.split(';', 1)[0]
  expect(cookie).toMatch(/^dsh-remote-control=/u)
  expect((await request(new URL(url).pathname + new URL(url).search)).status).toBe(401)
  expect((await request(new URL(first).pathname + new URL(first).search)).status).toBe(401)
  expect(await invite('workspace-2')).toMatchObject({ paired: true, expiresAt: expect.any(Number) })
  expect(await invite('workspace-1')).toMatchObject({ paired: true })
  expect(await (await control.fetch(new Request('http://localhost/api/remote-control'))).json())
    .toEqual({ active: true, paired: true, pairedUntil: expect.any(Number) })
  const page = await request('/', {
    cookie: cookie ?? '', accept: 'text/html', 'accept-encoding': 'gzip',
  })
  expect(page.status).toBe(200)
  const markup = await page.text()
  // A compressed body must never come back rewritten as if it were text.
  expect(markup).toContain('<main>DSH Web</main>')
  // The phone gets the proxy's narrow-screen layer on top of the shell it forwards.
  expect(markup).toContain('data-dsh-remote-control')
  // The drawer layer carries the dismissal scrim's visibility rules.
  expect(markup).toContain('[data-remote-control-scrim]')
  // The composer row is one strip: both host groups dissolve into it, so every chip between the
  // attach button and the send circle slides while those stay pinned at the two ends.
  expect(markup).toContain('> [class*="_tools"]:not([hidden])) > [class*="_trailing"]{display:contents}')
  expect(markup).toContain('> [class*="_add"]{position:sticky;left:0;z-index:2')
  expect(markup).toContain('> [class*="_primary"]{position:sticky;right:8px;z-index:2}')
  expect(markup).toContain('> [class*="_activity"]{position:sticky;right:46px;z-index:2}')
  // ...with an opaque floor under the tail and a popup that hangs off the card instead of the row.
  expect(markup).toContain('::after{content:"";position:sticky;right:0;z-index:1;align-self:stretch;flex:none;width:74px')
  expect(markup).toContain('[class*="hp-anchor"]{position:static}')
  expect(markup).toContain('[class*="hp-panel"]{bottom:50px !important}')
  // A document without a viewport meta gets the keyboard-aware one.
  expect(markup).toContain('interactive-widget=resizes-content')
  // The keyboard patch's stylesheet is present for the client attribute it keys on.
  expect(markup).toContain('[data-dsh-remote-keyboard]')
  // While typing, the composer is anchored outside the chat scroller's scrolling geometry.
  expect(markup).toContain('[data-composer-seat]{position:absolute !important;inset:auto 0 0}')
  compressedHtml = true
  const compressed = await request('/', {
    cookie: cookie ?? '', accept: 'text/html',
  })
  expect(compressed.headers.get('content-encoding')).toBe('gzip')
  expect(await compressed.text()).not.toContain('data-dsh-remote-control')
  expect((await request('/', {
    cookie: cookie ?? '', 'sec-fetch-site': 'cross-site',
  })).status).toBe(200)
  const echo = await request('/api/echo', { cookie: cookie ?? '', origin: 'https://host.tailnet.ts.net' })
  expect(await echo.json()).toEqual({ origin: 'http://127.0.0.1:' + dshPort, cookie: 'dsh-session=signed', body: '' })
  const posted = await request('/api/echo', { cookie: cookie ?? '', origin: 'https://host.tailnet.ts.net' }, 'POST', '{"message":"hello"}')
  expect(await posted.json()).toMatchObject({ body: '{"message":"hello"}', cookie: 'dsh-session=signed' })
  expect((await request('/api/remote-control', { cookie: cookie ?? '' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: cookie ?? '', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: cookie ?? '', origin: 'https://evil.invalid' })).status).toBe(403)
  const socket = (await upgrade({ cookie: cookie ?? '', origin: 'https://host.tailnet.ts.net' })).socket
  if (socket === undefined) throw new Error('WebSocket upgrade was refused')
  socket.on('error', () => {})
  const socketClosed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  const echoed = new Promise<string>((resolve) => { socket.once('data', (chunk: Buffer) => { resolve(chunk.toString('utf8')) }) })
  socket.write('ping')
  expect(await echoed).toBe('ping')
  expect((await upgrade({ cookie: cookie ?? '', origin: 'https://evil.invalid' })).status).toBe(403)
  expect((await post({ action: 'stop' })).status).toBe(200)
  await socketClosed
  await expect(request('/api/echo', { cookie: cookie ?? '' })).rejects.toThrow()
  await writeFile(state, 'http://127.0.0.1:9999')
  expect((await post({ action: 'start', workspaceId: 'workspace-1' })).status).toBe(409)
})

/** A fake Tailscale CLI that answers status and then runs `funnel` as the given script body. */
function fakeCli(funnel: string, status = "'{}'"): string {
  return `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const home = path.dirname(process.argv[1])
const args = process.argv.slice(2)
if (args[0] === 'status') console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'host.tailnet.ts.net.' } }))
else if (args[1] === 'status') console.log(${status})
else if (args[0] === 'funnel' || args[0] === 'serve') {
${funnel}
} else process.exit(1)
`
}

/** Applies the plugin against a fake CLI and returns its control route. */
async function controlRoute(
  funnel: string, startupTimeoutMs: number, status = "'{}'", wrap = false,
  access: Config['access'] = 'public',
): Promise<ConnectionFetchRoute> {
  directory = await mkdtemp(join(tmpdir(), 'dsh-remote-control-'))
  const binary = join(directory, 'tailscale')
  if (wrap) {
    // /usr/local/bin/tailscale is a shell script without exec, so the CLI becomes a grandchild.
    const cli = join(directory, 'cli.cjs')
    await writeFile(cli, fakeCli(funnel, status))
    await writeFile(binary, `#!/bin/sh\n/usr/bin/env node ${JSON.stringify(cli)} "$@"\n`)
  } else await writeFile(binary, fakeCli(funnel, status))
  await chmod(binary, 0o700)
  backend = createServer((_req, res) => {
    res.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=signed; Path=/; HttpOnly' }).end()
  })
  await new Promise<void>(resolve => { backend?.listen(0, '127.0.0.1', resolve) })
  const dshPort = (backend.address() as AddressInfo).port
  let route: ConnectionFetchRoute | undefined
  const ctx = {
    connection: {
      authenticatedUrl: (url: string) => url + '?token=launch',
      fetch: { register(value: ConnectionFetchRoute) { route = value; return async () => {} } },
    },
    webServer: { port: dshPort },
    workspaceRegistry: { get: (id: string) => id.startsWith('workspace-') ? { workspaceId: id } : undefined },
    effect(register: () => (() => void | Promise<void>)) {
      const dispose = register()
      if (route !== undefined) stop = async () => { await dispose() }
    },
  }
  apply(ctx as never as Context, {
    tailscaleBinary: binary, access, funnelPort: 443, invitationTtlMs: 60_000,
    browserTtlMs: 60_000, startupTimeoutMs, stopTimeoutMs: 5_000,
  })
  if (route === undefined) throw new Error('Control route not installed')
  return route
}

const begin = (route: ConnectionFetchRoute): Promise<Response> => route.fetch(
  new Request('http://localhost/api/remote-control', {
    method: 'POST', body: JSON.stringify({ action: 'start', workspaceId: 'workspace-1' }),
  }),
)

it.skipIf(process.platform === 'win32')('reports an unenabled tailnet instead of waiting out the timeout', async () => {
  const route = await controlRoute(`  process.stderr.write('Funnel is not enabled on your tailnet.\\nTo enable, visit:\\n\\n         https://login.tailscale.com/f/funnel?node=abc\\n')
  setInterval(() => {}, 1000)`, 30_000)
  const started = Date.now()
  const response = await begin(route)
  expect(response.status).toBe(409)
  expect(await response.text()).toBe('Tailscale Funnel could not start — Funnel is not enabled on your'
    + ' tailnet. To enable, visit: https://login.tailscale.com/f/funnel?node=abc')
  expect(Date.now() - started).toBeLessThan(10_000)
}, 30_000)

it.skipIf(process.platform === 'win32')('carries the CLI output into the startup timeout error', async () => {
  const route = await controlRoute(`  process.stderr.write('sending serve config: updating config: listener already exists for port 443\\n')
  setInterval(() => {}, 1000)`, 1_000)
  const response = await begin(route)
  expect(response.status).toBe(409)
  expect(await response.text()).toBe('Tailscale Funnel did not become ready before the startup timeout'
    + ' — sending serve config: updating config: listener already exists for port 443')
})

/** A JS expression printing the serve config a `tailscale funnel` process leaves behind. */
function foreground(target: string): string {
  return 'JSON.stringify(' + JSON.stringify({
    Foreground: {
      session: {
        TCP: { 443: { HTTPS: true } },
        Web: { 'host.tailnet.ts.net:443': { Handlers: { '/': { Proxy: target } } } },
      },
    },
  }) + ')'
}

/** A loopback port that was just released, so nothing can be listening on it. */
async function deadPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(resolve => { server.close(() => resolve()) })
  return port
}

it.skipIf(process.platform === 'win32')('retires the tunnel a dead DSH process left behind', async () => {
  const stale = foreground('http://127.0.0.1:' + String(await deadPort()))
  const route = await controlRoute(`  if (args[1] === 'reset') { fs.writeFileSync(path.join(home, 'reset'), '1'); return }
  fs.writeFileSync(path.join(home, 'target'), args.at(-1))
  setInterval(() => {}, 1000)`, 5_000,
  `fs.existsSync(path.join(home, 'reset')) ? (fs.existsSync(path.join(home, 'target'))`
  + ` ? JSON.stringify({ Web: { Proxy: fs.readFileSync(path.join(home, 'target'), 'utf8') } }) : '{}') : ${stale}`)
  const response = await begin(route)
  expect(response.status).toBe(200)
  expect(await response.json())
    .toMatchObject({ url: expect.stringContaining('https://host.tailnet.ts.net/?pair=') })
})

it.skipIf(process.platform === 'win32')('still refuses a foreground tunnel that is serving', async () => {
  const live = createServer((_req, res) => { res.writeHead(200).end() })
  await new Promise<void>(resolve => { live.listen(0, '127.0.0.1', resolve) })
  try {
    const route = await controlRoute('  setInterval(() => {}, 1000)', 5_000,
      foreground('http://127.0.0.1:' + String((live.address() as AddressInfo).port)))
    const response = await begin(route)
    expect(response.status).toBe(409)
    expect(await response.text()).toBe('Tailscale Funnel already has a configuration')
  } finally {
    await new Promise<void>(resolve => { live.close(() => resolve()) })
  }
})

it.skipIf(process.platform === 'win32')('stops a tunnel whose CLI is a wrapper script', async () => {
  const route = await controlRoute(`  fs.writeFileSync(path.join(home, 'target'), args.at(-1))
  process.on('SIGTERM', () => { fs.unlinkSync(path.join(home, 'target')); process.exit(0) })
  setInterval(() => {}, 1000)`, 5_000,
  `fs.existsSync(path.join(home, 'target'))`
  + ` ? JSON.stringify({ Web: { Proxy: fs.readFileSync(path.join(home, 'target'), 'utf8') } }) : '{}'`, true)
  expect((await begin(route)).status).toBe(200)
  const state = join(directory as string, 'target')
  expect(await readFile(state, 'utf8')).toContain('http://127.0.0.1:')
  const stopping = Date.now()
  const stopped = await route.fetch(new Request('http://localhost/api/remote-control', {
    method: 'POST', body: JSON.stringify({ action: 'stop' }),
  }))
  expect(stopped.status).toBe(200)
  expect(Date.now() - stopping).toBeLessThan(10_000)
  await expect(readFile(state, 'utf8')).rejects.toThrow()
}, 30_000)

it.skipIf(process.platform === 'win32')('serves tailnet peers alone when access is tailnet', async () => {
  // `funnel` would open the public ingress, so failing on it proves `serve` drove the tunnel.
  const route = await controlRoute(`  if (args[0] === 'funnel') process.exit(9)
  fs.writeFileSync(path.join(home, 'target'), args.at(-1))
  setInterval(() => {}, 1000)`, 5_000,
  `fs.existsSync(path.join(home, 'target'))`
  + ` ? JSON.stringify({ Web: { Proxy: fs.readFileSync(path.join(home, 'target'), 'utf8') } }) : '{}'`,
  false, 'tailnet')
  const response = await begin(route)
  expect(response.status).toBe(200)
  expect(await response.json())
    .toMatchObject({ url: expect.stringContaining('https://host.tailnet.ts.net/?pair=') })
})
