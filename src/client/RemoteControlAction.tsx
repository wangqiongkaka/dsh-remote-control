/** Session-header action and one-use QR dialog for public HTTPS pairing. */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode/lib/browser.js'
import { Button, IconLinkOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { NS } from './locales.ts'

/** Host commands passed through the slot injection face. */
export interface RemoteControlInjected {
  start: (workspaceId: string) => Promise<string>
  stop: () => Promise<void>
}

/** Header action props supplied by the slot renderer. */
export type RemoteControlActionProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS> & InjectFace<RemoteControlInjected>

/** Show a link and QR code for the Session's owning Workspace. */
export function RemoteControlAction(props: RemoteControlActionProps): React.JSX.Element | null {
  const { sessionId, useWorkspaces, t } = props
  const workspaceId = useWorkspaces(state => state.items.find(item => item.sessionIds.includes(sessionId))?.workspaceId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string>()
  const [qr, setQr] = useState<string>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || workspaceId === undefined || url !== undefined || busy || error !== undefined) return
    setBusy(true)
    void props.start(workspaceId).then(setUrl, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }, [open, workspaceId, url, busy, error, props.start])

  useEffect(() => {
    if (url === undefined) { setQr(undefined); return }
    let alive = true
    void QRCode.toString(url, { type: 'svg', width: 240, margin: 2 }).then(
      (svg) => { if (alive) setQr(`data:image/svg+xml,${encodeURIComponent(svg)}`) },
      () => { if (alive) setQr(undefined) },
    )
    return () => { alive = false }
  }, [url])

  if (workspaceId === undefined) return null
  return <>
    <button type="button" aria-label={t('title')}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28,
        height: 28, border: 0, borderRadius: 28, background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }}
      title={t('title')} onClick={() => { setOpen(true) }}>
      <IconLinkOutlineRegular size={16} />
    </button>
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('title')} closeLabel={t('close')}
      description={t('description')}
      footer={url !== undefined && <Button variant="outline" disabled={busy}
        onClick={() => {
          setBusy(true)
          void props.stop().then(() => { setUrl(undefined); setQr(undefined); setOpen(false) }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).finally(() => { setBusy(false) })
        }}>{t('stop')}</Button>}>
      {busy && url === undefined && <p role="status">{t('loading')}</p>}
      {error !== undefined && <div role="alert" style={{ color: 'var(--dsw-alias-state-danger-primary)' }}>
        <p>{t('error')}: {error}</p>
        <Button variant="outline" onClick={() => { setError(undefined) }}>{t('retry')}</Button>
      </div>}
      {url !== undefined && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {qr === undefined ? <p>{t('qrUnavailable')}</p> : <img src={qr} alt={t('title')} width={240} height={240} />}
        <p style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 12, textAlign: 'center' }}>{t('oneUse')}</p>
        <div style={{ display: 'flex', width: '100%', gap: 8 }}>
          <input readOnly aria-label={t('copy')} value={url} onFocus={(event) => { event.currentTarget.select() }} />
          <Button variant="outline" onClick={() => {
            void navigator.clipboard.writeText(url).then(() => { setCopied(true) }, (reason: unknown) => {
              setError(reason instanceof Error ? reason.message : String(reason))
            })
          }}>{t(copied ? 'copied' : 'copy')}</Button>
        </div>
      </div>}
    </Modal>
  </>
}
