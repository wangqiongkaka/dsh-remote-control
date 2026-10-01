// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { applyDrawerSelection, DRAWER_STYLE_ATTRIBUTE } from '../dist/client/drawer-style.js'

/** The injected sheet, or undefined while none is mounted. */
function sheet(): HTMLStyleElement | null {
  return document.head.querySelector(`style[${DRAWER_STYLE_ATTRIBUTE}]`)
}

afterEach(() => { sheet()?.remove() })

it('separates the current session from a latched hover in the drawer', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  // The session the user is in takes the active fill the shell's own sidebar nav uses...
  expect(css).toContain('[class*="_sessionRow"][aria-selected="true"]')
  expect(css).toContain('var(--dsw-specific-sidebar-nav-item-active)')
  // ...and on a touch device the row a finger last landed on paints nothing at all.
  expect(css).toContain('@media (hover: none)')
  expect(css).toContain('[class*="_sessionRow"]:hover:not([aria-selected="true"])')
  expect(css).toContain('[class*="_projectRow"]:hover')
  dispose()
})

// WebKit treats a tap that first produces a hover-only layout change as the hover, so a row that
// grows its action strip or drops its timestamp on that tap needs a second one to open.
it('keeps session and search rows at their resting shape on a touch device', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  expect(css).toContain('[class*="_rowActions"]{display:none !important}')
  expect(css).toContain('[class*="_time"]{display:revert !important}')
  expect(css).toContain('[class*="_pinIndicator"]{display:inline-flex !important}')
  expect(css).toContain('[class*="_chevron"]{display:none !important}')
  expect(css).toContain('[class*="_folder"]{display:revert !important}')
  // An open row menu is the user's own state and keeps its revealed actions.
  expect(css).toContain(':hover:not([class*="_menuOpen"])')
  // With the latched fill gone, the pressed fill is what answers the finger.
  expect(css).toContain('[class*="_sessionRow"]:active')
  expect(css).toContain('var(--dsw-alias-interactive-bg-active)')
  dispose()
})

// Each top-level Workspace section (its row, Session rows and overflow control) reads as one card;
// a child Workspace in tree grouping stays inside its parent's card instead of nesting another.
it('draws each top-level workspace section as an outlined card', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  const card = '[class*="_sidebarCol"] [role="tree"] > [class*="_groupSection"]'
  expect(css).toContain(`${card}{padding:4px;border-radius:16px;box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}`)
  expect(css).toContain(`${card} + [class*="_groupSection"]{margin-top:8px !important}`)
  expect(css).toContain(`${card} > [class*="_projectRow"] [class*="_title"]{font-weight:600}`)
  dispose()
})

// The full-screen phone drawer gives every row a thumb-sized target, the only way back included.
it('raises the drawer rows to touch height at phone width', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  const phone = css.slice(css.indexOf('@media (max-width: 720px){'))
  expect(phone).not.toBe(css)
  expect(phone).toContain('[class*="_projectRow"]{height:44px !important}')
  expect(phone).toContain('[class*="_sessionRow"]{height:40px !important}')
  expect(phone).toContain('[class*="_sessionOverflowButton"]{height:36px !important}')
  expect(phone).toContain('[class*="_logoRow"] button[class*="_toggle"]{width:40px !important;height:40px !important}')
  dispose()
})

// The Agent card takes the seat: the shell's New Session button goes, a Workspace row's stays.
it('hides the sidebar New Session button in the drawer', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  expect(css).toContain('[class*="_sidebarCol"] button[class*="_newSession"]{display:none !important}')
  expect(css).not.toContain('button[class*="_newSession"]{height')
  dispose()
})

it('keeps project actions visible on touch so a session can be created', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  expect(css).toContain('[class*="_projectRow"] [class*="_rowActions"]{display:inline-flex !important}')
  expect(css).not.toContain('[class*="_projectRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"]{display:none !important}')
  dispose()
})

it('removes the sheet it injected', () => {
  const dispose = applyDrawerSelection()
  expect(sheet()).not.toBeNull()
  dispose()
  expect(sheet()).toBeNull()
})

it('scrolls the whole drawer while the brand and settings stay pinned', () => {
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div class="ui_sidebar__root__h1">'
    + '<div class="ui_sidebar__logoRow__h1">品牌</div>'
    + '<div data-remote-control-agents><div class="rc-agents-list">Agent</div></div>'
    + '<div class="ui_sidebar__regionArea__h1"><div class="ui_workspace__root__h1">'
    + '<div class="ui_workspace__listArea__h1"><div class="ui_workspace__treeBody__h1">'
    + '<div class="ui_workspace__list__h1" role="tree">项目</div></div></div></div></div>'
    + '<div class="ui_sidebar__footArea__h1">设置</div></div></div>'
  document.body.append(frame)
  const dispose = applyDrawerSelection()
  const style = (selector: string): CSSStyleDeclaration => getComputedStyle(frame.querySelector(selector)!)
  try {
    expect(style('.ui_sidebar__root__h1').overflowY).toBe('auto')
    expect(style('.ui_sidebar__root__h1').overscrollBehaviorY).toBe('none')
    expect(style('.ui_sidebar__logoRow__h1').position).toBe('sticky')
    expect(style('.ui_sidebar__logoRow__h1').top).toBe('0px')
    expect(style('.ui_sidebar__footArea__h1').position).toBe('sticky')
    expect(style('.ui_sidebar__footArea__h1').bottom).toBe('0px')
    expect(style('.ui_sidebar__regionArea__h1').overflow).toBe('visible')
    expect(style('.ui_workspace__list__h1').overflowY).toBe('visible')
    expect(style('.rc-agents-list').overflow).toBe('visible')
    expect(style('.rc-agents-list').maxHeight).toBe('none')
  } finally { dispose(); frame.remove() }
})

it('stacks delegation and discussion controls with phone-sized touch targets', () => {
  const dispose = applyDrawerSelection()
  const phone = sheet()?.textContent ?? ''
  dispose()
  const mode = '.hp-delegate[data-hp-mode]'
  expect(phone).toContain(`${mode}{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));`)
  expect(phone).toContain(`${mode} > .hp-delegate-exit{grid-column:2;grid-row:1;justify-self:end;margin:0;width:36px;height:36px;position:sticky;top:-8px;z-index:1;background:var(--dsw-specific-input-major)}`)
  expect(phone).toContain(`${mode} > .hp-delegate-harness,${mode} > .hp-anchor{grid-column:1 / -1;min-width:0}`)
  expect(phone).toContain(`${mode} .hp-delegate-harness button{flex:1;justify-content:center;height:36px;`)
  expect(phone).toContain(`${mode} .hp-chip{width:100%;max-width:100%;height:36px;`)
  expect(phone).toContain(`${mode} .hp-delegate-report{min-width:0;margin-left:0;min-height:44px;padding:0 8px;gap:8px;line-height:18px;font-size:12px;white-space:normal;overflow-wrap:anywhere}`)
  expect(phone).toContain('border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-specific-input-major);')
})

it('keeps mode controls scrollable and model menus inside the visible keyboard viewport', () => {
  const dispose = applyDrawerSelection()
  const phone = sheet()?.textContent ?? ''
  dispose()
  const mode = '.hp-delegate[data-hp-mode]'
  expect(phone).toContain('max-height:min(280px,calc(var(--dsh-remote-keyboard-height,100dvh) * .45));overflow-y:auto;overscroll-behavior-y:contain')
  // A fixed menu escapes the mode bar's scroll clip, even after scrolling to the last option.
  expect(phone).toContain(`${mode} .hp-menu{position:fixed;left:16px;right:16px;`)
  expect(phone).toContain('bottom:var(--dsh-remote-mode-menu-bottom,50px);')
  expect(phone).toContain('background:var(--dsw-alias-bg-layer-2);opacity:1;backdrop-filter:none;-webkit-backdrop-filter:none;')
  expect(phone).toContain('width:auto;min-width:0;max-width:none;max-height:var(--dsh-remote-mode-menu-height,360px) !important}')
  expect(phone).toContain(`${mode} .hp-menu > *{flex-shrink:0}`)
  expect(phone).toContain(`${mode} .hp-menu :is(.hp-option,.hp-cell){min-height:44px}`)
  expect(phone).toContain(`${mode} .hp-option-hint,${mode} .hp-error{overflow-wrap:anywhere}`)
})

it('positions a newly opened task menu above its button and cleans up tracking', async () => {
  const viewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
    offsetTop: 20, addEventListener() {}, removeEventListener() {},
  } })
  const root = document.createElement('div')
  root.className = 'hp-delegate'
  root.dataset.hpMode = 'delegate'
  document.body.append(root)
  const dispose = applyDrawerSelection()
  const menu = document.createElement('div')
  menu.className = 'hp-menu'
  const button = document.createElement('button')
  button.className = 'hp-chip'
  let top = 420
  Object.defineProperty(button, 'getBoundingClientRect', { value: () => ({ top }) })
  const anchor = document.createElement('div')
  anchor.className = 'hp-anchor'
  anchor.append(button, menu)
  const settle = () => new Promise(resolve => setTimeout(resolve, 40))
  try {
    root.append(anchor)
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe(`${window.innerHeight - top + 8}px`)
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('360px')
    top = 300
    root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe(`${window.innerHeight - top + 8}px`)
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('264px')
    top = 260
    window.dispatchEvent(new Event('resize'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('224px')
    top = 10
    root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe(`${window.innerHeight - 80 + 8}px`)
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('44px')
    dispose()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe('')
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('')
    root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe('')
  } finally {
    dispose()
    root.remove()
    if (viewport) Object.defineProperty(window, 'visualViewport', viewport)
    else Reflect.deleteProperty(window, 'visualViewport')
  }
})
