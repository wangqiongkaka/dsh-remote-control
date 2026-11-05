import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { NS } from './locales.ts'

type Props = PropsRuntime<'sidebar.workspaces.session.menu.item'> & PropsLocale<typeof NS>

export function SessionNotifications({ sessionId, useMenuOpenState, t }: Props) {
  const [open, setOpen] = useMenuOpenState()
  const [muted, setMuted] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = '/api/remote-control/notifications?sessionId=' + encodeURIComponent(sessionId)
  const load = async (signal?: AbortSignal): Promise<boolean> => {
    const response = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) })
    if (!response.ok) throw new Error('Cannot read notification settings')
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !('muted' in body) || typeof body.muted !== 'boolean') throw new Error('Invalid notification settings')
    return body.muted
  }
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setMuted(undefined)
    setFailed(false)
    void load(controller.signal).then(value => {
      if (!controller.signal.aborted) setMuted(value)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort() }
  }, [sessionId, open])
  const select = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      if (muted === undefined) setMuted(await load())
      else {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ muted: !muted }) })
        if (!response.ok) throw new Error('Cannot save notification settings')
        setMuted(!muted)
        setOpen(false)
      }
    } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return <>
    <MenuItemButton icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      {muted === false && <path d="m3 3 18 18" />}
    </svg>} disabled={busy || (muted === undefined && !failed)} onSelect={() => { void select() }}>
      {t(busy ? 'notifications.saving' : muted === undefined ? failed ? 'notifications.retry' : 'notifications.loading'
        : muted ? 'notifications.enable' : 'notifications.disable')}
    </MenuItemButton>
    {failed && <div role="alert" style={{ padding: '4px 12px', maxWidth: 240, fontSize: 12, color: 'var(--color-text-error, #e66)' }}>{t('notifications.error')}</div>}
  </>
}

export function registerSessionNotifications(ctx: Context): void {
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item', id: 'remote-control.notifications', order: 350, locale: NS,
  }, SessionNotifications))
}
