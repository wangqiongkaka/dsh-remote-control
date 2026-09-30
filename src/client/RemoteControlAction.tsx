/** Session-header action and one-use QR dialog for public HTTPS pairing. */

import { useEffect, useState, type CSSProperties } from 'react'
import QRCode from 'qrcode/lib/browser.js'
import {
  Button, IconCheckOutlineRegular, IconCopyOutlineRegular, IconLinkOutlineRegular, Input, Modal, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * Body roles for the dialog. `Modal` owns the title, description, and footer
 * chrome; the body only has to stay on the same type scale (14/22 primary,
 * 13/20 secondary) and to zero every margin, since an unstyled paragraph falls
 * back to the browser's 1em margins and doubles the dialog's vertical rhythm.
 */
const styles: Record<string, CSSProperties> = {
  column: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  status: { display: 'flex', alignItems: 'center', gap: 8 },
  secondary: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
  centered: {
    margin: 0, fontSize: 13, lineHeight: '20px', textAlign: 'center',
    color: 'var(--dsw-alias-label-secondary)',
  },
  danger: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-state-error-primary)' },
  actions: { display: 'flex', gap: 8 },
  // The expiry is dialog metadata, not a second paragraph: one hairline row
  // keeps it apart from the state sentence above without another block of air.
  meta: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
    paddingTop: 12, borderTop: '0.5px solid var(--dsw-alias-border-l2)',
  },
  metaLabel: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
  metaValue: {
    fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)',
    fontVariantNumeric: 'tabular-nums',
  },
  qr: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minWidth: 0 },
  qrImage: { display: 'block' },
  // The link and its copy action are one control, not two boxes of different heights: the field
  // keeps the input atom's own 32px box and the action rides inside its trailing edge.
  linkField: { position: 'relative', display: 'grid', minWidth: 0, width: '100%' },
  linkValue: { paddingRight: 34, textOverflow: 'ellipsis' },
  linkCopy: {
    position: 'absolute', top: '50%', right: 2, transform: 'translateY(-50%)',
    width: 28, height: 28, padding: 0,
  },
}

/**
 * Render an expiry as the client's own numeric stamp. `toLocaleString` follows
 * the browser locale, which prints an English date inside a Chinese dialog.
 * @param at - expiry in epoch milliseconds.
 * @returns `YYYY-MM-DD HH:mm` in the viewer's local zone.
 */
function formatUntil(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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
      description={pairedUntil === undefined ? t('description') : t('paired')}
      footer={(url !== undefined || pairedUntil !== undefined) && <Button variant="outline" disabled={busy}
        onClick={() => {
          setBusy(true)
          void props.stop().then(() => {
            setUrl(undefined); setInviteUntil(undefined); setPairedUntil(undefined); setQr(undefined); setOpen(false)
          }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).finally(() => { setBusy(false) })
        }}>{t('stop')}</Button>}>
      {busy && url === undefined && pairedUntil === undefined && <div role="status" style={styles.status}>
        <StateDot state="ongoing" />
        <span style={styles.secondary}>{t('loading')}</span>
      </div>}
      {pairedUntil !== undefined && <div role="status" style={styles.column}>
        <div style={styles.meta}>
          <span style={styles.metaLabel}>{t('pairedUntil')}</span>
          <span style={styles.metaValue}>{formatUntil(pairedUntil)}</span>
        </div>
        <p style={styles.secondary}>{t('pairedAnother')}</p>
      </div>}
      {error !== undefined && <div role="alert" style={styles.column}>
        <p style={styles.danger}>{t('error')}: {error}</p>
        <div style={styles.actions}>
          <Button variant="outline" onClick={() => { setError(undefined) }}>{t('retry')}</Button>
        </div>
      </div>}
      {url !== undefined && <div style={styles.qr}>
        {qr === undefined
          ? <p style={styles.centered}>{t('qrUnavailable')}</p>
          : <img style={styles.qrImage} src={qr} alt={t('title')} width={240} height={240} />}
        <p style={styles.centered}>{t('oneUse')}</p>
        <div style={styles.linkField}>
          <Input readOnly aria-label={t('copy')} value={url} style={styles.linkValue}
            onFocus={(event) => { event.currentTarget.select() }} />
          <Button variant="ghost" size="sm" style={styles.linkCopy}
            aria-label={t(copied ? 'copied' : 'copy')} title={t(copied ? 'copied' : 'copy')}
            icon={copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => { setCopied(true) }, (reason: unknown) => {
                setError(reason instanceof Error ? reason.message : String(reason))
              })
            }} />
        </div>
      </div>}
    </Modal>
  </>
}
