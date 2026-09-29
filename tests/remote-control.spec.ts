import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'

let directory: string | undefined
let backend: Server | undefined
let stop: (() => Promise<void>) | undefined

afterEach(async () => {
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
    if (req.url?.startsWith('/?remoteWorkspace=')) {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<main>DSH Web</main>')
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
  await new Promise<void>(resolve => { backend?.listen(0, '127.0.0.1', resolve) })
  const dshPort = (backend.address() as AddressInfo).port
  let route: ConnectionFetchRoute | undefined
  const ctx = {
    connection: {
      authenticatedUrl: (url: string) => url + '?token=launch',
      fetch: { register(value: ConnectionFetchRoute) { route = value; return async () => {} } },
    },
    webServer: { port: dshPort },
    workspaceRegistry: { get: (id: string) => id === 'workspace-1' ? { workspaceId: id } : undefined },
    effect(register: () => (() => void | Promise<void>)) {
      const dispose = register()
      if (route !== undefined) stop = async () => { await dispose() }
    },
  }
  const config: Config = {
    tailscaleBinary: binary, funnelPort: 443, invitationTtlMs: 60_000,
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
  const { url } = await started.json() as { url: string }
  expect(url).toMatch(/^https:\/\/host\.tailnet\.ts\.net\/\?pair=/u)
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
  expect((await request('/api/echo')).status).toBe(401)
  expect((await request('//other.invalid/?pair=x')).status).toBe(403)
  expect((await request('/?pair=wrong')).status).toBe(401)
  const paired = await request(new URL(url).pathname + new URL(url).search, { 'sec-fetch-site': 'cross-site' })
  expect(paired.status).toBe(303)
  expect(paired.headers.get('location')).toBe('/?remoteWorkspace=workspace-1')
  const cookie = paired.headers.get('set-cookie')?.split(';', 1)[0]
  expect(cookie).toMatch(/^dsh-remote-control=/u)
  expect((await request(new URL(url).pathname + new URL(url).search)).status).toBe(401)
  expect((await request('/?remoteWorkspace=workspace-1', { cookie: cookie ?? '' })).status).toBe(200)
  expect((await request('/?remoteWorkspace=workspace-1', {
    cookie: cookie ?? '', 'sec-fetch-site': 'cross-site',
  })).status).toBe(200)
  const echo = await request('/api/echo', { cookie: cookie ?? '', origin: 'https://host.tailnet.ts.net' })
  expect(await echo.json()).toEqual({ origin: 'http://127.0.0.1:' + dshPort, cookie: 'dsh-session=signed', body: '' })
  const posted = await request('/api/echo', { cookie: cookie ?? '', origin: 'https://host.tailnet.ts.net' }, 'POST', '{"message":"hello"}')
  expect(await posted.json()).toMatchObject({ body: '{"message":"hello"}', cookie: 'dsh-session=signed' })
  expect((await request('/api/remote-control', { cookie: cookie ?? '' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: cookie ?? '', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await request('/api/echo', { cookie: cookie ?? '', origin: 'https://evil.invalid' })).status).toBe(403)
  expect((await post({ action: 'stop' })).status).toBe(200)
  await expect(request('/api/echo', { cookie: cookie ?? '' })).rejects.toThrow()
  await writeFile(state, 'http://127.0.0.1:9999')
  expect((await post({ action: 'start', workspaceId: 'workspace-1' })).status).toBe(409)
})
