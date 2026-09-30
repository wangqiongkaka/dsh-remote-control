// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { expect, it } from 'vitest'
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
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  }, (() => null) as never)
  return core
}

function context(core: SlotCore, disposers: (() => void)[] = []): Context {
  return {
    effect: (register: () => () => void) => { disposers.push(register()) },
    locale: { register: () => () => {} },
    slots: {
      register: core.register.bind(core),
      inject: (_name: string, register: () => () => void) => register(),
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
