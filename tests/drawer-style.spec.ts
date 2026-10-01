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
  expect(css).toContain('[class*="_folder"]{display:inline-flex !important}')
  // An open row menu is the user's own state and keeps its revealed actions.
  expect(css).toContain(':hover:not([class*="_menuOpen"])')
  // With the latched fill gone, the pressed fill is what answers the finger.
  expect(css).toContain('[class*="_sessionRow"]:active')
  expect(css).toContain('var(--dsw-alias-interactive-bg-active)')
  dispose()
})

it.each([false, true])('keeps the project icon flex layout after a touch (worktree: %s)', (worktree) => {
  const host = document.createElement('style')
  host.textContent = '.host_slot{display:inline-flex;width:16px;height:20px}'
    + '.host_projectRow[data-hover] .host_folder{display:none}'
    + '[data-git-worktree-folder] > svg{display:none}'
    + '[data-git-worktree-folder]::before{content:"";width:16px;height:16px;background:currentColor}'
  document.head.append(host)
  const row = document.createElement('div')
  row.className = 'host_projectRow'
  const folder = document.createElement('span')
  folder.className = 'host_slot host_folder host_folderActive'
  if (worktree) folder.setAttribute('data-git-worktree-folder', '')
  folder.innerHTML = '<svg width="16" height="16"></svg>'
  row.append(folder)
  document.body.append(row)
  const dispose = applyDrawerSelection()
  const touch = document.createElement('style')
  // jsdom cannot evaluate hover media queries or latch :hover. Activate the actual touch
  // rules through an equivalent attribute; keep their declarations unchanged.
  const media = Array.from(sheet()!.sheet!.cssRules).find(rule => rule instanceof CSSMediaRule)
  touch.textContent = Array.from(media!.cssRules)
    .map(rule => rule.cssText.replaceAll(':hover', '[data-hover]')).join('')
  document.head.append(touch)
  try {
    expect(getComputedStyle(folder).display).toBe('inline-flex')
    row.setAttribute('data-hover', '')
    // The worktree's sized ::before needs a flex parent to paint when its SVG is hidden.
    expect(getComputedStyle(folder).display).toBe('inline-flex')
    if (worktree) expect(getComputedStyle(folder.firstElementChild!).display).toBe('none')
  } finally {
    dispose()
    host.remove()
    touch.remove()
    row.remove()
  }
})

it('removes the sheet it injected', () => {
  const dispose = applyDrawerSelection()
  expect(sheet()).not.toBeNull()
  dispose()
  expect(sheet()).toBeNull()
})
