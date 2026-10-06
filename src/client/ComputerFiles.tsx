import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, IconPaperclipOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IConversation, InputActions, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerDirectory, ComputerFile } from '../remote-files.ts'
import { NS } from './locales.ts'
import { proxiedFrame } from './SidebarToggle.tsx'

interface Selection {
  path: string
  pick(file: ComputerFile): boolean
  close(): void
}

interface Picker {
  subscribe(listener: () => void): () => void
  getSnapshot(): Selection | null
}

/** The host input shell exposes the same provide-channel actions consumed by its composer. */
type ComposerInput = SessionInput & { readonly actions: InputActions }

export function registerComputerFiles(ctx: Context): void {
  ctx.inject(['commandUi', 'sessions', 'conversation'], (scope) => {
    let selection: Selection | null = null
    const listeners = new Set<() => void>()
    const update = (next: Selection | null): void => {
      selection = next
      for (const listener of listeners) listener()
    }
    const picker: Picker = {
      getSnapshot: () => selection,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'remote-control.files', locale: NS,
      inject: () => ({ picker }),
    }, ComputerFiles))
    const commands = scope.get('commandUi') as {
      register(contribution: { name: string; label(): string; icon: typeof IconPaperclipOutlineRegular;
        available(session: { sessionId: SessionId }): boolean;
        ui: { kind: 'action'; run(session: { sessionId: SessionId }): void } }): () => void
    }
    const sessions = scope.get('sessions') as unknown as {
      scope(id: SessionId): Context | undefined
      list: { getSnapshot(): { byId: Readonly<Record<string, { cwd: string; origin: string }>> } }
    }
    const conversation = scope.get('conversation') as IConversation
    scope.effect(() => commands.register({
      name: 'computer-file', label: () => scope.locale.bind(NS)('files.title'), icon: IconPaperclipOutlineRegular,
      available: ({ sessionId }) => proxiedFrame() && sessions.scope(sessionId) !== undefined
        && sessions.list.getSnapshot().byId[sessionId]?.origin !== 'subagent',
      ui: { kind: 'action', run: ({ sessionId }) => {
        const actx = sessions.scope(sessionId)
        if (actx === undefined) return
        const input = conversation.input.for(actx) as ComposerInput
        const span = input.actions.captureInsertion()
        const current: Selection = {
          path: sessions.list.getSnapshot().byId[sessionId]?.cwd ?? '',
          pick: file => sessions.scope(sessionId) === actx && file.mention !== null
            && input.insertReference({ source: 'reference', ref: file.mention, label: file.name,
              appearance: 'file', clipboardText: file.mention }, span),
          close: () => { update(null); if (sessions.scope(sessionId) === actx) input.focus() },
        }
        update(current)
      } },
    }), 'remote-control: computer files')
    scope.effect(() => () => { update(null) }, 'remote-control: close computer files')
  })
}

export function ComputerFiles({ picker, t }: PropsLocale<typeof NS> & InjectFace<{ picker: Picker }>): React.JSX.Element | null {
  const selection = useSyncExternalStore(picker.subscribe, picker.getSnapshot)
  return selection === null ? null : <FileBrowser key={selection.path} selection={selection} t={t} />
}

function FileBrowser({ selection, t }: { selection: Selection; t: PropsLocale<typeof NS>['t'] }): React.JSX.Element {
  const [path, setPath] = useState(selection.path)
  const [address, setAddress] = useState(selection.path)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [listing, setListing] = useState<ComputerDirectory>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true); setError(''); setListing(undefined)
    const params = new URLSearchParams({ offset: String(offset), query })
    if (path !== '') params.set('path', path)
    void fetch('/api/remote-control/files?' + params, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(await response.text())
        return await response.json() as ComputerDirectory
      }).then(value => {
        if (!controller.signal.aborted) { setListing(value); setAddress(value.path) }
      }, (reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort() }
  }, [path, query, offset, retry])
  const navigate = (target: string): void => { setPath(target); setAddress(target); setQuery(''); setOffset(0) }
  return <Modal open onClose={selection.close} title={t('files.title')} closeLabel={t('close')}
    description={t('files.description')}>
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <form onSubmit={event => { event.preventDefault(); navigate(address) }} style={{ display: 'flex', gap: 8 }}>
        <Input aria-label={t('files.path')} value={address} onChange={event => { setAddress(event.target.value) }} style={{ minWidth: 0, flex: 1 }} />
        <Button type="submit" variant="outline">{t('files.go')}</Button>
      </form>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="outline" disabled={busy || !listing || listing.parent === listing.path} onClick={() => { if (listing) navigate(listing.parent) }}>{t('files.up')}</Button>
        <Button variant="outline" disabled={busy || !listing} onClick={() => { if (listing) navigate(listing.home) }}>{t('files.home')}</Button>
        <Button variant="outline" onClick={() => { navigate(selection.path) }}>{t('files.workspace')}</Button>
      </div>
      <Input aria-label={t('files.search')} placeholder={t('files.search')} value={query}
        onChange={event => { setQuery(event.target.value); setOffset(0) }} />
      {busy && <div role="status">{t('files.loading')}</div>}
      {error && <div role="alert">{error} <Button variant="outline" onClick={() => { setRetry(retry + 1) }}>{t('retry')}</Button></div>}
      <div style={{ maxHeight: '45dvh', overflowY: 'auto', display: 'grid', gap: 4 }}>
        {listing?.entries.map(file => <Button key={file.path} variant="ghost" disabled={!file.directory && file.mention === null}
          title={file.mention === null ? t('files.unsupported') : file.path}
          style={{ display: 'block', width: '100%', minWidth: 0, height: 'auto', minHeight: 44,
            padding: '8px 12px', textAlign: 'left', overflowWrap: 'anywhere', whiteSpace: 'normal' }}
          onClick={() => {
            if (file.directory) navigate(file.path)
            else if (selection.pick(file)) selection.close()
            else setError(t('files.changed'))
          }}>{file.directory ? '▸ ' : ''}{file.name}{file.directory ? '/' : ''}</Button>)}
        {listing?.entries.length === 0 && <div role="status">{t('files.empty')}</div>}
      </div>
      {listing && (offset > 0 || listing.next !== null) && <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 200)) }}>{t('files.previous')}</Button>
        <Button variant="outline" disabled={listing.next === null} onClick={() => { if (listing.next !== null) setOffset(listing.next) }}>{t('files.next')}</Button>
      </div>}
    </div>
  </Modal>
}
