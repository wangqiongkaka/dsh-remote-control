/** First view for a paired phone, rendered inside the ordinary DSH Web UI. */

import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS } from './locales.ts'

export interface LandingInjected {
  openSession: (sessionId: SessionId) => void
}

export type RemoteLandingProps = PropsRuntime<'conversation.header.leading'>
  & PropsLocale<typeof NS> & InjectFace<LandingInjected>

export function RemoteLanding({ useWorkspaces, useSessions, openSession, t }: RemoteLandingProps): React.JSX.Element {
  const [target, setTarget] = useState(() => new URL(window.location.href).searchParams.get('remoteWorkspace'))
  const workspace = useWorkspaces(state => state.items.find(item => item.workspaceId === target))
  const ready = useWorkspaces(state => state.phase === 'ready')
  const sessions = useSessions(state => state.byId)

  useEffect(() => {
    if (target === null) return
    const address = new URL(window.location.href)
    address.searchParams.delete('remoteWorkspace')
    window.history.replaceState(window.history.state, '', address)
  }, [target])

  return <Modal open={target !== null} onClose={() => { setTarget(null) }}
    title={workspace?.title ?? t('landingTitle')} closeLabel={t('close')}>
    {workspace === undefined
      ? ready && <p>{t('landingMissing')}</p>
      : workspace.sessionIds.length === 0
        ? <p>{t('landingEmpty')}</p>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {workspace.sessionIds.map(id => <button key={id} type="button"
            style={{ textAlign: 'left', padding: 10, borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-secondary)',
              background: 'var(--dsw-alias-bg-primary)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }}
            onClick={() => { openSession(id); setTarget(null) }}>
            {sessions[id]?.displayTitle ?? id}
          </button>)}
        </div>}
  </Modal>
}
