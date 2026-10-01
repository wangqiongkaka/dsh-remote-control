/**
 * The phone drawer's Agent board: a summary card in New Session's seat and a board over the whole
 * drawer, listing Sessions that wait for the user, run, or finished unseen. A row opens its Session.
 *
 * The sidebar shell declares no seat between New Session and its panel rows, so the card renders
 * through a portal into a host element placed right after that (phone-hidden, see drawer-style)
 * button, and is placed again whenever the shell rebuilds the column. Rows carry the drawer's
 * navigation-pick attribute, so SidebarDismiss folds the drawer on the same tap that opens the
 * Session.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, relativeTime, StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AGENT_STATES, agentRows, completionHistory, historyRows, type AgentRow, type AgentState, type CompletionRecord } from './agent-board.ts'
import { proxiedFrame, useNarrow } from './SidebarToggle.tsx'
import { DRAWER_PICK_ATTRIBUTE } from './SidebarDismiss.tsx'
import { NS } from './locales.ts'

/** Attribute on the card's host element in the sidebar column. */
export const AGENTS_ATTRIBUTE = 'data-remote-control-agents'

/** New Session in the sidebar column: the card takes the seat right after it. */
const ANCHOR = '[class*="_sidebarCol"] button[class*="_newSession"]'

/** How many Sessions the card previews. */
const PREVIEW = 3
const HISTORY_KEY = 'dsh-remote-control.agent-history.v1'

function savedHistory(): CompletionRecord<SessionId>[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is CompletionRecord<SessionId> =>
      typeof entry?.id === 'string' && typeof entry.completedAt === 'number' && Number.isFinite(entry.completedAt)).slice(0, 5)
  } catch { return [] }
}

/** Host commands passed through the slot injection face. */
export interface AgentBoardInjected {
  openSession: (sessionId: SessionId) => void
  /** Each Session's harness (dsh, codex, claude-code…); empty where harness-provider is absent. */
  harnesses: (sessionIds: SessionId[]) => Promise<Readonly<Record<string, { harness: string }>>>
}

/** The harness-provider Remote call the board reads harnesses from. */
export interface HarnessRemote {
  harnesses: (request: { sessionIds: string[] }) => Promise<
    { ok: true; value: Record<string, { harness: string }> } | { ok: false; error: { message: string } }>
}

/** Overlay props supplied by the slot renderer. */
export type AgentBoardProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<AgentBoardInjected>

type Translate = AgentBoardProps['t']

/** Which board view is open: every group, one group, or none (the card alone). */
type Filter = 'all' | AgentState | null

const DOT: Record<AgentState, StateDotState> = { pending: 'warning', running: 'ongoing', done: 'done' }

const STYLE = ''
  // The board covers the whole column, so the column is its containing block.
  + `div:has(> [${AGENTS_ATTRIBUTE}]){position:relative}`
  + `[${AGENTS_ATTRIBUTE}] button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;`
  + 'cursor:pointer;-webkit-tap-highlight-color:transparent}'
  + '.rc-agents-card{margin:4px 0 8px;padding:8px;border-radius:16px;'
  + 'box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3);display:flex;flex-direction:column;gap:6px}'
  + '.rc-agents-head{height:32px;display:flex;align-items:center;justify-content:space-between;padding:0 6px}'
  + '.rc-agents-head b{font-size:15px;font-weight:600}'
  + '.rc-agents-more{display:flex;align-items:center;gap:2px;font-size:13px;color:var(--dsw-alias-label-secondary)}'
  + '.rc-agents-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}'
  + '.rc-agents-board .rc-agents-tiles{grid-template-columns:repeat(4,minmax(0,1fr));padding:4px 0 12px}'
  + '.rc-agents-tile{height:60px;border-radius:12px;padding:8px 10px !important;box-sizing:border-box;display:flex;'
  + 'flex-direction:column;justify-content:space-between;background:var(--dsw-alias-interactive-bg-hover) !important}'
  + '.rc-agents-tile[aria-pressed="true"],.rc-agents-tile[aria-selected="true"]{box-shadow:inset 0 0 0 1.5px var(--dsw-alias-label-tertiary)}'
  + '.rc-agents-tile[data-state="pending"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent) !important}'
  + '.rc-agents-tile[data-state="done"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent) !important}'
  + '.rc-agents-tile span{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}'
  + '.rc-agents-tile b{font-size:20px;font-weight:700;line-height:24px}'
  + '.rc-agents-row{width:100%;min-height:48px;border-radius:10px;padding:6px 8px !important;box-sizing:border-box;'
  + 'display:flex;align-items:center;gap:10px}'
  + '.rc-agents-row:active{background:var(--dsw-alias-interactive-bg-active) !important}'
  + '.rc-agents-lead{width:16px;flex:none;display:flex;justify-content:center}'
  + '.rc-agents-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}'
  + '.rc-agents-title{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.rc-agents-meta{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.rc-agents-meta[data-state="pending"]{color:var(--dsw-alias-state-warn-primary)}'
  + '.rc-agents-time{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}'
  + '.rc-agents-empty{margin:0;padding:10px 6px;font-size:13px;color:var(--dsw-alias-label-secondary)}'
  + '.rc-agents-board{position:absolute;inset:0;z-index:5;background:var(--dsw-specific-sidebar-fill);'
  + 'display:flex;flex-direction:column;padding:6px 12px 0;box-sizing:border-box;'
  + 'animation:rc-agents-in var(--ds-transition-duration-slow,.3s) var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)) both}'
  + '.rc-agents-board[data-closing]{animation-name:rc-agents-out;pointer-events:none}'
  + '@keyframes rc-agents-in{from{transform:translateX(100%)}to{transform:translateX(0)}}'
  + '@keyframes rc-agents-out{from{transform:translateX(0)}to{transform:translateX(100%)}}'
  + '@media(prefers-reduced-motion:reduce){.rc-agents-board{animation:none}}'
  + '.rc-agents-bar{height:48px;display:flex;align-items:center;gap:4px;font-size:17px;font-weight:600}'
  + '.rc-agents-back{width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:10px}'
  + '.rc-agents-list{flex:1;overflow:auto;display:flex;flex-direction:column;gap:14px;padding-bottom:24px}'
  + '.rc-agents-group h3{margin:0 0 6px;padding:0 6px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;'
  + 'color:var(--dsw-alias-label-secondary)}'
  + '.rc-agents-group > div{padding:4px;border-radius:16px;box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}'

/**
 * Keep a host element right after New Session in the sidebar column while `active`.
 * @returns the placed host, or null while inactive or before the column exists.
 */
function useCardHost(active: boolean): HTMLElement | null {
  const [host] = useState(() => {
    const element = document.createElement('div')
    element.setAttribute(AGENTS_ATTRIBUTE, '')
    return element
  })
  const [placed, setPlaced] = useState(false)
  useEffect(() => {
    if (!active) return
    const place = (): void => {
      if (host.isConnected && host.previousElementSibling?.matches(ANCHOR) === true) return
      const anchor = document.querySelector(ANCHOR)
      if (anchor === null) host.remove()
      else anchor.after(host)
      setPlaced(anchor !== null)
    }
    place()
    const observer = new MutationObserver(place)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      host.remove()
      setPlaced(false)
    }
  }, [active, host])
  return active && placed ? host : null
}

/**
 * Look up each shown Session's harness once; a failed lookup is asked again with the next rows.
 * @returns harness by Session identity, as far as known.
 */
function useHarnesses(rows: readonly AgentRow<SessionId>[], lookup: AgentBoardInjected['harnesses']): ReadonlyMap<string, string> {
  const [known, setKnown] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [asked] = useState(() => new Set<string>())
  useEffect(() => {
    const missing = rows.map(row => row.id).filter(id => !asked.has(id))
    if (missing.length === 0) return
    for (const id of missing) asked.add(id)
    lookup(missing).then((marks) => {
      setKnown((previous) => {
        const next = new Map(previous)
        for (const [id, mark] of Object.entries(marks)) next.set(id, mark.harness)
        return next
      })
    }, () => { for (const id of missing) asked.delete(id) })
  }, [rows, lookup, asked])
  return known
}

/** A clock for relative times that ticks while the board is shown. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [active])
  return now
}

function timeLabel(at: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(at, now)
  return unit === 'now' ? t('agents.time.now') : t(`agents.time.${unit}`, { n })
}

function stateLabel(row: AgentRow<SessionId>, t: Translate): string {
  return row.pending === undefined ? t(`agents.${row.state}`) : t(`agents.pending.${row.pending}`)
}

function Row({ row, harness, now, t, open }: {
  row: AgentRow<SessionId>; harness: string | undefined; now: number; t: Translate; open: (id: SessionId) => void
}) {
  const meta = [stateLabel(row, t), row.workspace].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      className="rc-agents-row"
      // harness-provider's sidebar mark sheet draws the logo into the first span, breathing while it runs.
      data-hp-harness={harness}
      data-hp-running={harness !== undefined && row.state === 'running' ? '' : undefined}
      {...{ [DRAWER_PICK_ATTRIBUTE]: '' }}
      onClick={() => { open(row.id) }}
    >
      <span className="rc-agents-lead">{harness === undefined && <StateDot state={DOT[row.state]} />}</span>
      <span className="rc-agents-text">
        <span className="rc-agents-title">{row.title}</span>
        <span className="rc-agents-meta" data-state={row.state}>{meta}</span>
      </span>
      <span className="rc-agents-time">{timeLabel(row.updatedAt, now, t)}</span>
    </button>
  )
}

function Tile({ state, count, selected, role, t, pick }: {
  state: 'all' | AgentState; count: number; selected: boolean; role?: 'tab'; t: Translate; pick: () => void
}) {
  // The running spinner only turns while something runs; an empty tile rests on the idle dot.
  const dot = state === 'all' ? undefined : state === 'running' && count === 0 ? 'idle' : DOT[state]
  return (
    <button
      type="button"
      className="rc-agents-tile"
      data-state={state}
      role={role}
      {...(role === 'tab' ? { 'aria-selected': selected } : {})}
      onClick={pick}
    >
      <span>{dot !== undefined && <StateDot state={dot} size={dot === 'ongoing' ? 12 : 10} />}{t(`agents.${state}`)}</span>
      <b>{count}</b>
    </button>
  )
}

/**
 * Render the drawer's Agent card and board into the sidebar column.
 * @returns the portal, or null off a proxied narrow frame and before the column exists.
 */
export function AgentBoard(props: AgentBoardProps): React.JSX.Element | null {
  const { t, useSessions, useSessionStatus, useWorkspaces, openSession } = props
  const active = useNarrow() && proxiedFrame()
  const host = useCardHost(active)
  const now = useNow(host !== null)
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const list = useMemo(() => ({
    ...sessions,
    ids: sessions.ids.filter(id => !workspaces.archivedSessionIds.includes(id)),
  }), [sessions, workspaces.archivedSessionIds])
  const statuses = useSessionStatus(value => value)
  const rows = useMemo(() => agentRows(list, statuses), [list, statuses])
  const [history, setHistory] = useState(savedHistory)
  const previous = useRef<typeof statuses>()
  useEffect(() => {
    if (!active || list.phase !== 'ready' || workspaces.phase !== 'ready') { previous.current = undefined; return }
    const before = previous.current
    previous.current = statuses
    setHistory(current => {
      const next = completionHistory(list, statuses, before, current)
      return next.length === current.length && next.every((entry, index) =>
        entry.id === current[index]?.id && entry.completedAt === current[index]?.completedAt) ? current : next
    })
  }, [active, list, statuses, workspaces.phase])
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) } catch { /* Storage may be disabled. */ }
  }, [history])
  const completed = useMemo(() => historyRows(list, statuses, history), [list, statuses, history])
  const markedRows = useMemo(() => [...rows, ...completed], [rows, completed])
  const harnessOf = useHarnesses(host === null ? [] : markedRows, props.harnesses)
  const [filter, setFilter] = useState<Filter>(null)
  const [closing, setClosing] = useState(false)
  if (host === null) return null

  const counts = { all: rows.length, pending: 0, running: 0, done: 0 }
  for (const row of rows) counts[row.state] += 1
  const open = (id: SessionId): void => {
    setClosing(false)
    setFilter(null)
    openSession(id)
  }
  const back = (): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setFilter(null)
    else setClosing(true)
  }
  const shown = AGENT_STATES.filter(state => (filter === 'all' || filter === state) && counts[state] > 0)
  const showHistory = (filter === 'all' || filter === 'done') && completed.length > 0

  return createPortal(
    <>
      <style>{STYLE}</style>
      <section className="rc-agents-card" aria-label={t('agents.title')}>
        <button type="button" className="rc-agents-head" onClick={() => { setFilter('all') }}>
          <b>{t('agents.title')}</b>
          <span className="rc-agents-more">{t('agents.viewAll')}<IconChevronRightOutlineRegular size={14} /></span>
        </button>
        <div className="rc-agents-tiles">
          {AGENT_STATES.map(state => (
            <Tile key={state} state={state} count={counts[state]} selected={false} t={t}
              pick={() => { setFilter(state) }} />
          ))}
        </div>
        {rows.length === 0
          ? <p className="rc-agents-empty">{t('agents.empty')}</p>
          : rows.slice(0, PREVIEW).map(row => <Row key={row.id} row={row} harness={harnessOf.get(row.id)} now={now} t={t} open={open} />)}
      </section>
      {filter !== null && (
        <div className="rc-agents-board" role="dialog" aria-label={t('agents.board')}
          data-closing={closing ? '' : undefined} aria-hidden={closing || undefined}
          {...(closing ? { inert: '' } : {})}
          onAnimationEnd={(event) => {
            if (closing && event.target === event.currentTarget) { setFilter(null); setClosing(false) }
          }}>
          <div className="rc-agents-bar">
            <button type="button" className="rc-agents-back" aria-label={t('agents.back')} onClick={back}>
              <IconChevronLeftOutlineRegular size={20} />
            </button>
            {t('agents.board')}
          </div>
          <div className="rc-agents-tiles" role="tablist">
            {(['all', ...AGENT_STATES] as const).map(state => (
              <Tile key={state} state={state} count={counts[state]} selected={filter === state} role="tab" t={t}
                pick={() => { setFilter(state) }} />
            ))}
          </div>
          <div className="rc-agents-list">
            {shown.length === 0 && !showHistory && <p className="rc-agents-empty">{t('agents.empty')}</p>}
            {shown.map(state => (
              <section key={state} className="rc-agents-group">
                <h3><StateDot state={DOT[state]} size={state === 'running' ? 12 : 10} />{t(`agents.${state}`)}</h3>
                <div>
                  {rows.filter(row => row.state === state)
                    .map(row => <Row key={row.id} row={row} harness={harnessOf.get(row.id)} now={now} t={t} open={open} />)}
                </div>
              </section>
            ))}
            {showHistory && (
              <section className="rc-agents-group rc-agents-history">
                <h3><StateDot state="done" size={10} />{t('agents.history')}</h3>
                <div>{completed.map(row => <Row key={row.id} row={row} harness={harnessOf.get(row.id)} now={now} t={t} open={open} />)}</div>
              </section>
            )}
          </div>
        </div>
      )}
    </>,
    host,
  )
}
