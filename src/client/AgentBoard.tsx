/**
 * The phone drawer's Agent card in New Session's seat, with selectable status tiles and inline
 * Session details, including recent completion history. A row opens its Session; its trailing "…"
 * button opens the sidebar row's actions (pin, rename, fork, archive, copy ID). The host's own row
 * menu is a slot only its Workspace browser may render, so these call the same host operations.
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
  Button, IconArchiveOutlineRegular, IconBranchOutlineRegular, IconCopyOutlineRegular, IconEditOutlineRegular,
  IconEllipsisOutlineRegular, IconPinFillRegular, IconPinOutlineRegular, Menu, Modal, relativeTime, StateDot, Toast,
  writeClipboard, type MenuItem, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AGENT_STATES, agentRows, completionHistory, historyRows, residentRows,
  type AgentRow, type AgentState, type CompletionRecord, type HarnessMark,
} from './agent-board.ts'
import { proxiedFrame, useNarrow } from './SidebarToggle.tsx'
import { DRAWER_PICK_ATTRIBUTE } from './SidebarDismiss.tsx'
import { NS } from './locales.ts'

/** Attribute on the card's host element in the sidebar column. */
export const AGENTS_ATTRIBUTE = 'data-remote-control-agents'

/** New Session in the sidebar column: the card takes the seat right after it. */
const ANCHOR = '[class*="_sidebarCol"] button[class*="_newSession"]'

const HISTORY_KEY = 'dsh-remote-control.agent-history.v1'

function savedHistory(): CompletionRecord<SessionId>[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is CompletionRecord<SessionId> =>
      typeof entry?.id === 'string' && typeof entry.completedAt === 'number' && Number.isFinite(entry.completedAt))
  } catch { return [] }
}

/** Host commands passed through the slot injection face. */
export interface AgentBoardInjected {
  openSession: (sessionId: SessionId) => void
  /** Each Session's harness (dsh, codex, claude-code…) and liveness; empty where harness-provider is absent. */
  harnesses: (sessionIds: SessionId[]) => Promise<Readonly<Record<string, HarnessMark>>>
  pinSession: (sessionId: SessionId) => Promise<void>
  unpinSession: (sessionId: SessionId) => Promise<void>
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  forkSession: (sessionId: SessionId) => Promise<unknown>
  /** Rejects with the host's `WorkspaceArchiveError` while the Session still has work running. */
  archiveSession: (sessionId: SessionId, options?: { stopActivity: true }) => Promise<void>
}

/** The harness-provider Remote call the board reads harnesses from. */
export interface HarnessRemote {
  harnesses: (request: { sessionIds: string[] }) => Promise<
    { ok: true; value: Record<string, HarnessMark> } | { ok: false; error: { message: string } }>
}

/** Overlay props supplied by the slot renderer. */
export type AgentBoardProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<AgentBoardInjected>

type Translate = AgentBoardProps['t']

const DOT: Record<AgentState, StateDotState> = { pending: 'warning', running: 'ongoing', done: 'done', resident: 'idle' }

/** Row menu actions, in the host row menu's order. */
type RowAction = 'pin' | 'unpin' | 'rename' | 'fork' | 'archive' | 'copyId'

const ACTION_ICONS: Record<RowAction, React.JSX.Element> = {
  pin: <IconPinOutlineRegular />, unpin: <IconPinFillRegular />, rename: <IconEditOutlineRegular />,
  fork: <IconBranchOutlineRegular />, archive: <IconArchiveOutlineRegular size={14} />, copyId: <IconCopyOutlineRegular />,
}

/** Whether the host refused an archive because the Session still has work running (ui-workspace's own test). */
function activeRefusal(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'WorkspaceArchiveError'
    && (reason as Error & { rpcError?: { code?: string } }).rpcError?.code === 'workspace/session-active'
}

/** Most Session ids one harness-provider `harnesses` call accepts. */
const MARK_BATCH = 1000

const STYLE = ''
  + `[${AGENTS_ATTRIBUTE}] button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;`
  + 'cursor:pointer;-webkit-tap-highlight-color:transparent}'
  + '.rc-agents-card{margin:4px 0 8px;padding:8px;border-radius:16px;'
  + 'box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3);display:flex;flex-direction:column;gap:6px}'
  + '.rc-agents-head{height:32px;display:flex;align-items:center;padding:0 6px}'
  + '.rc-agents-head b{font-size:15px;font-weight:600}'
  + '.rc-agents-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}'
  + '.rc-agents-tile{height:60px;border-radius:12px;padding:8px 10px !important;box-sizing:border-box;display:flex;'
  + 'flex-direction:column;justify-content:space-between;background:var(--dsw-alias-interactive-bg-hover) !important}'
  + '.rc-agents-tile[aria-pressed="true"]{box-shadow:inset 0 0 0 1.5px var(--dsw-alias-label-tertiary)}'
  + '.rc-agents-tile[data-state="pending"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent) !important}'
  + '.rc-agents-tile[data-state="done"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent) !important}'
  + '.rc-agents-tile span{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}'
  + '.rc-agents-tile b{font-size:20px;font-weight:700;line-height:24px}'
  + '.rc-agents-item{height:48px;min-height:48px;border-radius:10px;display:flex;align-items:center}'
  + '.rc-agents-item:has(.rc-agents-row:active){background:var(--dsw-alias-interactive-bg-active)}'
  + '.rc-agents-row{flex:1;min-width:0;height:100%;padding:6px 0 6px 8px !important;box-sizing:border-box;'
  + 'display:flex;align-items:center;gap:10px}'
  + '.rc-agents-more{width:36px;height:40px;flex:none;display:flex !important;align-items:center;justify-content:center;'
  + 'color:var(--dsw-alias-label-secondary) !important}'
  + '.rc-agents-input{width:100%;box-sizing:border-box;height:40px;padding:0 12px;border-radius:10px;font:inherit;font-size:16px;'
  + 'color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major,transparent);'
  + 'border:0.5px solid var(--dsw-alias-border-l3);outline:none}'
  + '.rc-agents-error{margin-top:8px;font-size:13px;color:var(--dsw-alias-state-error-primary)}'
  + '.rc-agents-lead{width:16px;flex:none;display:flex;justify-content:center}'
  + '.rc-agents-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}'
  + '.rc-agents-title{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.rc-agents-meta{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.rc-agents-meta[data-state="pending"]{color:var(--dsw-alias-state-warn-primary)}'
  + '.rc-agents-time{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}'
  + '.rc-agents-empty{margin:0;padding:10px 6px;font-size:13px;color:var(--dsw-alias-label-secondary)}'
  + '.rc-agents-list{max-height:40dvh;overflow:auto;display:flex;flex-direction:column;gap:12px}'
  + '.rc-agents-group h3{margin:0 0 6px;padding:0 6px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;'
  + 'color:var(--dsw-alias-label-secondary)}'
  // Five 48px rows plus the card's padding; further rows stay reachable by native scrolling.
  + '.rc-agents-group > div{padding:4px;max-height:248px;box-sizing:border-box;overflow-y:auto;'
  + 'overscroll-behavior-y:contain;scrollbar-width:thin;border-radius:16px;box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}'

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
 * Read harness-provider's marks for the listed Sessions, and again every 30 seconds so a reclaimed
 * process leaves the unreleased group; a failed batch waits for the next round.
 * @returns mark by Session identity, as far as known.
 */
function useMarks(ids: readonly string[], lookup: AgentBoardInjected['harnesses']): ReadonlyMap<string, HarnessMark> {
  const [marks, setMarks] = useState<ReadonlyMap<string, HarnessMark>>(() => new Map())
  const latest = useRef(lookup)
  latest.current = lookup
  const key = ids.join('\n')
  useEffect(() => {
    if (key === '') return
    const all = key.split('\n') as SessionId[]
    const ask = (): void => {
      for (let start = 0; start < all.length; start += MARK_BATCH) {
        latest.current(all.slice(start, start + MARK_BATCH)).then((batch) => {
          setMarks((previous) => {
            const next = new Map(previous)
            for (const [id, mark] of Object.entries(batch)) next.set(id, mark)
            return next
          })
        }, () => {})
      }
    }
    ask()
    const timer = window.setInterval(ask, 30_000)
    return () => { window.clearInterval(timer) }
  }, [key])
  return marks
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

function Row({ row, harness, pinned, now, t, open, act }: {
  row: AgentRow<SessionId>; harness: string | undefined; pinned: boolean; now: number; t: Translate
  open: (id: SessionId) => void; act: (action: RowAction, row: AgentRow<SessionId>) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const meta = [stateLabel(row, t), row.workspace].filter(Boolean).join(' · ')
  const actions: RowAction[] = [pinned ? 'unpin' : 'pin', 'rename', 'fork', 'archive', 'copyId']
  const items: MenuItem[] = actions.map(id => ({ id, icon: ACTION_ICONS[id], label: t(`agents.menu.${id}`) }))
  return (
    <div className="rc-agents-item">
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
      <Menu
        open={menuOpen}
        onClose={() => { setMenuOpen(false) }}
        portal
        align="end"
        items={items}
        onSelect={(id) => { setMenuOpen(false); act(id as RowAction, row) }}
        anchor={(
          <button
            type="button"
            className="rc-agents-more"
            aria-label={t('agents.menu.more', { title: row.title })}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <IconEllipsisOutlineRegular />
          </button>
        )}
      />
    </div>
  )
}

/** A rename or stop-and-archive request; `draft` is present for rename. */
interface ActionDialog {
  title: string
  description?: string
  draft?: string
  confirm: string
  run: (value: string) => Promise<void>
}

/** One request's dialog: the draft, in-flight and error state die with it. */
function ActionDialogView({ dialog, t, close }: { dialog: ActionDialog; t: Translate; close: () => void }) {
  const [draft, setDraft] = useState(dialog.draft ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const composing = useRef(false)
  const value = draft.trim()
  const blocked = busy || (dialog.draft !== undefined && value === '')
  const dismiss = (): void => { if (!busy) close() }
  const confirm = (): void => {
    if (blocked) return
    setBusy(true)
    setError(null)
    dialog.run(value).then(close, (reason: unknown) => {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={dismiss}
      closeLabel={t('close')}
      title={dialog.title}
      {...(dialog.description === undefined ? {} : { description: dialog.description })}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={dismiss}>{t('agents.dialog.cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{dialog.confirm}</Button>
        </>
      )}
    >
      {dialog.draft !== undefined && (
        <input
          className="rc-agents-input"
          value={draft}
          aria-label={t('agents.rename.field')}
          data-modal-autofocus
          disabled={busy}
          onChange={(event) => { setDraft(event.target.value); setError(null) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !composing.current) { event.preventDefault(); confirm() }
          }}
        />
      )}
      {error !== null && <div className="rc-agents-error" role="alert">{error}</div>}
    </Modal>
  )
}

function Tile({ state, count, selected, t, pick }: {
  state: AgentState; count: number; selected: boolean; t: Translate; pick: () => void
}) {
  // The running spinner only turns while something runs; an empty tile rests on the idle dot.
  const dot = state === 'running' && count === 0 ? 'idle' : DOT[state]
  return (
    <button
      type="button"
      className="rc-agents-tile"
      data-state={state}
      aria-pressed={selected}
      onClick={pick}
    >
      <span><StateDot state={dot} size={dot === 'ongoing' ? 12 : 10} />{t(`agents.${state}`)}</span>
      <b>{count}</b>
    </button>
  )
}

/**
 * Render the drawer's Agent card and inline details into the sidebar column.
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
  const candidates = useMemo(() => host === null ? []
    : list.ids.filter(id => list.byId[id]?.blank === false && list.byId[id]?.origin !== 'subagent'), [host, list])
  const marks = useMarks(candidates, props.harnesses)
  const resident = useMemo(() => residentRows(list, statuses, marks), [list, statuses, marks])
  const [filter, setFilter] = useState<AgentState>('running')
  const [dialog, setDialog] = useState<ActionDialog | null>(null)
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  if (host === null) return null

  const pinned = new Set<string>(workspaces.pinnedSessionIds)
  const say = (key: Parameters<Translate>[0]): void => {
    setToast(previous => ({ text: t(key), seq: (previous?.seq ?? 0) + 1 }))
  }
  const failed = (): void => { say('agents.toast.failed') }
  const act = (action: RowAction, row: AgentRow<SessionId>): void => {
    switch (action) {
      case 'pin': props.pinSession(row.id).catch(failed); break
      case 'unpin': props.unpinSession(row.id).catch(failed); break
      case 'fork': props.forkSession(row.id).then(() => { say('agents.toast.forked') }, failed); break
      case 'copyId':
        void writeClipboard(row.id).then((copied) => { say(copied ? 'agents.toast.copied' : 'agents.toast.copyFailed') })
        break
      case 'rename':
        setDialog({ title: t('agents.rename.title'), draft: row.title, confirm: t('agents.rename.confirm'),
          run: title => props.renameSession(row.id, title) })
        break
      case 'archive':
        props.archiveSession(row.id).then(() => { say('agents.toast.archived') }, (reason: unknown) => {
          if (!activeRefusal(reason)) { failed(); return }
          setDialog({ title: t('agents.archive.title'), description: t('agents.archive.desc', { title: row.title }),
            confirm: t('agents.archive.confirm'),
            run: () => props.archiveSession(row.id, { stopActivity: true }).then(() => { say('agents.toast.archived') }) })
        })
        break
    }
  }

  const all = [...rows, ...resident]
  const counts = { pending: 0, running: 0, done: 0, resident: 0 }
  for (const row of all) counts[row.state] += 1
  const shown = all.filter(row => row.state === filter)
  const showHistory = filter === 'done' && completed.length > 0

  return createPortal(
    <>
      <style>{STYLE}</style>
      <section className="rc-agents-card" aria-label={t('agents.title')}>
        <div className="rc-agents-head"><b>{t('agents.title')}</b></div>
        <div className="rc-agents-tiles">
          {AGENT_STATES.map(state => (
            <Tile key={state} state={state} count={counts[state]} selected={filter === state} t={t}
              pick={() => { setFilter(state) }} />
          ))}
        </div>
        <div className="rc-agents-list" role="region" aria-label={t(`agents.${filter}`)}>
          {shown.length === 0 && !showHistory && <p className="rc-agents-empty">{t(`agents.empty.${filter}`)}</p>}
          {shown.length > 0 && (
            <section className="rc-agents-group">
              <h3><StateDot state={DOT[filter]} size={filter === 'running' ? 12 : 10} />{t(`agents.${filter}`)}</h3>
              <div>{shown.map(row => <Row key={row.id} row={row} harness={marks.get(row.id)?.harness} pinned={pinned.has(row.id)} now={now} t={t} open={openSession} act={act} />)}</div>
            </section>
          )}
          {showHistory && (
            <section className="rc-agents-group rc-agents-history">
              <h3><StateDot state="done" size={10} />{t('agents.history')}</h3>
              <div>{completed.map(row => <Row key={row.id} row={row} harness={marks.get(row.id)?.harness} pinned={pinned.has(row.id)} now={now} t={t} open={openSession} act={act} />)}</div>
            </section>
          )}
        </div>
      </section>
      {dialog !== null && <ActionDialogView dialog={dialog} t={t} close={() => { setDialog(null) }} />}
      {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
    </>,
    host,
  )
}
