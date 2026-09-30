import { expect, it } from 'vitest'
import { keyboardViewport, phoneDocument, VIEWPORT_META } from '../dist/phone-document.js'

it('adds the keyboard-aware viewport meta to a document that ships none', () => {
  const out = phoneDocument('<html><head></head><body></body></html>')
  expect(out).toContain(VIEWPORT_META)
  expect(out.indexOf(VIEWPORT_META)).toBeGreaterThan(out.indexOf('<head>'))
  expect(out).toContain('data-dsh-remote-control')
})

it('keeps the active phone composer at the bottom while the chat scrolls without a keyboard', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`}${chat}{padding-bottom:var(--dsh-composer-height,0px)}`)
  expect(out).toContain(`}${chat} > [data-composer-seat]{position:absolute !important;inset:auto 0 0}`)
})

it('appends the resize hint to the viewport meta the app already declares', () => {
  const out = phoneDocument('<head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>')
  expect(out).toContain('content="width=device-width, initial-scale=1, interactive-widget=resizes-content"')
  // The app declared one, so no second meta is added.
  expect(out.match(/name="viewport"/gu)).toHaveLength(1)
})

it('leaves an explicit interactive-widget choice as the app made it', () => {
  const declared = '<head><meta name="viewport" content="width=device-width, interactive-widget=overlays-content"></head>'
  expect(keyboardViewport(declared)).toBe(declared)
})

it('leaves a viewport meta without a content attribute alone', () => {
  const odd = '<head><meta name="viewport"></head>'
  expect(keyboardViewport(odd)).toBe(odd)
})
