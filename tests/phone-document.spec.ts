import { expect, it } from 'vitest'
import { keyboardViewport, phoneDocument, VIEWPORT_META } from '../dist/phone-document.js'

it('adds the keyboard-aware viewport meta to a document that ships none', () => {
  const out = phoneDocument('<html><head></head><body></body></html>')
  expect(out).toContain(VIEWPORT_META)
  expect(out.indexOf(VIEWPORT_META)).toBeGreaterThan(out.indexOf('<head>'))
  expect(out).toContain('data-dsh-remote-control')
})

it('opens the drawer full screen at phone width and keeps the tablet drawer', () => {
  const out = phoneDocument('<html><head></head><body></body></html>')
  const drawer = out.slice(out.indexOf('<style data-dsh-remote-control-drawer>'))
  const open = '[class*="_frame"]:has([class*="_sidebarCol"]):not([data-sidebar-collapsed]) [class*="_sidebarCol"]'
  // Tablets keep the 320px drawer beside the dimmed page.
  expect(drawer).toContain(`${open}{position:fixed;top:0;bottom:0;left:0;width:min(84vw,320px)`)
  // A phone gets the whole screen, with nothing left for the scrim's shadow to dim.
  const phone = drawer.slice(drawer.indexOf('@media (max-width: 720px){'))
  expect(phone).not.toBe(drawer)
  expect(phone).toContain(`${open}{width:100vw;box-shadow:none}`)
  // The shell sizes the sidebar content inline at its track width; the full column overrides it,
  // and lifts Settings off the screen's bottom edge by the chat's own bottom clearance.
  expect(phone).toContain(`${open} [class*="_root"]:has(> [class*="_logoRow"]){width:100% !important;`
    + 'padding-bottom:max(32px,env(safe-area-inset-bottom)) !important}')
})

it('keeps the active phone composer at the bottom while the chat scrolls without a keyboard', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`}${chat}{padding-bottom:var(--dsh-composer-height,0px);overscroll-behavior-y:none;`)
  expect(out).toContain(`}${chat} > [data-composer-seat]{position:absolute !important;inset:auto 0 0}`)
})

// The shell lifts its sticky jump-to-latest control by the composer height; the chat's own bottom
// padding already reserves that height, so counting it again parked the control far above the input.
it('keeps the jump-to-latest control just above the pinned composer', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`}${chat} [class*="_toBottomSlot"]{bottom:8px !important}`)
})

it('clips the phone toolbar backgrounds to the composer’s rounded bottom corners', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('[data-composer-card] > [class*="_row"]{flex-wrap:nowrap !important;gap:4px !important;'
    + 'border-radius:0 0 var(--dsw-radius-panel) var(--dsw-radius-panel);overflow-x:auto;overflow-y:hidden')
})

it('spaces phone composer controls evenly across the host tool groups', () => {
  const out = phoneDocument('<head></head>')
  const row = '[data-composer-card] > [class*="_row"]:has(> [class*="_tools"]:not([hidden]))'
  expect(out).toContain(`${row} > [class*="_tools"] > [class*="_modes"],`
    + `${row} > [class*="_trailing"] > [class*="_standardControls"]{display:contents}`)
  expect(out).not.toContain(`${row} > [class*="_trailing"] > [class*="_standardControls"]{margin-left:auto}`)
})

it('keeps a boundary swipe in the chat instead of moving the whole phone page', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('html,body{overflow:hidden;overscroll-behavior-y:none}')
})

it('hides the phone chat scrollbar without reserving its gutter', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`${chat}{padding-bottom:var(--dsh-composer-height,0px);overscroll-behavior-y:none;scrollbar-width:none;scrollbar-gutter:auto}`)
  expect(out).toContain(`${chat}::-webkit-scrollbar{display:none}`)
})

it('hides the session header utilities on phones while leaving the corner control', () => {
  const phone = phoneDocument('<head></head>')
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  expect(phone).toContain(`${frame} header[data-window-drag] [class*="_headerUtilities"]{display:none !important}`)
  expect(phone).not.toContain('[data-conversation-header-corner]{display:none')
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
