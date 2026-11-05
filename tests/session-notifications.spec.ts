// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionNotifications } from '../dist/client/SessionNotifications.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MenuItemButton: ({ children, disabled, onSelect }: { children: ReactNode; disabled: boolean; onSelect(): void }) =>
    createElement('button', { role: 'menuitem', disabled, onClick: onSelect }, children),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.unstubAllGlobals() })
it('loads a session, keeps the menu on save failure, retries and closes only on success', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ muted: false }))
    .mockResolvedValueOnce(new Response('failed', { status: 500 })).mockResolvedValueOnce(Response.json({ muted: true }))
    .mockResolvedValueOnce(Response.json({ muted: true })).mockResolvedValueOnce(Response.json({ muted: false }))
  vi.stubGlobal('fetch', fetcher)
  const mount = document.createElement('div')
  const root = createRoot(mount)
  const close = vi.fn()
  const props = { sessionId: 's/1', useMenuOpenState: () => [true, close], t: (key: string) => key }
  try {
    await act(async () => { root.render(createElement(SessionNotifications as never, props)) })
    expect(mount.textContent).toBe('notifications.disable')
    await act(async () => { mount.querySelector('button')!.click() })
    expect(mount.querySelector('[role="alert"]')).not.toBeNull()
    expect(close).not.toHaveBeenCalled()
    await act(async () => { mount.querySelector('button')!.click() })
    expect(close).toHaveBeenCalledWith(false)
    expect(fetcher.mock.calls[2]).toEqual(['/api/remote-control/notifications?sessionId=s%2F1', expect.objectContaining({ body: '{"muted":true}' })])
    await act(async () => { root.render(null) })
    await act(async () => { root.render(createElement(SessionNotifications as never, props)) })
    expect(mount.textContent).toBe('notifications.enable')
    await act(async () => { mount.querySelector('button')!.click() })
    expect(fetcher.mock.calls[4]![1]!.body).toBe('{"muted":false}')
  } finally { act(() => { root.unmount() }) }
})
it('allows retry after the initial read fails without accidentally muting', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ muted: false }))
  vi.stubGlobal('fetch', fetcher)
  const mount = document.createElement('div'), root = createRoot(mount)
  try {
    await act(async () => { root.render(createElement(SessionNotifications as never, { sessionId: 's1', useMenuOpenState: () => [true, vi.fn()], t: (key: string) => key })) })
    expect(mount.querySelector('button')!.textContent).toBe('notifications.retry')
    await act(async () => { mount.querySelector('button')!.click() })
    expect(mount.textContent).toBe('notifications.disable')
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  } finally { act(() => { root.unmount() }) }
})
