import { expect, it } from 'vitest'
import { agentRows, completionHistory } from '../dist/client/agent-board.js'

interface Summary {
  displayTitle: string
  cwd?: string
  running: boolean
  blank: boolean
  updatedAt: number
  origin?: 'subagent'
}

interface Status {
  running: boolean | undefined
  pendingInteraction: { kind: string } | undefined
  completionUnread: boolean
}

function summary(title: string, updatedAt: number, extra: Partial<Summary> = {}): Summary {
  return { displayTitle: title, cwd: '/Users/me/dsh-remote-control', running: false, blank: false, updatedAt, ...extra }
}

function status(extra: Partial<Status> = {}): Status {
  return { running: undefined, pendingInteraction: undefined, completionUnread: false, ...extra }
}

it('lists pending, running and unseen finished Sessions, each group newest first', () => {
  const byId: Record<string, Summary> = {
    idle: summary('空闲', 90),
    doneOld: summary('早完成', 10),
    doneNew: summary('刚完成', 30),
    run: summary('运行中', 20, { running: true }),
    ask: summary('等回答', 5),
  }
  const statuses = new Map<string, Status>([
    ['doneOld', status({ completionUnread: true })],
    ['doneNew', status({ completionUnread: true })],
    ['ask', status({ pendingInteraction: { kind: 'question' } })],
  ])
  const rows = agentRows({ ids: Object.keys(byId), byId }, statuses)
  expect(rows.map(row => [row.id, row.state])).toEqual([
    ['ask', 'pending'], ['run', 'running'], ['doneNew', 'done'], ['doneOld', 'done'],
  ])
  expect(rows[0]).toMatchObject({ title: '等回答', workspace: 'dsh-remote-control', updatedAt: 5, pending: 'question' })
  expect(rows[1]).not.toHaveProperty('pending')
})

// The Workspace browser's own precedence: a pending interaction outranks activity, which
// outranks the completion reminder; the live status outranks the list's running fact.
it('puts each Session in its highest-precedence group', () => {
  const byId: Record<string, Summary> = {
    a: summary('a', 1, { running: true }),
    b: summary('b', 2),
    c: summary('c', 3, { running: true }),
  }
  const statuses = new Map<string, Status>([
    ['a', status({ running: true, pendingInteraction: { kind: 'approval' }, completionUnread: true })],
    ['b', status({ running: true, completionUnread: true })],
    ['c', status({ running: false })],
  ])
  expect(agentRows({ ids: ['a', 'b', 'c'], byId }, statuses).map(row => [row.id, row.state])).toEqual([
    ['a', 'pending'], ['b', 'running'],
  ])
})

it('skips subagents, blank Sessions, rows outside the Host list and unknown pending kinds', () => {
  const byId: Record<string, Summary> = {
    child: summary('子 agent', 1, { running: true, origin: 'subagent' }),
    blank: summary('新会话', 2, { running: true, blank: true }),
    other: summary('其它领域', 3),
    gone: summary('不在列表', 4, { running: true }),
  }
  const statuses = new Map<string, Status>([['other', status({ pendingInteraction: { kind: 'custom' } })]])
  expect(agentRows({ ids: ['child', 'blank', 'other'], byId }, statuses)).toEqual([])
})

it('names the workspace by the last directory segment', () => {
  const byId: Record<string, Summary> = {
    posix: summary('p', 3, { running: true, cwd: '/a/b/proj/' }),
    windows: summary('w', 2, { running: true, cwd: 'C:\\work\\win-proj' }),
    none: { displayTitle: 'n', running: true, blank: false, updatedAt: 1 },
  }
  expect(agentRows({ ids: ['posix', 'windows', 'none'], byId }, new Map()).map(row => row.workspace))
    .toEqual(['proj', 'win-proj', ''])
})

it('retains the five newest completions after their unread reminders clear', () => {
  const byId = Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
    const id = `s${index + 1}`
    return [id, summary(id, index + 1)]
  }))
  const list = { ids: Object.keys(byId), byId }
  const unread = new Map(list.ids.map(id => [id, status({ running: false, completionUnread: id !== 's7' })]))
  const history = completionHistory(list, unread, undefined, [])
  expect(history.map(entry => entry.id)).toEqual(['s6', 's5', 's4', 's3', 's2'])
  const read = new Map(list.ids.map(id => [id, status({ running: false })]))
  expect(completionHistory(list, read, unread, history)).toEqual(history)

  const running = new Map(read)
  running.set('s7', status({ running: true }))
  const finished = new Map(read)
  expect(completionHistory(list, finished, running, history).map(entry => entry.id))
    .toEqual(['s7', 's6', 's5', 's4', 's3'])
  const awaiting = new Map(read)
  awaiting.set('s7', status({ running: false, pendingInteraction: { kind: 'approval' } }))
  expect(completionHistory(list, awaiting, running, history)).toEqual(history)
  expect(completionHistory({ ...list, ids: list.ids.filter(id => id !== 's6') }, read, undefined, history)
    .map(entry => entry.id)).not.toContain('s6')
})
