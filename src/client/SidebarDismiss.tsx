/**
 * Click-away dismissal for the proxy's narrow drawer sidebar. A tap on a
 * session pick inside the drawer (session row, search result, New Session)
 * and a tap on the blank scrim beside it both fold the drawer back and land
 * the phone on the Conversation. The proxy's patch layer owns the scrim's
 * visibility (`data-remote-control-scrim` is display-blocked only while the
 * drawer column is expanded) and keeps that column above the scrim, so the
 * column keeps its own taps.
 */

import { useEffect, useRef } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { proxiedFrame, useNarrow, type SidebarToggleInjected } from './SidebarToggle.tsx'

/** Drawer picks that navigate to a Session: session rows, search results, New Session. */
const SESSION_PICK = '[data-row-key^="session:"], [class*="_searchResultRow"], [class*="_newSession"]'

/** Whether the drawer sidebar is expanded at the frame containing the element. */
export function drawerOpen(from: Element): boolean {
  const frame = from.closest('[class*="_frame"]')
  return frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
}

/**
 * Whether a document click landed on a session pick inside the expanded
 * drawer: the pick must sit in the sidebar column, outside the trailing
 * action strip (menus, pin, fork keep their taps to themselves), and the
 * drawer must still be open at its frame.
 */
export function drawerSessionPick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[class*="_rowActions"]') !== null) return false
  const pick = target.closest(SESSION_PICK)
  return pick !== null && pick.closest('[class*="_sidebarCol"]') !== null && drawerOpen(pick)
}

/** Scrim props: the injected sidebar toggle supplied by the slot renderer. */
export type SidebarDismissProps = InjectFace<SidebarToggleInjected>

/**
 * Render the drawer's dismissal layer: a transparent scrim (the proxy's patch
 * layer dims the page and gates the scrim's visibility) plus a capture-phase
 * document listener for taps on the drawer's own session picks.
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
      if (!drawerSessionPick(event.target)) return
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
