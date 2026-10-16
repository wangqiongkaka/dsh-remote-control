/**
 * Phone notifications through Bark (https://github.com/Finb/Bark) for top-level Sessions that wait
 * for the user (approval, plan review, question) or stop running. Tapping one opens the Session in
 * the iOS app through its `dshremote://session/<id>` link.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Bark device and server; the key comes from the Bark app. */
export interface BarkConfig {
  key: string
  server: string
}

/** Why the user hears about a Session. */
export type NoticeKind = 'approval' | 'plan-review' | 'question' | 'done' | 'error'

export interface Notice {
  sessionId: string
  kind: NoticeKind
  /** Session title. */
  title: string
  /** Last segment of the Session directory; empty without one. */
  workspace: string
  /** Tool name for approvals, failure message for errors. */
  detail?: string
}

const HEADLINE: Record<NoticeKind, string> = {
  approval: '待确认 · 等待审批',
  'plan-review': '待确认 · 计划待审',
  question: '待确认 · 等待回答',
  done: '已完成',
  error: '出错停止',
}

/** The Bark `/push` body for one notice. */
export function barkPayload(key: string, notice: Notice): Record<string, string> {
  const body = [notice.workspace, notice.detail?.slice(0, 200)].filter(Boolean).join(' · ')
  return {
    device_key: key,
    title: HEADLINE[notice.kind],
    subtitle: notice.title,
    body: body === '' ? notice.title : body,
    group: 'DeepSeek',
    // Waiting Sessions may break through Focus; a finished one does not need to.
    level: notice.kind === 'done' || notice.kind === 'error' ? 'active' : 'timeSensitive',
    url: 'dshremote://session/' + encodeURIComponent(notice.sessionId),
  }
}

/** Send one notice; a failed push only costs that notification. */
export async function pushBark(bark: BarkConfig, notice: Notice): Promise<void> {
  try {
    const response = await fetch(bark.server.replace(/\/+$/u, '') + '/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(barkPayload(bark.key, notice)),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('HTTP ' + String(response.status) + ' ' + await response.text())
  } catch (error) {
    console.warn('[dsh-remote-control] Bark push failed:', error instanceof Error ? error.message : error)
  }
}

/** The Session facts read here (a structural subset of the host's Session). */
interface SessionFacts {
  id: string
  header: { cwd?: string; parentSession?: unknown; origin?: string }
}

type Listen = (name: string, listener: (...args: any[]) => unknown, options?: { prepend: boolean }) => () => void

/** Observe the host's Session events and report each notice. */
export function watchSessions(ctx: Context, notify: (notice: Notice) => void): void {
  const on = ctx.on.bind(ctx) as unknown as Listen
  // Subagent and delegated children report through their parent.
  const top = (session: SessionFacts | undefined): session is SessionFacts =>
    session !== undefined && session.header.origin !== 'subagent' && session.header.parentSession === undefined
  const report = (session: SessionFacts, kind: NoticeKind, detail?: string): void => {
    let title: string | null | undefined
    try {
      const projections = ctx.get('sessionProjections') as
        { snapshot: (session: SessionFacts, keys: ['title']) => { values: { title?: string | null } } } | undefined
      title = projections?.snapshot(session, ['title']).values.title
    } catch { /* projection not ready */ }
    notify({
      sessionId: session.id, kind, title: title || '未命名会话',
      workspace: session.header.cwd?.split(/[\\/]/u).filter(Boolean).pop() ?? '',
      ...(detail === undefined ? {} : { detail }),
    })
  }
  const ends = new Map<string, { kind: string; error?: { message?: string } }>()
  on('session/event', (session: SessionFacts, event: { type: string; data?: any }) => {
    if (!top(session)) return
    if (event.type === 'approval/asked') report(session, 'approval', event.data?.toolName)
    if (event.type === 'turn/end') ends.set(session.id, event.data.reason)
  })
  // Codex and Claude Code approvals arrive as questions too (harness-provider asks through userQuestions).
  // Answerers claim the request without calling next(), so watch ahead of them.
  on('user-questions/request', (request: {
    agent?: { session?: SessionFacts }
    questions: { id: string; question?: string; intent?: { kind?: string } }[]
  }, next: () => Promise<unknown>) => {
    const session = request.agent?.session
    if (top(session)) {
      if (request.questions.some(question => question.intent?.kind === 'plan-review')) report(session, 'plan-review')
      else if (request.questions.length === 1 && request.questions[0]!.id === 'approval') {
        report(session, 'approval', request.questions[0]!.question)
      } else report(session, 'question', request.questions[0]?.question)
    }
    return next()
  }, { prepend: true })
  on('agent/status', ({ agent, status }: { agent: { session?: SessionFacts }; status: string }) => {
    const session = agent.session
    if (status !== 'idle' || !top(session)) return
    const end = ends.get(session.id)
    ends.delete(session.id)
    // Cancelled by the user, or closed after a crash or fork: nothing finished to report.
    if (end === undefined || end.kind === 'aborted' || end.kind === 'interrupted' || end.kind === 'forked') return
    if (end.kind === 'error') report(session, 'error', end.error?.message)
    else report(session, 'done')
  })
}
