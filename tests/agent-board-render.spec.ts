// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AGENTS_ATTRIBUTE, AgentBoard } from '../dist/client/AgentBoard.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const list = {
  ids: ['ask', 'run', 'done', 'idle'],
  byId: {
    ask: { displayTitle: '等回答', cwd: '/w/dsh-remote-control', running: false, blank: false, updatedAt: 3 },
    run: { displayTitle: '运行中', cwd: '/w/dsh-remote-control-01', running: true, blank: false, updatedAt: 2 },
    done: { displayTitle: '完成了', cwd: '/w/dsh-remote-control', running: false, blank: false, updatedAt: 1 },
    idle: { displayTitle: '空闲', cwd: '/w/x', running: false, blank: false, updatedAt: 9 },
  },
}
const statuses = new Map([
  ['ask', { running: undefined, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
  ['done', { running: false, pendingInteraction: undefined, completionUnread: true }],
])

let root: Root
let mount: HTMLElement
let opened: string[]
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
    value: () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

function render(sessions: typeof list = list, marks: Record<string, { harness: string }> = {}): void {
  act(() => {
    root.render(createElement(AgentBoard as never, {
      t: (key: string, params?: { n?: number }) => params?.n === undefined ? key : `${key}:${params.n}`,
      useSessions: (select: (value: typeof list) => unknown) => select(sessions),
      useSessionStatus: (select: (value: typeof statuses) => unknown) => select(statuses),
      openSession: (id: string) => { opened.push(id) },
      harnesses: async () => marks,
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
  proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  setNarrow(true)
  opened = []
  mount = document.createElement('div')
  document.body.append(mount)
  root = createRoot(mount)
})

afterEach(() => {
  act(() => { root.unmount() })
  proxy.remove()
  setNarrow(false)
})

it('puts the Agent card in New Session\'s seat with the group counts and a preview', () => {
  column()
  render()
  const card = host()
  expect(card?.previousElementSibling?.textContent).toBe('新会话')
  expect(card?.nextElementSibling?.tagName).toBe('NAV')
  const tiles = [...card!.querySelectorAll('.rc-agents-tile')].map(tile => tile.textContent)
  expect(tiles).toEqual(['agents.pending1', 'agents.running1', 'agents.done1'])
  // Idle Sessions stay off; the preview leads with the one waiting for the user.
  const rows = [...card!.querySelectorAll('[data-remote-control-pick] .rc-agents-title')].map(row => row.textContent)
  expect(rows).toEqual(['等回答', '运行中', '完成了'])
  expect(card!.querySelector('.rc-agents-meta')?.textContent).toBe('agents.pending.approval · dsh-remote-control')
})

it('opens the board on one group and opens a Session from it', () => {
  column()
  render()
  click(host()?.querySelector('.rc-agents-tile[data-state="running"]'))
  const board = host()?.querySelector('[role="dialog"]')
  expect(board).not.toBeNull()
  expect([...board!.querySelectorAll('.rc-agents-title')].map(row => row.textContent)).toEqual(['运行中'])
  expect(board!.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-state')).toBe('running')
  // Every group at once.
  click(board!.querySelector('[role="tab"][data-state="all"]'))
  expect(board!.querySelectorAll('.rc-agents-group')).toHaveLength(3)
  // A row opens its Session and puts the board away.
  click(board!.querySelector('.rc-agents-group [data-remote-control-pick]'))
  expect(opened).toEqual(['ask'])
  expect(host()?.querySelector('[role="dialog"]')).toBeNull()
})

it('goes back from the board to the card', () => {
  column()
  render()
  click(host()?.querySelector('.rc-agents-head'))
  click(host()?.querySelector('.rc-agents-back'))
  expect(host()?.querySelector('[role="dialog"]')).toBeNull()
  expect(opened).toEqual([])
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
})

it('leads a row with its harness logo, breathing while it runs', async () => {
  column()
  render(list, { run: { harness: 'claude-code' }, done: { harness: 'codex' } })
  await act(async () => { await Promise.resolve() })
  const row = (title: string) => [...host()!.querySelectorAll<HTMLElement>('[data-remote-control-pick]')]
    .find(item => item.querySelector('.rc-agents-title')?.textContent === title)!
  expect(row('运行中').dataset.hpHarness).toBe('claude-code')
  expect(row('运行中').hasAttribute('data-hp-running')).toBe(true)
  expect(row('完成了').dataset.hpHarness).toBe('codex')
  expect(row('完成了').hasAttribute('data-hp-running')).toBe(false)
  // harness-provider's sheet draws the logo into the lead span, so the status dot steps aside.
  expect(row('运行中').firstElementChild?.children).toHaveLength(0)
  // No harness known: the status dot stays.
  expect(row('等回答').hasAttribute('data-hp-harness')).toBe(false)
  expect(row('等回答').firstElementChild?.querySelector('[data-state="warning"]')).not.toBeNull()
})

it('stays out of frames that did not come through the proxy', () => {
  column()
  proxy.remove()
  render()
  expect(host()).toBeNull()
})
