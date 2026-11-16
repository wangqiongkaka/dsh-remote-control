import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'

/**
 * The proxy rewrites every HTML document it forwards — the Hindsight console arrives as its own
 * same-origin document inside an iframe. Shell-wide rules therefore have to name the shell, or a
 * locked `body` takes away the embedded app's own scrolling.
 */
it('keeps the shell scroll lock and surface off embedded documents', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('html:has([class*="_sidebarCol"]) body{overflow:hidden;overscroll-behavior-y:none}')
  expect(out).toContain('html:has([class*="_sidebarCol"]) body{--dsw-alias-bg-base:var(--dsw-specific-sidebar-fill) !important')
  expect(out).not.toContain('html,body{overflow:hidden')
})
