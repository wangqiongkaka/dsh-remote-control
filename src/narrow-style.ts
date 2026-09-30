/** The narrow-screen patch layer the proxy injects into every forwarded DSH document. */

/**
 * The shell frame. Message content carries `_frame` classes of its own — a forced height or column
 * template on one of those distorts the transcript — and the shell frame is the only one holding
 * the sidebar column, hidden or not.
 */
const FRAME = '[class*="_frame"]:has([class*="_sidebarCol"])'

/** The main chat scroller; other views own their composer overlay positioning. */
const CHAT_SCROLL = `${FRAME} [data-phase="active"] > [data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))`

/**
 * The composer's button row while it carries a live composer. A running voice activity replaces
 * both host groups (`hidden`) with an expanded panel that owns the row, and none of the strip
 * rules below may touch that state.
 */
const COMPOSER_ROW = '[data-composer-card] > [class*="_row"]:has(> [class*="_tools"]:not([hidden]))'

/** The DSH shell has no narrow-screen layout, so the proxy lends phones a small patch layer. */
export const NARROW_SCREEN_STYLE = '<style data-dsh-remote-control>'
  + '@media (max-width: 720px){'
  // Only the conversation scrollport moves. At its ends, stop a pull from panning the page and
  // carrying the composer and its context meter with the whole shell.
  + 'html,body{overflow:hidden;overscroll-behavior-y:none}'
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
  // the mode and harness chips a fraction of the row.
  + '[data-composer-card] > [class*="_row"]{flex-wrap:nowrap !important;gap:4px !important;'
  + 'border-radius:0 0 var(--dsw-radius-panel) var(--dsw-radius-panel);'
  + 'overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none}'
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
  + 'width:36px;padding-left:8px;border-radius:0;background:var(--dsw-specific-input-major)}'
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
  // Harness and quota chips carry the longest labels in the row; the ellipsis they already style
  // now engages on a phone instead of letting one chip take the whole line.
  + '[data-composer-card] > [class*="_row"] [class*="hp-chip"]{max-width:104px}'
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
  + '[data-composer-card] > [class*="_row"] [class*="_modes"],[data-composer-card] > [class*="_row"] [class*="_standardControls"]{gap:4px !important}'
  // Overlay cards clamp their height against the layout viewport, which stays taller than the
  // visible area while a phone's browser chrome is drawn over it: size them by the dynamic
  // viewport so the tail of a menu is not parked under the toolbar.
  + '[class*="hp-menu"]{max-height:min(360px,calc(100dvh - 180px)) !important}'
  + '[class*="hp-panel"]{max-height:calc(100dvh - 180px) !important;overflow-y:auto}'
  + '[class*="_portal"]{max-height:calc(100dvh - 24px) !important}'
  // Bottom clearance for the status dock, plus the phone's own safe area.
  + '[class*="_root"]:not([class*="_hero"]):has(> [data-composer-card]):has(> [class*="_dock"]){padding-bottom:max(32px,env(safe-area-inset-bottom)) !important}'
  // Pin the active chat composer to the non-scrolling body and reserve its measured height in
  // the transcript, so scrolling messages never moves the input card or hides the last message.
  // The room is a trailing spacer rather than the scroller's bottom padding: WebKit leaves that
  // padding out of the scroll range while the transcript still fits the scroller, so a short chat
  // (taller than the room above the composer, not yet than the scroller) kept its last lines under it.
  + `${CHAT_SCROLL}{overscroll-behavior-y:none;scrollbar-width:none;scrollbar-gutter:auto}`
  + `${CHAT_SCROLL}::-webkit-scrollbar{display:none}`
  + `${CHAT_SCROLL}::after{content:"";flex:none;height:var(--dsh-composer-height,0px)}`
  + `${CHAT_SCROLL} > [data-composer-seat]{position:absolute !important;inset:auto 0 0}`
  // The shell's sticky jump-to-latest control rides the scroller's bottom edge, which the pinned
  // composer covers: lift it by the composer's measured height plus an 8px gap.
  + `${CHAT_SCROLL} [class*="_toBottomSlot"]{bottom:calc(var(--dsh-composer-height,0px) + 8px) !important}`
  // Keyboard up (the client patch publishes the visual viewport height): the shell shrinks to it,
  // the clearance the phone's bottom edge needed now belongs to the keyboard, and every overlay
  // card is bounded by the space actually visible above it. The shift is the pan the browser
  // applied to reveal the focused field, which the shell follows to stay inside the visible band.
  + `[data-dsh-remote-keyboard] ${FRAME}{height:var(--dsh-remote-keyboard-height,100%) !important;margin-top:var(--dsh-remote-keyboard-shift,0px) !important}`
  + '[data-dsh-remote-keyboard] [class*="_root"]:not([class*="_hero"]):has(> [data-composer-card]):has(> [class*="_dock"]){padding-bottom:4px !important}'
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
  // The sheet's own scroll region keeps its content reachable under the phone's home indicator,
  // and the keyboard (visual-viewport height) bounds it the same way it bounds the shell.
  + '[data-shortcut-modal="settings"]{padding-bottom:env(safe-area-inset-bottom)}'
  + '[data-dsh-remote-keyboard] [data-shortcut-modal="settings"]{height:calc(var(--dsh-remote-keyboard-height,100dvh) - 16px) !important}'
  + '}</style>'
  // The shell keeps a 56px icon rail whenever it is not a desktop window (AppFrame's collapsedWidth),
  // which a phone cannot spare: the closed sidebar takes no track at all, and the header control in
  // `conversation.header.leading` opens it. The rule stays off frames that give the right panel a
  // track, where the shell's own three-track geometry still applies.
  + '<style data-dsh-remote-control-drawer>'
  + '@media (max-width: 1023px){'
  + `${FRAME}[data-rightbar-collapsed]{grid-template-columns:0 minmax(0,1fr) 0 !important}`
  + `${FRAME}:not([data-sidebar-collapsed]) [class*="_sidebarCol"]{position:fixed;top:0;bottom:0;`
  + 'left:0;width:min(84vw,320px);z-index:30;box-shadow:0 0 0 100vmax rgb(0 0 0/.4)}'
  // The dismissal scrim fills the frame beside the drawer column and only takes taps while the
  // drawer is expanded (the client's SidebarDismiss owns the element and its toggle).
  + '[data-remote-control-scrim]{position:fixed;inset:0;z-index:25;display:none}'
  + `${FRAME}:not([data-sidebar-collapsed]) [data-remote-control-scrim]{display:block}`
  + '}'
  // A phone has no room to keep beside the drawer: there the open sidebar takes the whole screen,
  // and the collapse control in the sidebar's own logo row is the way back. The shell sizes the
  // sidebar content inline at the column's track width, which the full column overrides.
  + '@media (max-width: 720px){'
  + `${FRAME}:not([data-sidebar-collapsed]) [class*="_sidebarCol"]{width:100vw;box-shadow:none}`
  // Its 6px foot would park Settings on the screen's bottom edge: take the chat's bottom clearance.
  + `${FRAME}:not([data-sidebar-collapsed]) [class*="_sidebarCol"] [class*="_root"]:has(> [class*="_logoRow"]){width:100% !important;`
  + 'padding-bottom:max(32px,env(safe-area-inset-bottom)) !important}'
  + '}</style>'
