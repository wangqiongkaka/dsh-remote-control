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
 * every row therefore keeps its resting shape.
 *
 * It lives on the client because it only matters once someone interacts with the list, and the
 * client plugin reloads with the page while the proxy's patch layer is baked into the running host
 * process. The caller owns the phone gate (wide frames and plain local windows keep the shell's own
 * styling); this module only owns the sheet.
 */

/** Attribute on the injected sheet; the proxy's layers use their own attribute names. */
export const DRAWER_STYLE_ATTRIBUTE = 'data-dsh-remote-control-drawer-selection'

/** The current session's fill, and the resting row shape that keeps a tap a tap on a touch device. */
const DRAWER_SELECTION_STYLE = '[class*="_sessionRow"][aria-selected="true"]'
  + '{background:var(--dsw-specific-sidebar-nav-item-active) !important}'
  + '@media (hover: none){'
  // No latched fill behind the finger, on any row of the list.
  + '[class*="_sessionRow"]:hover:not([aria-selected="true"]),'
  + '[class*="_searchResultRow"]:hover:not([aria-selected="true"]),'
  + '[class*="_projectRow"]:hover{background:transparent !important}'
  // No latched layout either. An open row menu is the user's own state and keeps its shape.
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"],'
  + '[class*="_searchResultRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"],'
  + '[class*="_projectRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"]{display:none !important}'
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_time"]{display:revert !important}'
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_pinIndicator"]{display:inline-flex !important}'
  + '[class*="_projectRow"]:hover [class*="_chevron"]{display:none !important}'
  // Preserve the host's flex slot: worktree decorations paint a sized ::before inside it.
  + '[class*="_projectRow"]:hover [class*="_folder"]{display:inline-flex !important}'
  // With the hover fill gone, the finger needs the answer while it is still down: the pressed fill
  // is what tells a thumb the tap landed, and it is the only feedback a phone row has left.
  + '[class*="_sessionRow"]:active,'
  + '[class*="_searchResultRow"]:active,'
  + '[class*="_projectRow"]:active{background:var(--dsw-alias-interactive-bg-active) !important}'
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
