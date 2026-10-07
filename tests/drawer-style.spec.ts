// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { applyDrawerSelection, DRAWER_SCROLL_ROOT, DRAWER_STYLE_ATTRIBUTE } from '../dist/client/drawer-style.js'

/** The injected sheet, or undefined while none is mounted. */
function sheet(): HTMLStyleElement | null {
  return document.head.querySelector(`style[${DRAWER_STYLE_ATTRIBUTE}]`)
}

afterEach(() => { sheet()?.remove() })

it('bounds the drawer scrim above the same safe area as the phone sidebar', () => {
  const dispose = applyDrawerSelection()
  try {
    const shared = Array.from(sheet()!.sheet!.cssRules).find(rule => rule instanceof CSSMediaRule
      && rule.conditionText === '(max-width: 1023px)') as CSSMediaRule
    const scrim = Array.from(shared.cssRules).find(rule => rule instanceof CSSStyleRule
      && rule.selectorText.split(',').includes('[data-remote-control-scrim]')) as CSSStyleRule | undefined
    // An unbounded black scrim darkens the home-indicator band that the drawer leaves exposed.
    expect(scrim).toBeDefined()
    expect(scrim?.style.getPropertyValue('height')).toContain('- var(--dsh-remote-bottom-clearance)')
    expect(scrim?.style.getPropertyValue('height')).toContain('var(--dsh-remote-keyboard-height,100dvh)')
    expect(scrim?.style.getPropertyValue('top')).toContain('var(--dsh-remote-keyboard-shift,0px)')
    expect(scrim?.style.getPropertyValue('bottom')).toBe('auto')
    expect(scrim?.style.getPropertyPriority('bottom')).toBe('important')
  } finally { dispose() }
})

it('updates every page edge and the viewport on an older proxied phone document', () => {
  const viewport = document.createElement('meta')
  viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'
  document.head.append(viewport)
  const dispose = applyDrawerSelection()
  try {
    expect(viewport.content).toContain('viewport-fit=cover')
    const css = sheet()!.textContent!
    expect(css).toContain('--dsh-remote-bottom-clearance:max(8px,env(safe-area-inset-bottom,0px))')
    expect(css).toContain('padding-bottom:var(--dsh-remote-bottom-clearance) !important')
    expect(css).toContain('bottom:var(--dsh-remote-bottom-clearance) !important')
    expect(css).toContain('body > [role="presentation"]:has(> [role="dialog"])')
    expect(css).toContain('[data-sidebar-right-panel="fullscreen"]{width:calc(100vw - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)) !important}')
    expect(css).toContain('html[data-dsh-remote-keyboard]{--dsh-remote-bottom-clearance:4px}')
    const shared = css.slice(css.indexOf('@media (max-width: 1023px){'), css.indexOf('@media (max-width: 720px){'))
    expect(shared).toContain('margin-top:var(--dsh-remote-keyboard-shift,0px) !important')
    dispose()
    expect(viewport.content).toBe('width=device-width, initial-scale=1')
  } finally { dispose(); viewport.remove() }
})

it.each([true, false])('moves statistics above the input after a client reload (dock marker: %s)', marked => {
  // HMR replaces the client plugin, not the phone's already parsed proxy HTML.
  const proxy = document.createElement('style')
  proxy.setAttribute('data-dsh-remote-control', '')
  proxy.textContent = '.host_root{display:flex;flex-direction:column}.host_dock{order:0;padding-top:4px}'
  const root = document.createElement('div')
  root.className = 'host_root'
  // The installed desktop host predates data-composer-dock; both versions use the dock class.
  root.innerHTML = `<div data-composer-card>草稿</div><div class="host_dock" ${marked ? 'data-composer-dock' : ''}>`
    + '<button>性能</button><button>总量</button></div>'
  document.head.append(proxy)
  document.body.append(root)
  const dispose = applyDrawerSelection()
  const dock = root.querySelector<HTMLElement>('.host_dock')!
  const card = root.querySelector<HTMLElement>('[data-composer-card]')!
  // jsdom does not apply media queries: activate just the client sheet's phone rules.
  const phoneRules = sheet()!.sheet!.cssRules
  for (const rule of Array.from(phoneRules)) {
    if (rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)') {
      sheet()!.append(document.createTextNode(Array.from(rule.cssRules).map(value => value.cssText).join('')))
    }
  }
  try {
    expect(Number(getComputedStyle(dock).order)).toBeLessThan(Number(getComputedStyle(card).order || 0))
    expect(getComputedStyle(dock).paddingTop).toBe('0px')
    expect(dock.querySelectorAll('button')).toHaveLength(2)
    dispose()
    expect(getComputedStyle(dock).order).toBe('0')
  } finally { dispose(); root.remove(); proxy.remove() }
})

it.each([
  ['light', 'rgb(255, 255, 255)', 'rgba(248, 249, 250, 0.58)'],
  ['dark', 'rgb(44, 44, 46)', 'rgba(67, 69, 74, 0.45)'],
])('gives quota panels and picker menus opaque %s theme backgrounds', (_, solid, translucent) => {
  const host = document.createElement('style')
  host.textContent = `.hp-menu,.hp-panel{background:${translucent}}`
  const root = document.createElement('div')
  root.innerHTML = '<div class="hp-anchor"><div class="hp-panel hp-panel-right">本周 剩余 95%</div></div>'
    + '<div class="hp-anchor"><div class="hp-menu hp-menu-left">Codex</div></div>'
  document.body.append(root)
  const dispose = applyDrawerSelection()
  // jsdom cannot resolve CSS variables; substitute only the theme's solid surface color.
  sheet()!.textContent = sheet()!.textContent!.replaceAll('var(--dsw-alias-bg-layer-2)', solid)
  // Provider styles can arrive after this plugin's sheet during a client reload.
  document.head.append(host)
  try {
    for (const popup of root.querySelectorAll('.hp-panel,.hp-menu')) {
      expect(getComputedStyle(popup).backgroundColor).toBe(solid)
    }
  } finally { dispose(); host.remove(); root.remove() }
})

it('separates the current session from a latched hover in the drawer', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  // The session the user is in takes the active fill the shell's own sidebar nav uses...
  expect(css).toContain('[class*="_sessionRow"][aria-selected="true"]')
  expect(css).toContain('var(--dsw-specific-sidebar-nav-item-active)')
  // ...and on a touch device the row a finger last landed on paints nothing at all.
  expect(css).toContain('@media (hover: none)')
  expect(css).toContain('[class*="_sessionRow"]:hover:not([aria-selected="true"])')
  expect(css).toContain('[class*="_projectRow"]:hover')
  dispose()
})

// WebKit treats a tap that first produces a hover-only layout change as the hover, so a row that
// grows its action strip or drops its timestamp on that tap needs a second one to open.
it('keeps session and search rows at their resting shape on a touch device', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  expect(css).toContain('[class*="_rowActions"]{display:none !important}')
  expect(css).toContain('[class*="_time"]{display:revert !important}')
  expect(css).toContain('[class*="_pinIndicator"]{display:inline-flex !important}')
  expect(css).toContain('[class*="_chevron"]{display:none !important}')
  expect(css).toContain('[class*="_folder"]{display:inline-flex !important}')
  // An open row menu is the user's own state and keeps its revealed actions.
  expect(css).toContain(':hover:not([class*="_menuOpen"])')
  // With the latched fill gone, the pressed fill is what answers the finger.
  expect(css).toContain('[class*="_sessionRow"]:active')
  expect(css).toContain('var(--dsw-alias-interactive-bg-active)')
  dispose()
})

// Each top-level Workspace section (its row, Session rows and overflow control) reads as one card;
// a child Workspace in tree grouping stays inside its parent's card instead of nesting another.
it('draws each top-level workspace section as an outlined card', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  const card = '[class*="_sidebarCol"] [role="tree"] > [class*="_groupSection"]'
  expect(css).toContain(`${card}{padding:4px;border-radius:16px;box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}`)
  expect(css).toContain(`${card} + [class*="_groupSection"]{margin-top:8px !important}`)
  expect(css).toContain(`${card} > [class*="_projectRow"] [class*="_title"]{font-weight:600}`)
  dispose()
})

// The full-screen phone drawer gives every row a thumb-sized target, the only way back included.
it('raises the drawer rows to touch height at phone width', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  const phone = css.slice(css.indexOf('@media (max-width: 720px){'))
  expect(phone).not.toBe(css)
  expect(phone).toContain('[class*="_projectRow"]{height:44px !important}')
  expect(phone).toContain('[class*="_sessionRow"]{height:40px !important}')
  expect(phone).toContain('[class*="_sessionOverflowButton"]{height:36px !important}')
  expect(phone).toContain('[class*="_logoRow"] button[class*="_toggle"]{width:40px !important;height:40px !important}')
  dispose()
})

// The Agent card takes the seat: the shell's New Session button goes, a Workspace row's stays.
it('hides the sidebar New Session button in the drawer', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  expect(css).toContain('[class*="_sidebarCol"] button[class*="_newSession"]{display:none !important}')
  expect(css).not.toContain('button[class*="_newSession"]{height')
  dispose()
})

it.each(['添加工作区', 'Add workspace'])('keeps the drawer add-workspace entry visible (%s)', (label) => {
  const root = document.createElement('div')
  root.innerHTML = '<aside class="ui_layout__sidebarCol__h1"><header>'
    + `<button aria-label="${label}">添加</button>`
    + '<button aria-label="搜索会话">搜索</button><button aria-label="视图选项">视图</button></header>'
    + '<div class="ui_workspace__projectRow__h1"><span class="ui_workspace__folder__h1">文件夹</span>'
    + '<button aria-label="新建会话">新建会话</button></div></aside>'
    + `<button aria-label="${label}">其他页面</button>`
  document.body.append(root)
  const dispose = applyDrawerSelection()
  const add = root.querySelector('aside header button')!
  try {
    expect(getComputedStyle(add).display).not.toBe('none')
    for (const control of root.querySelectorAll('button:not(aside header button:first-child),span')) {
      expect(getComputedStyle(control).display).not.toBe('none')
    }
    dispose()
    expect(getComputedStyle(add).display).not.toBe('none')
  } finally { dispose(); root.remove() }
})

it('keeps project actions visible on touch so a session can be created', () => {
  const dispose = applyDrawerSelection()
  const css = sheet()?.textContent ?? ''
  expect(css).toContain('[class*="_projectRow"] [class*="_rowActions"]{display:inline-flex !important}')
  expect(css).not.toContain('[class*="_projectRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"]{display:none !important}')
  dispose()
})

it.each([false, true])('keeps the project icon flex layout after a touch (worktree: %s)', (worktree) => {
  const host = document.createElement('style')
  host.textContent = '.host_slot{display:inline-flex;width:16px;height:20px}'
    + '.host_projectRow[data-hover] .host_folder{display:none}'
    + '[data-git-worktree-folder] > svg{display:none}'
    + '[data-git-worktree-folder]::before{content:"";width:16px;height:16px;background:currentColor}'
  document.head.append(host)
  const row = document.createElement('div')
  row.className = 'host_projectRow'
  const folder = document.createElement('span')
  folder.className = 'host_slot host_folder host_folderActive'
  if (worktree) folder.setAttribute('data-git-worktree-folder', '')
  folder.innerHTML = '<svg width="16" height="16"></svg>'
  row.append(folder)
  document.body.append(row)
  const dispose = applyDrawerSelection()
  const touch = document.createElement('style')
  // jsdom cannot evaluate hover media queries or latch :hover. Activate the actual touch
  // rules through an equivalent attribute; keep their declarations unchanged.
  const media = Array.from(sheet()!.sheet!.cssRules).find(rule => rule instanceof CSSMediaRule)
  touch.textContent = Array.from(media!.cssRules)
    .map(rule => rule.cssText.replaceAll(':hover', '[data-hover]')).join('')
  document.head.append(touch)
  try {
    expect(getComputedStyle(folder).display).toBe('inline-flex')
    row.setAttribute('data-hover', '')
    // The worktree's sized ::before needs a flex parent to paint when its SVG is hidden.
    expect(getComputedStyle(folder).display).toBe('inline-flex')
    if (worktree) expect(getComputedStyle(folder.firstElementChild!).display).toBe('none')
  } finally {
    dispose()
    host.remove()
    touch.remove()
    row.remove()
  }
})

it('removes the sheet it injected', () => {
  const dispose = applyDrawerSelection()
  expect(sheet()).not.toBeNull()
  dispose()
  expect(sheet()).toBeNull()
})

it('scrolls the whole drawer while the brand and settings stay pinned', () => {
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div class="ui_sidebar__root__h1">'
    + '<div class="ui_sidebar__logoRow__h1">品牌</div>'
    + '<div data-remote-control-agents><div class="rc-agents-list">Agent</div></div>'
    + '<div class="ui_sidebar__regionArea__h1"><div class="ui_workspace__root__h1">'
    + '<div class="ui_workspace__listArea__h1"><div class="ui_workspace__treeBody__h1">'
    + '<div class="ui_workspace__list__h1" role="tree">项目</div></div></div></div></div>'
    + '<div class="ui_sidebar__footArea__h1">设置</div></div></div>'
  document.body.append(frame)
  const dispose = applyDrawerSelection()
  const style = (selector: string): CSSStyleDeclaration => getComputedStyle(frame.querySelector(selector)!)
  try {
    expect(style('.ui_sidebar__root__h1').overflowY).toBe('auto')
    expect(style('.ui_sidebar__root__h1').overscrollBehaviorY).toBe('none')
    expect(style('.ui_sidebar__logoRow__h1').position).toBe('sticky')
    expect(style('.ui_sidebar__logoRow__h1').top).toBe('0px')
    expect(style('.ui_sidebar__footArea__h1').position).toBe('sticky')
    expect(style('.ui_sidebar__footArea__h1').bottom).toBe('0px')
    // The page edge owns the home-indicator inset, not this inner sticky footer.
    expect(document.querySelector(`[${DRAWER_STYLE_ATTRIBUTE}]`)!.textContent).toContain(
      `${DRAWER_SCROLL_ROOT} > [class*="_footArea"]{padding-bottom:0}`,
    )
    expect(style('.ui_sidebar__regionArea__h1').overflow).toBe('visible')
    expect(style('.ui_workspace__list__h1').overflowY).toBe('visible')
    expect(style('.rc-agents-list').overflow).toBe('visible')
    expect(style('.rc-agents-list').maxHeight).toBe('none')
  } finally { dispose(); frame.remove() }
})

it('places settings before panel shortcuts beside the sidebar toggle with equal button sizes and spacing', () => {
  const frame = document.createElement('div')
  frame.className = 'ui_layout__frame__h1'
  frame.innerHTML = '<div class="ui_layout__sidebarCol__h1"><div class="ui_sidebar__root__h1">'
    + '<div class="ui_sidebar__logoRow__h1"><button class="ui_sidebar__brand__h1">品牌</button>'
    + '<button class="ui_sidebar__iconButton__h1 ui_sidebar__toggle__h1" aria-label="收起侧边栏"><svg width="16" height="16"></svg></button></div>'
    + '<button class="ui_sidebar__newSession__h1">新会话</button><div data-remote-control-agents>Agent</div>'
    + '<nav class="ui_sidebar__panelList__h1" aria-label="导航">'
    + '<button class="ui_sidebar__panelRow__h1" aria-label="插件"><span class="ui_sidebar__panelGlyph__h1"><svg width="16" height="16"></svg></span><span class="ui_sidebar__panelTitle__h1">插件</span></button>'
    + '<button class="ui_sidebar__panelRow__h1" aria-label="自动化任务"><span class="ui_sidebar__panelGlyph__h1"><svg width="20" height="20"></svg></span><span class="ui_sidebar__panelTitle__h1">自动化任务</span></button></nav>'
    + '<div class="ui_sidebar__regionArea__h1">项目</div><div class="ui_sidebar__footArea__h1">'
    + '<div class="ui_sidebar__footerActions__h1"></div><div class="ui_sidebar__settingsArea__h1">'
    + '<div data-slot="sidebar.settings" style="display:contents"><div class="settings__triggerRow__h1">'
    + '<div data-slot="settings.launcher" style="display:contents"><button class="settings__trigger__h1" aria-label="设置" aria-haspopup="dialog">'
    + '<div data-slot="settings.trigger" style="display:contents"><svg width="16" height="16"></svg>'
    + '<span class="settings__triggerLabel__h1">设置</span></div></button></div>'
    + '<span data-connection-indicator>连接状态</span></div></div></div></div>'
    + '</div></div>'
  document.body.append(frame)
  const dispose = applyDrawerSelection()
  const style = (selector: string) => getComputedStyle(frame.querySelector(selector)!)
  const picked: string[] = []
  const buttons = frame.querySelectorAll<HTMLButtonElement>('button[aria-label]')
  for (const button of buttons) button.onclick = () => { picked.push(button.getAttribute('aria-label')!) }
  try {
    expect(style('.ui_sidebar__root__h1').display).toBe('grid')
    expect(style('.ui_sidebar__root__h1').columnGap).toBe('8px')
    // One painted header spans every column, including the gaps between its controls.
    expect(style('.ui_sidebar__logoRow__h1').gridColumn).toBe('1 / -1')
    // The host list cancels the root's side padding. Cover those exposed strips too,
    // without enlarging the header's layout box or moving the buttons.
    const headerShadow = style('.ui_sidebar__logoRow__h1').boxShadow
    expect(headerShadow).toContain('var(--dsh-sidebar-inline-padding,12px) 0 0 var(--dsw-specific-sidebar-fill)')
    expect(headerShadow).toContain('calc(-1 * var(--dsh-sidebar-inline-padding,12px)) 0 0 var(--dsw-specific-sidebar-fill)')
    expect(style('.ui_sidebar__brand__h1').gridColumn).toBe('1')
    expect(style('.ui_sidebar__toggle__h1').gridColumn).toBe('4')
    expect(style('.ui_sidebar__panelList__h1').gridColumn).toBe('3')
    expect(style('.ui_sidebar__footArea__h1').display).toBe('contents')
    expect(style('.ui_sidebar__settingsArea__h1').display).toBe('contents')
    expect(style('.settings__triggerRow__h1').gridColumn).toBe('2')
    expect(style('.settings__triggerRow__h1').width).toBe('auto')
    expect(style('.settings__triggerLabel__h1').display).toBe('none')
    expect(style('[data-connection-indicator]').display).not.toBe('none')
    // The project track grows with its content while the settings control shares the header.
    expect(style('.ui_sidebar__regionArea__h1').minHeight).toBe('auto')
    for (const selector of ['.ui_sidebar__logoRow__h1', '.ui_sidebar__panelList__h1', '.settings__triggerRow__h1']) {
      expect(style(selector).gridRow).toBe('1')
      expect(style(selector).position).toBe('sticky')
      expect(style(selector).top).toBe('0px')
      expect(style(selector).gap).toBe('8px')
    }
    expect(style('.ui_sidebar__panelList__h1').flexDirection).toBe('row')
    expect(style('.ui_sidebar__panelTitle__h1').display).toBe('none')
    for (const button of buttons) {
      expect(getComputedStyle(button).width).toBe('40px')
      expect(getComputedStyle(button).height).toBe('40px')
      expect(getComputedStyle(button).boxSizing).toBe('border-box')
      expect(getComputedStyle(button.querySelector('svg')!).width).toBe('18px')
      expect(getComputedStyle(button.querySelector('svg')!).height).toBe('18px')
      button.click()
    }
    expect(picked).toEqual(['收起侧边栏', '插件', '自动化任务', '设置'])
    frame.setAttribute('data-sidebar-collapsed', '')
    expect(style('.ui_sidebar__root__h1').display).not.toBe('grid')
    expect(style('.ui_sidebar__panelTitle__h1').display).not.toBe('none')
    expect(style('.settings__triggerRow__h1').gridColumn).not.toBe('2')
    expect(style('.settings__triggerLabel__h1').display).not.toBe('none')
    frame.removeAttribute('data-sidebar-collapsed')
    dispose()
    expect(style('.ui_sidebar__footArea__h1').display).not.toBe('contents')
    expect(style('.settings__triggerRow__h1').gridRow).not.toBe('1')
  } finally { dispose(); frame.remove() }
})

it('keeps automation headings, actions and summaries on one line with long text reachable', () => {
  const page = document.createElement('section')
  page.dataset.testid = 'task-manager-page'
  page.innerHTML = '<div class="schedule_pageHeading"><h1>自动化任务</h1><button>新建任务</button></div>'
    + '<div class="schedule_empty"><h2>还没有自动化任务，在会话中创建的任务会显示在这里</h2></div>'
    + '<span class="schedule_rowSummary"><span class="schedule_metadata">每周一到周五，每天上午十点</span></span>'
    + '<h2 class="schedule_readonlyName">每天汇总项目更新与待办事项</h2>'
    + '<div class="schedule_nextRun"><p>下次运行：2026年10月3日 上午10点</p></div>'
  document.body.append(page)
  const dispose = applyDrawerSelection()
  try {
    for (const element of page.querySelectorAll('h1,h2,button,.schedule_rowSummary,.schedule_metadata,.schedule_nextRun p')) {
      expect(getComputedStyle(element).whiteSpace).toBe('nowrap')
    }
    expect(getComputedStyle(page.querySelector('.schedule_pageHeading')!).overflowX).toBe('auto')
    expect(getComputedStyle(page.querySelector('.schedule_rowSummary')!).overflowX).toBe('auto')
    expect(getComputedStyle(page.querySelector('.schedule_empty')!).overflowX).toBe('auto')
  } finally { dispose(); page.remove() }
})

it.each([0, 3, 5, 6, 11])('limits Git changes to five visible rows without removing files (count: %s)', (count) => {
  const host = document.createElement('style')
  host.textContent = '.git_gitSectionBody{max-height:160px;overflow-y:auto;overflow-x:hidden}'
    + '.git_gitSectionBodyChanges{max-height:320px}'
    + '.git_gitSectionBodyHistory{max-height:none}'
    + '.git_gitRow{min-height:34px}'
  document.head.append(host)
  const root = document.createElement('div')
  root.innerHTML = '<div data-scroll-key="changes" class="git_gitSectionBody git_gitSectionBodyChanges">'
    + '<div class="git_gitScrollClip"><div class="git_gitScrollContent">'
    + Array.from({ length: count }, (_, i) => `<div class="git_gitRow"><input type="checkbox"><button>文件${i}</button></div>`).join('')
    + '</div></div></div>'
    + '<div data-scroll-key="stash" class="git_gitSectionBody"></div>'
    + '<div data-scroll-key="history" class="git_gitSectionBody git_gitSectionBodyHistory"></div>'
  document.body.append(root)
  const changes = root.firstElementChild!
  const dispose = applyDrawerSelection()
  try {
    expect(getComputedStyle(changes).maxHeight).toBe('170px')
    expect(getComputedStyle(changes).overflowY).toBe('auto')
    expect(changes.querySelectorAll('.git_gitRow')).toHaveLength(count)
    for (const row of changes.querySelectorAll('.git_gitRow')) {
      expect(getComputedStyle(row).minHeight).toBe('34px')
      expect(getComputedStyle(row).display).not.toBe('none')
    }
    const lastCheck = changes.querySelector<HTMLInputElement>('.git_gitRow:last-child input')
    lastCheck?.click()
    if (lastCheck) expect(lastCheck.checked).toBe(true)
    expect(getComputedStyle(root.querySelector('[data-scroll-key="stash"]')!).maxHeight).toBe('160px')
    expect(getComputedStyle(root.querySelector('[data-scroll-key="history"]')!).maxHeight).toBe('none')
    dispose()
    expect(getComputedStyle(changes).maxHeight).toBe('320px')
  } finally { dispose(); host.remove(); root.remove() }
})

it('keeps git history compact and makes long detail text wrap inside the dialog', () => {
  const host = document.createElement('style')
  host.textContent = '.git_gitSectionBodyHistory{overflow-x:hidden}'
    + '.git_gitLogRef{flex:0 1 auto;max-width:96px;text-overflow:ellipsis}'
  const root = document.createElement('div')
  root.innerHTML = '<div data-scroll-key="history" class="git_gitSectionBodyHistory">'
    + '<span class="git_gitLogRef">dsh-remote-control-01</span></div>'
    + '<dialog data-remote-control-git-details><h2>提交详情</h2><dl><dt>完整哈希</dt><dd>abcdef</dd></dl><button>关闭</button></dialog>'
  document.head.append(host)
  document.body.append(root)
  const dispose = applyDrawerSelection()
  try {
    expect(getComputedStyle(root.firstElementChild!).overflowX).toBe('hidden')
    expect(getComputedStyle(root.querySelector('.git_gitLogRef')!).maxWidth).toBe('96px')
    expect(getComputedStyle(root.querySelector('dd')!).overflowWrap).toBe('anywhere')
    expect(getComputedStyle(root.querySelector('dd')!).whiteSpace).toBe('pre-wrap')
    expect(getComputedStyle(root.querySelector('dialog button')!).minHeight).toBe('44px')
  } finally { dispose(); host.remove(); root.remove() }
})

it('stacks delegation and discussion controls with phone-sized touch targets', () => {
  const dispose = applyDrawerSelection()
  const phone = sheet()?.textContent ?? ''
  dispose()
  const mode = '.hp-delegate[data-hp-mode]'
  expect(phone).toContain(`${mode}{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));`)
  expect(phone).toContain(`${mode} > .hp-delegate-exit{grid-column:2;grid-row:1;justify-self:end;margin:0;width:36px;height:36px;position:sticky;top:-8px;z-index:1;background:var(--dsw-specific-input-major)}`)
  expect(phone).toContain(`${mode} > .hp-delegate-harness,${mode} > .hp-anchor{grid-column:1 / -1;min-width:0}`)
  expect(phone).toContain(`${mode} .hp-delegate-harness button{flex:1;justify-content:center;height:36px;`)
  expect(phone).toContain(`${mode} .hp-chip{width:100%;max-width:100%;height:36px;`)
  expect(phone).toContain(`${mode} .hp-delegate-report{min-width:0;margin-left:0;min-height:44px;padding:0 8px;gap:8px;line-height:18px;font-size:12px;white-space:normal;overflow-wrap:anywhere}`)
  expect(phone).toContain('border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-specific-input-major);')
})

it('keeps mode controls scrollable and model menus inside the visible keyboard viewport', () => {
  const dispose = applyDrawerSelection()
  const phone = sheet()?.textContent ?? ''
  dispose()
  const mode = '.hp-delegate[data-hp-mode]'
  expect(phone).toContain('max-height:min(280px,calc(var(--dsh-remote-keyboard-height,100dvh) * .45));overflow-y:auto;overscroll-behavior-y:contain')
  // A fixed menu escapes the mode bar's scroll clip, even after scrolling to the last option.
  expect(phone).toContain(`${mode} .hp-menu{position:fixed;left:16px;right:16px;`)
  expect(phone).toContain('bottom:var(--dsh-remote-mode-menu-bottom,50px);')
  expect(phone).toContain('background:var(--dsw-alias-bg-layer-2);opacity:1;backdrop-filter:none;-webkit-backdrop-filter:none;')
  expect(phone).toContain('width:auto;min-width:0;max-width:none;max-height:var(--dsh-remote-mode-menu-height,360px) !important}')
  expect(phone).toContain(`${mode} .hp-menu > *{flex-shrink:0}`)
  expect(phone).toContain(`${mode} .hp-menu :is(.hp-option,.hp-cell){min-height:44px}`)
  expect(phone).toContain(`${mode} .hp-option-hint,${mode} .hp-error{overflow-wrap:anywhere}`)
})

it('positions a newly opened task menu above its button and cleans up tracking', async () => {
  const viewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
    offsetTop: 20, addEventListener() {}, removeEventListener() {},
  } })
  const root = document.createElement('div')
  root.className = 'hp-delegate'
  root.dataset.hpMode = 'delegate'
  document.body.append(root)
  const dispose = applyDrawerSelection()
  const menu = document.createElement('div')
  menu.className = 'hp-menu'
  const button = document.createElement('button')
  button.className = 'hp-chip'
  let top = 420
  Object.defineProperty(button, 'getBoundingClientRect', { value: () => ({ top }) })
  const anchor = document.createElement('div')
  anchor.className = 'hp-anchor'
  anchor.append(button, menu)
  const settle = () => new Promise(resolve => setTimeout(resolve, 40))
  try {
    root.append(anchor)
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe(`${window.innerHeight - top + 8}px`)
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('360px')
    top = 300
    root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe(`${window.innerHeight - top + 8}px`)
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('264px')
    top = 260
    window.dispatchEvent(new Event('resize'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('224px')
    top = 10
    root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe(`${window.innerHeight - 80 + 8}px`)
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('44px')
    dispose()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe('')
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-height')).toBe('')
    root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(menu.style.getPropertyValue('--dsh-remote-mode-menu-bottom')).toBe('')
  } finally {
    dispose()
    root.remove()
    if (viewport) Object.defineProperty(window, 'visualViewport', viewport)
    else Reflect.deleteProperty(window, 'visualViewport')
  }
})
