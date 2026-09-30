/**
 * Click-away dismissal for the proxy's narrow drawer sidebar. A tap on a
 * navigation pick inside the drawer (session row, search result, New Session, panel page)
 * and a tap on the blank scrim beside it fold the drawer to reveal the selected
 * page. The proxy's patch layer owns the scrim's look (it dims the page and
 * fades with the drawer's slide, taking taps only while the drawer column is
 * expanded) and keeps that column above the scrim, so the column keeps its
 * own taps.
 */

import { useEffect, useRef } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { proxiedFrame, useNarrow, type SidebarToggleInjected } from './SidebarToggle.tsx'

/** Marks this plugin's own drawer rows that open a Session (the Agent board's). */
export const DRAWER_PICK_ATTRIBUTE = 'data-remote-control-pick'

/** Drawer picks that navigate away from the current page. */
const NAVIGATION_PICK = '[data-row-key^="session:"], [class*="_searchResultRow"], [class*="_newSession"], '
  + `[class*="_panelList"] button[class*="_panelRow"], [${DRAWER_PICK_ATTRIBUTE}]`

/**
 * A Workspace row's New Session button. It sits in the row's action strip beside the Workspace
 * menu and carries no mark of its own, so it is known by its label in the host's two dictionaries
 * (ui-workspace `actions.newSession.aria`).
 */
const WORKSPACE_NEW_SESSION = '[class*="_projectRow"] [class*="_rowActions"] '
  + 'button:is([aria-label^="在“"][aria-label$="”中新建会话"], [aria-label^="New session in "])'

/** Whether the drawer sidebar is expanded at the frame containing the element. */
export function drawerOpen(from: Element): boolean {
  const frame = from.closest('[class*="_frame"]')
  return frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
}

/**
 * Whether a document click landed on a navigation pick inside the expanded
 * drawer: the pick must sit in the sidebar column, outside the trailing
 * action strip (menus, pin, fork keep their taps to themselves) except for a
 * Workspace row's New Session, and the drawer must still be open at its frame.
 */
export function drawerNavigationPick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const create = target.closest(WORKSPACE_NEW_SESSION)
  if (create === null && target.closest('[class*="_rowActions"]') !== null) return false
  const pick = create ?? target.closest(NAVIGATION_PICK)
  return pick !== null && pick.closest('[class*="_sidebarCol"]') !== null && drawerOpen(pick)
}

/** Scrim props: the injected sidebar toggle supplied by the slot renderer. */
export type SidebarDismissProps = InjectFace<SidebarToggleInjected>

/**
 * Render the drawer's dismissal layer: a transparent scrim (the proxy's patch
 * layer dims the page and gates the scrim's visibility) plus a capture-phase
 * document listener for taps on the drawer's own navigation picks.
 * @returns the scrim, or null off a proxied narrow frame.
 */
export function SidebarDismiss(props: SidebarDismissProps): React.JSX.Element | null {
  const active = useNarrow() && proxiedFrame()
  const toggle = useRef(props.toggleSidebar)
  toggle.current = props.toggleSidebar
  useEffect(() => {
    if (!active) return
    // The pick's own handler navigates on this same tap, and it runs after this capture listener.
    // Folding the drawer from here would start the sidebar's collapse — and the unmount of the very
    // row the tap is still travelling to — before that handler ran, which cost the tap its session.
    // A macrotask lands the fold after the whole dispatch instead, still within the same touch.
    const onPick = (event: Event): void => {
      if (!drawerNavigationPick(event.target)) return
      setTimeout(() => { toggle.current() }, 0)
    }
    document.addEventListener('click', onPick, true)
    return () => { document.removeEventListener('click', onPick, true) }
  }, [active])
  if (!active) return null
  return (
    <div
      data-remote-control-scrim
      aria-hidden="true"
      onClick={(event) => {
        // The patch layer hides the scrim while the drawer is closed; re-checking
        // guards a race against the attribute that layer keys on.
        if (drawerOpen(event.currentTarget)) props.toggleSidebar()
      }}
    />
  )
}
