/**
 * The drawer's Agent board rows, sorted out of the Session list and the unified Session status.
 *
 * A Session is on the live board while it needs the user (a pending interaction), while it runs,
 * or once it stopped and nobody has looked at it yet (the host's completion reminder). The
 * precedence is the Workspace browser's own: a pending interaction
 * outranks activity, which outranks the completion reminder. Like that browser, the board skips
 * subagent children and blank Sessions.
 */

/** Board groups, in the order the board shows them. */
export const AGENT_STATES = ['pending', 'running', 'done'] as const

/** Which board group a Session is in. */
export type AgentState = typeof AGENT_STATES[number]

/** Pending interactions the Workspace browser shows; other domains' kinds stay off the board. */
export type PendingKind = 'approval' | 'plan-review' | 'question'

/** The Session list facts the board reads (a structural subset of the host's summary). */
interface SummaryFacts {
  displayTitle: string
  cwd?: string | undefined
  running: boolean
  blank: boolean
  updatedAt: number
  origin?: 'subagent' | undefined
}

/** The Session status facts the board reads (a structural subset of the host's status). */
interface StatusFacts {
  running: boolean | undefined
  pendingInteraction: { kind: string } | undefined
  completionUnread: boolean
}

/** One Session on the board. */
export interface AgentRow<Id extends string = string> {
  id: Id
  title: string
  /** Last path segment of the Session's directory; empty when it has none. */
  workspace: string
  updatedAt: number
  state: AgentState
  pending?: PendingKind
}

/** One recently completed Session, kept after its unread reminder is cleared. */
export interface CompletionRecord<Id extends string = string> {
  id: Id
  completedAt: number
}

function pendingKind(kind: string | undefined): PendingKind | undefined {
  return kind === 'approval' || kind === 'plan-review' || kind === 'question' ? kind : undefined
}

function basename(path: string | undefined): string {
  return path?.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/**
 * Pick the board's Sessions.
 * @param list - Session list: `ids` is Host-list membership, `byId` the rows.
 * @param statuses - unified Session status by identity.
 * @returns board rows by group order, most recently updated first within a group.
 */
export function agentRows<Id extends string>(
  list: { readonly ids: readonly Id[]; readonly byId: Readonly<Record<Id, SummaryFacts>> },
  statuses: ReadonlyMap<Id, StatusFacts>,
): AgentRow<Id>[] {
  const rows: AgentRow<Id>[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary.origin === 'subagent' || summary.blank) continue
    const status = statuses.get(id)
    const pending = pendingKind(status?.pendingInteraction?.kind)
    const state: AgentState | undefined = pending !== undefined ? 'pending'
      : (status?.running ?? summary.running) ? 'running'
        : status?.completionUnread === true ? 'done'
          : undefined
    if (state === undefined) continue
    rows.push({
      id, title: summary.displayTitle, workspace: basename(summary.cwd), updatedAt: summary.updatedAt, state,
      ...(pending === undefined ? {} : { pending }),
    })
  }
  return rows.sort((a, b) => AGENT_STATES.indexOf(a.state) - AGENT_STATES.indexOf(b.state)
    || b.updatedAt - a.updatedAt)
}

/** Keep actual completions newest first, including those already being viewed. */
export function completionHistory<Id extends string>(
  list: { readonly ids: readonly Id[]; readonly byId: Readonly<Record<Id, SummaryFacts>> },
  statuses: ReadonlyMap<Id, StatusFacts>,
  previous: ReadonlyMap<Id, StatusFacts> | undefined,
  history: readonly CompletionRecord<Id>[],
): CompletionRecord<Id>[] {
  const entries = new Map(history.filter(entry => list.ids.includes(entry.id)).map(entry => [entry.id, entry]))
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary.origin === 'subagent' || summary.blank) continue
    const current = statuses.get(id)
    if (current === undefined || pendingKind(current.pendingInteraction?.kind) !== undefined) continue
    const before = previous?.get(id)
    if ((before?.running === true && current.running === false)
      || (current.completionUnread && before?.completionUnread !== true)) {
      entries.set(id, { id, completedAt: summary.updatedAt })
    }
  }
  return [...entries.values()].sort((a, b) => b.completedAt - a.completedAt)
}

/** Read completed rows stay separate from the live unread-completion group. */
export function historyRows<Id extends string>(
  list: { readonly ids: readonly Id[]; readonly byId: Readonly<Record<Id, SummaryFacts>> },
  statuses: ReadonlyMap<Id, StatusFacts>,
  history: readonly CompletionRecord<Id>[],
): AgentRow<Id>[] {
  return history.flatMap(({ id, completedAt }) => {
    const summary = list.byId[id]
    const status = statuses.get(id)
    if (!list.ids.includes(id) || summary === undefined || summary.origin === 'subagent' || summary.blank
      || status?.completionUnread || status?.pendingInteraction || (status?.running ?? summary.running)) return []
    return [{ id, title: summary.displayTitle, workspace: basename(summary.cwd), updatedAt: completedAt, state: 'done' as const }]
  })
}
