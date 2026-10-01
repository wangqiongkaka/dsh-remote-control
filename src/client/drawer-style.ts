/**
 * Phone-only drawer styling, injected by the client rather than the proxy.
 *
 * The shell paints the current session and the row under the pointer with one generic hover fill
 * (`--dsw-alias-interactive-bg-hover`), and a touch tap latches that hover — so in the drawer the
 * session you are in looks exactly like the row the finger last landed on. The theme ships a
 * sidebar navigation pair for precisely this: the settings nav paints hover with
 * `--dsw-specific-sidebar-nav-item-hover` and the open cell with `--dsw-specific-sidebar-nav-item-active`.
 *
 * The same latch also costs a tap. A row changes shape on hover — it grows its trailing action
 * strip, drops the timestamp, swaps the folder icon for a chevron — and WebKit reads a tap that
 * first produces such a change as the hover, so opening a session took two taps. On a touch device
 * session and search rows therefore keep their resting shape. Project actions must instead stay
 * visible because they contain the button that creates a session in that project.
 *
 * The drawer also groups the list into one outlined card per top-level Workspace, and at phone
 * width (where the proxy opens the drawer full screen) gives its rows touch-sized heights.
 *
 * It lives on the client because it only matters once someone interacts with the list, and the
 * client plugin reloads with the page while the proxy's patch layer is baked into the running host
 * process. The caller owns the phone gate (wide frames and plain local windows keep the shell's own
 * styling); this module only owns the sheet.
 */

/** Attribute on the injected sheet; the proxy's layers use their own attribute names. */
export const DRAWER_STYLE_ATTRIBUTE = 'data-dsh-remote-control-drawer-selection'

/** A top-level Workspace section of the sidebar tree; search results and the flat list have none. */
const CARD = '[class*="_sidebarCol"] [role="tree"] > [class*="_groupSection"]'

/** The expanded drawer's single scrollport; its header and footer stay sticky. */
export const DRAWER_SCROLL_ROOT = '[class*="_frame"]:has([class*="_sidebarCol"]):not([data-sidebar-collapsed]) '
  + '[class*="_sidebarCol"] [class*="_root"]:has(> [class*="_logoRow"])'

/**
 * The current session's fill, the resting row shape that keeps a tap a tap on a touch device,
 * the Workspace cards, and touch-sized rows at phone width.
 */
const DRAWER_SELECTION_STYLE = '[class*="_sessionRow"][aria-selected="true"]'
  + '{background:var(--dsw-specific-sidebar-nav-item-active) !important}'
  // The Agent card takes New Session's seat; a Workspace row's own New Session button stays.
  + '[class*="_sidebarCol"] button[class*="_newSession"]{display:none !important}'
  // One scrollport lets the Agent card leave room for projects instead of squeezing their list.
  + `${DRAWER_SCROLL_ROOT}{overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:none;scrollbar-width:thin;`
  + 'scrollbar-gutter:stable;padding-top:0 !important;padding-bottom:0 !important;'
  + '--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}'
  + `${DRAWER_SCROLL_ROOT} > *{flex-shrink:0}`
  + `${DRAWER_SCROLL_ROOT} > [class*="_logoRow"]{position:sticky;top:0;z-index:3;`
  + 'height:66px;padding-top:14px;background:var(--dsw-specific-sidebar-fill)}'
  + `${DRAWER_SCROLL_ROOT} > [class*="_footArea"]{position:sticky;bottom:0;z-index:3;margin-top:auto;`
  + 'padding:6px 0 max(32px,env(safe-area-inset-bottom));background:var(--dsw-specific-sidebar-fill)}'
  + `${DRAWER_SCROLL_ROOT} > [class*="_regionArea"]{flex:none;overflow:visible}`
  + `${DRAWER_SCROLL_ROOT} [class*="_regionArea"] :is([class*="_root"],[class*="_list"],[class*="_treeBody"])`
  + '{flex:none;overflow:visible;overflow-y:visible;scrollbar-gutter:auto}'
  + `${DRAWER_SCROLL_ROOT} [class*="_regionArea"] [class*="_fade"]{display:none}`
  + `${DRAWER_SCROLL_ROOT} .rc-agents-list{max-height:none;overflow:visible}`
  + '@media (hover: none){'
  // No latched fill behind the finger, on any row of the list.
  + '[class*="_sessionRow"]:hover:not([aria-selected="true"]),'
  + '[class*="_searchResultRow"]:hover:not([aria-selected="true"]),'
  + '[class*="_projectRow"]:hover{background:transparent !important}'
  // No latched layout on session/search rows. Project actions include New Session, so keep them visible.
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"],'
  + '[class*="_searchResultRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"]{display:none !important}'
  + '[class*="_projectRow"] [class*="_rowActions"]{display:inline-flex !important}'
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_time"]{display:revert !important}'
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_pinIndicator"]{display:inline-flex !important}'
  + '[class*="_projectRow"]:hover [class*="_chevron"]{display:none !important}'
  + '[class*="_projectRow"]:hover [class*="_folder"]{display:revert !important}'
  // A long press opens a Session row's menu (see followRowHolds): no text selection or callout on it.
  + '[class*="_sessionRow"]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}'
  // With the hover fill gone, the finger needs the answer while it is still down: the pressed fill
  // is what tells a thumb the tap landed, and it is the only feedback a phone row has left.
  + '[class*="_sessionRow"]:active,'
  + '[class*="_searchResultRow"]:active,'
  + '[class*="_projectRow"]:active{background:var(--dsw-alias-interactive-bg-active) !important}'
  + '}'
  // Each top-level Workspace section — its row, Session rows and overflow control — reads as one
  // outlined card. A child Workspace in tree grouping sits inside its parent's section, so it stays
  // an indented row of that card instead of a card within a card.
  + `${CARD}{padding:4px;border-radius:16px;box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}`
  + `${CARD} + [class*="_groupSection"]{margin-top:8px !important}`
  + `${CARD} > [class*="_projectRow"] [class*="_title"]{font-weight:600}`
  // At phone width the drawer is the whole screen: rows grow to thumb size, and so does the logo
  // row's collapse control, which is the drawer's only way back there.
  + '@media (max-width: 720px){'
  + '[class*="_projectRow"]{height:44px !important}'
  + '[class*="_sessionRow"]{height:40px !important}'
  + '[class*="_sessionOverflowButton"]{height:36px !important}'
  + '[class*="_logoRow"] button[class*="_toggle"]{width:40px !important;height:40px !important}'
  + '}'

/**
 * Append the drawer selection sheet to the document.
 * @returns a disposer that removes the sheet.
 */
export function applyDrawerSelection(): () => void {
  const style = document.createElement('style')
  style.setAttribute(DRAWER_STYLE_ATTRIBUTE, '')
  style.textContent = DRAWER_SELECTION_STYLE
  document.head.append(style)
  return () => { style.remove() }
}
