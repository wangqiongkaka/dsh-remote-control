// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AGENTS_ATTRIBUTE, AgentBoard } from '../dist/client/AgentBoard.js'

// The host's hook-based primitives resolve to the host checkout's own React; stand-ins keep their contracts.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...await importOriginal<object>(),
  Menu: ({ open, anchor, items, onSelect }: {
    open: boolean; anchor: ReactNode; items: { id: string; label: string }[]; onSelect(id: string): void
  }) => createElement('span', null, anchor, open && createElement('div', { role: 'menu' },
    items.map(item => createElement('button', { key: item.id, role: 'menuitem', onClick: () => { onSelect(item.id) } }, item.label)))),
  Modal: ({ children, title, description, footer }: { children: ReactNode; title: string; description?: string; footer: ReactNode }) =>
    createElement('div', { role: 'dialog', 'aria-label': title }, createElement('h2', null, title),
      description && createElement('p', null, description), children, footer),
  Button: (props: object) => createElement('button', props),
  Toast: ({ text }: { text: string }) => createElement('div', { role: 'alert' }, text),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const list = {
  phase: 'ready' as 'pending' | 'ready',
  ids: ['ask', 'run', 'done', 'idle'],
  byId: {
    ask: { displayTitle: '等回答', cwd: '/w/dsh-remote-control', running: false, blank: false, updatedAt: 3 },
    run: { displayTitle: '运行中', cwd: '/w/dsh-remote-control-01', running: true, blank: false, updatedAt: 2 },
    done: { displayTitle: '完成了', cwd: '/w/dsh-remote-control', running: false, blank: false, updatedAt: 1 },
    idle: { displayTitle: '空闲', cwd: '/w/x', running: false, blank: false, updatedAt: 9 },
  },
}
const statuses = new Map<string, {
  running: boolean | undefined
  pendingInteraction: { kind: string } | undefined
  completionUnread: boolean
}>([
  ['ask', { running: undefined, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
  ['done', { running: false, pendingInteraction: undefined, completionUnread: true }],
])
const workspaces = { phase: 'ready' as 'pending' | 'ready', archivedSessionIds: [] as string[], pinnedSessionIds: [] as string[] }

let root: Root
let mount: HTMLElement
let opened: string[]
let asked: string[][]
let calls: unknown[][]
let fail: Partial<Record<string, unknown>>
let proxy: HTMLStyleElement

/** The shell's sidebar column, with New Session between the logo row and the panel list. */
function column(): HTMLElement {
  const col = document.createElement('div')
  col.className = 'ui_layout__sidebarCol__h1'
  col.innerHTML = '<div class="ui_sidebar__root__h1"><div class="ui_sidebar__logoRow__h1"></div>'
    + '<button class="ui_sidebar__newSession__h1">新会话</button><nav class="ui_sidebar__panelList__h1"></nav></div>'
  document.body.append(col)
  return col
}

function setNarrow(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches,
      addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

function render(
  sessions: typeof list = list,
  marks: Record<string, { harness: string; running?: boolean; delegated?: boolean }> = {},
  snapshot: typeof statuses = statuses,
  workspaceSnapshot: typeof workspaces = workspaces,
): void {
  act(() => {
    root.render(createElement(AgentBoard as never, {
      t: (key: string, params?: { n?: number }) => params?.n === undefined ? key : `${key}:${params.n}`,
      useSessions: (select: (value: typeof list) => unknown) => select(sessions),
      useSessionStatus: (select: (value: typeof statuses) => unknown) => select(snapshot),
      useWorkspaces: (select: (value: typeof workspaces) => unknown) => select(workspaceSnapshot),
      openSession: (id: string) => {
        opened.push(id)
      },
      ...Object.fromEntries(['pinSession', 'unpinSession', 'renameSession', 'forkSession', 'archiveSession'].map(name =>
        [name, async (...args: unknown[]) => {
          calls.push([name, ...args])
          const reason = fail[name]
          if (reason !== undefined) { delete fail[name]; throw reason }
        }])),
      harnesses: async (ids: string[]) => {
        asked.push(ids)
        return Object.fromEntries(ids.flatMap(id => marks[id] ? [[id, { running: false, ...marks[id] }]] : []))
      },
    }))
  })
}

function host(): HTMLElement | null {
  return document.querySelector(`[${AGENTS_ATTRIBUTE}]`)
}

function click(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) throw new Error('missing element')
  act(() => { element.click() })
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  setNarrow(true)
  opened = []
  asked = []
  calls = []
  fail = {}
  mount = document.createElement('div')
  document.body.append(mount)
  root = createRoot(mount)
})

it('keeps read completions in inline history after remounting', () => {
  column()
  render()
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(host()?.querySelector('.rc-agents-history')).toBeNull()

  const read = new Map(statuses)
  read.set('done', { running: false, pendingInteraction: undefined, completionUnread: false })
  render(list, {}, read)
  expect(host()?.querySelector('.rc-agents-tile[data-state="done"]')?.textContent).toBe('agents.done0')
  expect(host()?.querySelector('.rc-agents-history h3')?.textContent).toBe('agents.history')
  expect(host()?.querySelector('.rc-agents-history .rc-agents-title')?.textContent).toBe('完成了')

  act(() => { root.unmount() })
  root = createRoot(mount)
  render(list, {}, read)
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(host()?.querySelector('.rc-agents-history .rc-agents-title')?.textContent).toBe('完成了')
  click(host()?.querySelector('.rc-agents-history [data-remote-control-pick]'))
  expect(opened).toEqual(['done'])
})

it('does not re-remind a completion watched from inside the Session, but keeps it in history', async () => {
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.setAttribute('data-sidebar-collapsed', '')
  document.body.append(frame)
  frame.append(column())
  const sessions = { ...list, ids: ['run'] }
  const running = new Map([['run', { running: true, pendingInteraction: undefined, completionUnread: false }]])
  render(sessions, {}, running)
  const finished = { ...sessions, byId: { ...sessions.byId, run: { ...sessions.byId.run, running: false, updatedAt: 10 } } }
  // The host acknowledges the completion immediately: the user is watching the Session.
  const stopped = new Map([['run', { running: false, pendingInteraction: undefined, completionUnread: false }]])
  render(finished, {}, stopped)
  frame.removeAttribute('data-sidebar-collapsed')
  await act(async () => { await Promise.resolve() })
  expect(host()?.querySelector('.rc-agents-tile[data-state="done"]')?.textContent).toBe('agents.done0')
  expect(host()?.querySelectorAll('[data-remote-control-pick]')).toHaveLength(0)
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(host()?.querySelector('.rc-agents-empty')).toBeNull()
  expect(host()?.querySelector('.rc-agents-history .rc-agents-title')?.textContent).toBe('运行中')
  click(host()?.querySelector('.rc-agents-history [data-remote-control-pick]'))
  expect(opened).toEqual(['run'])
})

it('still reminds of a completion that happened while the user was elsewhere', async () => {
  column()
  const sessions = { ...list, ids: ['run'], byId: { ...list.byId, run: { ...list.byId.run, running: false, updatedAt: 10 } } }
  const running = new Map([['run', { running: true, pendingInteraction: undefined, completionUnread: false }]])
  // The user never opened this Session, so the host keeps its completion unread.
  const stopped = new Map([['run', { running: false, pendingInteraction: undefined, completionUnread: true }]])
  render(sessions, {}, running)
  render(sessions, {}, stopped)
  await act(async () => { await Promise.resolve() })
  expect(host()?.querySelector('.rc-agents-tile[data-state="done"]')?.textContent).toBe('agents.done1')
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(host()?.querySelector('.rc-agents-title')?.textContent).toBe('运行中')
  click(host()?.querySelector('[data-remote-control-pick]'))
  expect(opened).toEqual(['run'])
  // Opening the Session is what clears the host's unread completion.
  const read = new Map([['run', { running: false, pendingInteraction: undefined, completionUnread: false }]])
  render(sessions, {}, read)
  expect(host()?.querySelector('.rc-agents-tile[data-state="done"]')?.textContent).toBe('agents.done0')
  expect(host()?.querySelector('.rc-agents-history .rc-agents-title')?.textContent).toBe('运行中')
})

it('restores the Harness icon for a completed history row', async () => {
  localStorage.setItem('dsh-remote-control.agent-history.v1', JSON.stringify([{ id: 'done', completedAt: 1 }]))
  column()
  const read = new Map(statuses)
  read.set('done', { running: false, pendingInteraction: undefined, completionUnread: false })
  render(list, { done: { harness: 'codex' } }, read)
  await act(async () => { await Promise.resolve() })
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect((host()?.querySelector('.rc-agents-history [data-remote-control-pick]') as HTMLElement).dataset.hpHarness).toBe('codex')
})

it('removes archived Sessions from card counts, rows and saved history', () => {
  column()
  render()
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  const archived = { ...workspaces, archivedSessionIds: ['ask', 'run', 'done'] }
  render(list, {}, statuses, archived)
  expect([...host()!.querySelectorAll('.rc-agents-card .rc-agents-tile')].map(tile => tile.textContent))
    .toEqual(['agents.pending0', 'agents.running0', 'agents.done0', 'agents.resident0'])
  expect(host()?.querySelectorAll('[data-remote-control-pick]')).toHaveLength(0)
  expect(JSON.parse(localStorage.getItem('dsh-remote-control.agent-history.v1') ?? '[]')).toEqual([])
})

it('clears archived read history and keeps other completions after remounting', () => {
  const kept = { id: 'idle', completedAt: 9 }
  localStorage.setItem('dsh-remote-control.agent-history.v1', JSON.stringify([{ id: 'done', completedAt: 1 }, kept]))
  column()
  const read = new Map(statuses)
  read.set('done', { running: false, pendingInteraction: undefined, completionUnread: false })
  render(list, {}, read)
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(host()?.querySelectorAll('.rc-agents-history .rc-agents-title')).toHaveLength(2)
  const archived = { ...workspaces, archivedSessionIds: ['done'] }
  render(list, {}, read, archived)
  expect([...host()!.querySelectorAll('.rc-agents-history .rc-agents-title')].map(row => row.textContent)).toEqual(['空闲'])
  expect(JSON.parse(localStorage.getItem('dsh-remote-control.agent-history.v1') ?? '[]')).toEqual([kept])
  act(() => { root.unmount() })
  root = createRoot(mount)
  render(list, {}, read, archived)
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect([...host()!.querySelectorAll('.rc-agents-history .rc-agents-title')].map(row => row.textContent)).toEqual(['空闲'])
})

it('preserves saved history until the Workspace archive list is ready', () => {
  const entry = { id: 'done', completedAt: 1 }
  localStorage.setItem('dsh-remote-control.agent-history.v1', JSON.stringify([entry]))
  column()
  const read = new Map(statuses)
  read.set('done', { running: false, pendingInteraction: undefined, completionUnread: false })
  render({ ...list, ids: [] }, {}, read, { ...workspaces, phase: 'pending' })
  expect(JSON.parse(localStorage.getItem('dsh-remote-control.agent-history.v1') ?? '[]')).toEqual([entry])
  render(list, {}, read, { ...workspaces, archivedSessionIds: ['done'] })
  expect(JSON.parse(localStorage.getItem('dsh-remote-control.agent-history.v1') ?? '[]')).toEqual([])
})

it('does not erase saved history while the Session list is loading', () => {
  const entry = { id: 'done', completedAt: 1 }
  localStorage.setItem('dsh-remote-control.agent-history.v1', JSON.stringify([entry]))
  column()
  render({ ...list, phase: 'pending', ids: [] })
  expect(JSON.parse(localStorage.getItem('dsh-remote-control.agent-history.v1') ?? '[]')).toEqual([entry])

  const read = new Map(statuses)
  read.set('done', { running: false, pendingInteraction: undefined, completionUnread: false })
  render(list, {}, read)
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(host()?.querySelector('.rc-agents-history .rc-agents-title')?.textContent).toBe('完成了')
})

afterEach(() => {
  act(() => { root.unmount() })
  proxy.remove()
  setNarrow(false)
})

it('defaults to running details below four tiles without a view-all entry or overlay', () => {
  column()
  render()
  const card = host()
  expect(card?.previousElementSibling?.textContent).toBe('新会话')
  expect(card?.nextElementSibling?.tagName).toBe('NAV')
  expect([...card!.querySelectorAll('.rc-agents-tile')].map(tile => tile.textContent))
    .toEqual(['agents.pending1', 'agents.running1', 'agents.done1', 'agents.resident0'])
  expect(card?.querySelector('.rc-agents-head')?.tagName).toBe('DIV')
  expect(card?.textContent).not.toContain('agents.viewAll')
  expect(card?.querySelector('[data-state="all"]')).toBeNull()
  expect(card?.querySelector('[role="dialog"]')).toBeNull()
  expect(card?.querySelector('.rc-agents-board')).toBeNull()
  expect(card?.querySelector('[aria-pressed="true"]')?.getAttribute('data-state')).toBe('running')
  const details = card!.querySelector('.rc-agents-list')!
  expect(details.previousElementSibling?.className).toBe('rc-agents-tiles')
  expect([...details.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['运行中'])
})

it('switches details inline and opens the chosen Session without navigating on a tile tap', () => {
  column()
  render()
  click(host()?.querySelector('.rc-agents-tile[data-state="pending"]'))
  expect(host()?.querySelector('[role="dialog"]')).toBeNull()
  expect(host()?.querySelectorAll('.rc-agents-tile')).toHaveLength(4)
  expect(host()?.querySelector('[aria-pressed="true"]')?.getAttribute('data-state')).toBe('pending')
  expect([...host()!.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['等回答'])
  expect(host()?.querySelector('.rc-agents-meta')?.textContent).toBe('agents.pending.approval · dsh-remote-control')
  expect(opened).toEqual([])
  expect(host()?.querySelector('.rc-agents-tile')?.hasAttribute('data-remote-control-pick')).toBe(false)
  click(host()?.querySelector('[data-remote-control-pick]'))
  expect(opened).toEqual(['ask'])
  click(host()?.querySelector('.rc-agents-tile[data-state="running"]'))
  expect([...host()!.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['运行中'])
})

it('shows all selected rows rather than limiting details to three previews', () => {
  column()
  const sessions = { ...list, ids: [...list.ids, 'run2', 'run3', 'run4'], byId: {
    ...list.byId,
    run2: { ...list.byId.run, displayTitle: '运行 2', updatedAt: 4 },
    run3: { ...list.byId.run, displayTitle: '运行 3', updatedAt: 5 },
    run4: { ...list.byId.run, displayTitle: '运行 4', updatedAt: 6 },
  } }
  render(sessions)
  expect([...host()!.querySelectorAll('.rc-agents-title')].map(row => row.textContent))
    .toEqual(['运行 4', '运行 3', '运行 2', '运行中'])
})

it.each(['pending', 'running', 'done'] as const)('keeps more than five %s rows in a five-row scrollport', async (state) => {
  column()
  const ids = Array.from({ length: 7 }, (_, index) => `session${index}`)
  const sessions = { ...list, ids, byId: { ...list.byId, ...Object.fromEntries(ids.map((id, index) =>
    [id, { ...list.byId.idle, displayTitle: id, updatedAt: index }])) } }
  const snapshot = new Map(ids.map(id => [id, {
    running: state === 'running',
    pendingInteraction: state === 'pending' ? { kind: 'question' } : undefined,
    completionUnread: state === 'done',
  }]))
  render(sessions, {}, snapshot)
  await act(async () => { await Promise.resolve() })
  click(host()?.querySelector(`.rc-agents-tile[data-state="${state}"]`))
  const scroller = host()!.querySelector('.rc-agents-group > div')!
  expect(scroller.querySelectorAll('.rc-agents-row')).toHaveLength(7)
  expect(getComputedStyle(scroller).maxHeight).toBe('248px')
  expect(getComputedStyle(scroller).overflowY).toBe('auto')
  expect(getComputedStyle(scroller.firstElementChild!).height).toBe('48px')
  click(scroller.lastElementChild?.querySelector('[data-remote-control-pick]'))
  expect(opened).toEqual(['session0'])
})

it('restores and opens saved history beyond the first five rows', async () => {
  const ids = Array.from({ length: 7 }, (_, index) => `session${index}`)
  const entries = ids.map((id, index) => ({ id, completedAt: 7 - index }))
  localStorage.setItem('dsh-remote-control.agent-history.v1', JSON.stringify(entries))
  column()
  const sessions = { ...list, ids, byId: { ...list.byId, ...Object.fromEntries(ids.map(id =>
    [id, { ...list.byId.idle, displayTitle: id }])) } }
  render(sessions, {}, new Map())
  await act(async () => { await Promise.resolve() })
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  const scroller = host()!.querySelector('.rc-agents-history > div')!
  expect(scroller.querySelectorAll('.rc-agents-row')).toHaveLength(7)
  expect(JSON.parse(localStorage.getItem('dsh-remote-control.agent-history.v1') ?? '[]')).toEqual(entries)
  click(scroller.lastElementChild?.querySelector('[data-remote-control-pick]'))
  expect(opened).toEqual(['session6'])
})

it('shows unread completions and read history only under the completed tile', () => {
  localStorage.setItem('dsh-remote-control.agent-history.v1', JSON.stringify([{ id: 'idle', completedAt: 9 }]))
  column()
  render()
  expect(host()?.querySelector('.rc-agents-history')).toBeNull()
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect([...host()!.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['完成了', '空闲'])
  expect(host()?.querySelector('.rc-agents-history .rc-agents-title')?.textContent).toBe('空闲')
  click(host()?.querySelector('.rc-agents-tile[data-state="pending"]'))
  expect(host()?.querySelector('.rc-agents-history')).toBeNull()
  expect([...host()!.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['等回答'])
})

it('shows an empty message for the selected group without falling back to other groups', () => {
  column()
  render({ ...list, ids: ['idle'] })
  for (const state of ['running', 'pending', 'done', 'resident']) {
    click(host()?.querySelector(`.rc-agents-tile[data-state="${state}"]`))
    expect(host()?.querySelector('.rc-agents-empty')?.textContent).toBe(`agents.empty.${state}`)
    expect(host()?.querySelectorAll('[data-remote-control-pick]')).toHaveLength(0)
    expect(host()?.querySelector('[role="dialog"]')).toBeNull()
  }
})

it('follows the column when the shell rebuilds it, and leaves with the component', async () => {
  render()
  expect(host()).toBeNull()
  column()
  await act(async () => { await Promise.resolve() })
  expect(host()?.previousElementSibling?.textContent).toBe('新会话')
  document.querySelector('.ui_layout__sidebarCol__h1')?.remove()
  column()
  await act(async () => { await Promise.resolve() })
  expect(host()?.isConnected).toBe(true)
  expect(host()?.querySelector('.rc-agents-card')).not.toBeNull()
  act(() => { root.unmount() })
  expect(host()).toBeNull()
  root = createRoot(mount)
})

it('turns the running spinner only while a Session runs', () => {
  column()
  const running = () => host()?.querySelector('.rc-agents-tile[data-state="running"] [data-state]')?.getAttribute('data-state')
  render()
  expect(running()).toBe('ongoing')
  render({ ...list, ids: ['ask', 'done', 'idle'] })
  expect(host()?.querySelector('.rc-agents-tile[data-state="running"]')?.textContent).toBe('agents.running0')
  expect(running()).toBe('idle')
  expect(host()?.querySelectorAll('[data-remote-control-pick]')).toHaveLength(0)
  expect(host()?.querySelector('.rc-agents-empty')?.textContent).toBe('agents.empty.running')
})

it('leads a row with its harness logo, breathing while it runs', async () => {
  column()
  render(list, { run: { harness: 'claude-code' }, done: { harness: 'codex' } })
  await act(async () => { await Promise.resolve() })
  const row = (title: string) => [...host()!.querySelectorAll<HTMLElement>('[data-remote-control-pick]')]
    .find(item => item.querySelector('.rc-agents-title')?.textContent === title)!
  expect(row('运行中').dataset.hpHarness).toBe('claude-code')
  expect(row('运行中').hasAttribute('data-hp-running')).toBe(true)
  expect(row('运行中').firstElementChild?.children).toHaveLength(0)
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(row('完成了').dataset.hpHarness).toBe('codex')
  expect(row('完成了').hasAttribute('data-hp-running')).toBe(false)
  // No harness known: the status dot stays.
  click(host()?.querySelector('.rc-agents-tile[data-state="pending"]'))
  expect(row('等回答').hasAttribute('data-hp-harness')).toBe(false)
  expect(row('等回答').firstElementChild?.querySelector('[data-state="warning"]')).not.toBeNull()
})

it('marks delegated Sessions so harness-provider badges their logo', async () => {
  column()
  render(list, { run: { harness: 'codex', delegated: true }, done: { harness: 'claude-code', delegated: false } })
  await act(async () => { await Promise.resolve() })
  const row = (title: string) => [...host()!.querySelectorAll<HTMLElement>('[data-remote-control-pick]')]
    .find(item => item.querySelector('.rc-agents-title')?.textContent === title)!
  expect(row('运行中').hasAttribute('data-hp-delegated')).toBe(true)
  // The badge is drawn into the empty leading cell.
  expect(row('运行中').firstElementChild?.innerHTML).toBe('')
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  expect(row('完成了').hasAttribute('data-hp-delegated')).toBe(false)
})

it('stays out of frames that did not come through the proxy', () => {
  column()
  proxy.remove()
  render()
  expect(host()).toBeNull()
})

it('lists idle Codex and Claude Code Sessions whose process is still alive under the unreleased tile', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    column()
    const marks: Record<string, { harness: string; running: boolean }> = {
      ask: { harness: 'codex', running: true },
      run: { harness: 'claude-code', running: true },
      done: { harness: 'claude-code', running: true },
      idle: { harness: 'codex', running: true },
    }
    render(list, marks)
    await act(async () => { await Promise.resolve() })
    // Every listed Session is asked, not only the rows already on the board.
    expect(asked[0]).toEqual(['ask', 'run', 'done', 'idle'])
    const tile = host()?.querySelector('.rc-agents-tile[data-state="resident"]')
    expect(tile?.textContent).toBe('agents.resident2')
    click(tile)
    const rows = [...host()!.querySelectorAll<HTMLElement>('[data-remote-control-pick]')]
    expect(rows.map(row => row.querySelector('.rc-agents-title')?.textContent)).toEqual(['空闲', '完成了'])
    expect(rows[0]?.dataset.hpHarness).toBe('codex')
    expect(rows[0]?.hasAttribute('data-hp-running')).toBe(false)
    expect(rows[0]?.querySelector('.rc-agents-meta')?.textContent).toBe('agents.resident · x')
    click(rows[0])
    expect(opened).toEqual(['idle'])

    // A reclaimed process leaves the tile on the next refresh.
    marks.idle = { harness: 'codex', running: false }
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(asked.length).toBeGreaterThan(1)
    expect(host()?.querySelector('.rc-agents-tile[data-state="resident"]')?.textContent).toBe('agents.resident1')
    expect([...host()!.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['完成了'])
  } finally {
    vi.useRealTimers()
  }
})

it('asks harness marks in batches the Remote call accepts', async () => {
  column()
  const ids = Array.from({ length: 1001 }, (_, index) => `s${index}`)
  const sessions = { ...list, ids, byId: { ...list.byId, ...Object.fromEntries(ids.map(id => [id, { ...list.byId.idle, displayTitle: id }])) } }
  render(sessions, {}, new Map())
  await act(async () => { await Promise.resolve() })
  expect(asked.map(batch => batch.length)).toEqual([1000, 1])
})

function openMenu(title: string): void {
  const item = [...host()!.querySelectorAll('.rc-agents-item')]
    .find(element => element.querySelector('.rc-agents-title')?.textContent === title)
  click(item?.querySelector('.rc-agents-more'))
}

function menuLabels(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim() ?? '')
}

function pickMenu(label: string): void {
  click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent?.trim() === label))
}

function dialogButton(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(button => button.textContent === label)
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

it('opens a row menu from its trailing button without opening the Session, then pins or unpins it', () => {
  column()
  render()
  openMenu('运行中')
  expect(opened).toEqual([])
  expect(host()?.querySelector('.rc-agents-more')?.hasAttribute('data-remote-control-pick')).toBe(false)
  expect(menuLabels()).toEqual([
    'agents.menu.pin', 'agents.menu.rename', 'agents.menu.fork', 'agents.menu.archive', 'agents.menu.copyId',
  ])
  pickMenu('agents.menu.pin')
  expect(calls).toEqual([['pinSession', 'run']])
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0)

  render(list, {}, statuses, { ...workspaces, pinnedSessionIds: ['run'] })
  openMenu('运行中')
  expect(menuLabels()[0]).toBe('agents.menu.unpin')
  pickMenu('agents.menu.unpin')
  expect(calls.at(-1)).toEqual(['unpinSession', 'run'])
})

it('renames a Session from a dialog seeded with its title, keeping the dialog on failure', async () => {
  column()
  render()
  openMenu('运行中')
  pickMenu('agents.menu.rename')
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
  expect(input.value).toBe('运行中')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  新标题 ')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  fail.renameSession = new Error('host down')
  click(dialogButton('agents.rename.confirm'))
  await settle()
  expect(calls).toEqual([['renameSession', 'run', '新标题']])
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('host down')
  click(dialogButton('agents.rename.confirm'))
  await settle()
  expect(calls).toHaveLength(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('archives a quiet Session directly and asks before stopping a running one', async () => {
  column()
  render()
  click(host()?.querySelector('.rc-agents-tile[data-state="done"]'))
  openMenu('完成了')
  pickMenu('agents.menu.archive')
  await settle()
  expect(calls).toEqual([['archiveSession', 'done']])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).toContain('agents.toast.archived')

  click(host()?.querySelector('.rc-agents-tile[data-state="running"]'))
  fail.archiveSession = Object.assign(new Error('active'), {
    name: 'WorkspaceArchiveError', rpcError: { code: 'workspace/session-active', details: { activity: [{ kind: 'turn' }] } },
  })
  openMenu('运行中')
  pickMenu('agents.menu.archive')
  await settle()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('agents.archive.title')
  click(dialogButton('agents.archive.confirm'))
  await settle()
  expect(calls.at(-1)).toEqual(['archiveSession', 'run', { stopActivity: true }])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('forks a Session and reports a failed fork', async () => {
  column()
  render()
  openMenu('运行中')
  pickMenu('agents.menu.fork')
  await settle()
  expect(calls).toEqual([['forkSession', 'run']])
  expect(document.body.textContent).toContain('agents.toast.forked')
  fail.forkSession = new Error('migration required')
  openMenu('运行中')
  pickMenu('agents.menu.fork')
  await settle()
  expect(document.body.textContent).toContain('agents.toast.failed')
})

it('copies the Session ID', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    column()
    render()
    openMenu('运行中')
    pickMenu('agents.menu.copyId')
    await settle()
    expect(writeText).toHaveBeenCalledWith('run')
    expect(document.body.textContent).toContain('agents.toast.copied')
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})
