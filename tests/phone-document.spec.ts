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
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  const open = `${frame}:not([data-sidebar-collapsed]) [class*="_sidebarCol"]`
  const column = `${frame}[data-rightbar-collapsed] [class*="_sidebarCol"],${open}`
  // Tablets keep the 320px drawer beside the dimmed page.
  expect(drawer).toContain(`${column}{position:fixed;top:0;bottom:0;left:0;width:min(84vw,320px);z-index:30}`)
  // A phone gets the whole screen.
  const phone = drawer.slice(drawer.indexOf('@media (max-width: 720px){'))
  expect(phone).not.toBe(drawer)
  expect(phone).toContain(`${column}{width:100vw;bottom:var(--dsh-remote-bottom-clearance)}`)
  // The shell sizes the sidebar content inline at its track width; the full column overrides it,
  // and lifts Settings off the screen's bottom edge by the chat's own bottom clearance.
  expect(phone).toContain(`${open} [class*="_root"]:has(> [class*="_logoRow"]){width:100% !important;`
    + 'padding-bottom:0 !important}')
})

// The shell auto-places its sidebar, conversation and right columns in order. The fixed drawer
// leaves that flow, which put the conversation into the zero-width first track: a black phone page.
it('keeps the phone conversation in its own grid track while the drawer is fixed', () => {
  const out = phoneDocument('<html><head></head><body></body></html>')
  const drawer = out.slice(out.indexOf('<style data-dsh-remote-control-drawer>'))
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  expect(drawer).toContain(`${frame} > [class*="_centerCol"]{grid-column:2;grid-row:1}`)
  expect(drawer).toContain(`${frame} > [data-rightbar-col]{grid-column:3;grid-row:1}`)
})

// The left drawer popped in and out while the right panel slid: it now slides on the right panel's
// own duration and curve, parks hidden off-screen once closed, and the scrim fades with it.
it('slides the phone drawer in and out like the right panel', () => {
  const out = phoneDocument('<html><head></head><body></body></html>')
  const drawer = out.slice(out.indexOf('<style data-dsh-remote-control-drawer>'))
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  const slide = 'transform var(--ds-transition-duration-slow,.3s) var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))'
  expect(drawer).toContain(`${frame}[data-rightbar-collapsed][data-sidebar-collapsed] [class*="_sidebarCol"]{transform:translateX(-100%);`
    + `visibility:hidden;transition:${slide},visibility 0s linear var(--ds-transition-duration-slow,.3s)}`)
  expect(drawer).toContain(`${frame}:not([data-sidebar-collapsed]) [class*="_sidebarCol"]{transform:none;visibility:visible;transition:${slide}}`)
  expect(drawer).toContain('[data-remote-control-scrim]{position:fixed;inset:0;z-index:25;background:rgb(0 0 0/.4);opacity:0;pointer-events:none;')
  expect(drawer).toContain(`${frame}:not([data-sidebar-collapsed]) [data-remote-control-scrim]{opacity:1;pointer-events:auto}`)
  expect(drawer).toContain('@media (prefers-reduced-motion: reduce){')
  expect(drawer).not.toContain('box-shadow:0 0 0 100vmax')
})

it('keeps the active phone composer at the bottom while the chat scrolls without a keyboard', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`}${chat}{overscroll-behavior-y:none;`)
  expect(out).toContain(`}${chat} > [data-composer-seat]{position:absolute !important;inset:auto 0 0}`)
  // The composer's room is a trailing spacer, not the scroller's bottom padding: WebKit leaves that
  // padding out of the scroll range while the transcript still fits the scroller, so a short chat
  // taller than the room above the composer could not scroll its last lines out from under it.
  expect(out).toContain(`}${chat}::after{content:"";flex:none;height:var(--dsh-composer-height,0px)}`)
  expect(out).not.toContain('padding-bottom:var(--dsh-composer-height')
})

it('shares one safe-area clearance across the phone drawer, conversation and right panel', () => {
  const out = phoneDocument('<head></head>')
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  const composer = '[class*="_root"]:not([class*="_hero"]):has(> [data-composer-card]):has(> [class*="_dock"])'
  expect(out).toContain('html{--dsh-remote-bottom-clearance:max(8px,env(safe-area-inset-bottom,0px))}')
  // Grid content (chat and the right panel's positioning column) ends above this one inset.
  expect(out).toContain(`${frame}{box-sizing:border-box;padding-bottom:var(--dsh-remote-bottom-clearance) !important}`)
  expect(out).toContain('html[data-dsh-remote-keyboard]{--dsh-remote-bottom-clearance:4px}')
  // The fixed drawer uses the same inset; the composer adds no second safe area.
  expect(out).toContain(`${composer}{padding-bottom:0 !important}`)
  expect(out).not.toContain(`[data-dsh-remote-keyboard] ${composer}{padding-bottom:`)
})

it('places the statistics dock above the phone input card without moving its controls', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('[data-composer-dock]{order:-1;padding-top:0 !important;padding-bottom:4px}')
  expect(out).toContain('[data-composer-dock]:empty{display:none}')
  // All existing dock entries (performance, usage and context) retain their own interactions.
  expect(out).not.toContain('[data-composer-card]{order:')
})

it('shares the phone page background with the theme-aware safe-area surface', () => {
  const out = phoneDocument('<head></head>')
  const phone = out.slice(out.indexOf('@media (max-width: 720px){'), out.indexOf('@media (max-width: 1023px){'))
  // The frame and browser theme-color already read the base surface; use the safe-area palette
  // there too, including when the host applies custom theme tokens inline on body.
  expect(phone).toContain('body{--dsw-alias-bg-base:var(--dsw-specific-sidebar-fill) !important;'
    + 'background:var(--dsw-alias-bg-base) !important}')
})

// The host's transcript sits 16px inside the composer's clearance: a phone's text lines up with the
// input card instead, and the turn rail that lived in that inset stays off the text's line ends.
it('widens the phone transcript to the input card and drops the turn rail', () => {
  const out = phoneDocument('<head></head>')
  const phone = out.slice(out.indexOf('@media (max-width: 720px){'))
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  expect(phone).toContain(`${frame} [class*="_scroll"]:has(> [class*="_column"][data-chat-flow]){padding-left:16px !important;padding-right:16px !important}`)
  expect(phone).toContain(`${frame} [class*="_slot"]:has(+ [class*="_root"] > [class*="_scroll"] > [data-chat-flow]){display:none !important}`)
})

// The shell's sticky jump-to-latest control rides the scroller's bottom edge, under the pinned
// composer; it clears the composer's measured height plus an 8px gap.
it('keeps the jump-to-latest control just above the pinned composer', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`}${chat} [class*="_toBottomSlot"]{bottom:calc(var(--dsh-composer-height,0px) + 8px) !important}`)
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

// The pinned attach button draws its circle from 8px in; the UA's right padding left behind would
// centre the + glyph 3px left of that circle.
it('centres the attach + glyph in its redrawn circle', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('[class*="_add"]{position:sticky;left:0;z-index:2;width:36px;padding:0 0 0 8px;')
  expect(out).toContain('inset:0 0 0 8px;border-radius:999px')
})

// The harness selector groups its chip with the quota chip 12px apart. The strip scrolls, so no
// chip is capped: a capped quota chip painted its ring over the model chip, and labels ellipsized.
it('keeps plugin chips on the row spacing and shows every label in full', () => {
  const out = phoneDocument('<head></head>')
  const row = '[data-composer-card] > [class*="_row"]'
  expect(out).toContain(`${row} [class*="hp-root"]{gap:4px !important}`)
  expect(out).toContain(`${row}:has(> [class*="_tools"]:not([hidden])) [class*="hp-chip"]{max-width:none}`)
  expect(out).not.toContain('max-width:104px')
})

// WebKit's rubber-band at the strip's edges would carry the sticky end buttons along with it.
it('keeps the pinned composer ends still at the strip edges', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:none;')
})

it('keeps a boundary swipe in the chat instead of moving the whole phone page', () => {
  const out = phoneDocument('<head></head>')
  expect(out).toContain('html,body{overflow:hidden;overscroll-behavior-y:none}')
})

it('hides the phone chat scrollbar without reserving its gutter', () => {
  const out = phoneDocument('<head></head>')
  const chat = '[class*="_frame"]:has([class*="_sidebarCol"]) [data-phase="active"] > '
    + '[data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))'
  expect(out).toContain(`${chat}{overscroll-behavior-y:none;scrollbar-width:none;scrollbar-gutter:auto}`)
  expect(out).toContain(`${chat}::-webkit-scrollbar{display:none}`)
})

it('hides the session header utilities on phones while leaving the corner control', () => {
  const phone = phoneDocument('<head></head>')
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  expect(phone).toContain(`${frame} header[data-window-drag] [class*="_headerUtilities"]{display:none !important}`)
  expect(phone).not.toContain('[data-conversation-header-corner]{display:none')
})

it('keeps Harness settings readable and aligns switches with their descriptions on phones', () => {
  const phone = phoneDocument('<head></head>').split('<style data-dsh-remote-control-drawer>')[0]
  const settings = '[data-shortcut-modal="settings"]'
  expect(phone).toContain(`${settings} .hp-set-title{font-size:16px;line-height:24px;`)
  expect(phone).toContain(`${settings} .hp-set-hint{font-size:14px;line-height:21px}`)
  expect(phone).toContain(`${settings} .hp-set-row:has(.hp-switch){flex-direction:row;align-items:center;`)
  expect(phone).toContain(`${settings} .hp-set-control .hp-delegate-harness{max-width:100%;overflow-x:auto;`)
  expect(phone).toContain(`${settings} .hp-set-control input.hp-set-number{width:88px !important;text-align:center !important}`)
})

it('keeps the phone session actions beside the right sidebar control', () => {
  const phone = phoneDocument('<head></head>')
  const frame = '[class*="_frame"]:has([class*="_sidebarCol"])'
  expect(phone).toContain(`${frame} header[data-window-drag] [class*="_headerActions"]{margin-left:auto}`)
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
