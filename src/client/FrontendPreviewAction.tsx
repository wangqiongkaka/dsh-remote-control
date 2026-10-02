/** Paired-phone entry for a loopback frontend, opened in a real mobile browser tab. */
import { useState } from 'react'
import { Button, IconGlobeOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { proxiedFrame } from './SidebarToggle.tsx'
import { NS } from './locales.ts'

export interface FrontendPreviewInjected {
  preview: (port: number) => Promise<string>
}

type Props = PropsLocale<typeof NS> & InjectFace<FrontendPreviewInjected>

export function FrontendPreviewAction({ t, preview }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  if (!proxiedFrame()) return null
  const value = Number(port)
  const valid = /^\d+$/u.test(port) && Number.isInteger(value) && value > 0 && value <= 65535
  return <>
    <Button data-frontend-preview-action size="sm" aria-label={t('preview.title')} title={t('preview.title')}
      style={{ flex: 'none', width: 28, padding: 0, color: 'var(--dsw-alias-label-secondary)' }}
      onClick={() => { setOpen(true); setError(undefined); setUrl(undefined) }}>
      <IconGlobeOutlineRegular size={16} />
    </Button>
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('preview.title')} closeLabel={t('close')}
      description={t('preview.description')}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={event => {
        event.preventDefault()
        if (!valid || busy) return
        setBusy(true); setError(undefined); setUrl(undefined)
        void preview(value).then(setUrl, (reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason))
        }).finally(() => { setBusy(false) })
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {t('preview.port')}
          <Input data-modal-autofocus type="text" inputMode="numeric" pattern="[0-9]+" required
            aria-label={t('preview.port')} placeholder="5173" value={port} disabled={busy}
            onChange={event => { setPort(event.target.value); setUrl(undefined); setError(undefined) }} />
        </label>
        {error !== undefined && <p role="alert" style={{ margin: 0, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</p>}
        <Button type="submit" variant="outline" disabled={!valid || busy}>
          {t(busy ? 'preview.loading' : 'preview.create')}
        </Button>
        {url !== undefined && <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 36,
            borderRadius: 'var(--dsw-radius-md)', textDecoration: 'none', fontSize: 14,
            color: 'var(--dsw-alias-label-primary-foreground)', background: 'var(--dsw-alias-button-primary-fill)' }}>
          {t('preview.open')}
        </a>}
      </form>
    </Modal>
  </>
}
