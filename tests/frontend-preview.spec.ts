// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { expect, it, vi } from 'vitest'
import { FrontendPreviewAction } from '../dist/client/FrontendPreviewAction.js'
import { phoneDocument } from '../dist/phone-document.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// The linked host package resolves its own React; keep this unit test on the plugin's renderer.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}))

it('keeps preview off local pages and validates the mobile form before generating a native link', async () => {
  const mount = document.createElement('div')
  document.body.append(mount)
  const root = createRoot(mount)
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  const preview = vi.fn().mockResolvedValue('https://host.tailnet.ts.net:8443/?pair=preview')
  const render = () => root.render(createElement(FrontendPreviewAction as never, {
    preview, t: (key: string) => key,
  }))
  const input = (value: string) => {
    const element = document.querySelector<HTMLInputElement>('input[aria-label="preview.port"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  try {
    act(render)
    expect(mount.querySelector('button')).toBeNull()
    document.head.append(proxy)
    act(render)
    const action = mount.querySelector<HTMLButtonElement>('[data-frontend-preview-action]')!
    expect(action.getAttribute('aria-label')).toBe('preview.title')
    act(() => { action.click() })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(submit().disabled).toBe(true)
    for (const value of ['0', '65536', '1.5', 'http://localhost:5173']) {
      input(value)
      expect(submit().disabled).toBe(true)
    }
    input('5173')
    expect(submit().disabled).toBe(false)
    await act(async () => { submit().click() })
    expect(preview).toHaveBeenCalledExactlyOnceWith(5173)
    const link = document.querySelector<HTMLAnchorElement>('a')!
    expect(link.href).toBe('https://host.tailnet.ts.net:8443/?pair=preview')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    input('3000')
    expect(document.querySelector('a')).toBeNull()
    preview.mockRejectedValueOnce(new Error('服务未启动'))
    await act(async () => { submit().click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('服务未启动')
    expect(document.querySelector('a')).toBeNull()
    expect(submit().disabled).toBe(false)
  } finally {
    act(() => { root.unmount() })
    proxy.remove()
    mount.remove()
  }
})

it('shows only the preview action through the host slot wrapper on phones', () => {
  const frame = document.createElement('div')
  frame.className = 'layout_frame'
  frame.innerHTML = '<div class="layout_sidebarCol"></div><header data-window-drag><div class="chat_headerUtilities">'
    + '<div data-slot="conversation.session.header.utilities" style="display:contents">'
    + '<button id="desktop-action">Desktop</button><span id="desktop-label">Desktop label</span>'
    + '<button data-frontend-preview-action>Preview</button></div></div></header>'
  const style = document.createElement('style')
  // jsdom does not evaluate viewport media queries; apply just the phone header rules.
  style.textContent = phoneDocument('<head></head>').match(/[^{}]*\[class\*="_headerUtilities"\][^{}]*\{[^{}]*\}/gu)!.join('')
  document.head.append(style)
  document.body.append(frame)
  try {
    expect(getComputedStyle(frame.querySelector('.chat_headerUtilities')!).display).toBe('flex')
    expect(getComputedStyle(frame.querySelector('[data-slot]')!).display).toBe('contents')
    expect(getComputedStyle(frame.querySelector('[data-frontend-preview-action]')!).display).not.toBe('none')
    expect(getComputedStyle(frame.querySelector('#desktop-action')!).display).toBe('none')
    expect(getComputedStyle(frame.querySelector('#desktop-label')!).display).toBe('none')
  } finally {
    frame.remove()
    style.remove()
  }
})
