/** The narrow-screen patch layer the proxy injects into every forwarded DSH document. */

/**
 * The shell frame. Message content carries `_frame` classes of its own — a forced height or column
 * template on one of those distorts the transcript — and the shell frame is the only one holding
 * the sidebar column, hidden or not.
 */
const FRAME = '[class*="_frame"]:has([class*="_sidebarCol"])'

/** The sidebar column as the phone drawer: always while it is open, and closed too while no right panel holds a track. */
const DRAWER = `${FRAME}[data-rightbar-collapsed] [class*="_sidebarCol"],${FRAME}:not([data-sidebar-collapsed]) [class*="_sidebarCol"]`

/** The shell's slow duration and in-out curve, which the right panel slides on. */
const SLOW = 'var(--ds-transition-duration-slow,.3s)'
const EASE = 'var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))'
const SLIDE = `transform ${SLOW} ${EASE}`

/** The main chat scroller; other views own their composer overlay positioning. */
const CHAT_SCROLL = `${FRAME} [data-phase="active"] > [data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))`

/**
 * The composer's button row while it carries a live composer. A running voice activity replaces
 * both host groups (`hidden`) with an expanded panel that owns the row, and none of the strip
 * rules below may touch that state.
 */
const COMPOSER_ROW = '[data-composer-card] > [class*="_row"]:has(> [class*="_tools"]:not([hidden]))'

const MODAL = 'body > [role="presentation"]:has(> [role="dialog"])'

/** Fresh proxy documents and client reloads share one safe visible band for every page. */
export const PHONE_SAFE_AREA_STYLE = 'html{--dsh-remote-bottom-clearance:max(8px,env(safe-area-inset-bottom,0px));'
  + '--dsh-remote-top-clearance:env(safe-area-inset-top,0px)}'
  + 'html[data-dsh-remote-keyboard]{--dsh-remote-bottom-clearance:4px}'
  + `${FRAME}{box-sizing:border-box;height:var(--dsh-remote-keyboard-height,100dvh) !important;`
  + 'padding-top:var(--dsh-remote-top-clearance) !important;padding-bottom:var(--dsh-remote-bottom-clearance) !important;'
  + 'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}'
  + `html[data-dsh-remote-keyboard] ${FRAME}{margin-top:var(--dsh-remote-keyboard-shift,0px) !important}`
  + `${FRAME} [data-sidebar-right-panel="fullscreen"]{width:calc(100vw - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)) !important}`
  + `${DRAWER},[data-remote-control-scrim]{box-sizing:border-box;top:calc(var(--dsh-remote-keyboard-shift,0px) + var(--dsh-remote-top-clearance)) !important;`
  + 'bottom:auto !important;height:calc(var(--dsh-remote-keyboard-height,100dvh) - var(--dsh-remote-top-clearance) - var(--dsh-remote-bottom-clearance)) !important;'
  + 'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}'
  + '[class*="_root"]:not([class*="_hero"]):has(> [data-composer-card]):has(> [class*="_dock"]){padding-bottom:0 !important}'
  + `${MODAL}{box-sizing:border-box;top:var(--dsh-remote-keyboard-shift,0px) !important;bottom:var(--dsh-remote-bottom-clearance) !important;`
  + 'height:calc(var(--dsh-remote-keyboard-height,100dvh) - var(--dsh-remote-bottom-clearance)) !important;'
  + 'padding-top:max(24px,var(--dsh-remote-top-clearance)) !important;'
  + 'padding-left:max(24px,env(safe-area-inset-left,0px));padding-right:max(24px,env(safe-area-inset-right,0px))}'
  + `${MODAL} > [role="dialog"]{max-height:100%}`
  + `${MODAL} > [role="dialog"] > [class*="_content"]{min-height:0;overflow-y:auto}`

/** The DSH shell has no narrow-screen layout, so the proxy lends phones a small patch layer. */
export const NARROW_SCREEN_STYLE = '<style data-dsh-remote-control>'
  + '@media (max-width: 720px){'
  // Only the conversation scrollport moves. At its ends, stop a pull from panning the page and
  // carrying the composer and its context meter with the whole shell.
  + 'html,body{overflow:hidden;overscroll-behavior-y:none}'
  // The page and browser theme-color share the safe-area surface in both palettes.
  + 'body{--dsw-alias-bg-base:var(--dsw-specific-sidebar-fill) !important;background:var(--dsw-alias-bg-base) !important}'
  // iOS zooms the whole page when a focused field is under 16px.
  + 'input,textarea,select,[contenteditable="true"]{font-size:16px !important}'
  // The session utilities are desktop actions; keep the separate sidebar corner control.
  + `${FRAME} header[data-window-drag] [class*="_headerUtilities"]{display:none !important}`
  // Keep session actions beside the sidebar corner control instead of leaving a wide empty gap.
  + `${FRAME} header[data-window-drag] [class*="_headerActions"]{margin-left:auto}`
  // The placeholder is not an editable element, so it keeps the 15px chat size beside a 16px
  // draft; match them so the hint reads at the size of the text that replaces it.
  + '[data-composer-card] [class*="_placeholder"]{font-size:16px !important}'
  // Column resize handles are pointer affordances a phone cannot use, and their strips sit on
  // content at the frame edges. Class modules ship as `<package hash>_handle`.
  + '[class*="_handle"]{display:none !important}'
  // One button row, and the whole row is the strip that gives way: the round controls at either
  // end (attach, microphone, send) hold still while every chip between them slides. Clip its
  // opaque pinned ends to the card's bottom corners instead of leaving square patches there. The host
  // splits those chips over two groups, so both dissolve into the row and their chips share the
  // one strip — kept as boxes, the model chip would sit fixed beside the send circle and leave
  // the mode and harness chips a fraction of the row. No overscroll either: WebKit's rubber-band
  // translates the whole strip, sticky ends included, so the pinned buttons would slide at its edges.
  + '[data-composer-card] > [class*="_row"]{flex-wrap:nowrap !important;gap:4px !important;'
  + 'border-radius:0 0 var(--dsw-radius-panel) var(--dsw-radius-panel);'
  + 'overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:none;scrollbar-width:none}'
  + '[data-composer-card] > [class*="_row"]::-webkit-scrollbar{display:none}'
  + `${COMPOSER_ROW} > [class*="_tools"],${COMPOSER_ROW} > [class*="_trailing"]{display:contents}`
  // The host spaces row items apart, but its nested mode and model groups keep their own 4px
  // gaps. Dissolve those boxes too so every visible control shares the row's spacing.
  + `${COMPOSER_ROW} > [class*="_tools"] > [class*="_modes"],`
  + `${COMPOSER_ROW} > [class*="_trailing"] > [class*="_standardControls"]{display:contents}`
  // A strip scrolls only while its items keep their own width. A chip squeezed below its own
  // content paints its glyphs outside its box, straight over the chip beside it, so nothing in the
  // row shrinks; the cap below is then what keeps one long label from taking the whole strip. The
  // host wraps every plugin seat in a `display: contents` slot element, so an item is a child of a
  // dissolved group or a child of one of those wrappers.
  + `${COMPOSER_ROW} > [class*="_tools"] > *:not([data-slot]),${COMPOSER_ROW} > [class*="_trailing"] > *:not([data-slot]),`
  + `${COMPOSER_ROW} [data-slot] > *{flex:none}`
  // The left end. The attach button is a 28px circle inside a 28px box, so a chip sliding under it
  // still shows in the four corners the circle leaves clear and in the row's own left pad. The row
  // hands its 8px pads to the two end controls instead: the attach button becomes a 36px box that
  // starts at the card's edge, filled square with the card's own colour, with the host's circle
  // redrawn inside it — a sticky box cannot sit outside its container, so the pad has to come from
  // the button. Handing the pads over also puts the strip's edges exactly under those controls,
  // which is what keeps a sliding glyph out of the pad a scroller would otherwise paint it in.
  + `${COMPOSER_ROW}{padding-left:0 !important;padding-right:0 !important}`
  + `${COMPOSER_ROW} > [class*="_tools"] > [class*="_add"]{position:sticky;left:0;z-index:2;`
  // The host leaves the button's UA side padding in place; zero it so the glyph centres in the circle.
  + 'width:36px;padding:0 0 0 8px;border-radius:0;background:var(--dsw-specific-input-major)}'
  + `${COMPOSER_ROW} > [class*="_tools"] > [class*="_add"]::before{content:"";position:absolute;z-index:-1;`
  + 'inset:0 0 0 8px;border-radius:999px;corner-shape:round;background:var(--dsw-specific-selector)}'
  + `${COMPOSER_ROW} > [class*="_tools"] > [class*="_add"]:hover:not(:disabled)::before{background:var(--dsw-alias-interactive-bg-hover-solid)}`
  // The right end: the microphone and the 34px send circle, each 4px apart, which is what places
  // the pinned tail. A turn in flight adds its own stop circle ahead of the send one.
  + `${COMPOSER_ROW} > [class*="_trailing"] > [class*="_primary"]{position:sticky;right:8px;z-index:2}`
  + `${COMPOSER_ROW} > [class*="_trailing"] > [class*="_primary"]:not(:last-child){right:46px}`
  + `${COMPOSER_ROW} > [class*="_trailing"] > [class*="_activity"]{position:sticky;right:46px;z-index:2}`
  + `${COMPOSER_ROW} > [class*="_trailing"] > [class*="_activity"]:has(~ [class*="_primary"] ~ [class*="_primary"]){right:84px}`
  // That end needs an opaque floor of its own: the send circle dims to `opacity:.4` whenever the
  // draft is empty and the microphone is a bare icon, so neither can hide a chip sliding under it.
  // This pseudo-item is that floor. It stops dead at the microphone's left edge, so the last chip
  // still reaches its own place when the strip is scrolled all the way, and it sits 4px short of
  // its own width in the flow, so it paints the tail without adding to the strip's length.
  + `${COMPOSER_ROW}::after{content:"";position:sticky;right:0;z-index:1;align-self:stretch;flex:none;`
  + 'width:74px;margin-left:-78px;background:var(--dsw-specific-input-major)}'
  // A turn in flight widens the tail by one 34px circle and its gap; the floor follows it.
  + `${COMPOSER_ROW}:has(> [class*="_trailing"] > [class*="_primary"] ~ [class*="_primary"])::after{`
  + 'width:112px;margin-left:-116px}'
  // The strip scrolls, so every chip shows its whole label: lift harness-provider's own 220px cap,
  // which would otherwise ellipsize a long harness or model name.
  + `${COMPOSER_ROW} [class*="hp-chip"]{max-width:none}`
  // The row is a scroll container, which clips in BOTH axes — and the harness chips' menus and the
  // quota panel pop absolutely-positioned ABOVE the row from inside it, so the clip would swallow
  // them whole. While one is open its anchor stops being the positioning context: the popup then
  // hangs off the card, which the row cannot clip (an absolutely positioned box whose containing
  // block is outside a scroller escapes that scroller's clip), 8px above the row — 50px above the
  // card's bottom, that being the row's own 42px, its 6px bottom pad and the 8px gap. Keeping the
  // row a scroll container also keeps the pinned ends and the strip's position while it is open.
  + `${COMPOSER_ROW}:has([class*="hp-menu"]) [class*="hp-anchor"],`
  + `${COMPOSER_ROW}:has([class*="hp-panel"]) [class*="hp-anchor"]{position:static}`
  + `${COMPOSER_ROW} [class*="hp-menu"],${COMPOSER_ROW} [class*="hp-panel"]{bottom:50px !important}`
  // A plugin seat that groups its own chips (the harness selector with its quota chip) spaces them
  // 12px apart; they share the row's 4px spacing too.
  + '[data-composer-card] > [class*="_row"] [class*="_modes"],[data-composer-card] > [class*="_row"] [class*="_standardControls"],'
  + '[data-composer-card] > [class*="_row"] [class*="hp-root"]{gap:4px !important}'
  // Overlay cards clamp their height against the layout viewport, which stays taller than the
  // visible area while a phone's browser chrome is drawn over it: size them by the dynamic
  // viewport so the tail of a menu is not parked under the toolbar.
  + '[class*="hp-menu"]{max-height:min(360px,calc(100dvh - 180px)) !important}'
  + '[class*="hp-panel"]{max-height:calc(100dvh - 180px) !important;overflow-y:auto}'
  + '[class*="_portal"]{max-height:calc(100dvh - 24px) !important}'
  // Pin the active chat composer to the non-scrolling body and reserve its measured height in
  // the transcript, so scrolling messages never moves the input card or hides the last message.
  // The room is a trailing spacer rather than the scroller's bottom padding: WebKit leaves that
  // padding out of the scroll range while the transcript still fits the scroller, so a short chat
  // (taller than the room above the composer, not yet than the scroller) kept its last lines under it.
  + `${CHAT_SCROLL}{overscroll-behavior-y:none;scrollbar-width:none;scrollbar-gutter:auto}`
  + `${CHAT_SCROLL}::-webkit-scrollbar{display:none}`
  + `${CHAT_SCROLL}::after{content:"";flex:none;height:var(--dsh-composer-height,0px)}`
  // The host insets the transcript 16px inside the composer's own 16px clearance, which leaves a
  // phone's text barely 84% of the screen: line it up with the input card instead. The turn rail
  // lives in that inset and would sit over the text's line ends, so a phone goes without it.
  + `${FRAME} [class*="_scroll"]:has(> [class*="_column"][data-chat-flow]){padding-left:16px !important;padding-right:16px !important}`
  + `${FRAME} [class*="_slot"]:has(+ [class*="_root"] > [class*="_scroll"] > [data-chat-flow]){display:none !important}`
  + `${CHAT_SCROLL} > [data-composer-seat]{position:absolute !important;inset:auto 0 0}`
  // The shell's sticky jump-to-latest control rides the scroller's bottom edge, which the pinned
  // composer covers: lift it by the composer's measured height plus an 8px gap.
  + `${CHAT_SCROLL} [class*="_toBottomSlot"]{bottom:calc(var(--dsh-composer-height,0px) + 8px) !important}`
  // A view that floats the composer over its own content (the trajectory ledger) is one a phone
  // only reads, and the card would cover a third of it: the seat goes, and the view's bottom
  // clearance follows the seat's measured height down to zero.
  + `${FRAME} [data-conversation-scroll]:has([data-conversation-composer-overlay]) > [data-composer-seat]{display:none !important}`
  // Keyboard up (the client patch publishes the visual viewport height): the shell shrinks to it,
  // the clearance the phone's bottom edge needed now belongs to the keyboard, and every overlay
  // card is bounded by the space actually visible above it. The shift is the pan the browser
  // applied to reveal the focused field, which the shell follows to stay inside the visible band.
  + '[data-dsh-remote-keyboard] [class*="hp-menu"],[data-dsh-remote-keyboard] [class*="hp-panel"],'
  + '[data-dsh-remote-keyboard] [class*="_portal"]{max-height:calc(var(--dsh-remote-keyboard-height,100dvh) - 140px) !important}'
  // Settings has a fixed desktop nav; stack it above the content on phones.
  + '[data-shortcut-modal="settings"]{flex-direction:column !important;width:calc(100vw - 24px) !important;max-width:none !important;height:calc(100dvh - 32px) !important}'
  + '[data-shortcut-modal="settings"] > nav{width:auto !important;padding:14px 16px 8px !important;gap:10px !important}'
  + '[data-shortcut-modal="settings"] [class*="_navTitle"]{padding:0 40px 0 0 !important}'
  + '[data-shortcut-modal="settings"] [class*="_navList"]{flex-direction:row !important;flex:none;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}'
  + '[data-shortcut-modal="settings"] [class*="_navList"]::-webkit-scrollbar{display:none}'
  + '[data-shortcut-modal="settings"] [class*="_navCell"]{flex:none;height:40px !important;padding:8px 10px !important}'
  + '[data-shortcut-modal="settings"] > [class*="_content"]{min-height:0}'
  + '[data-shortcut-modal="settings"] [class*="_header"]:has([class*="_close"]){position:absolute;top:12px;right:12px;height:28px !important;padding:0 !important;z-index:1}'
  + '[data-shortcut-modal="settings"] [class*="_options"]{padding:0 16px 20px !important}'
  + '[data-shortcut-modal="settings"] [class*="_themeCube"]{flex:1 1 0;min-width:0;padding:12px 4px}'
  + '[data-shortcut-modal="settings"] [class*="_rowText"]{padding-right:0 !important}'
  // Harness settings keep the shell's type scale on phones; toggles belong beside their copy,
  // while the multi-Harness selector can scroll rather than forcing the whole sheet wider.
  + '[data-shortcut-modal="settings"] .hp-set{gap:10px}'
  + '[data-shortcut-modal="settings"] .hp-set-page{font-size:20px;line-height:28px}'
  + '[data-shortcut-modal="settings"] .hp-set-intro{font-size:14px;line-height:21px}'
  + '[data-shortcut-modal="settings"] .hp-set-group{margin-top:12px}'
  + '[data-shortcut-modal="settings"] .hp-set-head{margin-bottom:4px;font-size:14px;line-height:20px;letter-spacing:0;color:var(--dsw-alias-label-secondary)}'
  + '[data-shortcut-modal="settings"] .hp-set-row{gap:12px;padding:16px 0}'
  + '[data-shortcut-modal="settings"] .hp-set-title{font-size:16px;line-height:24px;font-weight:500;flex-wrap:wrap}'
  + '[data-shortcut-modal="settings"] .hp-set-hint{font-size:14px;line-height:21px}'
  + '[data-shortcut-modal="settings"] .hp-set-row:has(.hp-switch){flex-direction:row;align-items:center;gap:16px}'
  + '[data-shortcut-modal="settings"] .hp-set-control input.hp-set-number{width:88px !important;text-align:center !important}'
  + '[data-shortcut-modal="settings"] .hp-set-control .hp-delegate-harness{max-width:100%;overflow-x:auto;scrollbar-width:none}'
  + '[data-shortcut-modal="settings"] .hp-set-control .hp-delegate-harness button{flex:none}'
  // The sheet's own scroll region keeps its content reachable under the phone's home indicator,
  // and the keyboard (visual-viewport height) bounds it the same way it bounds the shell.
  + '[data-shortcut-modal="settings"]{padding-bottom:env(safe-area-inset-bottom)}'
  + '[data-dsh-remote-keyboard] [data-shortcut-modal="settings"]{height:calc(var(--dsh-remote-keyboard-height,100dvh) - 16px) !important}'
  + '}'
  + '@media (max-width: 1023px){' + PHONE_SAFE_AREA_STYLE + '}</style>'
  // The shell keeps a 56px icon rail whenever it is not a desktop window (AppFrame's collapsedWidth),
  // which a phone cannot spare: the closed sidebar takes no track at all, and the header control in
  // `conversation.header.leading` opens it. The rule stays off frames that give the right panel a
  // track, where the shell's own three-track geometry still applies.
  + '<style data-dsh-remote-control-drawer>'
  + '@media (max-width: 1023px){'
  + `${FRAME}[data-rightbar-collapsed]{grid-template-columns:0 minmax(0,1fr) 0 !important}`
  // The shell auto-places its three columns in order. A fixed drawer leaves that flow, and the
  // conversation would then take the zero-width first track and vanish: pin both to their own.
  + `${FRAME} > [class*="_centerCol"]{grid-column:2;grid-row:1}`
  + `${FRAME} > [data-rightbar-col]{grid-column:3;grid-row:1}`
  // The drawer slides in from the left edge and back out on the right panel's own slide (the shell's
  // slow duration and in-out curve); closed, it parks off-screen and goes hidden once the slide ends,
  // so it takes no taps or tab stops. A frame whose right panel holds a track keeps the shell's own
  // geometry for a closed drawer.
  + `${DRAWER}{position:fixed;top:0;bottom:0;left:0;width:min(84vw,320px);z-index:30}`
  + `${FRAME}[data-rightbar-collapsed][data-sidebar-collapsed] [class*="_sidebarCol"]{transform:translateX(-100%);`
  + `visibility:hidden;transition:${SLIDE},visibility 0s linear ${SLOW}}`
  // The shell swaps the closing sidebar's content for its rail partway through: fade it out with
  // the shell's own 150ms content fade instead of showing rail icons in the sliding panel.
  + `${FRAME}[data-rightbar-collapsed][data-sidebar-collapsed] [class*="_sidebarCol"] > *{opacity:0;transition:opacity .15s}`
  + `${FRAME}:not([data-sidebar-collapsed]) [class*="_sidebarCol"]{transform:none;visibility:visible;transition:${SLIDE}}`
  // The dismissal scrim fills the frame beside the drawer and dims it, fading with the slide; it only
  // takes taps while the drawer is expanded (the client's SidebarDismiss owns the element and its toggle).
  + `[data-remote-control-scrim]{position:fixed;inset:0;z-index:25;background:rgb(0 0 0/.4);opacity:0;pointer-events:none;`
  + `transition:opacity ${SLOW} ${EASE}}`
  + `${FRAME}:not([data-sidebar-collapsed]) [data-remote-control-scrim]{opacity:1;pointer-events:auto}`
  + '@media (prefers-reduced-motion: reduce){'
  + `${FRAME} [class*="_sidebarCol"],${FRAME} [class*="_sidebarCol"] > *,[data-remote-control-scrim]{transition:none !important}`
  + '}'
  + '}'
  // A phone has no room to keep beside the drawer: there the open sidebar takes the whole screen,
  // and the collapse control in the sidebar's own logo row is the way back. The shell sizes the
  // sidebar content inline at the column's track width, which the full column overrides.
  + '@media (max-width: 720px){'
  + `${DRAWER}{width:100vw;bottom:var(--dsh-remote-bottom-clearance)}`
  // The drawer ends above the same page-edge inset, so its content needs no extra safe-area pad.
  + `${FRAME}:not([data-sidebar-collapsed]) [class*="_sidebarCol"] [class*="_root"]:has(> [class*="_logoRow"]){width:100% !important;`
  + 'padding-bottom:0 !important}'
  + '}</style>'
