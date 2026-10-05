import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { gzipSync } from 'node:zlib'
import dns from 'node:dns/promises'
import https from 'node:https'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, Config } from '../dist/index.js'

let directory: string | undefined
let backend: Server | undefined
let stop: (() => Promise<void>) | undefined
/** Serve the document gzipped even though the proxy asks for identity. */
let compressedHtml = false

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  compressedHtml = false
  await stop?.()
  stop = undefined
  await new Promise<void>(resolve => { backend?.close(() => resolve()) ?? resolve() })
  backend = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

it('defaults to unlimited phone access while preserving finite lifetime configuration', () => {
  expect(z.resolve({}, Config, {})[0].browserTtlMs).toBe(0)
  expect(z.resolve({}, Config, {})[0].invitationTtlMs).toBe(5 * 60_000)
  expect(z.resolve({ browserTtlMs: 0 }, Config, {})[0].browserTtlMs).toBe(0)
  expect(z.resolve({ browserTtlMs: 12 * 60 * 60_000 }, Config, {})[0].browserTtlMs).toBe(12 * 60 * 60_000)
  expect(() => z.resolve({ browserTtlMs: 999 }, Config, {})).toThrow()
  expect(() => z.resolve({ browserTtlMs: -1 }, Config, {})).toThrow()
})

it.skipIf(process.platform === 'win32').each([
  ['tailscale', 180_000], ['tailscale', 0], ['cloudflare', 0],
] as const)(
  'keeps one paired phone across reconnects and revokes replaced or stopped access (%s, TTL: %s)', async (publicTunnel, browserTtlMs) => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-remote-control-'))
  const state = join(directory, 'funnel-target')
  const binary = join(directory, 'tailscale')
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs')
const state = ${JSON.stringify(state)}
const args = process.argv.slice(2)
if (args[0] === 'status') console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'host.tailnet.ts.net.' } }))
else if (args[1] === 'status') console.log(fs.existsSync(state) ? JSON.stringify({ Web: { Proxy: fs.readFileSync(state, 'utf8') } }) : '{}')
else if (args[0] === 'funnel' || args[0] === 'tunnel') {
  fs.writeFileSync(state, args.at(-1))
  if (args[0] === 'tunnel') {
    process.stderr.write('https://phone-test.trycloudflare.')
    setTimeout(() => { process.stderr.write('com\\n' + 'startup diagnostics '.repeat(200) + '\\nRegistered tunnel connection\\n') }, 20)
  }
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
    if (req.url === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: connected\n\n')
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
  let readinessCalls = 0
  if (publicTunnel === 'cloudflare') {
    const nativeFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) !== 'https://phone-test.trycloudflare.com/') return nativeFetch(input, init)
      readinessCalls++
      if (readinessCalls === 1) throw new TypeError('DNS record not yet available')
      if (readinessCalls === 2) return new Response(null, { status: 530 })
      return new Response(null, { status: 401, headers: { 'x-dsh-remote-control': 'unpaired' } })
    })
  }
  const config: Config = {
    publicTunnel, cloudflaredBinary: binary,
    tailscaleBinary: publicTunnel === 'cloudflare' ? join(directory, 'no-tailscale') : binary, access: 'public', funnelPort: 443, invitationTtlMs: 60_000,
    browserTtlMs, startupTimeoutMs: 5_000, stopTimeoutMs: 5_000,
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
  if (publicTunnel === 'cloudflare') expect(readinessCalls).toBe(3)
  const { url: first } = await started.json() as { url: string }
  const hostname = publicTunnel === 'cloudflare' ? 'phone-test.trycloudflare.com' : 'host.tailnet.ts.net'
  const origin = 'https://' + hostname
  expect(first).toMatch(new RegExp('^' + origin.replaceAll('.', '\\.') + '/\\?pair='))
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
  const headers = { host: hostname }
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
  expect(paired.headers.get('set-cookie')).toContain(
    'Max-Age=' + String(browserTtlMs === 0 ? 400 * 24 * 60 * 60 : browserTtlMs / 1000))
  expect(paired.headers.get('set-cookie')).toContain('; Path=/; HttpOnly; Secure; SameSite=Lax')
  expect((await request(new URL(url).pathname + new URL(url).search)).status).toBe(401)
  expect((await request(new URL(first).pathname + new URL(first).search)).status).toBe(401)
  const next = await invite('workspace-2') as { url: string; expiresAt: number; pairedUntil: number }
  expect(next).toMatchObject({ url: expect.any(String), expiresAt: expect.any(Number), pairedUntil: expect.any(Number) })
  expect(next.url).not.toBe(url)
  if (browserTtlMs === 0) expect(next.pairedUntil).toBe(-1)
  else expect(next.pairedUntil).toBeGreaterThan(Date.now())
  expect(await invite('workspace-1')).toMatchObject({ ...next, workspaceId: 'workspace-1' })
  expect(await (await control.fetch(new Request('http://localhost/api/remote-control'))).json())
    .toEqual({ active: true, paired: true, pairedUntil: expect.any(Number) })
  const page = await request('/', {
    cookie: cookie ?? '', accept: 'text/html', 'accept-encoding': 'gzip',
  })
  expect(page.status).toBe(200)
  expect(page.headers.get('set-cookie')).toBe(browserTtlMs === 0 ? paired.headers.get('set-cookie') : null)
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
  // The phone composer stays anchored outside the chat scroller's scrolling geometry.
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
  const echo = await request('/api/echo', { cookie: cookie ?? '', origin })
  expect(await echo.json()).toEqual({ origin: 'http://127.0.0.1:' + dshPort, cookie: 'dsh-session=signed', body: '' })
  const posted = await request('/api/echo', { cookie: cookie ?? '', origin }, 'POST', '{"message":"hello"}')
  expect(await posted.json()).toMatchObject({ body: '{"message":"hello"}', cookie: 'dsh-session=signed' })
  expect((await request('/api/remote-control', { cookie: cookie ?? '' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: cookie ?? '', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: cookie ?? '', origin: 'https://evil.invalid' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: 'dsh-remote-control=wrong' })).headers.get('set-cookie')).toBeNull()
  const socket = (await upgrade({ cookie: cookie ?? '', origin })).socket
  if (socket === undefined) throw new Error('WebSocket upgrade was refused')
  socket.on('error', () => {})
  const socketClosed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  const echoed = new Promise<string>((resolve) => { socket.once('data', (chunk: Buffer) => { resolve(chunk.toString('utf8')) }) })
  socket.write('ping')
  expect(await echoed).toBe('ping')
  expect((await upgrade({ cookie: cookie ?? '', origin: 'https://evil.invalid' })).status).toBe(403)
  const stream = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = httpRequest({ hostname: local.hostname, port: Number(local.port), path: '/api/stream',
      headers: { ...headers, cookie: cookie ?? '' } }, resolve)
    outgoing.on('error', reject)
    outgoing.end()
  })
  stream.on('error', () => {})
  stream.resume()
  const streamClosed = new Promise<void>(resolve => { stream.once('close', () => { resolve() }) })
  // Refreshing an expired invitation must not rotate the current phone's cookie or close its streams.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(next.expiresAt + 1)
  const renewed = await invite('workspace-1') as { url: string }
  expect((await request('/' + new URL(next.url).search)).status).toBe(401)
  vi.useRealTimers()
  expect(renewed.url).not.toBe(next.url)
  expect((await request('/api/echo', { cookie: cookie ?? '' })).status).toBe(200)
  expect(socket.destroyed).toBe(false)
  expect(stream.destroyed).toBe(false)
  expect(await readFile(state, 'utf8')).toBe(proxy)
  expect((await request('/?pair=wrong')).status).toBe(401)
  expect((await request('/api/echo', { cookie: cookie ?? '' })).status).toBe(200)
  // Only a successful scan replaces access, including already established HTTP and WebSocket streams.
  const replacement = await request('/' + new URL(renewed.url).search)
  expect(replacement.status).toBe(303)
  const replacementCookie = replacement.headers.get('set-cookie')?.split(';', 1)[0]
  expect(replacementCookie).toMatch(/^dsh-remote-control=/u)
  expect(replacementCookie).not.toBe(cookie)
  await Promise.all([socketClosed, streamClosed])
  expect((await request('/api/echo', { cookie: cookie ?? '' })).status).toBe(401)
  expect((await upgrade({ cookie: cookie ?? '', origin })).status).toBe(401)
  expect((await request('/api/echo', { cookie: replacementCookie ?? '' })).status).toBe(200)
  expect((await request('/' + new URL(renewed.url).search)).status).toBe(401)
  const again = await invite('workspace-1') as { url: string; pairedUntil: number }
  expect(again.url).not.toBe(renewed.url)
  if (browserTtlMs === 0) expect(again.pairedUntil).toBe(-1)
  else expect(again.pairedUntil).toBeGreaterThan(Date.now())
  // Unlimited access survives elapsed time; a configured finite lifetime still expires.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + 401 * 24 * 60 * 60_000)
  const later = await request('/api/echo', { cookie: replacementCookie ?? '' })
  expect(later.status).toBe(browserTtlMs === 0 ? 200 : 401)
  expect(later.headers.get('set-cookie')).toBe(browserTtlMs === 0 ? replacement.headers.get('set-cookie') : null)
  expect(await (await control.fetch(new Request('http://localhost/api/remote-control'))).json())
    .toEqual({ active: true, paired: browserTtlMs === 0, pairedUntil: browserTtlMs === 0 ? -1 : 0 })
  const laterUpgrade = await upgrade({ cookie: replacementCookie ?? '', origin })
  if (browserTtlMs === 0) {
    expect(laterUpgrade.socket).toBeDefined()
    laterUpgrade.socket?.destroy()
  } else expect(laterUpgrade.status).toBe(401)
  vi.useRealTimers()
  const replacementSocket = (await upgrade({ cookie: replacementCookie ?? '', origin })).socket
  if (replacementSocket === undefined) throw new Error('Replacement WebSocket was refused')
  replacementSocket.on('error', () => {})
  const replacementClosed = new Promise<void>(resolve => { replacementSocket.once('close', () => { resolve() }) })
  expect((await post({ action: 'stop' })).status).toBe(200)
  await replacementClosed
  await expect(request('/api/echo', { cookie: replacementCookie ?? '' })).rejects.toThrow()
  if (publicTunnel === 'tailscale') {
    await writeFile(state, 'http://127.0.0.1:9999')
    expect((await post({ action: 'start', workspaceId: 'workspace-1' })).status).toBe(409)
  }
})

/** A fake Tailscale CLI that answers status and then runs `funnel` as the given script body. */
function fakeCli(funnel: string, status = "'{}'"): string {
  return `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const home = path.dirname(process.argv[1])
const args = process.argv.slice(2)
if (args[0] === 'status') {
  const stateFile = path.join(home, 'backend-state')
  const state = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : 'Running'
  if (state === 'unavailable') process.exit(7)
  console.log(JSON.stringify({ BackendState: state, Self: { DNSName: 'host.tailnet.ts.net.' } }))
}
else if (args[1] === 'status') console.log(${status})
else if (args[0] === 'funnel' || args[0] === 'serve' || args[0] === 'tunnel') {
${funnel}
} else process.exit(1)
`
}

/** Applies the plugin against a fake CLI and returns its control route. */
async function controlRoute(
  funnel: string, startupTimeoutMs: number, status = "'{}'", wrap = false,
  access: Config['access'] = 'public', publicTunnel: Config['publicTunnel'] = 'tailscale', overrides: Partial<Config> = {},
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
    tailscaleBinary: binary, publicTunnel, cloudflaredBinary: binary, access, funnelPort: 443, invitationTtlMs: 60_000,
    browserTtlMs: 60_000, startupTimeoutMs, stopTimeoutMs: 5_000, ...overrides,
  })
  if (route === undefined) throw new Error('Control route not installed')
  return route
}

const begin = (route: ConnectionFetchRoute): Promise<Response> => route.fetch(
  new Request('http://localhost/api/remote-control', {
    method: 'POST', body: JSON.stringify({ action: 'start', workspaceId: 'workspace-1' }),
  }),
)

it.skipIf(process.platform === 'win32').each([
  ['tailnet', false], ['tailnet', true], ['public', false], ['public', true],
] as const)('preserves other %s mappings (foreground: %s) while starting and stopping DSH', async (access, foreground) => {
  const service = {
    TCP: { 8443: { HTTPS: true } },
    Web: { 'host.tailnet.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8000' } } } },
  }
  const existing = foreground ? { Foreground: { other: service } } : service
  const route = await controlRoute(`  const state = path.join(home, 'config')
  const existing = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : ${JSON.stringify(existing)}
  if (args[1] === 'reset') { fs.writeFileSync(path.join(home, 'reset'), '1'); fs.writeFileSync(state, '{}'); return }
  if (args[0] !== ${JSON.stringify(access === 'tailnet' ? 'serve' : 'funnel')}) process.exit(9)
  const port = args.find(arg => arg.startsWith('--https='))?.slice('--https='.length)
  if (port !== '443') process.exit(8)
  const config = { ...existing, Foreground: { ...existing.Foreground, dsh: {
    TCP: { [port]: { HTTPS: true } },
    Web: { ['host.tailnet.ts.net:' + port]: { Handlers: { '/': { Proxy: args.at(-1) } } } },
  } } }
  fs.writeFileSync(state + '.next', JSON.stringify(config))
  fs.renameSync(state + '.next', state)
  process.on('SIGTERM', () => { fs.writeFileSync(state, JSON.stringify(existing)); process.exit(0) })
  setInterval(() => {}, 1000)`, 5_000,
  `fs.existsSync(path.join(home, 'config')) ? fs.readFileSync(path.join(home, 'config'), 'utf8') : JSON.stringify(${JSON.stringify(existing)})`,
  false, access)
  const response = await begin(route)
  expect(response.status, await response.clone().text()).toBe(200)
  expect(await response.json()).toMatchObject({ url: expect.stringContaining('https://host.tailnet.ts.net/?pair=') })
  const state = join(directory!, 'config')
  expect(JSON.parse(await readFile(state, 'utf8'))).toMatchObject(existing)
  const stopped = await route.fetch(new Request('http://localhost/api/remote-control', {
    method: 'POST', body: JSON.stringify({ action: 'stop' }),
  }))
  expect(stopped.status).toBe(200)
  expect(JSON.parse(await readFile(state, 'utf8'))).toEqual(existing)
  await expect(readFile(join(directory!, 'reset'), 'utf8')).rejects.toThrow()
})

it.skipIf(process.platform === 'win32').each([
  { TCP: { 443: { HTTPS: true } } },
  { TCP: { 443: { TCPForward: '127.0.0.1:8000' } } },
  { TCP: { 8443: { HTTPS: true } }, Foreground: { other: { TCP: { 443: { HTTPS: true } } } } },
  { TCP: null },
  { Foreground: { other: null } },
])('refuses occupied or unreadable listeners without resetting other mappings: %j', async existing => {
  const route = await controlRoute(`  fs.writeFileSync(path.join(home, 'mutation'), args.join(' '))
  process.exit(9)`, 1_000, `JSON.stringify(${JSON.stringify(existing)})`, false, 'tailnet')
  const response = await begin(route)
  expect(response.status).toBe(409)
  await expect(readFile(join(directory!, 'mutation'), 'utf8')).rejects.toThrow()
})

it.skipIf(process.platform === 'win32')('does not reset a dead foreground session containing another port', async () => {
  const existing = { Foreground: { other: {
    TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
    Web: { 'host.tailnet.ts.net:443': { Handlers: {
      '/': { Proxy: 'http://127.0.0.1:' + String(await deadPort()) },
    } } },
  } } }
  const route = await controlRoute(`  fs.writeFileSync(path.join(home, 'mutation'), args.join(' '))
  process.exit(9)`, 1_000, `JSON.stringify(${JSON.stringify(existing)})`, false, 'tailnet')
  expect((await begin(route)).status).toBe(409)
  await expect(readFile(join(directory!, 'mutation'), 'utf8')).rejects.toThrow()
})

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
    expect(await response.text()).toBe('Tailscale Funnel port 443 already has a configuration')
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

it.skipIf(process.platform === 'win32').each([
  ['https://phone-test.trycloudflare.com\n', 'missing registration'],
  ['Registered tunnel connection\nhttps://phone-test.trycloudflare.com.evil.invalid\n', 'untrusted hostname'],
])('refuses an unusable Cloudflare announcement (%s, %s) and closes its listener', async (message) => {
  const route = await controlRoute(`  fs.writeFileSync(path.join(home, 'target'), args.at(-1))
  process.on('SIGTERM', () => { fs.writeFileSync(path.join(home, 'stopped'), 'yes'); process.exit(0) })
  process.stderr.write(${JSON.stringify(message)})
  setInterval(() => {}, 1000)`, 2_000, "'{}'", false, 'public', 'cloudflare')
  const response = await begin(route)
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('Cloudflare Tunnel did not become ready before the startup timeout')
  expect(await readFile(join(directory!, 'stopped'), 'utf8')).toBe('yes')
  const target = await readFile(join(directory!, 'target'), 'utf8')
  await expect(fetch(target)).rejects.toThrow()
  expect(await (await route.fetch(new Request('http://localhost/api/remote-control'))).json()).toEqual({ active: false })
})

it.skipIf(process.platform === 'win32')('reports Cloudflare startup failures and keeps other Tailscale mappings untouched', async () => {
  const route = await controlRoute(`  if (args[0] !== 'tunnel') { fs.writeFileSync(path.join(home, 'tailscale-used'), 'yes'); process.exit(9) }
  process.stderr.write('Unable to reach Cloudflare edge\\n')
  process.exit(7)`, 5_000, "JSON.stringify({TCP:{443:{HTTPS:true},8443:{HTTPS:true}}})", false, 'public', 'cloudflare')
  const response = await begin(route)
  expect(response.status).toBe(409)
  expect(await response.text()).toContain('Cloudflare Tunnel exited (7) — Unable to reach Cloudflare edge')
  await expect(readFile(join(directory!, 'tailscale-used'), 'utf8')).rejects.toThrow()
})


it('defaults to choosing the public tunnel from the Mac Tailscale connection state', () => {
  expect(z.resolve({}, Config, {})[0].publicTunnel).toBe('auto')
})

it.skipIf(process.platform === 'win32')('starts Cloudflare when the system DNS cannot resolve its registered public hostname', async () => {
  const nativeFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input) === 'https://dns-phone.trycloudflare.com/'
    ? Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) }))
    : nativeFetch(input, init))
  const resolver = new dns.Resolver()
  const resolve = vi.spyOn(resolver, 'resolve4').mockResolvedValue(['127.0.0.1'])
  const servers = vi.spyOn(resolver, 'setServers').mockImplementation(() => {})
  vi.spyOn(dns, 'Resolver').mockImplementation(function () { return resolver })
  const probe = vi.spyOn(https, 'request').mockImplementation((url, options, callback) => {
    expect(String(url)).toBe('https://dns-phone.trycloudflare.com/')
    expect(options).toMatchObject({ servername: 'dns-phone.trycloudflare.com', family: 4 })
    expect(options).not.toHaveProperty('rejectUnauthorized', false)
    expect(options).not.toHaveProperty('headers')
    return httpRequest(readFileSync(join(directory!, 'target'), 'utf8'), { headers: { host: 'dns-phone.trycloudflare.com' } }, callback)
  })
  const route = await controlRoute(`  fs.writeFileSync(path.join(home, 'target'), args.at(-1))
  console.log('https://dns-phone.trycloudflare.com\\nRegistered tunnel connection')
  setInterval(() => {}, 1000)`, 2_000, "'{}'", false, 'public', 'cloudflare')
  // The fake HTTPS transport still reaches the real pairing proxy and its Host fence.
  const response = await begin(route)
  expect(response.status, await response.clone().text()).toBe(200)
  expect(probe).toHaveBeenCalledOnce()
  expect(resolve).toHaveBeenCalledWith('dns-phone.trycloudflare.com')
  expect(servers).toHaveBeenCalledWith(['8.8.8.8', '8.8.4.4'])
})

it.skipIf(process.platform === 'win32').each(['Running', 'Stopped', 'NeedsLogin', 'unavailable'])(
  'selects the public tunnel only when starting remote control (Tailscale: %s)', async (state) => {
  const nativeFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input) === 'https://auto-phone.trycloudflare.com/'
    ? Promise.resolve(new Response(null, { status: 401, headers: { 'x-dsh-remote-control': 'unpaired' } }))
    : nativeFetch(input, init))
  const route = await controlRoute(`  if (args[1] === 'reset') process.exit(9)
  const state = fs.readFileSync(path.join(home, 'backend-state'), 'utf8')
  const expected = state === 'Running' ? 'funnel' : 'tunnel'
  if (args[0] !== expected) process.exit(8)
  fs.writeFileSync(path.join(home, 'target'), args.at(-1))
  if (args[0] === 'tunnel') console.log('https://auto-phone.trycloudflare.com\\nRegistered tunnel connection')
  process.on('SIGTERM', () => { fs.unlinkSync(path.join(home, 'target')); process.exit(0) })
  setInterval(() => {}, 1000)`, 5_000,
  `fs.existsSync(path.join(home, 'target'))
    ? JSON.stringify({ TCP: {8443:{HTTPS:true}}, Web:{Proxy:fs.readFileSync(path.join(home, 'target'),'utf8')} })
    : JSON.stringify({ TCP:{8443:{HTTPS:true}} })`, false, 'public', 'auto')
  await writeFile(join(directory!, 'backend-state'), state)
  const response = await begin(route)
  expect(response.status, await response.clone().text()).toBe(200)
  const first = await response.json() as { url: string }
  const hostname = state === 'Running' ? 'host.tailnet.ts.net' : 'auto-phone.trycloudflare.com'
  expect(new URL(first.url).hostname).toBe(hostname)
  // Merely opening the existing session never replaces its origin or phone authorization.
  await writeFile(join(directory!, 'backend-state'), state === 'Running' ? 'Stopped' : 'Running')
  expect(await (await begin(route)).json()).toMatchObject({ url: first.url })
  expect((await route.fetch(new Request('http://localhost/api/remote-control', {
    method: 'POST', body: JSON.stringify({ action: 'stop' }),
  }))).status).toBe(200)
  const restarted = await begin(route)
  expect(restarted.status, await restarted.clone().text()).toBe(200)
  const next = await restarted.json() as { url: string }
  expect(new URL(next.url).hostname).toBe(state === 'Running' ? 'auto-phone.trycloudflare.com' : 'host.tailnet.ts.net')
})

it.skipIf(process.platform === 'win32')('uses Cloudflare in auto mode when Tailscale is not installed', async () => {
  const nativeFetch = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => String(input) === 'https://auto-phone.trycloudflare.com/'
    ? Promise.resolve(new Response(null, { status: 401, headers: { 'x-dsh-remote-control': 'unpaired' } }))
    : nativeFetch(input, init))
  const route = await controlRoute(`  if (args[0] !== 'tunnel') process.exit(9)
  console.log('https://auto-phone.trycloudflare.com\\nRegistered tunnel connection')
  setInterval(() => {}, 1000)`, 5_000, "'{}'", false, 'public', 'auto', { tailscaleBinary: '/no-tailscale-installed' })
  const response = await begin(route)
  expect(response.status, await response.clone().text()).toBe(200)
  expect(new URL((await response.json() as {url:string}).url).hostname).toBe('auto-phone.trycloudflare.com')
})

it.skipIf(process.platform === 'win32')('never exposes a private tailnet service through the auto Cloudflare fallback', async () => {
  const route = await controlRoute(`  fs.writeFileSync(path.join(home, 'mutation'), 'yes'); process.exit(9)`,
    5_000, "'{}'", false, 'tailnet', 'auto')
  await writeFile(join(directory!, 'backend-state'), 'Stopped')
  expect((await begin(route)).status).toBe(409)
  await expect(readFile(join(directory!, 'mutation'), 'utf8')).rejects.toThrow()
})
