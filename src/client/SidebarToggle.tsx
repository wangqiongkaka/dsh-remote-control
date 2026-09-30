/** Header-leading control that opens the sidebar where the shell keeps no rail to click. */

import { useEffect, useState } from 'react'
import { Button, IconPanelLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'

/** The frame width below which the shell collapses the sidebar and the proxy takes the rail away. */
export const NARROW = '(max-width: 1023px)'

/** Host commands passed through the slot injection face. */
export interface SidebarToggleInjected {
  toggleSidebar: () => void
}

/** Header-leading props supplied by the slot renderer. */
export type SidebarToggleProps = PropsLocale<typeof NS> & InjectFace<SidebarToggleInjected>

/** Track the narrow-frame state both the shell and the proxy's patch layer key on. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const update = (): void => { setNarrow(query.matches) }
    update()
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])
  return narrow
}

/** Whether this frame came through the remote proxy, whose patch layer the drawer keys on. */
export function proxiedFrame(): boolean {
  return document.querySelector('style[data-dsh-remote-control]') !== null
}

/**
 * Show the sidebar control only on a narrow frame that came through the remote proxy: there the
 * patch layer removed the rail, and this is the one way back to the panel. A local narrow window
 * keeps the shell's own rail and toggle.
 */
export function SidebarToggle(props: SidebarToggleProps): React.JSX.Element | null {
  const narrow = useNarrow()
  if (!narrow || !proxiedFrame()) return null
  const { t } = props
  return <Button size="sm" type="button" aria-label={t('sidebar')} title={t('sidebar')}
    style={{ flex: 'none', width: 28, padding: 0, color: 'var(--dsw-alias-label-secondary)' }}
    onClick={() => { props.toggleSidebar() }}>
    <IconPanelLeftOutlineRegular size={15} />
  </Button>
}
