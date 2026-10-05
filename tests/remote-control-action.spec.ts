// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemoteControlAction } from '../dist/client/RemoteControlAction.js'

// Test the plugin's dialog behavior independently of the host's modal portal and React instance.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ open, onClose, title, description, footer, children }: {
    open: boolean; onClose: () => void; title: string; description: string; footer: ReactNode; children: ReactNode
  }) => open ? createElement('div', { role: 'dialog' }, title, description,
    createElement('button', { 'aria-label': 'close', onClick: onClose }), children, footer) : null,
  Button: ({ children, onClick, disabled, 'aria-label': label }: {
    children: ReactNode; onClick: () => void; disabled: boolean; 'aria-label': string
  }) => createElement('button', { onClick, disabled, 'aria-label': label }, children),
  Input: ({ value }: { value: string }) => createElement('input', { value, readOnly: true }),
  IconCheckOutlineRegular: () => null,
  IconCopyOutlineRegular: () => null,
  IconLinkOutlineRegular: () => null,
  StateDot: () => null,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let mount: HTMLElement
const start = vi.fn()
const stop = vi.fn()
const status = vi.fn()
const invitation = (id: string, pairedUntil = Date.now() + 60_000) => ({
  url: `https://host.tailnet.ts.net/?pair=${id}`, expiresAt: Date.now() + 30_000, pairedUntil,
})

async function click(selector: string): Promise<void> {
  const button = document.querySelector<HTMLElement>(selector)
  if (button === null) throw new Error(`Missing button: ${selector}`)
  await act(async () => { button.click() })
}

beforeEach(() => {
  vi.useFakeTimers()
  start.mockReset().mockResolvedValue(invitation('first'))
  stop.mockReset().mockResolvedValue(undefined)
  status.mockReset().mockResolvedValue(false)
  mount = document.createElement('div')
  document.body.append(mount)
  root = createRoot(mount)
  act(() => {
    root.render(createElement(RemoteControlAction as never, {
      sessionId: 'session-1', t: (key: string) => key,
      useWorkspaces: (select: (value: unknown) => unknown) => select({ items: [
        { workspaceId: 'workspace-1', sessionIds: ['session-1'] },
      ] }), start, stop, status, wide: true,
    }))
  })
})

it('shows a phone entry and reads pairing status without starting the tunnel on hover', async () => {
  const entry = document.querySelector<HTMLButtonElement>('button[aria-label="title"]')!
  expect(entry.querySelector('svg[data-remote-control-phone]')).not.toBeNull()
  await act(async () => { entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('titlewaiting')
  expect(start).not.toHaveBeenCalled()
  status.mockResolvedValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('titleconnected')
  await click('button[aria-label="title"]')
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

it('opens pairing without a selected session or workspace', async () => {
  await act(async () => {
    root.render(createElement(RemoteControlAction as never, {
      t: (key: string) => key, start, stop, status, wide: false,
    }))
  })
  await click('button[aria-label="title"]')
  expect(start).toHaveBeenCalledWith()
  expect(document.querySelector('[role="dialog"] img')).not.toBeNull()
})

it('supports keyboard preview, reports unavailable status, and stops polling on blur', async () => {
  status.mockRejectedValue(new Error('offline'))
  const entry = document.querySelector<HTMLButtonElement>('button[aria-label="title"]')!
  await act(async () => { entry.focus() })
  const hint = document.querySelector('[role="tooltip"]')!
  expect(hint.textContent).toBe('titlestatusUnavailable')
  expect(entry.getAttribute('aria-describedby')).toBe(hint.id)
  await act(async () => { entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await act(async () => { entry.blur(); await vi.advanceTimersByTimeAsync(4_000) })
  expect(status).toHaveBeenCalledOnce()
  expect(start).not.toHaveBeenCalled()
})

it('hides the pairing control on the paired phone', async () => {
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  try {
    await act(async () => {
      root.render(createElement(RemoteControlAction as never, {
        t: (key: string) => key, start, stop, status, wide: true,
      }))
    })
    expect(document.querySelector('button[aria-label="title"]')).toBeNull()
    expect(status).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  } finally { proxy.remove() }
})

afterEach(() => {
  act(() => { root.unmount() })
  mount.remove()
  vi.useRealTimers()
})

it('shows a usable QR code on each open while a phone remains paired', async () => {
  await click('button[aria-label="title"]')
  expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/u)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('pairedUntil')
  await click('button[aria-label="close"]')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('button[aria-label="title"]')
  expect(start).toHaveBeenCalledTimes(2)
  expect(document.querySelector<HTMLInputElement>('input')?.value).toContain('?pair=first')
  expect(document.querySelector('[role="dialog"] img')).not.toBeNull()
  expect(stop).not.toHaveBeenCalled()
})

it('shows unlimited access as paired without formatting an expiry date', async () => {
  start.mockResolvedValue(invitation('unlimited', -1))
  await click('button[aria-label="title"]')
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog?.textContent).toContain('pairedForever')
  expect(dialog?.textContent).toContain('pairedAnother')
  expect(dialog?.textContent).not.toContain('1970-')
  expect(dialog?.querySelector('img')).not.toBeNull()
  await click('button[aria-label="close"]')
  await click('button[aria-label="title"]')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('pairedForever')
  await click('[role="dialog"] > button:last-child')
  expect(stop).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('manually refreshes the QR while preserving phone access and blocking duplicate requests', async () => {
  start.mockResolvedValue(invitation('first', -1))
  await click('button[aria-label="title"]')
  const original = document.querySelector('img')?.getAttribute('src')
  let finish: ((value: ReturnType<typeof invitation>) => void) | undefined
  start.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await click('button[aria-label="refresh"]')
  expect(start).toHaveBeenLastCalledWith(undefined, true)
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="refresh"]')?.disabled).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('[role="dialog"] > button:last-child')?.disabled).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(start).toHaveBeenCalledTimes(2)
  start.mockResolvedValue(invitation('manual', -1))
  await act(async () => { finish?.(invitation('manual', -1)) })
  expect(document.querySelector<HTMLInputElement>('input')?.value).toContain('?pair=manual')
  expect(document.querySelector('img')?.getAttribute('src')).not.toBe(original)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('pairedForever')
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  expect(start).toHaveBeenLastCalledWith()
  await click('button[aria-label="close"]')
  await click('button[aria-label="title"]')
  expect(start).toHaveBeenLastCalledWith()
  expect(stop).not.toHaveBeenCalled()
})

it('keeps the existing QR on manual refresh failure and allows another refresh', async () => {
  await click('button[aria-label="title"]')
  const original = document.querySelector('img')?.getAttribute('src')
  start.mockRejectedValueOnce(new Error('refresh failed'))
  await click('button[aria-label="refresh"]')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('refresh failed')
  expect(document.querySelector('img')?.getAttribute('src')).toBe(original)
  expect(document.querySelector<HTMLButtonElement>('button[aria-label="refresh"]')?.disabled).toBe(false)
  start.mockResolvedValue(invitation('retried'))
  await click('button[aria-label="refresh"]')
  expect(start).toHaveBeenLastCalledWith(undefined, true)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.querySelector<HTMLInputElement>('input')?.value).toContain('?pair=retried')
  expect(stop).not.toHaveBeenCalled()
})

it('refreshes spent or expired invitations without hiding the QR code after pairing', async () => {
  start.mockResolvedValueOnce(invitation('first', 0)).mockResolvedValue(invitation('next'))
  await click('button[aria-label="title"]')
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('pairedUntil')
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  expect(document.querySelector<HTMLInputElement>('input')?.value).toContain('?pair=next')
  expect(document.querySelector('[role="dialog"] img')).not.toBeNull()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('pairedUntil')
  start.mockResolvedValue(invitation('renewed'))
  await act(async () => { await vi.advanceTimersByTimeAsync(32_000) })
  expect(document.querySelector<HTMLInputElement>('input')?.value).toContain('?pair=renewed')
  expect(stop).not.toHaveBeenCalled()
  let finishStop: (() => void) | undefined
  stop.mockReturnValue(new Promise<void>(resolve => { finishStop = resolve }))
  await click('[role="dialog"] > button:last-child')
  const calls = start.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(start).toHaveBeenCalledTimes(calls)
  await act(async () => { finishStop?.() })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(start).toHaveBeenCalledTimes(calls)
})

it('stops showing the startup spinner and offers retry when the tunnel times out', async () => {
  start.mockImplementation(() => new Promise((_resolve, reject) => {
    setTimeout(() => { reject(new Error('Tailscale Funnel startup timeout')) }, 60_000)
  }))
  await click('button[aria-label="title"]')
  expect(document.querySelector('[role="status"]')?.textContent).toContain('loading')
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
  expect(start).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(document.querySelector('[role="status"]')).toBeNull()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Tailscale Funnel startup timeout')
  expect(document.querySelector('[role="alert"] button')?.textContent).toBe('retry')
})
