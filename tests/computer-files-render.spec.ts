// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComputerFiles, registerComputerFiles } from '../dist/client/ComputerFiles.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  rankByName: (await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()).rankByName,
  Modal: ({ children, onClose }: { children: ReactNode; onClose(): void }) => createElement('div', { role: 'dialog' },
    createElement('button', { onClick: onClose }, 'close'), children),
  Button: (props: object) => createElement('button', props),
  Input: (props: object) => createElement('input', props),
  IconPaperclipOutlineRegular: () => null,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let mount: HTMLElement
let root: Root
let disposers: (() => void)[]
let scope: Context | undefined
let action: { name: string; label(): string; available(session: { sessionId: string }): boolean; ui: { run(session: { sessionId: string }): void } }
type Row = { name: string; label?: string; section?: string }
type Request = { query: string; position: string }
let commands: { register(value: typeof action): () => void; candidates(session: { sessionId: string }, request: Request): Promise<readonly Row[]> }
const pick = vi.fn(() => true)
const focus = vi.fn()
const fetcher = vi.fn<typeof fetch>()
const selection = { start: 4, end: 4, draftRev: 8 }
const file = { name: 'notes.txt', path: '/outside/notes.txt', directory: false, mention: '@/outside/notes.txt' }
const listing = { path: '/workspace', parent: '/', home: '/home', entries: [{ name: 'folder', path: '/workspace/folder', directory: true, mention: '@/workspace/folder' }, file], next: null }
const button = (text: string) => [...mount.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!
async function click(text: string): Promise<void> { await act(async () => { button(text).click() }) }

beforeEach(() => {
  disposers = []
  pick.mockReset().mockReturnValue(true); focus.mockReset()
  fetcher.mockReset().mockImplementation(async () => Response.json(listing))
  vi.stubGlobal('fetch', fetcher)
  mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
  const proxy = document.createElement('style'); proxy.setAttribute('data-dsh-remote-control', ''); document.head.append(proxy)
  scope = {} as Context
  // Reproduce the Harness filter after the host synthesizes registered contributions.
  // The screenshot's Codex menu keeps only these names and discards computer-file.
  const kept = new Set(['file', 'link', 'goal', 'plan', 'compact', 'clear'])
  commands = {
    register: value => { action = value; return () => {} },
    candidates: async (session, request) => [
      { name: 'file', section: '添加' }, { name: 'link', section: '添加' },
      { name: 'goal', section: '添加' }, { name: 'compact', section: '指令' },
      ...(action.available(session) ? [{ name: action.name, label: action.label(), section: '指令' }] : []),
    ].filter(row => kept.has(row.name) && (row.name.includes(request.query) || row.label?.includes(request.query))),
  }
  const serviceContext = new Context()
  Object.assign(new (class extends Service {})(serviceContext, 'commandUi'), commands)
  commands = serviceContext.get('commandUi') as unknown as typeof commands
  const services: Record<string, unknown> = {
    sessions: { scope: () => scope, list: { getSnapshot: () => ({ byId: { s1: { cwd: '/workspace', origin: 'user' } } }) } },
    conversation: { input: { for: () => ({ actions: { captureInsertion: () => selection }, insertReference: pick, focus }) } },
    commandUi: commands,
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

it('keeps computer files immediately after phone files in a filtered Harness menu and on search', async () => {
  const session = { sessionId: 's1' }
  const request = { query: '', position: 'leading' }
  const rows = await commands.candidates(session, request)
  expect(rows.map(row => row.name)).toEqual(['file', 'computer-file', 'link', 'goal', 'compact'])
  expect(rows[1]).toMatchObject({ label: 'files.title', section: '添加' })
  expect((await commands.candidates(session, { ...request, query: 'computer' })).map(row => row.name)).toEqual(['computer-file'])
  expect(await commands.candidates(session, { ...request, query: 'missing' })).toEqual([])
  await act(async () => { action.ui.run(session) })
  expect(mount.querySelector('[role="dialog"]')).not.toBeNull()
  await click('close')
  document.querySelector('style[data-dsh-remote-control]')!.remove()
  expect((await commands.candidates(session, request)).map(row => row.name)).toEqual(['file', 'link', 'goal', 'compact'])
})

it('survives a later Harness filter and restores its method on disposal without duplicate file entries', async () => {
  const session = { sessionId: 's1' }
  const request = { query: '', position: 'leading' }
  const previous = commands.candidates.bind(commands)
  const harness = async (session: { sessionId: string }, request: Request) =>
    (await previous(session, request)).filter(row => row.name !== 'computer-file')
  commands.candidates = harness
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const launcher = document.createElement('button')
  card.append(launcher); document.body.append(card)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      launcher.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      const rows = await commands.candidates(session, request)
      expect(rows.map(row => row.name)).toEqual(['file', 'computer-file', 'link', 'goal', 'compact'])
    }
    act(() => { for (const dispose of disposers.splice(0)) dispose() })
    expect(Object.getOwnPropertyDescriptor(commands, 'candidates')?.value).toBe(harness)
    expect((await commands.candidates(session, request)).some(row => row.name === 'computer-file')).toBe(false)
    launcher.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(Object.getOwnPropertyDescriptor(commands, 'candidates')?.value).toBe(harness)
  } finally { card.remove() }
})

it('preserves an empty command menu and deduplicates an unfiltered host contribution', async () => {
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  document.body.append(card)
  const session = { sessionId: 's1' }, request = { query: '', position: 'leading' }
  try {
    commands.candidates = async () => []
    card.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(await commands.candidates(session, request)).toEqual([])
    commands.candidates = async () => [
      { name: 'file', section: 'Add' }, { name: 'compact', section: 'Commands' },
      { name: 'computer-file', section: 'Commands' },
    ]
    card.dispatchEvent(new Event('input', { bubbles: true }))
    expect((await commands.candidates(session, request)).map(row => row.name)).toEqual(['file', 'computer-file', 'compact'])
  } finally { card.remove() }
})
afterEach(() => {
  act(() => { for (const dispose of disposers) dispose(); root.unmount() })
  mount.remove(); document.querySelector('style[data-dsh-remote-control]')?.remove(); vi.unstubAllGlobals()
})

it('offers a separate remote action and inserts an absolute file reference without replacing the draft', async () => {
  expect(action.available({ sessionId: 's1' })).toBe(true)
  document.querySelector('style[data-dsh-remote-control]')!.remove()
  expect(action.available({ sessionId: 's1' })).toBe(false)
  await act(async () => { action.ui.run({ sessionId: 's1' }) })
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('path=%2Fworkspace')
  await click('notes.txt')
  expect(pick).toHaveBeenCalledWith({ source: 'reference', ref: '@/outside/notes.txt', label: 'notes.txt',
    appearance: 'file', clipboardText: '@/outside/notes.txt' }, selection)
  expect(mount.querySelector('[role="dialog"]')).toBeNull()
  expect(focus).toHaveBeenCalledOnce()
})

it('navigates folders, parent and home, and cancellation adds nothing', async () => {
  await act(async () => { action.ui.run({ sessionId: 's1' }) })
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
  await act(async () => { action.ui.run({ sessionId: 's1' }) })
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
  await act(async () => { action.ui.run({ sessionId: 's1' }) })
  expect(button('notes.txt').disabled).toBe(true)
  fetcher.mockImplementationOnce(() => new Promise(() => {}))
  await click('files.home')
  const signal = fetcher.mock.lastCall?.[1]?.signal
  await click('close')
  expect(signal?.aborted).toBe(true)
})

it('requests both pages without dropping the active directory', async () => {
  fetcher.mockImplementation(async () => Response.json({ ...listing, next: 200 }))
  await act(async () => { action.ui.run({ sessionId: 's1' }) })
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
  await act(async () => { action.ui.run({ sessionId: 's1' }) })
  await click('files.home')
  const oldSignal = fetcher.mock.lastCall?.[1]?.signal
  await click('files.workspace')
  await act(async () => { settle(Response.json({ ...listing, path: '/home', entries: [{ ...file, name: 'stale.txt' }] })) })
  expect(oldSignal?.aborted).toBe(true)
  expect(button('current.txt')).toBeDefined()
  expect(button('stale.txt')).toBeUndefined()
})
