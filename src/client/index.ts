/** Browser actions for pairing and the mobile sidebar. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { RemoteControlAction, type RemoteControlInjected } from './RemoteControlAction.tsx'
import { NARROW, SidebarToggle, proxiedFrame, type SidebarToggleInjected } from './SidebarToggle.tsx'
import { SidebarDismiss } from './SidebarDismiss.tsx'
import { followKeyboard } from './keyboard.ts'
import { applyDrawerSelection } from './drawer-style.ts'
import { compactChatDefaults } from './chat-defaults.ts'
import { hideModelsSettings } from './settings-models.ts'
import { followChatPulls, followSidebarSwipes } from './sidebar-swipe.ts'
import { en, NS, zh, type RemoteControlKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'remote-control': RemoteControlKey
  }
}

export const inject = ['slots', 'locale', 'layout']

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
  ctx.effect(() => {
    const closeLauncher = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      const launcher = event.target.closest('button[aria-haspopup="listbox"][class*="_add"]')
      const card = launcher?.closest('[data-composer-card]')
      const editor = card?.querySelector('[data-composer-input]')
      if (!card?.querySelector('[data-trigger-menu]') || !editor) return
      // The host refocuses before toggling and loses the launcher's source. Let its
      // existing Escape route close the open menu without running that click handler.
      event.preventDefault()
      event.stopImmediatePropagation()
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }))
    }
    document.addEventListener('click', closeLauncher, true)
    return () => { document.removeEventListener('click', closeLauncher, true) }
  }, 'remote-control: command launcher close')
  // Two phone-only patches arm together on a narrow proxied frame: the soft keyboard covers the
  // shell's layout viewport instead of shrinking it (iOS WebKit keeps the layout viewport whole),
  // and the drawer needs the shell's own selection fill so the current session stops matching a
  // finger's latched hover. Both are dropped the moment the frame stops being a phone one.
  ctx.effect(() => {
    const query = window.matchMedia(NARROW)
    let follow: (() => void) | undefined
    let selection: (() => void) | undefined
    let swipes: (() => void) | undefined
    let pulls: (() => void) | undefined
    let models: (() => void) | undefined
    const sync = (): void => {
      const phone = query.matches && proxiedFrame()
      follow?.()
      follow = phone ? followKeyboard() : undefined
      selection?.()
      selection = phone ? applyDrawerSelection() : undefined
      swipes?.()
      swipes = phone ? followSidebarSwipes(() => { ctx.layout.toggleSidebar() }) : undefined
      pulls?.()
      pulls = phone ? followChatPulls() : undefined
      models?.()
      models = phone ? hideModelsSettings(ctx.slots) : undefined
    }
    sync()
    query.addEventListener('change', sync)
    return () => {
      query.removeEventListener('change', sync)
      follow?.()
      selection?.()
      swipes?.()
      pulls?.()
      models?.()
    }
  }, 'remote-control: phone patches')
  // Any page that came through the proxy keeps Chat preferences in memory only (see chat-defaults),
  // whatever its width: it opens at Compact work steps and performance usage.
  ctx.effect(() => proxiedFrame() ? compactChatDefaults(ctx.slots) : () => {}, 'remote-control: compact chat')
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
    inject: (): SidebarToggleInjected => ({
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
    }),
  }, SidebarToggle))
  // The drawer's dismissal layer: session picks and the blank scrim beside the
  // drawer both fold it back onto the Conversation (proxy narrow frames only).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'remote-control.dismiss',
    inject: (): SidebarToggleInjected => ({
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
    }),
  }, SidebarDismiss))
}
