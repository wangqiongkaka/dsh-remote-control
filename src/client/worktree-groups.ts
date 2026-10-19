import type { Context } from '@deepseek-ai/cordis'
import { NARROW, proxiedFrame } from './SidebarToggle.tsx'

interface WorkspaceList {
  getSnapshot(): { items: readonly { workspaceId: string; path: string }[] }
  subscribe(listener: () => void): () => void
}

const ROW = '[data-row-key^="workspace:"]'
const TREE = '[class*="_sidebarCol"] [role="tree"]'
let nextId = 0

const STYLE = '[data-rc-worktree-tree]{display:flex !important;flex-direction:column}'
  + '[data-rc-worktree-section]{order:var(--rc-worktree-order)}'
  + '[data-rc-worktree-child][hidden]{display:none !important}'
  + '[data-rc-worktree-child]{--dsh-workspace-indent:12px !important}'
/** The phone drawer draws each top-level Workspace as a card (drawer-style); an open folder and its worktrees share one. */
const CARD_STYLE = '[data-rc-worktree-open],[data-rc-worktree-child]{box-shadow:none !important;'
  + 'border:.5px solid var(--dsw-alias-border-l3);border-bottom:0;box-sizing:border-box}'
  + '[data-rc-worktree-open]{border-radius:16px 16px 0 0 !important}'
  + '[data-rc-worktree-child]{margin-top:0 !important;border-top:0;border-radius:0 !important}'
  + '[data-rc-worktree-last]{border-bottom:.5px solid var(--dsw-alias-border-l3);border-radius:0 0 16px 16px !important}'

/** Keep React's rows in place; CSS order and ARIA ownership share the same Git-derived tree. */
export function followWorktreeGroups(workspaces: WorkspaceList, cards = true): () => void {
  // shortcut: the host has no Git grouping hook; recheck this seam if workspace row markup changes.
  const sheet = document.createElement('style')
  sheet.textContent = cards ? STYLE + CARD_STYLE : STYLE
  document.head.append(sheet)
  const initialized = new Set<string>()
  const attributes = new Map<HTMLElement, Map<string, string | null>>()
  const orders = new Map<HTMLElement, string>()
  const usedAttributes = new Map<HTMLElement, Set<string>>()
  const usedOrders = new Set<HTMLElement>()
  let parents: Record<string, string> = {}
  let request: AbortController | undefined
  let signature: string | undefined
  let active = true

  const set = (element: HTMLElement, name: string, value: string): void => {
    let saved = attributes.get(element)
    if (!saved) { saved = new Map(); attributes.set(element, saved) }
    if (!saved.has(name)) saved.set(name, element.getAttribute(name))
    const used = usedAttributes.get(element) ?? new Set<string>()
    used.add(name)
    usedAttributes.set(element, used)
    if (element.getAttribute(name) !== value) element.setAttribute(name, value)
  }
  const restore = (all = true): void => {
    for (const [element, saved] of attributes) {
      for (const [name, value] of saved) {
        if (!all && usedAttributes.get(element)?.has(name)) continue
        if (value === null) element.removeAttribute(name)
        else element.setAttribute(name, value)
        saved.delete(name)
      }
      if (!saved.size) attributes.delete(element)
    }
    for (const [element, order] of orders) {
      if (!all && usedOrders.has(element)) continue
      if (order) element.style.setProperty('--rc-worktree-order', order)
      else element.style.removeProperty('--rc-worktree-order')
      orders.delete(element)
    }
  }
  const sync = (): void => {
    usedAttributes.clear()
    usedOrders.clear()
    for (const tree of document.querySelectorAll<HTMLElement>(TREE)) {
      for (const id of new Set(Object.values(parents))) {
        const row = [...tree.querySelectorAll<HTMLElement>(ROW)].find(row => row.dataset.rowKey === `workspace:${id}`)
        if (!row || initialized.has(id)) continue
        initialized.add(id)
        if (row.getAttribute('aria-expanded') === 'true') row.click()
      }
      const sections = [...tree.children].filter((element): element is HTMLElement => element instanceof HTMLElement
        && element.matches('[class*="_groupSection"]'))
      const rows = new Map(sections.flatMap(section => {
        const row = section.querySelector<HTMLElement>(ROW)
        return row ? [[row.dataset.rowKey!.slice(10), { section, row }] as const] : []
      }))
      const children = new Map<string, string[]>()
      for (const id of rows.keys()) {
        const parent = parents[id]
        if (parent === undefined || !rows.has(parent)) continue
        const siblings = children.get(parent) ?? []
        siblings.push(id)
        children.set(parent, siblings)
      }
      if (!children.size) continue
      set(tree, 'data-rc-worktree-tree', '')
      const childIds = new Set([...children.values()].flat())
      const rootIds = [...new Set([...rows.keys()].map(id => childIds.has(id) ? parents[id]! : id))]
      let order = 0
      const identify = (id: string): string => {
        const section = rows.get(id)!.section
        if (!section.id || attributes.get(section)?.has('id')) set(section, 'id', section.id || `dsh-remote-workspace-${++nextId}`)
        set(section, 'role', 'group')
        set(section, 'data-rc-worktree-section', '')
        if (!orders.has(section)) orders.set(section, section.style.getPropertyValue('--rc-worktree-order'))
        usedOrders.add(section)
        section.style.setProperty('--rc-worktree-order', String(order++))
        return section.id
      }
      const rootElements: string[] = []
      for (const id of rootIds) {
        rootElements.push(identify(id))
        const parent = rows.get(id)!
        const nested = children.get(id)
        if (!nested) continue
        const expanded = parent.row.getAttribute('aria-expanded') === 'true'
        if (expanded) set(parent.section, 'data-rc-worktree-open', '')
        set(parent.row, 'aria-level', '1')
        set(parent.row, 'aria-owns', nested.map(childId => {
          const target = identify(childId)
          const child = rows.get(childId)!
          set(child.section, 'data-rc-worktree-child', '')
          set(child.row, 'aria-level', '2')
          if (!expanded) set(child.section, 'hidden', '')
          return target
        }).join(' '))
        set(rows.get(nested.at(-1)!)!.section, 'data-rc-worktree-last', '')
      }
      set(tree, 'aria-owns', rootElements.join(' '))
    }
    restore(false)
  }
  const refresh = (force = false): void => {
    const next = JSON.stringify(workspaces.getSnapshot().items.map(row => [row.workspaceId, row.path]))
    if (!force && signature === next) { sync(); return }
    signature = next
    request?.abort()
    const controller = new AbortController()
    request = controller
    void fetch('/api/remote-control/worktree-groups', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Worktree grouping unavailable')
        const value: unknown = await response.json()
        if (typeof value !== 'object' || value === null || Array.isArray(value)
          || !Object.values(value).every(parent => typeof parent === 'string')) throw new Error('Invalid worktree groups')
        if (!active || controller.signal.aborted) return
        const known = new Set(workspaces.getSnapshot().items.map(row => row.workspaceId))
        parents = Object.fromEntries(Object.entries(value as Record<string, string>).filter(([id, parent]) =>
          known.has(id) && known.has(parent) && id !== parent && !Object.hasOwn(value, parent)))
        sync()
      }).catch(() => {
        if (!active || controller.signal.aborted) return
        parents = {}
        sync()
      })
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target instanceof Element && record.target.closest(TREE)
      || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
        && (node.matches(TREE) || node.querySelector(TREE))))) sync()
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
  const unsubscribe = workspaces.subscribe(() => { refresh() })
  const focus = (): void => { refresh(true) }
  window.addEventListener('focus', focus)
  refresh()
  return () => {
    active = false
    request?.abort()
    observer.disconnect()
    unsubscribe()
    window.removeEventListener('focus', focus)
    restore()
    sheet.remove()
  }
}

/** Fold worktrees under their main folder on every page; only the phone drawer outlines the group as a card. */
export function registerWorktreeGroups(ctx: Context): void {
  ctx.inject(['workspaces'], scope => {
    scope.effect(() => {
      const query = window.matchMedia(NARROW)
      let dispose: (() => void) | undefined
      let phone: boolean | undefined
      const sync = (): void => {
        const next = query.matches && proxiedFrame()
        if (next === phone) return
        phone = next
        dispose?.()
        dispose = followWorktreeGroups((scope.get('workspaces') as { list: WorkspaceList }).list, next)
      }
      sync()
      query.addEventListener('change', sync)
      return () => { query.removeEventListener('change', sync); dispose?.() }
    }, 'remote-control: worktree folders')
  })
}
