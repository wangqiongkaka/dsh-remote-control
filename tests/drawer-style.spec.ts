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
it('keeps every row at its resting shape on a touch device', () => {
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

it('removes the sheet it injected', () => {
  const dispose = applyDrawerSelection()
  expect(sheet()).not.toBeNull()
  dispose()
  expect(sheet()).toBeNull()
})
