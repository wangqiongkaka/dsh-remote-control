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
  /** A pairing link with its expiry, or when the already paired phone's access ends. */
  start: (workspaceId: string) => Promise<{ url: string; expiresAt: number } | { pairedUntil: number }>
  /** Whether a phone holds the tunnel right now, and until when. */
  status: () => Promise<{ paired: boolean; pairedUntil: number }>
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
  const [inviteUntil, setInviteUntil] = useState<number>()
  const [pairedUntil, setPairedUntil] = useState<number>()
  const [qr, setQr] = useState<string>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || workspaceId === undefined || url !== undefined || pairedUntil !== undefined
      || busy || error !== undefined) return
    setBusy(true)
    void props.start(workspaceId).then((result) => {
      if ('url' in result) { setUrl(result.url); setInviteUntil(result.expiresAt) }
      else setPairedUntil(result.pairedUntil)
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }, [open, workspaceId, url, pairedUntil, busy, error, props.start])

  // A displayed link is spent the moment a phone pairs, and it lapses after a few minutes: keep the
  // dialog on the live state instead of leaving a dead QR code in front of the user.
  useEffect(() => {
    if (!open || url === undefined || workspaceId === undefined) return
    const timer = setInterval(() => {
      void props.status().then((state) => {
        if (state.paired) {
          setPairedUntil(state.pairedUntil)
          setUrl(undefined)
          return
        }
        if (inviteUntil !== undefined && Date.now() >= inviteUntil) {
          void props.start(workspaceId).then((result) => {
            if ('url' in result) { setUrl(result.url); setInviteUntil(result.expiresAt) }
            else { setPairedUntil(result.pairedUntil); setUrl(undefined) }
          }, () => {})
        }
      }, () => {})
    }, 2_000)
    return () => { clearInterval(timer) }
  }, [open, url, inviteUntil, workspaceId, props.start, props.status])

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
      title={t('title')} onClick={() => {
        // Re-ask on every open: the link may be spent or expired, or this Workspace may have changed.
        setUrl(undefined)
        setInviteUntil(undefined)
        setPairedUntil(undefined)
        setError(undefined)
        setCopied(false)
        setOpen(true)
      }}>
      <IconLinkOutlineRegular size={16} />
    </button>
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('title')} closeLabel={t('close')}
      description={t('description')}
      footer={(url !== undefined || pairedUntil !== undefined) && <Button variant="outline" disabled={busy}
        onClick={() => {
          setBusy(true)
          void props.stop().then(() => {
            setUrl(undefined); setInviteUntil(undefined); setPairedUntil(undefined); setQr(undefined); setOpen(false)
          }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).finally(() => { setBusy(false) })
        }}>{t('stop')}</Button>}>
      {busy && url === undefined && pairedUntil === undefined && <p role="status">{t('loading')}</p>}
      {pairedUntil !== undefined && <div role="status">
        <p>{t('paired')}</p>
        <p style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
          {t('pairedUntil')} {new Date(pairedUntil).toLocaleString()}
        </p>
      </div>}
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
