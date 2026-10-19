// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { followWorktreeGroups, registerWorktreeGroups } from '../dist/client/worktree-groups.js'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.innerHTML = ''
  document.querySelector('style[data-dsh-remote-control]')?.remove()
  vi.unstubAllGlobals()
})

function fixture() {
  const ids = ['child', 'other', 'main']
  document.body.innerHTML = '<div class="test_sidebarCol"><div role="tree">' + ids.map(id =>
    `<section class="test_groupSection"><div class="test_projectRow" data-row-key="workspace:${id}" role="treeitem" aria-expanded="true">`
    + `<span>${id}</span><button aria-label="新建">+</button></div><div data-row-key="session:${id}">${id} 会话</div></section>`).join('')
    + '</div></div>'
  const rows = new Map(ids.map(id => [id, document.querySelector<HTMLElement>(`[data-row-key="workspace:${id}"]`)!]))
  for (const row of rows.values()) row.addEventListener('click', event => {
    if ((event.target as Element).closest('button')) return
    row.setAttribute('aria-expanded', String(row.getAttribute('aria-expanded') !== 'true'))
  })
  let items = ids.map(workspaceId => ({ workspaceId, path: '/w/' + workspaceId }))
  let changed = (): void => {}
  const source = {
    getSnapshot: () => ({ items }),
    subscribe: (listener: () => void) => { changed = listener; return () => { changed = () => {} } },
  }
  return { rows, source, change: (next = items) => { items = next; changed() } }
}

const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

it('folds the main folder initially, preserves rows/actions, and restores the ordinary list on disposal', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ child: 'main' })))
  const { rows, source } = fixture()
  const main = rows.get('main')!
  const child = rows.get('child')!
  const added = vi.fn()
  main.querySelector('button')!.addEventListener('click', added)
  dispose = followWorktreeGroups(source)
  await settle()
  expect(main.getAttribute('aria-expanded')).toBe('false')
  expect(child.parentElement!.hidden).toBe(true)
  expect(main.getAttribute('aria-owns')).toBe(child.parentElement!.id)
  expect(child.getAttribute('aria-level')).toBe('2')
  expect(document.querySelector('[role="tree"]')!.getAttribute('aria-owns')!.split(' ').map(id =>
    document.getElementById(id)!.querySelector('[data-row-key]')!.getAttribute('data-row-key'))).toEqual(['workspace:main', 'workspace:other'])
  main.click()
  await settle()
  expect(child.parentElement!.hidden).toBe(false)
  expect(main.parentElement!.hasAttribute('data-rc-worktree-open')).toBe(true)
  main.querySelector('button')!.click()
  expect(added).toHaveBeenCalledOnce()
  expect(main.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('[data-row-key="session:child"]')).not.toBeNull()
  expect(document.querySelector('[data-row-key="workspace:child"]')).toBe(child)
  dispose()
  expect(child.parentElement!.hidden).toBe(false)
  expect(child.parentElement!.id).toBe('')
  expect(main.hasAttribute('aria-owns')).toBe(false)
  expect(document.querySelector('[data-rc-worktree-section]')).toBeNull()
  expect(child.parentElement!.style.getPropertyValue('--rc-worktree-order')).toBe('')
})

it('updates after registry changes, preserves an opened folder on redraw, and ignores stale requests', async () => {
  const fetcher = vi.fn(async () => Response.json({ child: 'main' }))
  vi.stubGlobal('fetch', fetcher)
  const { rows, source, change } = fixture()
  dispose = followWorktreeGroups(source)
  await settle()
  rows.get('main')!.click()
  await settle()
  const childId = rows.get('child')!.parentElement!.id
  rows.get('main')!.parentElement!.append(document.createElement('span'))
  await settle()
  expect(rows.get('main')!.getAttribute('aria-expanded')).toBe('true')
  expect(rows.get('child')!.parentElement!.id).toBe(childId)
  expect(fetcher).toHaveBeenCalledOnce()
  let answer!: (value: Response) => void
  fetcher.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
  window.dispatchEvent(new Event('focus'))
  fetcher.mockResolvedValueOnce(Response.json({}))
  change([])
  await settle()
  expect(document.querySelector('[data-rc-worktree-section]')).toBeNull()
  answer(Response.json({ child: 'main' }))
  await settle()
  expect(document.querySelector('[data-rc-worktree-section]')).toBeNull()
})

it('preserves the current worktree row order independently of metadata response order', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ second: 'main', child: 'main' })))
  const { rows, source, change } = fixture()
  const section = rows.get('child')!.parentElement!.cloneNode(true) as HTMLElement
  section.querySelector<HTMLElement>('[data-row-key]')!.dataset.rowKey = 'workspace:second'
  document.querySelector('[role="tree"]')!.append(section)
  change([...source.getSnapshot().items, { workspaceId: 'second', path: '/w/second' }])
  dispose = followWorktreeGroups(source)
  await settle()
  const owned = rows.get('main')!.getAttribute('aria-owns')!.split(' ')
  expect(owned.map(id => document.getElementById(id)!.querySelector('[data-row-key]')!.getAttribute('data-row-key')))
    .toEqual(['workspace:child', 'workspace:second'])
})

it.each(['http', 'invalid', 'offline'])('keeps every workspace available when grouping is %s', async failure => {
  const fetcher = vi.fn(async () => Response.json({ child: 'main' }))
  vi.stubGlobal('fetch', fetcher)
  const { source } = fixture()
  dispose = followWorktreeGroups(source)
  await settle()
  if (failure === 'offline') fetcher.mockRejectedValueOnce(new Error('offline'))
  else fetcher.mockResolvedValueOnce(failure === 'http' ? new Response('', { status: 503 }) : Response.json({ child: null }))
  window.dispatchEvent(new Event('focus'))
  await settle()
  expect(document.querySelector('[data-rc-worktree-section]')).toBeNull()
  expect(document.querySelectorAll('[data-row-key^="workspace:"]')).toHaveLength(3)
  expect(document.querySelector('[hidden]')).toBeNull()
})

it('keeps existing directory nesting and leaves flat/search lists alone', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ child: 'main' })))
  const { rows, source } = fixture()
  const main = rows.get('main')!
  const child = rows.get('child')!
  const nested = document.createElement('div')
  nested.setAttribute('role', 'group')
  nested.append(child.parentElement!)
  main.parentElement!.append(nested)
  dispose = followWorktreeGroups(source)
  await settle()
  expect(main.getAttribute('aria-expanded')).toBe('false')
  expect(child.closest('[role="group"]')).toBe(nested)
  expect(main.parentElement!.contains(child)).toBe(true)
  document.body.innerHTML = '<div class="test_sidebarCol"><div role="tree"><div data-row-key="session:x">搜索结果</div></div></div>'
  await settle()
  expect(document.querySelector('[data-rc-worktree-tree]')).toBeNull()
  expect(document.body.textContent).toBe('搜索结果')
})

it('ignores stale identities and cyclic or self-parent relations', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ child: 'main', main: 'child', other: 'other', missing: 'main' })))
  const { rows, source } = fixture()
  dispose = followWorktreeGroups(source)
  await settle()
  expect(document.querySelector('[data-rc-worktree-tree]')).toBeNull()
  expect([...rows.values()].every(row => row.getAttribute('aria-expanded') === 'true')).toBe(true)
})

it('groups on every page, outlining the folder as a card only in narrow remote pages', async () => {
  const fetcher = vi.fn(async () => Response.json({ child: 'main' }))
  vi.stubGlobal('fetch', fetcher)
  const { source, rows } = fixture()
  let changed = (): void => {}
  const query = { matches: false, addEventListener: (_: string, listener: () => void) => { changed = listener }, removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => query)
  const scope = {
    get: () => ({ list: source }),
    effect: (install: () => () => void) => { dispose = install() },
  }
  const sheet = (): string => [...document.head.querySelectorAll('style')].map(style => style.textContent).join('')
  registerWorktreeGroups({ inject: (_: string[], install: (ctx: unknown) => void) => { install(scope) } } as unknown as Context)
  await settle()
  expect(rows.get('child')!.parentElement!.hidden).toBe(true)
  expect(sheet()).toContain('[data-rc-worktree-child]{--dsh-workspace-indent:12px !important}')
  expect(sheet()).not.toContain('border-radius:16px 16px 0 0')
  rows.get('main')!.click()
  await settle()
  expect(rows.get('child')!.parentElement!.hidden).toBe(false)
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  document.head.append(proxy)
  query.matches = true
  changed()
  await settle()
  expect(sheet()).toContain('border-radius:16px 16px 0 0')
  expect(fetcher).toHaveBeenCalledTimes(2)
})
