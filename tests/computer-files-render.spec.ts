// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComputerFiles, registerComputerFiles } from '../dist/client/ComputerFiles.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ children, onClose, title }: { children: ReactNode; onClose(): void; title: string }) => createElement('div', { role: 'dialog', 'aria-label': title },
    createElement('button', { onClick: onClose }, 'close'), children),
  Button: (props: object) => createElement('button', props),
  Input: (props: object) => createElement('input', props),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let mount: HTMLElement
let root: Root
let disposers: (() => void)[]
let scope: Context | undefined
let inputHub: { pickFiles(id: string): void; canPickFiles(id: string): boolean; for(scope: Context): object }
const nativePicker = vi.fn()
const canPickFiles = vi.fn(() => true)
const register = vi.fn(() => () => {})
const pick = vi.fn(() => true)
const focus = vi.fn()
const fetcher = vi.fn<typeof fetch>()
const selection = { start: 4, end: 4, draftRev: 8 }
const file = { name: 'notes.txt', path: '/outside/notes.txt', directory: false, mention: '@/outside/notes.txt' }
const listing = { path: '/workspace', parent: '/', home: '/home', entries: [{ name: 'folder', path: '/workspace/folder', directory: true, mention: '@/workspace/folder' }, file], next: null }
const button = (text: string) => [...mount.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!
async function click(text: string): Promise<void> { await act(async () => { button(text).click() }) }
async function openRemote(): Promise<void> {
  await act(async () => { inputHub.pickFiles('s1') })
  const dialog = mount.querySelector('[role="dialog"]')
  await click('files.title')
  expect(mount.querySelector('[role="dialog"]')).toBe(dialog)
}

beforeEach(() => {
  disposers = []
  pick.mockReset().mockReturnValue(true); focus.mockReset(); nativePicker.mockReset(); register.mockClear()
  canPickFiles.mockReset().mockReturnValue(true)
  fetcher.mockReset().mockImplementation(async () => Response.json(listing))
  vi.stubGlobal('fetch', fetcher)
  mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
  const proxy = document.createElement('style'); proxy.setAttribute('data-dsh-remote-control', ''); document.head.append(proxy)
  scope = {} as Context
  inputHub = {
    pickFiles: nativePicker, canPickFiles,
    for: () => ({ actions: { captureInsertion: () => selection }, insertReference: pick, focus }),
  }
  const serviceContext = new Context()
  Object.assign(new (class extends Service {})(serviceContext, 'conversation'), { input: inputHub })
  const services: Record<string, unknown> = {
    sessions: { scope: () => scope, list: { getSnapshot: () => ({ byId: { s1: { cwd: '/workspace', origin: 'user' } } }) } },
    conversation: serviceContext.get('conversation'),
    commandUi: { register },
  }
  const ctx = {
    inject: (_names: string[], run: (context: unknown) => void) => run(ctx),
    get: (name: string) => services[name], locale: { bind: () => (key: string) => key },
    effect: (run: () => () => void) => { disposers.push(run()) },
    slots: { inject: (_name: string, run: () => void) => run(),
      register: (entry: { inject(): object }) => {
        act(() => { root.render(createElement(ComputerFiles as never, { ...entry.inject(), t: (key: string) => key })) })
        return () => {}
      } },
  }
  registerComputerFiles(ctx as unknown as Context)
})
afterEach(() => {
  act(() => { for (const dispose of disposers) dispose(); root.unmount() })
  mount.remove(); document.querySelector('style[data-dsh-remote-control]')?.remove(); vi.unstubAllGlobals()
})

it('chooses a file source inside the existing file action without an extra command or premature reads', async () => {
  await act(async () => { inputHub.pickFiles('s1') })
  expect(mount.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('files.sourceTitle')
  expect(button('files.local')).toBeDefined()
  expect(button('files.title')).toBeDefined()
  expect(register).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(nativePicker).not.toHaveBeenCalled()
  await click('close')
  expect(pick).not.toHaveBeenCalled()
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
})

it('opens the original phone picker only after choosing phone files and refuses a stale session', async () => {
  await act(async () => { inputHub.pickFiles('s1') })
  await click('files.local')
  expect(nativePicker).toHaveBeenCalledExactlyOnceWith('s1')
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  expect(pick).not.toHaveBeenCalled()
  await act(async () => { inputHub.pickFiles('s1') })
  scope = undefined
  await click('files.local')
  expect(nativePicker).toHaveBeenCalledOnce()
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('files.changed')
  await click('files.title')
  expect(fetcher).not.toHaveBeenCalled()
  expect(mount.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('files.sourceTitle')
})

it('restores the host picker on disposal and keeps local pages and disabled file intake unchanged', async () => {
  document.querySelector('style[data-dsh-remote-control]')!.remove()
  await act(async () => { inputHub.pickFiles('s1') })
  expect(nativePicker).toHaveBeenCalledExactlyOnceWith('s1')
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  const proxy = document.createElement('style'); proxy.setAttribute('data-dsh-remote-control', ''); document.head.append(proxy)
  canPickFiles.mockReturnValue(false)
  await act(async () => { inputHub.pickFiles('s1') })
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  canPickFiles.mockReturnValue(true)
  await act(async () => { inputHub.pickFiles('s1') })
  expect(mount.querySelector('[role="dialog"]')).not.toBeNull()
  act(() => { for (const dispose of disposers.splice(0)) dispose() })
  expect(inputHub.pickFiles).toBe(nativePicker)
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  inputHub.pickFiles('s1')
  expect(nativePicker).toHaveBeenCalledTimes(3)
})

it('inserts a remote absolute file reference without replacing the draft', async () => {
  await openRemote()
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('path=%2Fworkspace')
  await click('notes.txt')
  expect(pick).toHaveBeenCalledWith({ source: 'reference', ref: '@/outside/notes.txt', label: 'notes.txt',
    appearance: 'file', clipboardText: '@/outside/notes.txt' }, selection)
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  expect(focus).toHaveBeenCalledOnce()
})

it('navigates folders, parent and home, and cancellation adds nothing', async () => {
  await openRemote()
  await click('▸ folder/')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2Fworkspace%2Ffolder')
  await click('files.up')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2F')
  await click('files.home')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2Fhome')
  await click('close')
  expect(pick).not.toHaveBeenCalled()
})

it('keeps the dialog on read failure and retries, refusing a changed draft or disposed session', async () => {
  fetcher.mockResolvedValueOnce(new Response('没有权限读取此目录', { status: 403 }))
  await openRemote()
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('没有权限')
  expect(pick).not.toHaveBeenCalled()
  await click('retry')
  pick.mockReturnValueOnce(false)
  await click('notes.txt')
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('files.changed')
  expect(mount.querySelector('[role="dialog"]')).not.toBeNull()
  scope = undefined; pick.mockClear()
  await click('notes.txt')
  expect(pick).not.toHaveBeenCalled()
})

it('disables unrepresentable filenames and aborts pending directory reads when closing', async () => {
  fetcher.mockImplementationOnce(async () => Response.json({ ...listing, entries: [{ ...file, mention: null }] }))
  await openRemote()
  expect(button('notes.txt').disabled).toBe(true)
  fetcher.mockImplementationOnce(() => new Promise(() => {}))
  await click('files.home')
  const signal = fetcher.mock.lastCall?.[1]?.signal
  await click('close')
  expect(signal?.aborted).toBe(true)
})

it('requests both pages without dropping the active directory', async () => {
  fetcher.mockImplementation(async () => Response.json({ ...listing, next: 200 }))
  await openRemote()
  await click('files.next')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('offset=200')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2Fworkspace')
  await click('files.previous')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('offset=0')
})

it('ignores a late directory result after returning to the workspace', async () => {
  let settle: (response: Response) => void = () => {}
  fetcher.mockResolvedValueOnce(Response.json(listing))
    .mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    .mockResolvedValueOnce(Response.json({ ...listing, entries: [{ ...file, name: 'current.txt' }] }))
  await openRemote()
  await click('files.home')
  const oldSignal = fetcher.mock.lastCall?.[1]?.signal
  await click('files.workspace')
  await act(async () => { settle(Response.json({ ...listing, path: '/home', entries: [{ ...file, name: 'stale.txt' }] })) })
  expect(oldSignal?.aborted).toBe(true)
  expect(button('current.txt')).toBeDefined()
  expect(button('stale.txt')).toBeUndefined()
})
