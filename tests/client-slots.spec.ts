// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { expect, it, vi } from 'vitest'
import { apply } from '../dist/client/index.js'

// jsdom ships neither of these; the apply-time phone effect and the slot entries ask for both.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
})

/** Frame slot ledger with this plugin's seats plus the frame-wide overlay list. */
function slots(): SlotCore {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: {
      'conversation.header.leading': { kind: 'single', scope: 'root' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
    },
  }, (() => null) as never)
  return core
}

function context(core: SlotCore, disposers: (() => void)[] = []): Context {
  let activePanelId: MainPanelId | null = null
  const listeners = new Set<() => void>()
  return {
    inject: () => {},
    effect: (register: () => () => void) => { disposers.push(register()) },
    locale: { register: () => () => {} },
    slots: {
      register: core.register.bind(core),
      inject: (_name: string, register: () => () => void) => {
        const dispose = register()
        disposers.push(dispose)
        return dispose
      },
      entries: core.entries.bind(core),
      subscribe: core.subscribe.bind(core),
    },
    layout: {
      toggleSidebar: () => {},
      panelInfo: {
        getSnapshot: () => ({ activePanelId }),
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
      selectPanel: (id: MainPanelId | null) => {
        activePanelId = id
        for (const listener of listeners) listener()
      },
    },
  } as unknown as Context
}

it('activates the mobile sidebar control in the single leading slot', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  try {
    expect(() => { apply(context(core, disposers)) }).not.toThrow()
    expect(core.entries('conversation.header.leading')).toHaveLength(1)
  } finally {
    for (const dispose of disposers) dispose()
  }
})

it('wires the separate computer-file command and overlay through plugin activation', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  const ctx = context(core, disposers)
  const register = vi.fn(() => () => {})
  const services: Record<string, unknown> = {
    commandUi: { register, candidates: async () => [] }, sessions: {}, conversation: {},
  }
  Object.assign(ctx, {
    inject: (_names: string[], run: (scope: Context) => void) => { run(ctx) },
    get: (name: string) => services[name],
  })
  Object.assign(ctx.locale, { bind: () => (key: string) => key })
  try {
    apply(ctx)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'computer-file', ui: { kind: 'action', run: expect.any(Function) } }))
    expect(core.entries('shell.overlay').map(entry => entry.options.id)).toContain('remote-control.files')
  } finally { for (const dispose of disposers) dispose() }
})

it('places the pairing entry at the sidebar foot instead of the session header', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  try {
    apply(context(core, disposers))
    expect(core.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('remote-control')
    expect(core.entries('conversation.session.header.utilities').map(entry => entry.options.id)).not.toContain('remote-control')
  } finally {
    for (const dispose of disposers) dispose()
  }
})

it('uses the refresh command only for an explicit manual QR refresh', async () => {
  const core = slots()
  const disposers: (() => void)[] = []
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json({ url: 'https://host/?pair=test', expiresAt: 1, pairedUntil: -1 }))
  vi.stubGlobal('fetch', fetcher)
  try {
    apply(context(core, disposers))
    const entry = core.entries('sidebar.footer.action').find(item => item.options.id === 'remote-control')!
    const inject = entry.inject as () => { start: (workspaceId?: string, refresh?: boolean) => Promise<unknown> }
    await inject().start(undefined, true)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ action: 'refresh' })
    await inject().start()
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ action: 'start' })
  } finally {
    for (const dispose of disposers) dispose()
    vi.unstubAllGlobals()
  }
})

it('leaves frontend access to the browser without a plugin preview entry', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  try {
    apply(context(core, disposers))
    expect(core.entries('conversation.session.header.utilities').map(entry => entry.options.id))
      .not.toContain('remote-control.preview')
  } finally {
    for (const dispose of disposers) dispose()
  }
})

it('adds the drawer dismissal layer to the frame-wide overlay list', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  try {
    apply(context(core, disposers))
    expect(core.entries('shell.overlay').map(entry => entry.options.id))
      .toEqual(expect.arrayContaining(['remote-control.dismiss', 'remote-control.agents']))
  } finally {
    for (const dispose of disposers) dispose()
  }
})

it('opens an Agent board Session through the Workspace UI navigation', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  const opened: string[] = []
  const ctx = context(core, disposers)
  Object.assign(ctx, {
    get: (name: string) => name === 'uiWorkspace' ? { openSession: (id: string) => { opened.push(id) } } : undefined,
  })
  try {
    apply(ctx)
    const entry = core.entries('shell.overlay').find(item => item.options.id === 'remote-control.agents')
    const inject = entry?.inject as (() => { openSession: (id: string) => void }) | undefined
    inject?.().openSession('session-1')
    expect(opened).toEqual(['session-1'])
  } finally {
    for (const dispose of disposers) dispose()
  }
})

// This plugin injects `remote` only, and cordis refuses `ctx.remote.harness` without its own inject
// ("cannot get property ... without inject"): the namespace is read through `ctx.get`, and a lookup
// that cannot answer yet rejects so the board asks again instead of settling on no logo.
it('reads Agent board harnesses from harness-provider without injecting it', async () => {
  const core = slots()
  const disposers: (() => void)[] = []
  const ctx = context(core, disposers)
  const asked: string[][] = []
  let reply: unknown = { ok: true, value: { s1: { harness: 'codex', delegated: false, running: true } } }
  let service: unknown
  Object.assign(ctx, {
    remote: { get harness(): never { throw new Error('cannot get property "remote.harness" without inject') } },
    get: (name: string) => name === 'remote.harness' ? service : undefined,
  })
  try {
    apply(ctx)
    const entry = core.entries('shell.overlay').find(item => item.options.id === 'remote-control.agents')
    const harnesses = () => (entry?.inject as () => { harnesses: (ids: string[]) => Promise<unknown> })().harnesses
    // harness-provider not mounted yet.
    await expect(harnesses()(['s1'])).rejects.toThrow()
    service = { harnesses: async ({ sessionIds }: { sessionIds: string[] }) => { asked.push(sessionIds); return reply } }
    expect(await harnesses()(['s1'])).toEqual({ s1: { harness: 'codex', delegated: false, running: true } })
    expect(asked).toEqual([['s1']])
    reply = { ok: false, error: { message: 'offline' } }
    await expect(harnesses()(['s1'])).rejects.toThrow('offline')
  } finally {
    for (const dispose of disposers) dispose()
  }
})

it('patches the drawer only on a narrow frame that came through the proxy', () => {
  const proxied = document.createElement('style')
  proxied.setAttribute('data-dsh-remote-control', '')
  const sheet = () => document.head.querySelector('style[data-dsh-remote-control-drawer-selection]')
  /** Apply the plugin as one frame shape would see it; the result disposes that whole activation. */
  const activate = (narrow: boolean, installProxyStyle: boolean): (() => void) => {
    if (installProxyStyle) document.head.append(proxied)
    else proxied.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: narrow, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    const disposers: (() => void)[] = []
    apply(context(slots(), disposers))
    return () => { for (const dispose of disposers) dispose() }
  }
  try {
    // A proxied phone frames gets the drawer sheet, and disposing the activation takes it away.
    const phone = activate(true, true)
    try {
      expect(sheet()).not.toBeNull()
      expect(sheet()?.textContent).toContain('.hp-delegate[data-hp-mode]{display:grid;')
    } finally { phone() }
    expect(sheet()).toBeNull()

    // A local narrow window never came through the proxy, so the shell keeps its own styling.
    const local = activate(true, false)
    expect(sheet()).toBeNull()
    local()

    // Neither does a wide frame that did come through the proxy.
    const wide = activate(false, true)
    expect(sheet()).toBeNull()
    wide()
  } finally {
    proxied.remove()
    sheet()?.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

it('opens the left and right sidebars with one-finger swipes across the phone conversation', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div>'
    + '<main class="ui_layout__centerCol__h1"><button data-sidebar-right-expand>右侧栏</button>'
    + '<div data-conversation-scroll>消息</div><textarea></textarea></main>'
    + '<div data-rightbar-col></div>'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-rightbar-collapsed', '')
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const content = frame.querySelector('[data-conversation-scroll]')!
  const input = frame.querySelector('textarea')!
  let leftOpens = 0
  let rightOpens = 0
  frame.querySelector('button')!.addEventListener('click', () => {
    rightOpens++
    frame.removeAttribute('data-rightbar-collapsed')
  })
  const disposers: (() => void)[] = []
  const ctx = context(slots(), disposers)
  ctx.layout.toggleSidebar = () => {
    leftOpens++
    frame.removeAttribute('data-sidebar-collapsed')
  }
  const touch = (target: Element, type: string, x: number, y: number, count = 1): void => {
    const event = new Event(type, { bubbles: true })
    const points = Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y }))
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : points },
      changedTouches: { value: points },
    })
    target.dispatchEvent(event)
  }
  const swipe = (target: Element, x1: number, y1: number, x2: number, y2: number, count = 1): void => {
    touch(target, 'touchstart', x1, y1, count)
    touch(target, 'touchend', x2, y2, count)
  }
  try {
    apply(ctx)
    swipe(content, 20, 100, 140, 110)
    expect(leftOpens).toBe(1)
    swipe(content, 20, 100, 140, 110)
    expect(leftOpens).toBe(1)
    swipe(content, 300, 100, 180, 110)
    expect(rightOpens).toBe(1)
    swipe(content, 300, 100, 180, 110)
    expect(rightOpens).toBe(1)

    frame.setAttribute('data-sidebar-collapsed', '')
    frame.setAttribute('data-rightbar-collapsed', '')
    swipe(content, 20, 100, 65, 105)
    swipe(content, 20, 100, 140, 190)
    swipe(content, 20, 100, 140, 110, 2)
    swipe(input, 20, 100, 140, 110)
    const horizontal = document.createElement('div')
    horizontal.style.overflowX = 'auto'
    Object.defineProperties(horizontal, {
      scrollWidth: { value: 300 },
      clientWidth: { value: 100 },
    })
    content.append(horizontal)
    swipe(horizontal, 20, 100, 140, 110)
    touch(content, 'touchstart', 20, 100)
    touch(content, 'touchcancel', 140, 110)
    touch(content, 'touchend', 140, 110)
    expect(leftOpens).toBe(1)
    expect(rightOpens).toBe(1)

    swipe(content, 300, 100, 245, 105)
    expect(rightOpens).toBe(2)
    frame.setAttribute('data-rightbar-collapsed', '')
    swipe(content, 20, 100, 75, 105)
    expect(leftOpens).toBe(2)

    for (const dispose of disposers.splice(0)) dispose()
    swipe(content, 20, 100, 140, 110)
    expect(leftOpens).toBe(2)
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

it.each(['left', 'center'])('ignores WeChat exit coordinates when leaving %s', (area) => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.toggleAttribute('data-sidebar-collapsed', area === 'center')
  frame.setAttribute('data-rightbar-collapsed', '')
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div data-left>左栏</div></div>'
    + '<main class="ui_layout__centerCol__h1"><div data-conversation-scroll>会话</div>'
    + '<button data-sidebar-right-expand>右栏</button></main>'
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', { configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) })
  const target = frame.querySelector(area === 'left' ? '[data-left]' : '[data-conversation-scroll]')!
  const disposers: (() => void)[] = []
  const ctx = context(slots(), disposers)
  const navigate = vi.fn()
  ctx.layout.toggleSidebar = navigate
  frame.querySelector('button')!.addEventListener('click', navigate)
  const touch = (type: string, x: number, y: number): void => {
    const event = new Event(type, { bubbles: true })
    const point = { identifier: 0, clientX: x, clientY: y }
    Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] },
      changedTouches: { value: [point] } })
    target.dispatchEvent(event)
  }
  try {
    apply(ctx)
    // Actual phone trace: swiping right to exit moves the WebView, flipping its local coordinates.
    const points = area === 'left' ? [[12, 394], [29.33, 404.67], [35, 407.33], [-286.33, 462.33]]
      : [[13, 267.67], [27, 273.33], [47.33, 278.67], [54.67, 280.67], [-281.67, 313]]
    touch('touchstart', points[0]![0]!, points[0]![1]!)
    for (const [x, y] of points.slice(1)) touch('touchmove', x!, y!)
    touch('touchend', points.at(-1)![0]!, points.at(-1)![1]!)
    expect(navigate).not.toHaveBeenCalled()
    // A fresh, normal left swipe still closes the drawer or opens the right panel.
    touch('touchstart', 300, 300)
    touch('touchmove', 240, 300)
    touch('touchend', 180, 300)
    expect(navigate).toHaveBeenCalledTimes(1)
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
    Object.defineProperty(window, 'matchMedia', { configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) })
  }
})

it.each([[20, 140], [300, 180]])('keeps text selection drags out of sidebar swipes (%i → %i)', (from, to) => {
  vi.useFakeTimers()
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-rightbar-collapsed', '')
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div>'
    + '<main class="ui_layout__centerCol__h1"><button data-sidebar-right-expand>右侧栏</button>'
    + '<div data-conversation-scroll>复制这段会话内容</div></main>'
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const content = frame.querySelector('[data-conversation-scroll]')!
  const selection = window.getSelection()!
  const select = (): void => {
    const range = document.createRange()
    range.selectNodeContents(content)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  const touch = (type: string, x: number): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const point = { identifier: 0, clientX: x, clientY: 100 }
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : [point] },
      changedTouches: { value: [point] },
    })
    content.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    return event
  }
  const toggle = vi.fn()
  frame.querySelector('button')!.addEventListener('click', toggle)
  const disposers: (() => void)[] = []
  const ctx = context(slots(), disposers)
  ctx.layout.toggleSidebar = toggle
  try {
    apply(ctx)
    // Drag an existing selection, even if the browser clears it before the finger lifts.
    select()
    touch('touchstart', from!)
    selection.removeAllRanges()
    touch('touchend', to!)
    expect(toggle).not.toHaveBeenCalled()

    // A new selection may become visible only at the end of the touch.
    touch('touchstart', from!)
    select()
    touch('touchend', to!)
    expect(toggle).not.toHaveBeenCalled()
    expect(selection.toString()).toBe('复制这段会话内容')
    selection.removeAllRanges()

    // Copy clears the range, but that same touch still belongs to text selection.
    touch('touchstart', from!)
    select()
    document.dispatchEvent(new Event('selectionchange'))
    selection.removeAllRanges()
    touch('touchend', to!)
    expect(toggle).not.toHaveBeenCalled()

    touch('touchstart', from!)
    content.dispatchEvent(new Event('contextmenu', { bubbles: true }))
    touch('touchend', to!)
    expect(toggle).not.toHaveBeenCalled()

    // Native long-press selection may not announce its range until after touchend.
    touch('touchstart', from!)
    vi.advanceTimersByTime(600)
    touch('touchmove', to!)
    touch('touchend', to!)
    expect(toggle).not.toHaveBeenCalled()

    // A collapsed caret and a slow swipe that starts moving promptly still allow navigation.
    select()
    selection.collapseToStart()
    touch('touchstart', from!)
    touch('touchmove', from! + Math.sign(to! - from!) * 20)
    vi.advanceTimersByTime(600)
    touch('touchend', to!)
    expect(toggle).toHaveBeenCalledTimes(1)
  } finally {
    for (const dispose of disposers) dispose()
    selection.removeAllRanges()
    proxy.remove()
    frame.remove()
    vi.useRealTimers()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

it('closes an open phone sidebar with a reverse swipe inside that sidebar', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div data-left-content>左栏</div></div>'
    + '<main class="ui_layout__centerCol__h1"><div data-conversation-scroll>消息</div>'
    + '<button data-sidebar-right-expand>右栏</button></main>'
    + '<div data-rightbar-col><div data-sidebar-right-panel="fullscreen" data-sidebar-right-open>'
    + '<div data-right-content>右栏内容</div><button data-sidebar-right-toggle>收起</button></div></div>'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-rightbar-collapsed', '')
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const disposers: (() => void)[] = []
  const ctx = context(slots(), disposers)
  ctx.layout.toggleSidebar = () => {
    frame.toggleAttribute('data-sidebar-collapsed')
  }
  frame.querySelector('[data-sidebar-right-expand]')!.addEventListener('click', () => {
    frame.removeAttribute('data-rightbar-collapsed')
  })
  frame.querySelector('[data-sidebar-right-toggle]')!.addEventListener('click', () => {
    frame.setAttribute('data-rightbar-collapsed', '')
  })
  const swipe = (target: Element, x1: number, x2: number): void => {
    for (const [type, x] of [['touchstart', x1], ['touchend', x2]] as const) {
      const event = new Event(type, { bubbles: true })
      const point = { identifier: 0, clientX: x, clientY: 100 }
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' ? [] : [point] },
        changedTouches: { value: [point] },
      })
      target.dispatchEvent(event)
    }
  }
  try {
    apply(ctx)
    swipe(frame.querySelector('[data-conversation-scroll]')!, 20, 140)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    swipe(frame.querySelector('[data-left-content]')!, 140, 85)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)

    swipe(frame.querySelector('[data-conversation-scroll]')!, 300, 180)
    expect(frame.hasAttribute('data-rightbar-collapsed')).toBe(false)
    swipe(frame.querySelector('[data-right-content]')!, 180, 235)
    expect(frame.hasAttribute('data-rightbar-collapsed')).toBe(true)
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

// Session identity and right-panel tabs are restored by the host; this plugin remembers only
// which area and global main panel were visible, without pulling a returning user off that page.
it.each([
  ['left', null], ['center', null], ['right', null],
  ['center', 'plugins'], ['center', 'schedules'], ['center', 'custom-tasks'],
] as const)('restores the phone page after leaving %s / %s', async (area, panelId) => {
  const key = 'dsh-remote-control.last-page.v1'
  localStorage.removeItem(key)
  document.documentElement.removeAttribute('data-remote-control-landed')
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div>'
    + '<main class="ui_layout__centerCol__h1"><div data-conversation-session="A"></div>'
    + '<button data-sidebar-right-expand>打开右侧栏</button></main>'
    + '<div data-rightbar-col><div data-sidebar-right-panel="fullscreen" data-sidebar-right-open>'
    + '<button data-sidebar-right-toggle>收起</button></div></div>'
  document.body.append(frame)
  const panel = frame.querySelector('[data-sidebar-right-panel]')!
  panel.querySelector('button')!.addEventListener('click', () => { panel.removeAttribute('data-sidebar-right-open') })
  frame.querySelector('[data-sidebar-right-expand]')!.addEventListener('click', () => {
    panel.setAttribute('data-sidebar-right-open', '')
    frame.setAttribute('data-sidebar-collapsed', '')
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  let visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  let now = 1_000_000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const tick = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })
  const disposers: (() => void)[] = []
  const core = slots()
  let offMain = panelId === null ? undefined
    : core.register({ name: 'main', key: panelId }, (() => null) as never)
  const ctx = context(core, disposers)
  let toggles = 0
  ctx.layout.toggleSidebar = () => {
    toggles++
    setTimeout(() => { frame.toggleAttribute('data-sidebar-collapsed') }, 0)
  }
  const drawerOpen = (): boolean => !frame.hasAttribute('data-sidebar-collapsed')
  const rightOpen = (): boolean => panel.hasAttribute('data-sidebar-right-open')
  const touch = (): void => {
    const event = new Event('touchstart', { bubbles: true })
    const point = { identifier: 0, clientX: 100, clientY: 100 }
    Object.defineProperties(event, { touches: { value: [point] }, changedTouches: { value: [point] } })
    document.body.dispatchEvent(event)
  }
  const expectPage = (): void => {
    expect(drawerOpen()).toBe(area === 'left')
    expect(rightOpen()).toBe(area === 'right')
    expect(ctx.layout.panelInfo.getSnapshot().activePanelId).toBe(panelId)
    expect(frame.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session')).toBe('A')
  }
  try {
    apply(ctx)
    await tick()
    await tick()
    expect(drawerOpen()).toBe(true) // No saved page: preserve the first visit's drawer landing.
    expect(rightOpen()).toBe(false)
    touch()
    ctx.layout.selectPanel(panelId as MainPanelId | null)
    frame.toggleAttribute('data-sidebar-collapsed', area !== 'left')
    panel.toggleAttribute('data-sidebar-right-open', area === 'right')
    await tick()
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({ area, panelId })

    // WeChat's floating WebView can reset the live layout while the page is hidden.
    const before = toggles
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    frame.setAttribute('data-sidebar-collapsed', '')
    panel.removeAttribute('data-sidebar-right-open')
    ctx.layout.selectPanel(null)
    await tick()
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({ area, panelId })
    now += 60_000
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    await tick()
    expectPage()
    if (area !== 'left') expect(toggles).toBe(before)

    // Back/forward caching can send pagehide/pageshow without a visibility change.
    touch()
    window.dispatchEvent(new Event('pagehide'))
    frame.setAttribute('data-sidebar-collapsed', '')
    panel.removeAttribute('data-sidebar-right-open')
    ctx.layout.selectPanel(null)
    await tick()
    expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({ area, panelId })
    window.dispatchEvent(new Event('pageshow'))
    await tick()
    await tick()
    expectPage()

    // A full document reload starts with the host's default layout and a restored Session A.
    for (const dispose of disposers.splice(0)) dispose()
    offMain?.()
    document.documentElement.removeAttribute('data-remote-control-landed')
    ctx.layout.selectPanel(null)
    frame.setAttribute('data-sidebar-collapsed', '')
    panel.toggleAttribute('data-sidebar-right-open', area !== 'right')
    apply(ctx)
    await tick()
    await tick()
    if (panelId !== null) {
      expect(ctx.layout.panelInfo.getSnapshot().activePanelId).toBeNull()
      expect(JSON.parse(localStorage.getItem(key) ?? 'null')).toEqual({ area, panelId })
      offMain = core.register({ name: 'main', key: panelId }, (() => null) as never)
      await tick()
      await tick()
    }
    expectPage()

    // Late native right-panel restoration must not replace the saved area.
    panel.toggleAttribute('data-sidebar-right-open', area !== 'right')
    frame.setAttribute('data-sidebar-collapsed', '')
    await tick()
    await tick()
    expectPage()

    // A user's first interaction stops startup restoration; HMR must not apply it again.
    touch()
    ctx.layout.selectPanel(null)
    frame.setAttribute('data-sidebar-collapsed', '')
    panel.removeAttribute('data-sidebar-right-open')
    await tick()
    for (const dispose of disposers.splice(0)) dispose()
    apply(ctx)
    await tick()
    await tick()
    expect(drawerOpen()).toBe(false)
    expect(rightOpen()).toBe(false)
  } finally {
    for (const dispose of disposers) dispose()
    offMain?.()
    localStorage.removeItem(key)
    proxy.remove()
    frame.remove()
    Reflect.deleteProperty(document, 'visibilityState')
    document.documentElement.removeAttribute('data-remote-control-landed')
    clock.mockRestore()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

it.each(['invalid JSON', 'invalid area', 'missing panel', 'blocked storage'])('handles %s during phone page restoration', (value) => {
  vi.useFakeTimers()
  const key = 'dsh-remote-control.last-page.v1'
  localStorage.setItem(key, value === 'missing panel' ? JSON.stringify({ area: 'center', panelId: 'removed' })
    : value === 'invalid area' ? JSON.stringify({ area: 'diagonal', panelId: null }) : 'not-json')
  document.documentElement.removeAttribute('data-remote-control-landed')
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div><main class="ui_layout__centerCol__h1"></main>'
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const disposers: (() => void)[] = []
  const ctx = context(slots(), disposers)
  ctx.layout.toggleSidebar = () => { frame.toggleAttribute('data-sidebar-collapsed') }
  try {
    if (value === 'blocked storage') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    }
    expect(() => { apply(ctx) }).not.toThrow()
    vi.advanceTimersByTime(10_000)
    expect(ctx.layout.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(value === 'missing panel')
    if (value === 'missing panel') expect(JSON.parse(localStorage.getItem(key) ?? 'null'))
      .toEqual({ area: 'center', panelId: null })
  } finally {
    for (const dispose of disposers) dispose()
    vi.restoreAllMocks()
    localStorage.removeItem(key)
    frame.remove()
    proxy.remove()
    document.documentElement.removeAttribute('data-remote-control-landed')
    vi.useRealTimers()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

// A touch screen never shows a Session row's hover strip, so a long press is the phone's way to its
// "…" menu (pin, rename, fork, archive), and the lift that ends it must not also open the row.
it('opens a drawer Session row menu with a long press on the phone', () => {
  vi.useFakeTimers()
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div class="ws__sessionRow__h1" data-row-key="session:s1">'
    + '<span data-title>会话</span><span class="ws__rowActions__h1"><span class="ui__root__h1">'
    + '<button data-trigger>…</button></span><button data-archive>归档</button></span></div></div>'
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  let menus = 0
  frame.querySelector('[data-trigger]')!.addEventListener('click', () => { menus++ })
  const title = frame.querySelector('[data-title]')!
  const touch = (target: Element, type: string, x = 100, y = 100): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const point = { identifier: 0, clientX: x, clientY: y }
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : [point] },
      changedTouches: { value: [point] },
    })
    target.dispatchEvent(event)
    return event
  }
  const disposers: (() => void)[] = []
  try {
    apply(context(slots(), disposers))
    touch(title, 'touchstart')
    vi.advanceTimersByTime(500)
    expect(menus).toBe(1)
    expect(touch(title, 'touchend').defaultPrevented).toBe(true)

    // A tap stays a tap.
    touch(title, 'touchstart')
    vi.advanceTimersByTime(200)
    expect(touch(title, 'touchend').defaultPrevented).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(menus).toBe(1)

    // A scroll or swipe is not a press, and the strip's own buttons keep their taps.
    touch(title, 'touchstart')
    touch(title, 'touchmove', 100, 130)
    vi.advanceTimersByTime(1000)
    touch(frame.querySelector('[data-archive]')!, 'touchstart')
    vi.advanceTimersByTime(1000)
    expect(menus).toBe(1)

    const menu = new Event('contextmenu', { bubbles: true, cancelable: true })
    title.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)

    for (const dispose of disposers.splice(0)) dispose()
    touch(title, 'touchstart')
    vi.advanceTimersByTime(1000)
    expect(menus).toBe(1)
  } finally {
    for (const dispose of disposers) dispose()
    vi.useRealTimers()
    proxy.remove()
    frame.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

it('shows full git history details on a label hold without taking taps or row menus', () => {
  vi.useFakeTimers()
  const prototype = HTMLDialogElement.prototype
  const show = Object.getOwnPropertyDescriptor(prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(prototype, 'close')
  // jsdom has the element but no native top layer; browser checks cover the real modal.
  Object.defineProperty(prototype, 'showModal', { configurable: true, value() {
    this.setAttribute('open', '')
    this.querySelector('button')?.focus()
  } })
  Object.defineProperty(prototype, 'close', { configurable: true, value() {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  } })
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  })
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<aside class="ui_layout__sidebarCol__h1">'
    + '<div data-scroll-key="history" class="git_gitSectionBodyHistory"></div></aside>'
  document.body.append(frame)
  const disposers: (() => void)[] = []
  const touch = (target: Element, type: string, x = 100, count = 1): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const points = Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: 100 }))
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : points },
      changedTouches: { value: points },
    })
    target.dispatchEvent(event)
    return event
  }
  const details = () => document.querySelector<HTMLDialogElement>('[data-remote-control-git-details]')
  try {
    apply(context(slots(), disposers))
    // History can load after the phone patches are installed.
    const row = document.createElement('div')
    row.className = 'git_gitLogRow'
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.title = 'main origin/main dsh-remote-control-01\n作者 · 2026-10-06T12:00:00+08:00\n' + 'a'.repeat(40)
    row.innerHTML = '<span class="git_gitLogSubject"></span><span class="git_gitLogRef">main</span>'
      + '<span class="git_gitLogRef">origin/main</span><span class="git_gitLogRef"></span>'
    const subject = row.firstElementChild!
    subject.textContent = '完整提交说明 <img src=x onerror=alert(1)>'
    const label = row.lastElementChild!
    label.textContent = 'dsh-remote-control-01/' + 'very-long-'.repeat(20)
    frame.querySelector('[data-scroll-key="history"]')!.append(row)
    let clicks = 0
    let menus = 0
    row.addEventListener('click', () => { clicks++ })
    row.addEventListener('contextmenu', () => { menus++ })
    touch(label, 'touchstart')
    vi.advanceTimersByTime(200)
    expect(touch(label, 'touchend').defaultPrevented).toBe(false)
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(clicks).toBe(1)
    expect(details()).toBeNull()
    for (const type of ['move', 'cancel', 'multi', 'removed']) {
      touch(label, 'touchstart')
      if (type === 'move') touch(label, 'touchmove', 130)
      if (type === 'cancel') touch(label, 'touchcancel')
      if (type === 'multi') touch(label, 'touchmove', 100, 2)
      if (type === 'removed') row.remove()
      vi.advanceTimersByTime(600)
      expect(details()).toBeNull()
      touch(label, 'touchend')
      frame.querySelector('[data-scroll-key="history"]')!.append(row)
    }
    touch(label, 'touchstart')
    vi.advanceTimersByTime(500)
    const dialog = details()!
    expect(dialog).not.toBeNull()
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.getAttribute('aria-label')).toBe('提交详情')
    expect([...dialog.querySelectorAll('dd')].map(value => value.textContent)).toEqual([
      subject.textContent, 'main\norigin/main\n' + label.textContent,
      '作者 · 2026-10-06T12:00:00+08:00', 'a'.repeat(40),
    ])
    expect(dialog.querySelector('img')).toBeNull()
    const menu = new Event('contextmenu', { bubbles: true, cancelable: true })
    label.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    expect(menus).toBe(0)
    expect(document.querySelectorAll('[data-remote-control-git-details]')).toHaveLength(1)
    expect(touch(label, 'touchend').defaultPrevented).toBe(true)
    label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicks).toBe(1)
    dialog.querySelector('button')!.click()
    expect(details()).toBeNull()
    expect(document.activeElement).toBe(row)
    subject.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }))
    expect(menus).toBe(1)
    touch(subject, 'touchstart')
    vi.advanceTimersByTime(600)
    expect(details()).toBeNull()
    touch(subject, 'touchend')
    touch(label, 'touchstart')
    vi.advanceTimersByTime(500)
    expect(details()).not.toBeNull()
    for (const dispose of disposers.splice(0)) dispose()
    expect(details()).toBeNull()
    touch(label, 'touchstart')
    vi.advanceTimersByTime(600)
    expect(details()).toBeNull()
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
    if (show) Object.defineProperty(prototype, 'showModal', show)
    else Reflect.deleteProperty(prototype, 'showModal')
    if (close) Object.defineProperty(prototype, 'close', close)
    else Reflect.deleteProperty(prototype, 'close')
    vi.useRealTimers()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    })
  }
})

// A phone frame has no room for a right track (the shell's computeColumns gives it 0), so the right
// panel opens fullscreen over a frame that keeps `data-rightbar-collapsed`: open is the panel's own
// `data-sidebar-right-open`, and a reverse swipe must close it all the same.
it('closes the fullscreen phone right panel over a frame that keeps no right track', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-rightbar-collapsed', '')
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div><main class="ui_layout__centerCol__h1"></main>'
    + '<div data-rightbar-col><div data-sidebar-right-panel="fullscreen" data-sidebar-right-open>'
    + '<div data-guide>指南</div><button data-sidebar-right-toggle>收起</button></div></div>'
  document.body.append(frame)
  const panel = frame.querySelector('[data-sidebar-right-panel]')!
  frame.querySelector('[data-sidebar-right-toggle]')!.addEventListener('click', () => {
    panel.removeAttribute('data-sidebar-right-open')
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const disposers: (() => void)[] = []
  const swipe = (target: Element, x1: number, x2: number): void => {
    for (const [type, x] of [['touchstart', x1], ['touchend', x2]] as const) {
      const event = new Event(type, { bubbles: true })
      const point = { identifier: 0, clientX: x, clientY: 100 }
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' ? [] : [point] },
        changedTouches: { value: [point] },
      })
      target.dispatchEvent(event)
    }
  }
  try {
    apply(context(slots(), disposers))
    swipe(frame.querySelector('[data-guide]')!, 100, 220)
    expect(panel.hasAttribute('data-sidebar-right-open')).toBe(false)
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

// An open sidebar is mostly controls (file rows, tabs, session actions) inside scrollers that also
// scroll sideways: a closing swipe that starts on them still closes, unless a text field has it or
// the scroller underneath can still scroll that way.
it('closes an open phone sidebar from a swipe that starts on its controls', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><button data-left-row>会话</button></div>'
    + '<main class="ui_layout__centerCol__h1"></main>'
    + '<div data-rightbar-col><div data-sidebar-right-panel="fullscreen" data-sidebar-right-open>'
    + '<div data-files style="overflow-x:auto"><button data-file>src/client/AgentBoard.tsx</button></div>'
    + '<input data-filter><button data-sidebar-right-toggle>收起</button></div></div>'
  document.body.append(frame)
  const files = frame.querySelector<HTMLElement>('[data-files]')!
  Object.defineProperties(files, { scrollWidth: { value: 500 }, clientWidth: { value: 300 } })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const disposers: (() => void)[] = []
  const ctx = context(slots(), disposers)
  ctx.layout.toggleSidebar = () => { frame.toggleAttribute('data-sidebar-collapsed') }
  frame.querySelector('[data-sidebar-right-toggle]')!.addEventListener('click', () => {
    frame.setAttribute('data-rightbar-collapsed', '')
  })
  const swipe = (target: Element, x1: number, x2: number): void => {
    for (const [type, x] of [['touchstart', x1], ['touchend', x2]] as const) {
      const event = new Event(type, { bubbles: true })
      const point = { identifier: 0, clientX: x, clientY: 100 }
      Object.defineProperties(event, {
        touches: { value: type === 'touchend' ? [] : [point] },
        changedTouches: { value: [point] },
      })
      target.dispatchEvent(event)
    }
  }
  try {
    apply(ctx)
    // A text field keeps its own drag, and a list scrolled right takes the swipe back to its start.
    swipe(frame.querySelector('[data-filter]')!, 100, 220)
    files.scrollLeft = 60
    swipe(frame.querySelector('[data-file]')!, 100, 220)
    expect(frame.hasAttribute('data-rightbar-collapsed')).toBe(false)
    // At the list's start there is nothing left to scroll: the swipe over a file row closes the panel.
    files.scrollLeft = 0
    swipe(frame.querySelector('[data-file]')!, 100, 220)
    expect(frame.hasAttribute('data-rightbar-collapsed')).toBe(true)

    swipe(frame.querySelector('[data-left-row]')!, 220, 100)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})

// Chat preferences are page-local on a proxied page (the Host persists them for loopback pages
// only), so every phone load would open at Detailed; the remote page starts both at Compact.
it('starts remote chat work steps and performance usage at compact, once per registration', async () => {
  const proxied = document.createElement('style')
  proxied.setAttribute('data-dsh-remote-control', '')
  /** One Chat settings row, registered the way the shell's Chat plugin does. */
  const row = (core: SlotCore, id: string, setter: string, calls: string[]): void => {
    core.register({
      name: 'settings.general.item', id,
      inject: () => ({ [setter]: (mode: string) => { calls.push(`${id}:${mode}`) } }),
    } as never, (() => null) as never)
  }
  const activate = (installProxyStyle: boolean): { calls: string[]; core: SlotCore; dispose: () => void } => {
    if (installProxyStyle) document.head.append(proxied)
    else proxied.remove()
    const calls: string[] = []
    const core = slots()
    row(core, 'transcript-view', 'setTranscriptView', calls)
    row(core, 'link-opening', 'setLinkOpening', calls)
    const disposers: (() => void)[] = []
    apply(context(core, disposers))
    return { calls, core, dispose: () => { for (const dispose of disposers) dispose() } }
  }
  try {
    const remote = activate(true)
    expect(remote.calls).toEqual(['transcript-view:compact'])
    // A row the Chat plugin registers later still starts at Compact...
    row(remote.core, 'performance-usage', 'setPerformanceUsage', remote.calls)
    await Promise.resolve()
    expect(remote.calls).toEqual(['transcript-view:compact', 'performance-usage:compact'])
    // ...and later ledger changes leave a choice made on the phone alone.
    row(remote.core, 'other', 'setOther', remote.calls)
    await Promise.resolve()
    expect(remote.calls).toEqual(['transcript-view:compact', 'performance-usage:compact'])
    remote.dispose()

    // A local page keeps the shell's own defaults and its persisted choice.
    const local = activate(false)
    row(local.core, 'performance-usage', 'setPerformanceUsage', local.calls)
    await Promise.resolve()
    expect(local.calls).toEqual([])
    local.dispose()
  } finally {
    proxied.remove()
  }
})

it('pulls to load earlier messages only at the top of the phone conversation', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div>'
    + '<main class="ui_layout__centerCol__h1"><div data-conversation-scroll>'
    + '<div data-chat-flow><div class="ui_chat__older__h1"><button>加载更早</button></div>'
    + '<p>会话内容</p></div></div></main>'
  document.body.append(frame)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: !query.includes('prefers-reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const scroller = frame.querySelector<HTMLElement>('[data-conversation-scroll]')!
  const column = frame.querySelector<HTMLElement>('[data-chat-flow]')!
  const message = frame.querySelector('p')!
  const button = frame.querySelector('button')!
  Object.defineProperties(scroller, {
    scrollHeight: { value: 900 },
    clientHeight: { value: 400 },
  })
  let loads = 0
  button.addEventListener('click', () => { loads++ })
  const touch = (type: string, y: number, count = 1): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const points = Array.from({ length: count }, (_, index) => ({ identifier: index + 1, clientX: 160, clientY: y }))
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : points },
      changedTouches: { value: points },
    })
    message.dispatchEvent(event)
    return event
  }
  const disposers: (() => void)[] = []
  try {
    apply(context(slots(), disposers))
    touch('touchstart', 190)
    expect(touch('touchmove', 90).defaultPrevented).toBe(false)
    touch('touchend', 90)
    touch('touchstart', 100)
    const pull = touch('touchmove', 190)
    expect(pull.defaultPrevented).toBe(true)
    expect(column.style.transform).toMatch(/translateY\([1-9]/u)
    touch('touchend', 190)
    expect(loads).toBe(1)
    expect(column.style.transform).toBe('translateY(0px)')
    expect(column.style.transition).toContain('transform')

    scroller.scrollTop = 100
    touch('touchstart', 100)
    expect(touch('touchmove', 190).defaultPrevented).toBe(false)
    touch('touchend', 190)
    expect(loads).toBe(1)

    scroller.scrollTop = 0
    button.disabled = true
    touch('touchstart', 100)
    touch('touchmove', 190)
    touch('touchend', 190)
    expect(loads).toBe(1)

    button.disabled = false
    touch('touchstart', 100)
    touch('touchmove', 190)
    touch('touchstart', 190, 2)
    expect(column.style.transform).toBe('translateY(0px)')
    touch('touchend', 190)
    expect(loads).toBe(1)
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
  }
})

it('rebounds an upward pull at the bottom without moving the composer', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"></div>'
    + '<main class="ui_layout__centerCol__h1"><div data-conversation-scroll>'
    + '<div data-chat-flow><p>会话内容</p></div><div data-composer-seat>输入框</div></div></main>'
  document.body.append(frame)
  let reducedMotion = false
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : true,
      addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const scroller = frame.querySelector<HTMLElement>('[data-conversation-scroll]')!
  const column = frame.querySelector<HTMLElement>('[data-chat-flow]')!
  const message = frame.querySelector('p')!
  Object.defineProperties(scroller, {
    scrollHeight: { value: 900 },
    clientHeight: { value: 400 },
  })
  scroller.scrollTop = 500
  const touch = (type: string, y: number): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const point = { identifier: 1, clientX: 160, clientY: y }
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : [point] },
      changedTouches: { value: [point] },
    })
    message.dispatchEvent(event)
    return event
  }
  const disposers: (() => void)[] = []
  try {
    apply(context(slots(), disposers))
    touch('touchstart', 90)
    expect(touch('touchmove', 190).defaultPrevented).toBe(false)
    touch('touchend', 190)
    touch('touchstart', 190)
    expect(touch('touchmove', 90).defaultPrevented).toBe(true)
    expect(column.style.transform).toMatch(/translateY\(-/u)
    touch('touchend', 90)
    expect(column.style.transform).toBe('translateY(0px)')
    expect(column.style.transition).toContain('transform')
    expect(frame.querySelector('[data-composer-seat]')?.getAttribute('style')).toBeNull()

    reducedMotion = true
    touch('touchstart', 190)
    touch('touchmove', 90)
    touch('touchend', 90)
    expect(column.style.transform).toBe('')
    expect(column.style.transition).toBe('')
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
  }
})

it('rebounds the whole drawer at either edge without moving its pinned header or settings', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div class="ui_sidebar__root__h1">'
    + '<div class="ui_sidebar__logoRow__h1"><button>收起</button></div>'
    + '<div data-remote-control-agents><button>Agent</button></div>'
    + '<nav class="ui_sidebar__panelList__h1"><button>插件</button><button>自动化任务</button></nav>'
    + '<div class="ui_sidebar__regionArea__h1"><div class="ui_workspace__list__h1">'
    + '<button data-project>项目</button><input><div role="dialog">菜单</div></div></div>'
    + '<div class="ui_sidebar__footArea__h1"><button>设置</button></div></div></div>'
  document.body.append(frame)
  let reducedMotion = false
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : true,
      addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const scroller = frame.querySelector<HTMLElement>('.ui_sidebar__root__h1')!
  const agents = frame.querySelector<HTMLElement>('[data-remote-control-agents]')!
  const projects = frame.querySelector<HTMLElement>('.ui_sidebar__regionArea__h1')!
  const target = frame.querySelector('[data-project]')!
  Object.defineProperties(scroller, { scrollHeight: { value: 900 }, clientHeight: { value: 400 } })
  const touch = (element: Element, type: string, y: number, x = 160, count = 1): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const points = Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y }))
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : points },
      changedTouches: { value: points },
    })
    element.dispatchEvent(event)
    return event
  }
  const disposers: (() => void)[] = []
  try {
    apply(context(slots(), disposers))
    scroller.scrollTop = 100
    touch(target, 'touchstart', 100)
    expect(touch(target, 'touchmove', 200).defaultPrevented).toBe(false)
    touch(target, 'touchend', 200)
    scroller.scrollTop = 0
    touch(target, 'touchstart', 100)
    expect(touch(target, 'touchmove', 200).defaultPrevented).toBe(true)
    expect(agents.style.transform).toMatch(/translateY\([1-9]/u)
    expect(projects.style.transform).toBe(agents.style.transform)
    expect(frame.querySelector('.ui_sidebar__logoRow__h1')?.getAttribute('style')).toBeNull()
    expect(frame.querySelector('.ui_sidebar__panelList__h1')?.getAttribute('style')).toBeNull()
    expect(frame.querySelector('.ui_sidebar__footArea__h1')?.getAttribute('style')).toBeNull()
    touch(target, 'touchend', 200)
    expect(agents.style.transform).toBe('translateY(0px)')
    expect(projects.style.transition).toContain('transform')
    scroller.scrollTop = 500
    touch(target, 'touchstart', 200)
    expect(touch(target, 'touchmove', 100).defaultPrevented).toBe(true)
    expect(projects.style.transform).toMatch(/translateY\(-/u)
    expect(frame.querySelector('.ui_sidebar__panelList__h1')?.getAttribute('style')).toBeNull()
    touch(target, 'touchcancel', 100)
    expect(projects.style.transform).toBe('translateY(0px)')
    reducedMotion = true
    touch(target, 'touchstart', 200)
    touch(target, 'touchmove', 100)
    touch(target, 'touchend', 100)
    expect(projects.style.transform).toBe('')
    expect(projects.style.transition).toBe('')
    for (const selector of ['input', '[role="dialog"]', '.ui_sidebar__logoRow__h1 button', '.ui_sidebar__panelList__h1 button', '.ui_sidebar__footArea__h1 button']) {
      const element = frame.querySelector(selector)!
      touch(element, 'touchstart', 200)
      expect(touch(element, 'touchmove', 100).defaultPrevented).toBe(false)
      touch(element, 'touchend', 100)
    }
    touch(target, 'touchstart', 200)
    expect(touch(target, 'touchmove', 200, 80).defaultPrevented).toBe(false)
    touch(target, 'touchcancel', 200)
    touch(target, 'touchstart', 200, 160, 2)
    expect(touch(target, 'touchmove', 100, 160, 2).defaultPrevented).toBe(false)
    touch(target, 'touchcancel', 100)
    touch(target, 'touchstart', 200)
    touch(target, 'touchmove', 100)
    for (const dispose of disposers.splice(0)) dispose()
    expect(projects.style.transform).toBe('')
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    frame.remove()
  }
})

// Models configuration is a desktop task; the phone's Settings keep every other section.
it('hides the Models section from phone Settings and leaves it when selected', async () => {
  const proxied = document.createElement('style')
  proxied.setAttribute('data-dsh-remote-control', '')
  const modal = document.createElement('div')
  modal.setAttribute('data-shortcut-modal', 'settings')
  const cell = (label: string, current = false): string => '<button type="button" class="s_navCell"'
    + (current ? ' aria-current="true"' : '') + `><svg></svg><span class="s_navLabel">${label}</span></button>`
  const activate = (narrow: boolean, installProxyStyle: boolean): { core: SlotCore; dispose: () => void } => {
    if (installProxyStyle) document.head.append(proxied)
    else proxied.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: narrow, addEventListener: () => {}, removeEventListener: () => {} }),
    })
    const core = slots()
    core.register({ name: 'settings.section', id: 'general', order: 0, label: '通用' } as never, (() => null) as never)
    core.register({ name: 'settings.section', id: 'models', order: 10, label: () => '模型' } as never, (() => null) as never)
    const disposers: (() => void)[] = []
    apply(context(core, disposers))
    return { core, dispose: () => { for (const dispose of disposers) dispose() } }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const button = (label: string) => [...modal.querySelectorAll('button')]
    .find(candidate => candidate.textContent === label)!
  try {
    // The Settings dialog opens on Models (a remembered choice): the phone hides it and moves on.
    modal.innerHTML = `<nav><div class="s_navList">${cell('通用')}${cell('模型', true)}</div></nav>`
    document.body.append(modal)
    let picked = ''
    modal.addEventListener('click', (event) => { picked = (event.target as Element).textContent ?? '' })
    const phone = activate(true, true)
    expect(button('模型').style.display).toBe('none')
    expect(button('通用').style.display).toBe('')
    expect(picked).toBe('通用')
    // A dialog opened later is handled too.
    modal.innerHTML = `<nav><div class="s_navList">${cell('通用', true)}${cell('模型')}</div></nav>`
    await settle()
    expect(button('模型').style.display).toBe('none')
    phone.dispose()
    // Disposing the phone patch gives the row back.
    expect(button('模型').style.display).toBe('')

    // A local window keeps its Models section.
    modal.innerHTML = `<nav><div class="s_navList">${cell('通用', true)}${cell('模型')}</div></nav>`
    const local = activate(true, false)
    await settle()
    expect(button('模型').style.display).toBe('')
    local.dispose()
  } finally {
    proxied.remove()
    modal.remove()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    })
  }
})


it('closes the command launcher on a second click after its source is cleared', () => {
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const launcher = document.createElement('button')
  launcher.className = '_add'
  launcher.setAttribute('aria-haspopup', 'listbox')
  const editor = document.createElement('div')
  editor.setAttribute('data-composer-input', '')
  const menu = document.createElement('div')
  menu.setAttribute('data-trigger-menu', '')
  card.append(launcher, editor)
  document.body.append(card)
  let hostClicks = 0
  launcher.addEventListener('click', () => {
    hostClicks++
    // The host's focus tracking clears the launcher source before its toggle runs.
    // Its second click therefore leaves this already-open menu in place.
    if (!menu.isConnected) card.append(menu)
  })
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.remove()
  })
  const disposers: (() => void)[] = []
  try {
    apply(context(slots(), disposers))
    launcher.click()
    expect(menu.isConnected).toBe(true)
    launcher.click()
    expect(menu.isConnected).toBe(false)
    expect(hostClicks).toBe(1)
    launcher.click()
    expect(menu.isConnected).toBe(true)
  } finally {
    for (const dispose of disposers) dispose()
    card.remove()
  }
})

it('springs the phone composer chips past either strip end while its pinned ends stay put', () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  card.innerHTML = '<div class="ui_conversation__row__h1">'
    + '<div class="ui_conversation__tools__h1"><button class="ui_conversation__add__h1">+</button>'
    + '<div class="ui_conversation__modes__h1"><div data-slot="p"><div id="mode">自动</div></div></div>'
    + '<div data-slot="l"><div id="harness">Claude Code</div></div></div>'
    + '<div class="ui_conversation__trailing__h1"><div class="ui_conversation__standardControls__h1">'
    + '<div data-slot="m"><div id="model">Opus</div></div></div>'
    + '<div class="ui_conversation__activity__h1"><div data-slot="a"><button id="mic">mic</button></div></div>'
    + '<button class="ui_conversation__primary__h1">发送</button></div></div>'
  document.body.append(card)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: !query.includes('prefers-reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }),
  })
  const strip = card.firstElementChild as HTMLElement
  Object.defineProperties(strip, { scrollWidth: { value: 600 }, clientWidth: { value: 300 } })
  const chips = ['mode', 'harness', 'model'].map(id => document.getElementById(id)!)
  const pinned = [card.querySelector<HTMLElement>('[class*="_add"]')!, document.getElementById('mic')!,
    card.querySelector<HTMLElement>('[class*="_primary"]')!]
  const touch = (type: string, x: number, y = 20): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const points = [{ identifier: 1, clientX: x, clientY: y }]
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : points },
      changedTouches: { value: points },
    })
    chips[1]!.dispatchEvent(event)
    return event
  }
  const disposers: (() => void)[] = []
  try {
    apply(context(slots(), disposers))
    // At the start, a further rightward drag stretches the chips, capped, and springs back on release.
    strip.scrollLeft = 0
    touch('touchstart', 100)
    touch('touchmove', 110)
    const pull = touch('touchmove', 250)
    expect(pull.defaultPrevented).toBe(true)
    for (const chip of chips) expect(chip.style.transform).toBe('translateX(40px)')
    for (const end of pinned) expect(end.style.transform).toBe('')
    touch('touchend', 250)
    for (const chip of chips) {
      expect(chip.style.transform).toBe('translateX(0px)')
      expect(chip.style.transition).toContain('transform')
    }

    // Mid-strip the drag is the strip's own scroll.
    strip.scrollLeft = 100
    touch('touchstart', 100)
    touch('touchmove', 110)
    expect(touch('touchmove', 190).defaultPrevented).toBe(false)
    expect(chips[0]!.style.transform).toBe('')
    touch('touchend', 190)

    // At the end the pull runs the other way.
    strip.scrollLeft = 300
    touch('touchstart', 200)
    touch('touchmove', 190)
    touch('touchmove', 150)
    expect(chips[0]!.style.transform).toBe('translateX(-23px)')
    touch('touchend', 150)

    // A vertical gesture is never a strip pull.
    strip.scrollLeft = 0
    touch('touchstart', 100, 20)
    touch('touchmove', 104, 60)
    expect(touch('touchmove', 150, 90).defaultPrevented).toBe(false)
    expect(chips[0]!.style.transform).toBe('')
  } finally {
    for (const dispose of disposers) dispose()
    proxy.remove()
    card.remove()
  }
})
