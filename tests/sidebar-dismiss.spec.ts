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

it('folds the drawer after opening a Session from the Agent card', () => {
  const card = document.createElement('div')
  card.innerHTML = '<button type="button">运行中</button>'
    + '<button type="button" data-remote-control-pick><span class="title">会话</span></button>'
  pick('.ui_layout__sidebarCol__h1').append(card)
  expect(drawerNavigationPick(pick('[data-remote-control-pick] .title'))).toBe(true)
  // The card's own controls only switch the inline details.
  expect(drawerNavigationPick(card.firstElementChild)).toBe(false)
})

// A Workspace row's New Session button sits in the row's action strip, which otherwise keeps its taps
// (menus, pins): it opens a Session, so the drawer folds onto it instead of staying over it.
it('folds the drawer after New Session on a workspace row, in either UI language', () => {
  const row = document.createElement('div')
  row.className = 'ui_workspace__projectRow__h1'
  row.innerHTML = '<span class="ui_workspace__rowActions__h1">'
    + '<button aria-label="工作区“dsh”的操作">…</button>'
    + '<button aria-label="在“dsh”中新建会话"><svg class="glyph"></svg></button>'
    + '<button aria-label="New session in dsh">+</button></span>'
  pick('.ui_layout__sidebarCol__h1').append(row)
  expect(drawerNavigationPick(pick('[aria-label="在“dsh”中新建会话"] .glyph'))).toBe(true)
  expect(drawerNavigationPick(pick('[aria-label="New session in dsh"]'))).toBe(true)
  expect(drawerNavigationPick(pick('[aria-label="工作区“dsh”的操作"]'))).toBe(false)
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
