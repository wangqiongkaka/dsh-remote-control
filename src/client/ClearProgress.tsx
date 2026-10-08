import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import { proxiedFrame } from './SidebarToggle.tsx'

interface CommandOutcome {
  kind: 'success' | 'error'
  text?: string
}

interface ClearState {
  kind: 'loading' | 'success' | 'error'
  error: string
}

interface Progress {
  subscribe(listener: () => void): () => void
  getSnapshot(): ClearState | null
  close(): void
}

type ClearProgressProps = PropsLocale<typeof NS> & InjectFace<{ progress: Progress }>

function ClearProgress({ progress, t }: ClearProgressProps): React.JSX.Element | null {
  const state = useSyncExternalStore(progress.subscribe, progress.getSnapshot)
  if (state === null) return null
  const loading = state.kind === 'loading'
  return <Modal open title={t('clear.title')} closeLabel={t('close')} onClose={progress.close}
    footer={<Button type="button" disabled={loading} onClick={progress.close}>{t('close')}</Button>}>
    <div role={state.kind === 'error' ? 'alert' : 'status'} aria-busy={loading}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, lineHeight: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StateDot state={loading ? 'ongoing' : state.kind === 'error' ? 'error' : 'done'} />
        {t(loading ? 'clear.loading' : state.kind === 'error' ? 'clear.error' : 'clear.success')}
      </div>
      {state.error && <div style={{ overflowWrap: 'anywhere' }}>{state.error}</div>}
    </div>
  </Modal>
}

/** Follow the existing command transaction without replacing its result or error handling. */
export function registerClearProgress(ctx: Context): void {
  if (!proxiedFrame()) return
  ctx.inject(['commandUi'], scope => {
    const pending = new Map<string, number>()
    const listeners = new Set<() => void>()
    let state: ClearState | null = null
    let failure: string | null = null
    const update = (next: ClearState | null): void => {
      state = next
      for (const listener of listeners) listener()
    }
    const progress: Progress = {
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      getSnapshot: () => state,
      close: () => { if (pending.size === 0) update(null) },
    }
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'remote-control.clear', locale: NS,
      inject: () => ({ progress }),
    }, ClearProgress))
    // Menu picks and typed/localized /clear both reach this normalized execution hub.
    const commands = scope.get('commandUi') as unknown as {
      execute(session: { sessionId: string }, line: string, ...args: unknown[]): Promise<CommandOutcome>
    }
    scope.effect(() => {
      let active = true
      // Admission can report success after a handler error; this event carries the actual outcome.
      const events = scope as unknown as {
        on(name: 'command/executed', listener: (sessionId: string, name: string, result: CommandOutcome) => void): () => void
      }
      const off = events.on('command/executed', (sessionId, name, result) => {
        if (name === 'clear' && pending.has(sessionId) && result.kind === 'error') failure = result.text ?? ''
      })
      const descriptor = Object.getOwnPropertyDescriptor(commands, 'execute')
      const nativeExecute = commands.execute
      // Cordis supplies the caller's dependency context through the Service receiver.
      const execute: typeof commands.execute = async function (this: typeof commands, session, line, ...args) {
        if (!active || !proxiedFrame() || !/^\/clear(?:\s|$)/u.test(line.trim())) {
          return nativeExecute.call(this, session, line, ...args)
        }
        const id = session.sessionId
        if (pending.size === 0) failure = null
        pending.set(id, (pending.get(id) ?? 0) + 1)
        update({ kind: 'loading', error: '' })
        try {
          const result = await nativeExecute.call(this, session, line, ...args)
          if (result.kind === 'error') failure = result.text ?? ''
          return result
        } catch (cause) {
          failure = cause instanceof Error ? cause.message : String(cause)
          throw cause
        } finally {
          if (active) {
            const remaining = (pending.get(id) ?? 1) - 1
            if (remaining > 0) pending.set(id, remaining)
            else pending.delete(id)
            update({ kind: pending.size > 0 ? 'loading' : failure !== null ? 'error' : 'success',
              error: pending.size > 0 ? '' : failure ?? '' })
          }
        }
      }
      commands.execute = execute
      return () => {
        active = false
        off()
        pending.clear()
        update(null)
        if (Object.getOwnPropertyDescriptor(commands, 'execute')?.value !== execute) return
        if (descriptor) Object.defineProperty(commands, 'execute', descriptor)
        else Reflect.deleteProperty(commands, 'execute')
      }
    }, 'remote-control: clear progress')
  })
}
