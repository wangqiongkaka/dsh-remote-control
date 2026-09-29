/** Browser actions for pairing and the first Workspace session list. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { RemoteControlAction, type RemoteControlInjected } from './RemoteControlAction.tsx'
import type { LandingInjected } from './RemoteLanding.tsx'
import { RemoteHeaderLeading, type SidebarToggleInjected } from './SidebarToggle.tsx'
import { en, NS, zh, type RemoteControlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'remote-control': RemoteControlKey
  }
}

export const inject = ['slots', 'locale', 'uiWorkspace', 'layout']

async function command(action: 'start' | 'stop', workspaceId?: string): Promise<object> {
  const response = await fetch('/api/remote-control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, workspaceId }),
  })
  if (!response.ok) throw new Error(await response.text())
  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null) throw new Error('Invalid remote-control response')
  return result
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'remote-control: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'remote-control',
    order: 60,
    locale: NS,
    inject: (): RemoteControlInjected => ({
      start: workspaceId => command('start', workspaceId).then((result) => {
        if ('url' in result && typeof result.url === 'string'
          && 'expiresAt' in result && typeof result.expiresAt === 'number') {
          return { url: result.url, expiresAt: result.expiresAt }
        }
        if ('expiresAt' in result && typeof result.expiresAt === 'number') return { pairedUntil: result.expiresAt }
        throw new Error('Missing remote-control URL')
      }),
      status: async () => {
        const response = await fetch('/api/remote-control')
        if (!response.ok) throw new Error(await response.text())
        const state: unknown = await response.json()
        if (typeof state !== 'object' || state === null) throw new Error('Invalid remote-control response')
        const { paired, pairedUntil } = state as { paired?: unknown; pairedUntil?: unknown }
        return { paired: paired === true, pairedUntil: typeof pairedUntil === 'number' ? pairedUntil : 0 }
      },
      stop: async () => { await command('stop') },
    }),
  }, RemoteControlAction))
  ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    locale: NS,
    inject: (): SidebarToggleInjected & LandingInjected => ({
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      openSession: id => { ctx.uiWorkspace.openSession(id) },
    }),
  }, RemoteHeaderLeading))
}
