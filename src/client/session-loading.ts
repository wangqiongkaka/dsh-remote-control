/** A smaller remote opening window and bounded reuse of already visited live Sessions. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { proxiedFrame } from './SidebarToggle.tsx'

/** The public Client reference surface; the Host's same-named service has a different contract. */
interface ClientReference {
  readonly sessionId: string
  readonly ready: Promise<{ session: { getSnapshot(): { openState: string } | undefined } }>
  release(): void
}

interface ClientSessions {
  retain(target: string, options: { source: string }): ClientReference
  readonly list: {
    getSnapshot(): { phase: string; byId: Readonly<Record<string, {
      id: string; running: boolean; retainedBy: Readonly<Record<string, number | undefined>>
    }>> }
    subscribe(listener: () => void): () => void
  }
}

/** Install both policies only on pages admitted through the remote proxy. */
export function registerSessionLoading(ctx: Context): void {
  if (!proxiedFrame()) return
  ctx.inject(['remote.session'], scope => {
    scope.effect(() => {
      const remote = scope.get('remote.session') as Context['remote']['session']
      const descriptor = Object.getOwnPropertyDescriptor(remote, 'follow')
      const original = remote.follow
      let active = true
      // Generated Remote getters capture the calling Cordis context; read them on that receiver.
      const get = function (this: typeof remote): typeof original {
        const native: typeof original = descriptor?.get?.call(this) ?? original
        return (request, signal) => native.call(this, active && proxiedFrame()
          ? { ...request, maxMessages: Math.min(request.maxMessages ?? 500, 500), turnWindow: { minMessages: 1, minTurns: 1 } }
          : request, signal)
      }
      Object.defineProperty(remote, 'follow', { configurable: true, enumerable: descriptor?.enumerable ?? true, get })
      return () => {
        active = false
        if (Object.getOwnPropertyDescriptor(remote, 'follow')?.get !== get) return
        if (descriptor) Object.defineProperty(remote, 'follow', descriptor)
        else Reflect.deleteProperty(remote, 'follow')
      }
    }, 'remote-control: recent history window')
  })
  ctx.inject(['sessions'], scope => {
    scope.effect(() => {
      const sessions = scope.get('sessions') as unknown as ClientSessions
      type Reference = ReturnType<typeof sessions.retain>
      const cache = new Map<Reference['sessionId'], Reference>()
      let active = true
      let syncing = false
      let hidden = document.visibilityState === 'hidden'
      let mainIds = new Set<string>()
      const drop = (id: Reference['sessionId']): void => {
        const reference = cache.get(id)
        cache.delete(id)
        reference?.release()
      }
      const clear = (): void => { for (const id of [...cache.keys()]) drop(id) }
      const remember = (id: Reference['sessionId']): void => {
        const cached = cache.get(id)
        if (cached) { cache.delete(id); cache.set(id, cached); return }
        // Caching is optional: a failed extra acquisition must not fail the user's navigation.
        let reference: Reference
        try { reference = sessions.retain(id, { source: 'remoteControlCache' }) } catch { return }
        cache.set(id, reference)
        while (cache.size > 3) drop(cache.keys().next().value!)
        const forgetFailed = (): void => { if (cache.get(id) === reference) drop(id) }
        void reference.ready.then(binding => {
          if (cache.get(id) !== reference) return
          if (binding.session.getSnapshot()?.openState !== 'open') forgetFailed()
        }, forgetFailed)
      }
      const sync = (): void => {
        // Acquiring or releasing a cache reference publishes another retention snapshot.
        if (syncing) return
        syncing = true
        try {
          if (!active || !proxiedFrame() || hidden) { mainIds.clear(); clear(); return }
          const state = sessions.list.getSnapshot()
          const viewed = Object.values(state.byId).filter(row => row.retainedBy.mainView)
          const entered = viewed.filter(row => !mainIds.has(row.id))
          mainIds = new Set(viewed.map(row => row.id))
          for (const row of entered) remember(row.id)
          for (const id of [...cache.keys()]) {
            const row = state.byId[id]
            if ((state.phase === 'ready' && !row) || (row?.running && !row.retainedBy.mainView)) drop(id)
          }
        } finally { syncing = false }
      }
      const off = sessions.list.subscribe(sync)
      const visibility = (): void => { hidden = document.visibilityState === 'hidden'; sync() }
      const hide = (): void => { hidden = true; sync() }
      document.addEventListener('visibilitychange', visibility)
      window.addEventListener('pagehide', hide)
      window.addEventListener('pageshow', visibility)
      sync()
      return () => {
        active = false
        off()
        document.removeEventListener('visibilitychange', visibility)
        window.removeEventListener('pagehide', hide)
        window.removeEventListener('pageshow', visibility)
        clear()
      }
    }, 'remote-control: recent session reuse')
  })
}
