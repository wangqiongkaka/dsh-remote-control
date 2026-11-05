import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { notificationSettings, type NoticeKind } from '../dist/notify.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function file() { const dir = mkdtempSync(join(tmpdir(), 'dsh-notices-')); dirs.push(dir); return join(dir, 'settings.json') }
function request(sessionId: string, muted?: boolean) {
  return new Request('http://localhost/api/remote-control/notifications?sessionId=' + encodeURIComponent(sessionId),
    muted === undefined ? {} : { method: 'POST', body: JSON.stringify({ muted }) })
}
it('persists per-session muting, preserves requests for input, and restores notifications', async () => {
  const path = file()
  let settings = notificationSettings(path)
  expect(await (await settings.fetch(request('s1'))).json()).toEqual({ muted: false })
  expect((await settings.fetch(request('s1', true))).status).toBe(200)
  settings = notificationSettings(path)
  expect(await (await settings.fetch(request('s1'))).json()).toEqual({ muted: true })
  for (const kind of ['done', 'error', 'approval', 'question', 'plan-review'] as NoticeKind[]) {
    expect(settings.allows('s1', kind)).toBe(kind !== 'done' && kind !== 'error')
    expect(settings.allows('s2', kind)).toBe(true)
  }
  await settings.fetch(request('s1', false))
  expect(notificationSettings(path).allows('s1', 'done')).toBe(true)
})
it('rejects malformed requests without changing preferences', async () => {
  const settings = notificationSettings(file())
  for (const req of [new Request('http://localhost/'), new Request('http://localhost/?sessionId=s1', { method: 'POST', body: '{' }),
    new Request('http://localhost/?sessionId=s1', { method: 'POST', body: '{"muted":"false"}' })]) {
    expect((await settings.fetch(req)).status).toBe(400)
  }
  expect(settings.allows('s1', 'done')).toBe(true)
})
it('reports storage failures without accepting an unsaved change', async () => {
  const path = file()
  const settings = notificationSettings(path)
  const { mkdirSync } = await import('node:fs')
  mkdirSync(path)
  expect((await settings.fetch(request('s1', true))).status).toBe(500)
})
