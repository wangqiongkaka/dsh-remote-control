/** Sidebar-footer action and one-use QR dialog for public HTTPS pairing. */

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode/lib/browser.js'
import {
  Button, IconCheckOutlineRegular, IconCopyOutlineRegular, Input, Modal, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { proxiedFrame } from './SidebarToggle.tsx'

/** Host commands passed through the slot injection face. */
export interface RemoteControlInjected {
  /** A usable pairing link and phone access expiry (-1 unlimited, 0 unpaired). */
  start: (workspaceId?: string, refresh?: boolean) => Promise<{ url: string; expiresAt: number; pairedUntil: number }>
  stop: () => Promise<void>
  status: () => Promise<boolean>
}

/** Footer action props supplied by the slot renderer. */
export type RemoteControlActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS> & InjectFace<RemoteControlInjected>

/**
 * Body roles for the dialog. `Modal` owns the title, description, and footer
 * chrome; the body only has to stay on the same type scale (14/22 primary,
 * 13/20 secondary) and to zero every margin, since an unstyled paragraph falls
 * back to the browser's 1em margins and doubles the dialog's vertical rhythm.
 */
const styles: Record<string, CSSProperties> = {
  hint: {
    position: 'fixed', zIndex: 1100, transform: 'translateY(-100%)',
    boxSizing: 'border-box', width: 208, maxWidth: 'calc(100vw - 16px)', padding: '12px 16px',
    borderRadius: 'var(--dsw-radius-lg)', background: 'var(--dsw-alias-tooltip-bg)',
    boxShadow: 'var(--dsw-shadow-lv3)', color: 'var(--dsw-static-neutral-bluish-00)',
    pointerEvents: 'none', fontSize: 14, lineHeight: '22px',
  },
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

const ENTRY_STYLE = ''
  + '.rc-pair-entry{display:flex;flex:none;align-items:center;justify-content:center;width:36px;height:36px;'
  + 'padding:0;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:#f2994a;cursor:pointer}'
  + '.rc-pair-entry:hover,.rc-pair-entry[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}'
  + '.rc-pair-entry:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}'
  + '[class*="_footArea"]:has(.rc-pair-entry[data-wide="true"]){position:relative}'
  + '.rc-pair-entry[data-wide="true"]{position:absolute;right:40px;bottom:8px;z-index:1}'
  + '[class*="_footArea"]:has(.rc-pair-entry[data-wide="true"]) [class*="_triggerRow"] > :first-child{margin-right:44px}'

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

/** Show pairing at the sidebar foot, including when no Session is open. */
export function RemoteControlAction(props: RemoteControlActionProps): React.JSX.Element | null {
  const { t, wide } = props
  const remote = proxiedFrame()
  const trigger = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [connection, setConnection] = useState<'waiting' | 'connected' | 'statusLoading' | 'statusUnavailable'>('statusLoading')
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const forceRefresh = useRef(false)
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [url, setUrl] = useState<string>()
  const [pairedUntil, setPairedUntil] = useState<number>()
  const [qr, setQr] = useState<string>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const preview = !remote && !open && (hovered || focused)

  useEffect(() => {
    if (!preview) return
    const place = (): void => {
      const rect = trigger.current?.getBoundingClientRect()
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)), top: rect.top - 8 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [preview])

  useEffect(() => {
    if (!preview) return
    let alive = true
    let pending = false
    const refresh = async (): Promise<void> => {
      if (pending) return
      pending = true
      try {
        const paired = await props.status()
        if (alive) setConnection(paired ? 'connected' : 'waiting')
      } catch {
        if (alive) setConnection('statusUnavailable')
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 2_000)
    return () => { alive = false; clearInterval(timer) }
  }, [preview, props.status])

  useEffect(() => {
    if (!open || stopping || error !== undefined) return
    let alive = true
    let pending = false
    // The server reuses a valid invitation, renewing only when spent or expired. Polling never
    // changes the paired browser's access, and stops before a stop command can close the tunnel.
    const refresh = async (initial = false): Promise<void> => {
      if (pending) return
      pending = true
      if (initial) setBusy(true)
      try {
        const force = initial && forceRefresh.current
        if (initial) forceRefresh.current = false
        const result = await (force ? props.start(undefined, true) : props.start())
        if (!alive) return
        setUrl(result.url)
        setPairedUntil(result.pairedUntil === 0 ? undefined : result.pairedUntil)
      } catch (reason: unknown) {
        if (alive && initial) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        pending = false
        if (alive && initial) setBusy(false)
      }
    }
    void refresh(true)
    const timer = setInterval(() => { void refresh() }, 2_000)
    return () => { alive = false; clearInterval(timer) }
  }, [open, stopping, error, props.start, refreshKey])

  useEffect(() => {
    setQr(undefined)
    setCopied(false)
    if (url === undefined) return
    let alive = true
    void QRCode.toString(url, { type: 'svg', width: 240, margin: 2 }).then(
      (svg) => { if (alive) setQr(`data:image/svg+xml,${encodeURIComponent(svg)}`) },
      () => { if (alive) setQr(undefined) },
    )
    return () => { alive = false }
  }, [url])

  if (remote) return null
  return <>
    <style>{ENTRY_STYLE}</style>
    <button ref={trigger} className="rc-pair-entry" data-wide={wide} type="button" aria-label={t('title')}
      aria-haspopup="dialog" aria-expanded={open} aria-describedby={preview ? hintId : undefined}
      onMouseEnter={() => { setHovered(true) }} onMouseLeave={() => { setHovered(false) }}
      onFocus={() => { setFocused(true) }} onBlur={() => { setFocused(false) }}
      onKeyDown={event => { if (event.key === 'Escape') { setHovered(false); setFocused(false) } }}
      onClick={() => {
        // Re-ask on every open: the link may be spent or expired, or this Workspace may have changed.
        setUrl(undefined)
        setQr(undefined)
        setPairedUntil(undefined)
        setError(undefined)
        setCopied(false)
        forceRefresh.current = false
        setOpen(true)
      }}>
      <svg data-remote-control-phone width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="4.5" y="1.5" width="11" height="17" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8.5 16h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
    {preview && createPortal(<div id={hintId} role="tooltip" style={{ ...styles.hint, ...position }}>
      <div style={{ fontWeight: 600 }}>{t('title')}</div>
      <div style={{ marginTop: 6, opacity: .7 }}>{t(connection)}</div>
    </div>, document.body)}
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('title')} closeLabel={t('close')}
      description={pairedUntil === undefined ? t('description') : t('paired')}
      footer={(url !== undefined || pairedUntil !== undefined) && <Button variant="outline" disabled={busy || stopping}
        onClick={() => {
          setStopping(true)
          void props.stop().then(() => {
            setUrl(undefined); setPairedUntil(undefined); setQr(undefined); setOpen(false)
          }, (reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).finally(() => { setStopping(false) })
        }}>{t('stop')}</Button>}>
      <div style={styles.column}>
        {busy && url === undefined && pairedUntil === undefined && <div role="status" style={styles.status}>
          <StateDot state="ongoing" />
          <span style={styles.secondary}>{t('loading')}</span>
        </div>}
        {pairedUntil !== undefined && <div role="status" style={styles.column}>
          <div style={styles.meta}>
            <span style={styles.metaLabel}>{t('pairedUntil')}</span>
            <span style={styles.metaValue}>{pairedUntil === -1 ? t('pairedForever') : formatUntil(pairedUntil)}</span>
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
          <Button variant="outline" aria-label={t('refresh')} disabled={busy || stopping}
            onClick={() => {
              forceRefresh.current = true
              setError(undefined)
              setBusy(true)
              setRefreshKey(value => value + 1)
            }}>{t(busy ? 'refreshing' : 'refresh')}</Button>
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
      </div>
    </Modal>
  </>
}
