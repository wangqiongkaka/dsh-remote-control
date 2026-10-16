import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../dist/index.js'
import { barkPayload, pushBark, watchSessions, type Notice } from '../dist/notify.js'

afterEach(() => { vi.restoreAllMocks() })

/** A host stand-in that records listeners so the test can fire the host's events. */
function host() {
  const listeners = new Map<string, { listener: (...args: any[]) => unknown; options?: { prepend: boolean } }>()
  const ctx = {
    on: (name: string, listener: (...args: any[]) => unknown, options?: { prepend: boolean }) => {
      listeners.set(name, { listener, ...(options === undefined ? {} : { options }) })
      return () => {}
    },
    get: (name: string) => name === 'sessionProjections'
      ? { snapshot: (session: { id: string }) => ({ values: { title: session.id === 's1' ? '修复登录' : null } }) }
      : undefined,
  }
  const notices: Notice[] = []
  watchSessions(ctx as unknown as Context, (notice) => { notices.push(notice) })
  const fire = (name: string, ...args: unknown[]) => listeners.get(name)!.listener(...args)
  return { listeners, notices, fire }
}

const top = { id: 's1', header: { cwd: '/Users/me/projects/app' } }
const child = { id: 'c1', header: { cwd: '/x', parentSession: 's1' } }
const sub = { id: 'c2', header: { origin: 'subagent' } }

it('defaults Bark off and to the public server once a key is set', () => {
  expect(z.resolve({}, Config, {})[0].bark).toBeUndefined()
  expect(z.resolve({ bark: { key: 'k' } }, Config, {})[0].bark).toEqual({ key: 'k', server: 'https://api.day.app' })
  expect(() => z.resolve({ bark: { key: 'k', server: 'ftp://x' } }, Config, {})).toThrow()
})

it('notifies when a top-level Session waits for an approval, a plan review or an answer', async () => {
  const { listeners, notices, fire } = host()
  fire('session/event', top, { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } })
  fire('session/event', child, { type: 'approval/asked', data: { id: 'a2', toolName: 'bash' } })
  fire('session/event', top, { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } })
  // Answerers claim questions without calling next(), so the watcher must run ahead of them.
  expect(listeners.get('user-questions/request')!.options).toEqual({ prepend: true })
  const next = vi.fn(async () => ({ answers: [] }))
  const ask = (session: unknown, questions: unknown[]) => fire('user-questions/request', { agent: { session }, questions }, next)
  await expect(ask(top, [{ id: 'plan', question: '审核计划', intent: { kind: 'plan-review' } }])).resolves.toEqual({ answers: [] })
  await ask(top, [{ id: 'approval', question: '允许运行 npm test？' }])
  await ask(top, [{ id: 'q1', question: '用哪个数据库？' }, { id: 'q2', question: '要迁移吗？' }])
  await ask(sub, [{ id: 'q1', question: '?' }])
  await ask(undefined, [{ id: 'q1', question: '?' }])
  expect(next).toHaveBeenCalledTimes(5)
  expect(notices).toEqual([
    { sessionId: 's1', kind: 'approval', title: '修复登录', workspace: 'app', detail: 'bash' },
    { sessionId: 's1', kind: 'plan-review', title: '修复登录', workspace: 'app' },
    { sessionId: 's1', kind: 'approval', title: '修复登录', workspace: 'app', detail: '允许运行 npm test？' },
    { sessionId: 's1', kind: 'question', title: '修复登录', workspace: 'app', detail: '用哪个数据库？' },
  ])
})

it('notifies once a top-level Session stops, except when it was cancelled', () => {
  const { notices, fire } = host()
  const stop = (session: unknown, reason: unknown) => {
    fire('agent/status', { agent: { session }, status: 'running' })
    fire('session/event', session, { type: 'turn/end', data: { turn: 1, reason } })
    fire('agent/status', { agent: { session }, status: 'idle' })
  }
  stop(top, { kind: 'completed' })
  stop({ id: 's2', header: {} }, { kind: 'error', error: { message: 'rate limited', code: 'RATE' } })
  stop(top, { kind: 'aborted', reason: { kind: 'user' } })
  stop(child, { kind: 'completed' })
  // A queued follow-up keeps it running: only the final idle counts.
  fire('session/event', top, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  fire('agent/status', { agent: { session: top }, status: 'running' })
  expect(notices).toEqual([
    { sessionId: 's1', kind: 'done', title: '修复登录', workspace: 'app' },
    { sessionId: 's2', kind: 'error', title: '未命名会话', workspace: '', detail: 'rate limited' },
  ])
})

it('pushes to Bark with a link that opens the Session in the iOS app', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: 200 }))
  await pushBark({ key: 'dev', server: 'https://bark.example.com/' },
    { sessionId: 'a b', kind: 'approval', title: '修复登录', workspace: 'app', detail: 'bash' })
  expect(fetch).toHaveBeenCalledOnce()
  const [url, init] = fetch.mock.calls[0]!
  expect(url).toBe('https://bark.example.com/push')
  expect(JSON.parse(String(init!.body))).toEqual({
    device_key: 'dev', title: '待确认 · 等待审批', subtitle: '修复登录', body: 'app · bash',
    group: 'DeepSeek', level: 'timeSensitive', url: 'dshremote://session/a%20b',
  })
  expect(barkPayload('dev', { sessionId: 's', kind: 'done', title: 't', workspace: '' })).toMatchObject({ body: 't', level: 'active' })
  // A failed push is logged, never thrown into the host's event dispatch.
  fetch.mockRejectedValueOnce(new Error('offline'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(pushBark({ key: 'dev', server: 'https://x' }, { sessionId: 's', kind: 'done', title: 't', workspace: '' })).resolves.toBeUndefined()
  expect(warn).toHaveBeenCalledOnce()
})
