// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComputerFiles, ComputerDirectoryFlow, registerComputerFiles } from '../dist/client/ComputerFiles.js'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ children, onClose, title, description }: { children: ReactNode; onClose(): void; title: string; description?: string }) => createElement('div', { role: 'dialog', 'aria-label': title },
    createElement('h2', null, title), createElement('button', { onClick: onClose }, 'close'),
    description && createElement('p', null, description), children),
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
  expect(dialog?.getAttribute('aria-label')).toBe('files.title')
  expect(dialog?.querySelector('p')?.textContent).toBe('files.description')
}

beforeEach(() => {
  disposers = []
  pick.mockReset().mockReturnValue(true); focus.mockReset(); nativePicker.mockReset(); register.mockClear()
  canPickFiles.mockReset().mockReturnValue(true)
  fetcher.mockReset().mockImplementation(async () => Response.json(listing))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
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
  const dialog = mount.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('aria-label')).toBe('files.sourceDescription')
  expect(dialog.querySelector('h2')?.textContent).toBe('files.sourceDescription')
  expect(dialog.textContent).not.toContain('files.sourceTitle')
  expect(dialog.querySelector('p')).toBeNull()
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
  expect(mount.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('files.sourceDescription')
})

it.each(['change', 'cancel', 'pointerdown', 'dispose', 'wide'])('anchors the native phone menu to the source dialog and restores the input on %s', async (closed) => {
  vi.stubGlobal('matchMedia', () => ({ matches: closed !== 'wide' }))
  const input = document.createElement('input')
  input.type = 'file'; input.hidden = true; input.multiple = true
  input.setAttribute('style', 'color: red;')
  mount.append(input)
  const style = input.getAttribute('style')
  nativePicker.mockImplementation(() => { input.click() })
  await act(async () => { inputHub.pickFiles('s1') })
  const dialog = mount.querySelector<HTMLElement>('[role="dialog"]')!
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(24, 300, 380, 200))
  await click('files.local')
  expect(nativePicker).toHaveBeenCalledExactlyOnceWith('s1')
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  expect(input.multiple).toBe(true)
  if (closed !== 'wide') {
    expect(input.hidden).toBe(false)
    expect(input.style.position).toBe('fixed')
    expect(input.style.left).toBe('214px')
    expect(input.style.top).toBe('500px')
    expect(input.style.opacity).toBe('0')
    expect(input.style.pointerEvents).toBe('none')
    if (closed === 'dispose') act(() => { for (const dispose of disposers.splice(0)) dispose() })
    else if (closed === 'pointerdown') document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    else input.dispatchEvent(new Event(closed, { bubbles: true }))
  }
  expect(input.hidden).toBe(true)
  expect(input.getAttribute('style')).toBe(style)
  input.click()
  expect(input.hidden).toBe(true)
  expect(input.getAttribute('style')).toBe(style)
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

async function directoryFlow(overrides: Partial<DirectoryFlowOwnerProps> = {}): Promise<DirectoryFlowOwnerProps> {
  const owner = { open: true, busy: false, onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(), ...overrides }
  await act(async () => { root.render(createElement(ComputerDirectoryFlow, { ...owner, t: (key: string) => key })) })
  return owner
}

it('adds the browsed remote directory through the workspace owner, with files unavailable', async () => {
  const owner = await directoryFlow()
  expect(new URL(String(fetcher.mock.calls[0]?.[0]), 'http://localhost').searchParams.has('path')).toBe(false)
  expect(button('notes.txt').disabled).toBe(true)
  expect(button('files.workspace')).toBeUndefined()
  expect(owner.onPicked).not.toHaveBeenCalled()
  fetcher.mockResolvedValueOnce(Response.json({ ...listing, path: '/workspace/folder', entries: [] }))
  await click('▸ folder/')
  await click('files.selectDirectory')
  await click('files.selectDirectory')
  expect(owner.onPicked).toHaveBeenCalledExactlyOnceWith('/workspace/folder')
  expect(pick).not.toHaveBeenCalled()
  expect(nativePicker).not.toHaveBeenCalled()
})

it('does not select an unvalidated typed path or failed directory, and allows retry', async () => {
  const owner = await directoryFlow()
  const address = mount.querySelector<HTMLInputElement>('input[aria-label="files.path"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(address, '/missing')
    address.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(button('files.selectDirectory').disabled).toBe(true)
  fetcher.mockResolvedValueOnce(new Response('目录不存在', { status: 404 }))
  await act(async () => { mount.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2Fmissing')
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('目录不存在')
  expect(button('files.selectDirectory').disabled).toBe(true)
  expect(owner.onPicked).not.toHaveBeenCalled()
  fetcher.mockResolvedValueOnce(Response.json({ ...listing, path: '/missing' }))
  await click('retry')
  await click('files.selectDirectory')
  expect(owner.onPicked).toHaveBeenCalledExactlyOnceWith('/missing')
})

it('cancels remote directory selection without adoption and aborts withdrawn reads', async () => {
  const owner = await directoryFlow()
  await click('close')
  expect(owner.onCancel).toHaveBeenCalledOnce()
  expect(owner.onPicked).not.toHaveBeenCalled()
  await directoryFlow({ ...owner, open: false })
  fetcher.mockImplementationOnce(() => new Promise(() => {}))
  await directoryFlow(owner)
  const signal = fetcher.mock.lastCall?.[1]?.signal
  await directoryFlow({ ...owner, open: false })
  expect(signal?.aborted).toBe(true)
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  expect(owner.onPicked).not.toHaveBeenCalled()
})

it('blocks directory actions during workspace adoption without relaunching reads', async () => {
  const owner = await directoryFlow()
  const reads = fetcher.mock.calls.length
  await directoryFlow({ ...owner, busy: true })
  expect(button('files.selectDirectory').disabled).toBe(true)
  expect(mount.querySelector('fieldset')?.disabled).toBe(true)
  await click('close')
  expect(owner.onCancel).not.toHaveBeenCalled()
  expect(owner.onPicked).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledTimes(reads)
})

it.each(['directory', 'file'] as const)('hides all dot entries by default and toggles them without losing the directory or keeping a stale page (%s)', async (mode) => {
  const hidden = { name: '.cache', path: '/workspace/.cache', directory: true, mention: '@/workspace/.cache' }
  const hiddenFile = { name: '.env', path: '/workspace/.env', directory: false, mention: '@/workspace/.env' }
  fetcher.mockImplementation(async url => {
    const params = new URL(String(url), 'http://localhost').searchParams
    return Response.json({ ...listing, next: 200,
      entries: [...listing.entries, ...(params.get('showHidden') === 'true' ? [hidden, hiddenFile] : [])] })
  })
  const owner = mode === 'directory' ? await directoryFlow() : undefined
  if (mode === 'file') await openRemote()
  const toggle = mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  expect(toggle).not.toBeNull()
  expect(toggle.checked).toBe(false)
  expect(toggle.parentElement?.textContent).toBe('files.showHidden')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('showHidden=false')
  expect(button('▸ .cache/')).toBeUndefined()
  expect(button('.env')).toBeUndefined()
  await click('files.next')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('offset=200')
  await act(async () => { toggle.click() })
  expect(toggle.checked).toBe(true)
  expect(String(fetcher.mock.lastCall?.[0])).toContain('showHidden=true')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('offset=0')
  expect(button('▸ .cache/')).toBeDefined()
  expect(button('.env').disabled).toBe(mode === 'directory')
  await click('▸ folder/')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2Fworkspace%2Ffolder')
  expect(String(fetcher.mock.lastCall?.[0])).toContain('showHidden=true')
  await act(async () => { toggle.click() })
  expect(String(fetcher.mock.lastCall?.[0])).toContain('path=%2Fworkspace%2Ffolder')
  expect(button('▸ .cache/')).toBeUndefined()
  expect(button('.env')).toBeUndefined()
  if (owner) {
    expect(owner.onPicked).not.toHaveBeenCalled()
    await directoryFlow({ ...owner, open: false })
    await directoryFlow(owner)
  } else {
    await click('close')
    await openRemote()
  }
  expect(mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
})

it.each(['directory', 'file'] as const)('shows the full wrapping path and keeps editing separate from navigation (%s)', async (mode) => {
  const path = '/Users/wangqiongkaka/AIProjetcs/项目  文件夹/very-long-directory-name/another-long-directory-name'
  fetcher.mockResolvedValueOnce(Response.json({ ...listing, path }))
  if (mode === 'directory') await directoryFlow()
  else await openRemote()
  const display = mount.querySelector<HTMLElement>('[role="note"][aria-label="files.path"]')!
  expect(display).not.toBeNull()
  expect(display.textContent).toBe(path)
  expect(getComputedStyle(display).whiteSpace).toBe('pre-wrap')
  expect(getComputedStyle(display).overflowWrap).toBe('anywhere')
  const address = mount.querySelector<HTMLInputElement>('input[aria-label="files.path"]')!
  const edited = path + '/child'
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(address, edited)
    address.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(display.textContent).toBe(edited)
  expect(fetcher).toHaveBeenCalledOnce()
  fetcher.mockResolvedValueOnce(Response.json({ ...listing, path: edited }))
  await act(async () => { mount.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(new URL(String(fetcher.mock.lastCall?.[0]), 'http://localhost').searchParams.get('path')).toBe(edited)
  expect(display.textContent).toBe(edited)
})
