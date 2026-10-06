import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IConversation, InputActions, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ComputerDirectory, ComputerFile } from '../remote-files.ts'
import { NS } from './locales.ts'
import { proxiedFrame } from './SidebarToggle.tsx'

interface Selection {
  path: string
  available(): boolean
  local(): boolean
  pick(file: ComputerFile): boolean
  close(): void
}

interface Picker {
  subscribe(listener: () => void): () => void
  getSnapshot(): Selection | null
}

/** The host input shell exposes the same provide-channel actions consumed by its composer. */
type ComposerInput = SessionInput & { readonly actions: InputActions }

export function registerComputerDirectories(ctx: Context): void {
  if (!proxiedFrame()) return
  for (const name of ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow'] as const) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -10, locale: NS }, ComputerDirectoryFlow))
  }
}

export function ComputerDirectoryFlow(props: DirectoryFlowOwnerProps & PropsLocale<typeof NS>): React.JSX.Element | null {
  if (!props.open) return null
  return <Modal open title={props.t('files.directoryTitle')} closeLabel={props.t('close')}
    onClose={() => { if (!props.busy) props.onCancel() }}>
    <FileBrowser directory={props} t={props.t} />
  </Modal>
}

export function registerComputerFiles(ctx: Context): void {
  ctx.inject(['sessions', 'conversation'], (scope) => {
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
    const sessions = scope.get('sessions') as unknown as {
      scope(id: SessionId): Context | undefined
      list: { getSnapshot(): { byId: Readonly<Record<string, { cwd: string; origin: string }>> } }
    }
    const conversation = scope.get('conversation') as IConversation
    const inputs = conversation.input as IConversation['input'] & {
      canPickFiles(id: SessionId): boolean
      pickFiles(id: SessionId): void
    }
    scope.effect(() => {
      let active = true
      const descriptor = Object.getOwnPropertyDescriptor(inputs, 'pickFiles')
      const nativePicker = inputs.pickFiles.bind(inputs)
      // All host File actions share this hub. Keep its intake guards and native upload flow.
      const pickFiles = (sessionId: SessionId): void => {
        if (!active || !proxiedFrame()) return nativePicker(sessionId)
        const actx = sessions.scope(sessionId)
        if (actx === undefined || !inputs.canPickFiles(sessionId)
          || sessions.list.getSnapshot().byId[sessionId]?.origin === 'subagent') return nativePicker(sessionId)
        const input = inputs.for(actx) as ComposerInput
        const span = input.actions.captureInsertion()
        const available = (): boolean => active && sessions.scope(sessionId) === actx && inputs.canPickFiles(sessionId)
        update({
          path: sessions.list.getSnapshot().byId[sessionId]?.cwd ?? '', available,
          local: () => {
            if (!available()) return false
            update(null)
            nativePicker(sessionId)
            return true
          },
          pick: file => available() && file.mention !== null
            && input.insertReference({ source: 'reference', ref: file.mention, label: file.name,
              appearance: 'file', clipboardText: file.mention }, span),
          close: () => { update(null); if (active && sessions.scope(sessionId) === actx) input.focus() },
        })
      }
      inputs.pickFiles = pickFiles
      return () => {
        active = false
        update(null)
        if (Object.getOwnPropertyDescriptor(inputs, 'pickFiles')?.value !== pickFiles) return
        if (descriptor) Object.defineProperty(inputs, 'pickFiles', descriptor)
        else Reflect.deleteProperty(inputs, 'pickFiles')
      }
    }, 'remote-control: file source picker')
  })
}

export function ComputerFiles({ picker, t }: PropsLocale<typeof NS> & InjectFace<{ picker: Picker }>): React.JSX.Element | null {
  const selection = useSyncExternalStore(picker.subscribe, picker.getSnapshot)
  return selection === null ? null : <FileDialog key={selection.path} selection={selection} t={t} />
}

function FileDialog({ selection, t }: { selection: Selection; t: PropsLocale<typeof NS>['t'] }): React.JSX.Element {
  const [remote, setRemote] = useState(false)
  const [error, setError] = useState('')
  return <Modal open onClose={selection.close} title={t(remote ? 'files.title' : 'files.sourceTitle')} closeLabel={t('close')}
    description={t(remote ? 'files.description' : 'files.sourceDescription')}>
    {remote ? <FileBrowser path={selection.path} pickFile={file => {
      if (!selection.pick(file)) return false
      selection.close()
      return true
    }} t={t} /> : <div style={{ display: 'grid', gap: 12 }}>
      <Button type="button" variant="outline" style={{ minHeight: 44 }} onClick={() => {
        if (!selection.local()) setError(t('files.changed'))
      }}>{t('files.local')}</Button>
      <Button type="button" variant="outline" style={{ minHeight: 44 }} onClick={() => {
        if (selection.available()) setRemote(true)
        else setError(t('files.changed'))
      }}>{t('files.title')}</Button>
      {error && <div role="alert">{error}</div>}
    </div>}
  </Modal>
}

function FileBrowser({ path: initialPath = '', pickFile, directory, t }: {
  path?: string
  pickFile?: (file: ComputerFile) => boolean
  directory?: DirectoryFlowOwnerProps
  t: PropsLocale<typeof NS>['t']
}): React.JSX.Element {
  const [path, setPath] = useState(initialPath)
  const [address, setAddress] = useState(initialPath)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [listing, setListing] = useState<ComputerDirectory>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [retry, setRetry] = useState(0)
  const [showHiddenDirectories, setShowHiddenDirectories] = useState(false)
  const choosingDirectory = directory !== undefined
  const picked = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true); setError(''); setListing(undefined)
    const params = new URLSearchParams({ offset: String(offset), query })
    if (choosingDirectory) params.set('showHiddenDirectories', String(showHiddenDirectories))
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
  }, [path, query, offset, retry, choosingDirectory, showHiddenDirectories])
  const navigate = (target: string): void => { setPath(target); setAddress(target); setQuery(''); setOffset(0) }
  return <fieldset disabled={directory?.busy} style={{ display: 'grid', gap: 12, minWidth: 0, margin: 0, padding: 0, border: 0 }}>
    <form onSubmit={event => { event.preventDefault(); navigate(address) }} style={{ display: 'flex', gap: 8 }}>
      <Input aria-label={t('files.path')} value={address} onChange={event => { setAddress(event.target.value) }} style={{ minWidth: 0, flex: 1 }} />
      <Button type="submit" variant="outline">{t('files.go')}</Button>
    </form>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button variant="outline" disabled={busy || !listing || listing.parent === listing.path} onClick={() => { if (listing) navigate(listing.parent) }}>{t('files.up')}</Button>
      <Button variant="outline" disabled={busy || !listing} onClick={() => { if (listing) navigate(listing.home) }}>{t('files.home')}</Button>
      {pickFile && <Button variant="outline" onClick={() => { navigate(initialPath) }}>{t('files.workspace')}</Button>}
    </div>
    <Input aria-label={t('files.search')} placeholder={t('files.search')} value={query}
      onChange={event => { setQuery(event.target.value); setOffset(0) }} />
    {directory && <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <input type="checkbox" checked={showHiddenDirectories} onChange={event => {
        setShowHiddenDirectories(event.target.checked); setOffset(0)
      }} />{t('files.showHiddenDirectories')}
    </label>}
    {busy && <div role="status">{t('files.loading')}</div>}
    {error && <div role="alert">{error} <Button variant="outline" onClick={() => { setRetry(retry + 1) }}>{t('retry')}</Button></div>}
    <div style={{ maxHeight: '45dvh', overflowY: 'auto', display: 'grid', gap: 4 }}>
      {listing?.entries.map(file => <Button key={file.path} variant="ghost" disabled={!file.directory && (!pickFile || file.mention === null)}
        title={!file.directory && file.mention === null ? t('files.unsupported') : file.path}
        style={{ display: 'block', width: '100%', minWidth: 0, height: 'auto', minHeight: 44,
          padding: '8px 12px', textAlign: 'left', overflowWrap: 'anywhere', whiteSpace: 'normal' }}
        onClick={() => {
          if (file.directory) navigate(file.path)
          else if (pickFile && !pickFile(file)) setError(t('files.changed'))
        }}>{file.directory ? '▸ ' : ''}{file.name}{file.directory ? '/' : ''}</Button>)}
      {listing?.entries.length === 0 && <div role="status">{t('files.empty')}</div>}
    </div>
    {listing && (offset > 0 || listing.next !== null) && <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="outline" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 200)) }}>{t('files.previous')}</Button>
      <Button variant="outline" disabled={listing.next === null} onClick={() => { if (listing.next !== null) setOffset(listing.next) }}>{t('files.next')}</Button>
    </div>}
    {directory && <Button variant="primary" disabled={busy || directory.busy || !listing || address !== listing.path || picked.current}
      onClick={() => {
        if (!listing || busy || directory.busy || address !== listing.path || picked.current) return
        picked.current = true
        directory.onPicked(listing.path)
      }}>{t('files.selectDirectory')}</Button>}
  </fieldset>
}
