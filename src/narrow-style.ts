/** The narrow-screen patch layer the proxy injects into every forwarded DSH document. */

/**
 * The shell frame. Message content carries `_frame` classes of its own — a forced height or column
 * template on one of those distorts the transcript — and the shell frame is the only one holding
 * the sidebar column, hidden or not.
 */
const FRAME = '[class*="_frame"]:has([class*="_sidebarCol"])'

/** The main chat scroller; other views own their composer overlay positioning. */
const CHAT_SCROLL = `${FRAME} [data-phase="active"] > [data-conversation-content] > [data-conversation-scroll]:not(:has([data-conversation-composer-overlay]))`

/** The DSH shell has no narrow-screen layout, so the proxy lends phones a small patch layer. */
export const NARROW_SCREEN_STYLE = '<style data-dsh-remote-control>'
  + '@media (max-width: 720px){'
  // iOS zooms the whole page when a focused field is under 16px.
  + 'input,textarea,select,[contenteditable="true"]{font-size:16px !important}'
  // The placeholder is not an editable element, so it keeps the 15px chat size beside a 16px
  // draft; match them so the hint reads at the size of the text that replaces it.
  + '[data-composer-card] [class*="_placeholder"]{font-size:16px !important}'
  // Column resize handles are pointer affordances a phone cannot use, and their strips sit on
  // content at the frame edges. Class modules ship as `<package hash>_handle`.
  + '[class*="_handle"]{display:none !important}'
  // One button row, and the LEFT group is what gives way: it scrolls inside its own box while the
  // trailing group (model + send) stays fixed, so the send control can never be scrolled out of
  // reach. The chips cap their labels below, which keeps the row on one line on a phone width.
  + '[data-composer-card] > [class*="_row"]{flex-wrap:nowrap !important;gap:4px !important}'
  + '[data-composer-card] > [class*="_row"] > [class*="_tools"]{flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}'
  + '[data-composer-card] > [class*="_row"] > [class*="_tools"]::-webkit-scrollbar{display:none}'
  + '[data-composer-card] > [class*="_row"] > [class*="_trailing"]{flex:none}'
  // Harness and quota chips carry the longest labels in the row; the ellipsis they already style
  // now engages on a phone instead of letting one chip take the whole line.
  + '[data-composer-card] > [class*="_row"] [class*="hp-chip"]{max-width:104px}'
  // The tools box is a scroll container, which clips in BOTH axes — and the harness chips' menus
  // and the quota panel pop absolutely-positioned ABOVE the row from inside it, so the clip would
  // hide them entirely. Lift the clip while one is open; it keeps its scroll while they are closed.
  + '[data-composer-card] > [class*="_row"] > [class*="_tools"]:has([class*="hp-menu"]),'
  + '[data-composer-card] > [class*="_row"] > [class*="_tools"]:has([class*="hp-panel"]){overflow:visible !important}'
  + '[data-composer-card] > [class*="_row"] [class*="_tools"],[data-composer-card] > [class*="_row"] [class*="_trailing"],[data-composer-card] > [class*="_row"] [class*="_modes"],[data-composer-card] > [class*="_row"] [class*="_standardControls"]{gap:4px !important}'
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
  + `${CHAT_SCROLL}{padding-bottom:var(--dsh-composer-height,0px)}`
  + `${CHAT_SCROLL} > [data-composer-seat]{position:absolute !important;inset:auto 0 0}`
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
  + '}</style>'
