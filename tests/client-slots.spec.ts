// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { expect, it } from 'vitest'
import { apply } from '../dist/client/index.js'
import { formatBalance } from '../dist/client/account.js'

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
      'shell.overlay': { kind: 'list', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  }, (() => null) as never)
  return core
}

function context(core: SlotCore, disposers: (() => void)[] = [], remote: object = {}): Context {
  return {
    remote,
    effect: (register: () => () => void) => { disposers.push(register()) },
    locale: { register: () => () => {}, bind: () => (key: string) => key, getSnapshot: () => ({ active: 'zh-CN' }) },
    slots: {
      register: core.register.bind(core),
      inject: (_name: string, register: () => () => void) => register(),
      entries: core.entries.bind(core),
      subscribe: core.subscribe.bind(core),
    },
    layout: { toggleSidebar: () => {} },
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

it('adds the drawer dismissal layer to the frame-wide overlay list', () => {
  const core = slots()
  const disposers: (() => void)[] = []
  try {
    apply(context(core, disposers))
    expect(core.entries('shell.overlay')).toHaveLength(1)
    expect(core.entries('shell.overlay')[0]?.options.id).toBe('remote-control.dismiss')
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
    expect(sheet()).not.toBeNull()
    phone()
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

// The Host registers Account & balance only in the Desktop renderer; a proxied page gets its own
// read-only section over the same account calls, reported under the Host's client version.
it('shows the signed-in account and balance on a proxied page', async () => {
  const proxied = document.createElement('style')
  proxied.setAttribute('data-dsh-remote-control', '')
  const fetchBefore = globalThis.fetch
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const signedIn = { status: 'credential-stored', links: { usageUrl: 'https://platform.example/usage', topUpUrl: '' }, attempt: null }
  /** Account calls as the Host serves them, recording the client identity each read carried. */
  const remote = (view: object, calls: string[]) => ({
    account: {
      watch: async function* () { yield view },
      getProfile: async (client: { version: string }) => {
        calls.push(`profile:${client.version}`)
        return { ok: true, value: { status: 'ready', value: { id: null, name: '王琼', contact: 'w***@gmail.com', avatarUrl: null } } }
      },
      getBalance: async (client: { version: string }) => {
        calls.push(`balance:${client.version}`)
        return { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '1234.567' }], bonusWallets: [{ currency: 'CNY', balance: '0' }] } }
      },
    },
    $stream: (options: { open: (signal: AbortSignal) => AsyncIterable<unknown> }) => {
      const lifetime = new AbortController()
      return {
        async* [Symbol.asyncIterator]() {
          for await (const value of options.open(lifetime.signal)) yield { value, accept: () => {} }
        },
        dispose: async () => { lifetime.abort() },
      }
    },
  })
  const activate = async (options: { proxy: boolean; view: object; version?: string }) => {
    if (options.proxy) document.head.append(proxied)
    else proxied.remove()
    globalThis.fetch = (async () => Response.json(
      options.version === undefined ? { active: true } : { active: true, clientVersion: options.version })) as typeof fetch
    const calls: string[] = []
    const core = slots()
    const disposers: (() => void)[] = []
    apply(context(core, disposers, remote(options.view, calls)))
    await settle()
    await settle()
    const section = core.entries('settings.section').find(entry => entry.options.id === 'account')
    return { calls, section, dispose: () => { for (const dispose of disposers) dispose() } }
  }
  try {
    const phone = await activate({ proxy: true, view: signedIn, version: '0.2.0-rc.2' })
    expect(phone.section?.options.order).toBe(-10)
    expect(phone.calls.sort()).toEqual(['balance:0.2.0-rc.2', 'profile:0.2.0-rc.2'])
    const store = (phone.section?.inject?.() as { store: { getSnapshot: () => unknown } }).store
    expect(store.getSnapshot()).toMatchObject({
      usageUrl: 'https://platform.example/usage',
      profile: { status: 'ready', value: { name: '王琼' } },
      balance: { status: 'ready', value: [{ currency: 'CNY', balance: '1234.567' }] },
    })
    phone.dispose()

    // Signed out, the section stays away, as it does on Desktop.
    const signedOut = await activate({ proxy: true, view: { ...signedIn, status: 'signed-out' }, version: '0.2.0-rc.2' })
    expect(signedOut.section).toBeUndefined()
    signedOut.dispose()

    // Without the Host's version there is nothing honest to report: no section, no account call.
    const unknown = await activate({ proxy: true, view: signedIn })
    expect(unknown.section).toBeUndefined()
    expect(unknown.calls).toEqual([])
    unknown.dispose()

    // A local page leaves account UI to the Host.
    const local = await activate({ proxy: false, view: signedIn, version: '0.2.0-rc.2' })
    expect(local.section).toBeUndefined()
    local.dispose()
  } finally {
    proxied.remove()
    globalThis.fetch = fetchBefore
  }
})

it('formats balances the way the Desktop account section does', () => {
  expect(formatBalance('1234.567', '¥')).toBe('¥1,234.56')
  expect(formatBalance('0', '¥')).toBe('¥0.00')
  expect(formatBalance('0.004', '$')).toBe('<$0.01')
  expect(formatBalance('1000000', '$')).toBe('$1,000,000.00')
  expect(formatBalance('-12.5', '¥')).toBe('-¥12.50')
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
