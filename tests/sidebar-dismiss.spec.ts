// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { drawerOpen, drawerNavigationPick } from '../dist/client/SidebarDismiss.js'

/**
 * Minimal drawer DOM: the frame carries data-sidebar-collapsed exactly as
 * AppFrame does, the sidebar column holds the picks, and the module-hashed
 * class names carry the suffixes the selectors key on.
 */
function drawer(collapsed: boolean): void {
  document.body.innerHTML = ''
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  if (collapsed) frame.setAttribute('data-sidebar-collapsed', '')
  const column = document.createElement('div')
  column.className = 'ui_layout__sidebarCol__h1'
  column.innerHTML = ''
    + '<div class="ui_workspace__sessionRow__h1" data-row-key="session:a"><span class="ui_workspace__title__h1">标题</span></div>'
    + '<button class="ui_sidebar__newSession__h1">新建</button>'
    + '<div class="ui_workspace__searchResultRow__h1">结果</div>'
    + '<nav class="ui_sidebar__panelList__h1"><button class="ui_sidebar__panelRow__h1"><span>插件</span></button>'
    + '<button class="ui_sidebar__panelRow__h1"><span>自动化任务</span></button></nav>'
    + '<div class="ui_workspace__sessionRow__h1" data-row-key="session:b">'
    + '<span class="ui_workspace__rowActions__h1"><button class="ui_workspace__iconButton__h1">…</button></span>'
    + '</div>'
  const outside = document.createElement('div')
  outside.className = 'ui_workspace__sessionRow__h1'
  outside.setAttribute('data-row-key', 'session:z')
  frame.append(column, outside)
  document.body.append(frame)
}

beforeEach(() => { drawer(false) })

/** Query with the fixture's own guarantee that the element exists. */
function pick(selector: string): Element {
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`fixture missing ${selector}`)
  return found
}

it('folds the drawer on a session row, a search result, and New Session', () => {
  expect(drawerNavigationPick(pick('[data-row-key="session:a"] > .ui_workspace__title__h1'))).toBe(true)
  expect(drawerNavigationPick(pick('.ui_workspace__searchResultRow__h1'))).toBe(true)
  expect(drawerNavigationPick(pick('.ui_sidebar__newSession__h1'))).toBe(true)
})

it('folds the drawer after choosing Plugins or Automations', () => {
  const rows = document.querySelectorAll('[class*="_panelRow"] span')
  expect(rows).toHaveLength(2)
  for (const row of rows) expect(drawerNavigationPick(row)).toBe(true)
  drawer(true)
  expect(drawerNavigationPick(pick('[class*="_panelRow"] span'))).toBe(false)
})

it('keeps the trailing action strip and off-drawer rows to themselves', () => {
  expect(drawerNavigationPick(pick('.ui_workspace__iconButton__h1'))).toBe(false)
  expect(drawerNavigationPick(pick('[data-row-key="session:z"]'))).toBe(false)
  expect(drawerNavigationPick(document)).toBe(false)
  expect(drawerNavigationPick(null)).toBe(false)
})

it('reports the drawer open only while the frame has no collapse mark', () => {
  expect(drawerOpen(pick('[data-row-key="session:a"]'))).toBe(true)
  drawer(true)
  expect(drawerOpen(pick('[data-row-key="session:a"]'))).toBe(false)
  expect(drawerNavigationPick(pick('[data-row-key="session:a"]'))).toBe(false)
})
