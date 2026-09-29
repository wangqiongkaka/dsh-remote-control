import type { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

it('activates the mobile sidebar control in the single leading slot', () => {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: {
      'conversation.header.leading': { kind: 'single', scope: 'root' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  }, (() => null) as never)
  const ctx = {
    effect: (register: () => () => void) => register(),
    locale: { register: () => () => {} },
    slots: {
      register: core.register.bind(core),
      inject: (_name: string, register: () => () => void) => register(),
    },
    layout: { toggleSidebar: () => {} },
  } as unknown as Context

  expect(() => { apply(ctx) }).not.toThrow()
  expect(core.entries('conversation.header.leading')).toHaveLength(1)
})
