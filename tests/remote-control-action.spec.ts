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
  mount = document.createElement('div')
  document.body.append(mount)
  root = createRoot(mount)
  act(() => {
    root.render(createElement(RemoteControlAction as never, {
      sessionId: 'session-1', t: (key: string) => key,
      useWorkspaces: (select: (value: unknown) => unknown) => select({ items: [
        { workspaceId: 'workspace-1', sessionIds: ['session-1'] },
      ] }), start, stop,
    }))
  })
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
