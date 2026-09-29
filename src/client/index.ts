/** Browser actions for pairing and the first Workspace session list. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { RemoteControlAction, type RemoteControlInjected } from './RemoteControlAction.tsx'
import { RemoteLanding, type LandingInjected } from './RemoteLanding.tsx'
import { en, NS, zh, type RemoteControlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'remote-control': RemoteControlKey
  }
}

export const inject = ['slots', 'locale', 'uiWorkspace']

async function command(action: 'start' | 'stop', workspaceId?: string): Promise<string | undefined> {
  const response = await fetch('/api/remote-control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, workspaceId }),
  })
  if (!response.ok) throw new Error(await response.text())
  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null) throw new Error('Invalid remote-control response')
  const url = 'url' in result ? result.url : undefined
  if (action === 'start' && typeof url !== 'string') throw new Error('Missing remote-control URL')
  return typeof url === 'string' ? url : undefined
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'remote-control: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'remote-control',
    order: 60,
    locale: NS,
    inject: (): RemoteControlInjected => ({
      start: workspaceId => command('start', workspaceId).then((url) => {
        if (url === undefined) throw new Error('Missing remote-control URL')
        return url
      }),
      stop: async () => { await command('stop') },
    }),
  }, RemoteControlAction))
  ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    locale: NS,
    inject: (): LandingInjected => ({
      openSession: id => { ctx.uiWorkspace.openSession(id) },
    }),
  }, RemoteLanding))
}
