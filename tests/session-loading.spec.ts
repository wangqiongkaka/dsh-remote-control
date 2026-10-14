// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../dist/client/index.js'

type Request = { address: { kind: 'session'; sessionId: string }; maxMessages: number; turnWindow: { minMessages: number; minTurns: number }; assistantStream: boolean }
const windowRequest = (id: string): Request => ({ address: { kind: 'session', sessionId: id }, maxMessages: 500,
  turnWindow: { minMessages: 50, minTurns: 2 }, assistantStream: true })
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.restoreAllMocks() })

/** Model the public reference lifecycle: one initial follow per live instance, teardown at zero owners. */
function fixture(proxied = true) {
  const style = document.createElement('style')
  if (proxied) { style.setAttribute('data-dsh-remote-control', ''); document.head.append(style) }
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(window, 'matchMedia', { configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  const listeners = new Set<() => void>()
  const rows: Record<string, { id: string; running: boolean; retainedBy: Record<string, number> }> = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'failed'].map(id => [id, { id, running: false, retainedBy: {} }]))
  const state = { phase: 'ready', ids: Object.keys(rows), byId: rows }
  const notify = () => { for (const listener of [...listeners]) listener() }
  const calls: { request: Request; signal?: AbortSignal; caller: unknown }[] = []
  const page = vi.fn()
  const remote = { page, caller: 'owner' }
  const nativeGetter = function (this: typeof remote) {
    const receiver = this
    return (request: Request, signal?: AbortSignal) => {
      calls.push({ request, ...(signal ? { signal } : {}), caller: receiver.caller })
      return (async function* () { yield { type: 'snapshot', cursor: 7, records: [], hasMore: true } })()
    }
  }
  Object.defineProperty(remote, 'follow', { configurable: true, enumerable: true, get: nativeGetter })
  const history = remote as typeof remote & { follow: ReturnType<typeof nativeGetter> }
  type Binding = { session: { getSnapshot(): { openState: string; text: string } } }
  type Reference = { sessionId: string; binding: Binding; ready: Promise<Binding>; release(): void }
  const residents = new Map<string, { binding: Binding; snapshot: { openState: string; text: string }; owners: number }>()
  const nativeRetain = vi.fn((id: string, options: { source: string; signal?: AbortSignal }): Reference => {
    options.signal?.throwIfAborted()
    if (!rows[id]) throw new Error('未知会话')
    let resident = residents.get(id)
    if (!resident) {
      const snapshot = { openState: id === 'failed' ? 'error' : 'open', text: id + ':初始内容' }
      resident = { snapshot, binding: { session: { getSnapshot: () => snapshot } }, owners: 0 }
      residents.set(id, resident)
      history.follow(windowRequest(id), options.signal)
    }
    const owned = resident
    owned.owners++
    rows[id].retainedBy[options.source] = (rows[id].retainedBy[options.source] ?? 0) + 1
    notify()
    let released = false
    return { sessionId: id, binding: owned.binding, ready: Promise.resolve(owned.binding), release() {
      if (released) return
      released = true
      owned.owners--
      if (rows[id]) {
        rows[id].retainedBy[options.source] = (rows[id].retainedBy[options.source] ?? 1) - 1
        if (!rows[id].retainedBy[options.source]) delete rows[id].retainedBy[options.source]
      }
      if (!owned.owners) residents.delete(id)
      notify()
    } }
  })
  const sessions = { retain: nativeRetain,
    list: { getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } } } }
  const disposers: (() => void)[] = []
  const services: Record<string, unknown> = { sessions, 'remote.session': history }
  const ctx = {
    get: (name: string) => services[name],
    inject: (names: string[], register: (scope: unknown) => void) => { if (names.every(name => name in services)) register(ctx) },
    effect: (register: () => (() => void) | undefined) => { const dispose = register(); if (dispose) disposers.push(dispose) },
    locale: { register: () => () => {} },
    slots: { inject: (_name: string, register: () => () => void) => { disposers.push(register()) },
      register: () => () => {}, entries: () => [], subscribe: () => () => {} },
    layout: { toggleSidebar() {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
  }
  apply(ctx as unknown as Context)
  let main: Reference | undefined
  const navigate = (id: string) => { const previous = main; main = sessions.retain(id, { source: 'mainView' }); previous?.release(); return main }
  const dispose = () => { for (const stop of disposers.splice(0).reverse()) stop() }
  cleanups.push(() => { dispose(); main?.release(); style.remove(); delete (document as unknown as { visibilityState?: string }).visibilityState })
  return { ctx, calls, history, nativeGetter, nativeRetain, sessions, rows, state, residents, notify, navigate, dispose }
}

it('opens only the latest turn, preserves the cap, address, signal and stream, and leaves older-page requests intact', async () => {
  const f = fixture()
  const request = windowRequest('a')
  const original = structuredClone(request)
  const signal = new AbortController().signal
  const stream = f.history.follow(request, signal)
  expect(f.calls[0]?.request).toEqual({ ...request, turnWindow: { minMessages: 1, minTurns: 1 } })
  expect(f.calls[0]?.signal).toBe(signal)
  expect(request).toEqual(original)
  expect((await stream[Symbol.asyncIterator]().next()).value?.hasMore).toBe(true)
  f.history.page(request)
  expect(f.history.page).toHaveBeenCalledWith(request)
})

it('preserves a generated getter caller and restores it on disposal, including already borrowed methods', () => {
  const f = fixture()
  const caller = Object.assign(Object.create(f.history), { caller: 'consumer' }) as typeof f.history
  const borrowed = caller.follow
  borrowed(windowRequest('a'))
  expect(f.calls[0]?.caller).toBe('consumer')
  expect(f.calls[0]?.request.turnWindow.minTurns).toBe(1)
  f.dispose()
  expect(Object.getOwnPropertyDescriptor(f.history, 'follow')?.get).toBe(f.nativeGetter)
  borrowed(windowRequest('b'))
  expect(f.calls[1]?.request.turnWindow.minTurns).toBe(2)
  expect(f.sessions.retain).toBe(f.nativeRetain)
})

it('reuses live history when switching back and evicts the least recently visited instance at three', () => {
  const f = fixture()
  const a = f.navigate('a').binding
  f.navigate('b')
  expect(f.residents.has('a')).toBe(true)
  f.residents.get('a')!.snapshot.text = 'a:实时追加'
  expect(f.navigate('a').binding).toBe(a)
  expect(a.session.getSnapshot().text).toBe('a:实时追加')
  expect(f.calls.filter(call => call.request.address.sessionId === 'a')).toHaveLength(1)
  f.navigate('c'); f.navigate('d')
  expect([...f.residents.keys()].sort()).toEqual(['a', 'c', 'd'])
  f.navigate('b')
  expect(f.calls.filter(call => call.request.address.sessionId === 'b')).toHaveLength(2)
})

it('releases cached history when an inactive session starts running, while keeping the active running session', () => {
  const f = fixture()
  f.navigate('a'); f.navigate('b')
  expect(f.residents.get('a')?.owners).toBe(1)
  expect(f.residents.get('b')?.owners).toBe(2)
  f.rows.a!.running = true; f.rows.b!.running = true; f.notify()
  expect(f.residents.has('a')).toBe(false)
  expect(f.residents.has('b')).toBe(true)
  f.navigate('c')
  expect(f.residents.has('b')).toBe(false)
})

it('does not preserve a failed first load or block native errors and cancellation', async () => {
  const f = fixture()
  expect(f.navigate('a').binding.session.getSnapshot().openState).toBe('open')
  await f.navigate('failed').ready
  await Promise.resolve()
  f.navigate('b')
  expect(f.residents.has('failed')).toBe(false)
  expect(() => f.navigate('missing')).toThrow('未知会话')
  const controller = new AbortController(); controller.abort(new Error('已取消'))
  expect(() => f.sessions.retain('a', { source: 'mainView', signal: controller.signal })).toThrow('已取消')
})

it.each(['hidden', 'pagehide', 'dispose', 'removed'])('releases cached references on %s without releasing the main view', event => {
  const f = fixture()
  f.navigate('a'); f.navigate('b')
  expect(f.residents.has('a')).toBe(true)
  if (event === 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  } else if (event === 'pagehide') window.dispatchEvent(new Event('pagehide'))
  else if (event === 'dispose') f.dispose()
  else { f.state.ids = ['b']; delete f.rows.a; f.notify() }
  expect(f.residents.has('a')).toBe(false)
  expect(f.residents.get('b')?.owners).toBe(event === 'removed' ? 2 : 1)
})

it('leaves local pages and non-view references on the original loading lifecycle', () => {
  const f = fixture(false)
  f.navigate('a'); f.navigate('b'); f.navigate('a')
  expect(f.calls.filter(call => call.request.address.sessionId === 'a')).toHaveLength(2)
  expect(f.calls.every(call => call.request.turnWindow.minTurns === 2)).toBe(true)
  expect(f.sessions.retain).toBe(f.nativeRetain)
})

it.each([7, 2000])('keeps an explicit lower limit or caps it at 500 (%s)', maxMessages => {
  const f = fixture()
  f.history.follow({ ...windowRequest('a'), maxMessages, turnWindow: { minMessages: 2, minTurns: 2 } })
  expect(f.calls[0]?.request.maxMessages).toBe(Math.min(maxMessages, 500))
  expect(f.calls[0]?.request.turnWindow).toEqual({ minMessages: 1, minTurns: 1 })
})

it('keeps navigation working when the optional cache acquisition fails', () => {
  const f = fixture()
  const native = f.nativeRetain.getMockImplementation()!
  const failed = vi.fn()
  f.nativeRetain.mockImplementation((id, options) => {
    if (options.source === 'remoteControlCache') { failed(); throw new Error('缓存引用不可用') }
    return native(id, options)
  })
  expect(f.navigate('a').binding.session.getSnapshot().openState).toBe('open')
  expect(failed).toHaveBeenCalledOnce()
  f.notify()
  expect(failed).toHaveBeenCalledOnce()
  expect(f.residents.get('a')?.owners).toBe(1)
})

it.each(['visibilitychange', 'pageshow'])('reacquires only the current instance on %s after background cleanup', event => {
  const f = fixture()
  f.navigate('a')
  window.dispatchEvent(new Event('pagehide'))
  expect(f.residents.get('a')?.owners).toBe(1)
  if (event === 'visibilitychange') document.dispatchEvent(new Event(event))
  else window.dispatchEvent(new Event(event))
  expect(f.residents.get('a')?.owners).toBe(2)
  f.navigate('b'); f.navigate('a')
  expect(f.calls.filter(call => call.request.address.sessionId === 'a')).toHaveLength(1)
})

it('does not retain history opened only for a background operation', () => {
  const f = fixture()
  const reference = f.sessions.retain('a', { source: 'gateway' })
  expect(f.residents.get('a')?.owners).toBe(1)
  reference.release()
  expect(f.residents.has('a')).toBe(false)
})

it('keeps receiver context and reference ownership through real Cordis Service proxies', async () => {
  const f = fixture()
  f.dispose()
  const root = new Context()
  for (const name of ['slots', 'locale', 'layout'] as const) root.provide(name, f.ctx[name] as never)
  const callers: unknown[] = []
  class Remote extends Service {
    constructor(scope: Context) {
      super(scope, 'remote.session')
      Object.defineProperty(this, 'follow', { configurable: true, get: function (this: Remote) {
        const caller = this.ctx
        return (request: Request) => {
          callers.push((caller as Context & { callerName?: string }).callerName)
          return f.history.follow(request)
        }
      } })
    }
  }
  class Sessions extends Service {
    readonly list = f.sessions.list
    constructor(scope: Context) { super(scope, 'sessions') }
    retain(id: string, options: { source: string }) { return f.nativeRetain(id, options) }
  }
  const remote = new Remote(root)
  const sessions = new Sessions(root)
  const descriptor = Object.getOwnPropertyDescriptor(remote, 'follow')
  const owned: ReturnType<typeof f.nativeRetain>[] = []
  const fiber = root.plugin(apply)
  try {
    await fiber.await()
    const consumer = root.extend({ callerName: 'consumer' })
    const followed = consumer.get('remote.session') as unknown as typeof f.history
    followed.follow(windowRequest('a'))
    expect(callers).toEqual(['consumer'])
    expect(f.calls[0]?.request.turnWindow).toEqual({ minMessages: 1, minTurns: 1 })
    const borrowed = consumer.get('sessions') as unknown as Sessions
    owned.push(borrowed.retain('a', { source: 'mainView' }))
    owned.push(borrowed.retain('b', { source: 'mainView' }))
    owned[0]!.release()
    expect(f.residents.has('a')).toBe(true)
    await fiber.dispose()
    expect(f.residents.has('a')).toBe(false)
    expect(Object.getOwnPropertyDescriptor(remote, 'follow')?.get).toBe(descriptor?.get)
    expect(Object.hasOwn(sessions, 'retain')).toBe(false)
  } finally { await fiber.dispose(); for (const reference of owned) reference.release() }
})
