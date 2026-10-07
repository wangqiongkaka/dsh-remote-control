import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import { proxiedFrame } from './SidebarToggle.tsx'

interface Progress {
  subscribe(listener: () => void): () => void
  clearing(sessionId: string): boolean
}

type ClearProgressProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS>
  & InjectFace<{ progress: Progress }>

function ClearProgress({ sessionId, progress, t }: ClearProgressProps): React.JSX.Element | null {
  const clearing = useSyncExternalStore(progress.subscribe, () => progress.clearing(sessionId))
  if (!clearing) return null
  return <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
    color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>
    <StateDot state="ongoing" />{t('clear.loading')}
  </div>
}

/** Follow the existing command transaction without replacing its result or error handling. */
export function registerClearProgress(ctx: Context): void {
  if (!proxiedFrame()) return
  ctx.inject(['commandUi'], scope => {
    const pending = new Map<string, number>()
    const listeners = new Set<() => void>()
    const publish = (): void => { for (const listener of listeners) listener() }
    const progress: Progress = {
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      clearing: sessionId => pending.has(sessionId),
    }
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'remote-control.clear', locale: NS,
      inject: () => ({ progress }),
    }, ClearProgress))
    // Menu picks and typed/localized /clear both reach this normalized execution hub.
    const commands = scope.get('commandUi') as unknown as {
      execute(session: { sessionId: string }, line: string, ...args: unknown[]): Promise<unknown>
    }
    scope.effect(() => {
      let active = true
      const descriptor = Object.getOwnPropertyDescriptor(commands, 'execute')
      const nativeExecute = commands.execute.bind(commands)
      const execute: typeof commands.execute = async (session, line, ...args) => {
        if (!active || !proxiedFrame() || !/^\/clear(?:\s|$)/u.test(line.trim())) {
          return nativeExecute(session, line, ...args)
        }
        const id = session.sessionId
        pending.set(id, (pending.get(id) ?? 0) + 1)
        publish()
        try { return await nativeExecute(session, line, ...args) }
        finally {
          if (active) {
            const remaining = (pending.get(id) ?? 1) - 1
            if (remaining > 0) pending.set(id, remaining)
            else pending.delete(id)
            publish()
          }
        }
      }
      commands.execute = execute
      return () => {
        active = false
        pending.clear()
        publish()
        if (Object.getOwnPropertyDescriptor(commands, 'execute')?.value !== execute) return
        if (descriptor) Object.defineProperty(commands, 'execute', descriptor)
        else Reflect.deleteProperty(commands, 'execute')
      }
    }, 'remote-control: clear progress')
  })
}
