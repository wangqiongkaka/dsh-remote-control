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
  // Only the button itself: its label, mask and shortcut spans share the class prefix.
  expect(phone).toContain('button[class*="_newSession"]{height:44px !important}')
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
