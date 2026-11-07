// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

it.each(['proxy', 'reload'])('compacts the phone automation catalog without changing details (%s)', source => {
  document.body.innerHTML = '<main class="shell_frame" data-sidebar-drawer><aside class="shell_sidebarCol"></aside>'
    + '<div class="shell_mainPanel" data-global-panel><section data-testid="task-manager-page"><div class="tasks_pageContent">'
    + '<div class="tasks_pageHeading"><h1>自动化任务</h1><div class="tasks_creationActions"><button class="tasks_newButton">新建</button><button class="tasks_menuButton" aria-label="更多创建方式">更多</button></div></div>'
    + '<div class="tasks_filters"><div class="tasks_filterTabs"><button class="tasks_filterTab">已开启</button></div></div>'
    + '<div class="tasks_searchField"><input type="search"></div><div class="tasks_empty"><h2>没有已开启的自动化任务</h2><button class="tasks_emptyAction">新建自动化任务</button></div>'
    + '</div><div class="tasks_detail"><h2>详情</h2></div></section></div></main>'
  const host = document.createElement('style')
  host.textContent = '.shell_frame[data-sidebar-drawer] .shell_mainPanel[data-global-panel]{padding-top:48px}'
    + '[data-platform] .tasks_pageHeading{padding-top:76px}.tasks_pageContent{padding:0 24px 48px}'
    + '.tasks_filterTab{height:28px}.tasks_searchField{height:36px}.tasks_detail{padding:20px}'
  document.documentElement.setAttribute('data-platform', 'darwin')
  const proxy = source === 'proxy'
    ? [...new DOMParser().parseFromString(phoneDocument('<head></head>'), 'text/html').querySelectorAll('style')] : []
  document.head.append(...proxy)
  const dispose = source === 'reload' ? applyDrawerSelection() : () => {}
  const phone = document.createElement('style')
  phone.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)')
    .flatMap(rule => [...rule.cssRules].map(child => child.cssText)).join('')
  document.head.append(phone, host)
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  try {
    expect(style('[data-global-panel]').paddingTop).toBe('0px')
    expect(style('.tasks_pageHeading').paddingTop).toBe('11px')
    expect(style('.tasks_pageContent').paddingTop).toBe('0px')
    expect(style('.tasks_pageHeading').height).toBe('66px')
    expect(style('.tasks_pageHeading').position).toBe('sticky')
    expect(style('.tasks_pageHeading').top).toBe('0px')
    expect(style('.tasks_pageContent').paddingLeft).toBe('16px')
    expect(style('.tasks_filterTab').height).toBe('44px')
    expect(style('.tasks_searchField').height).toBe('44px')
    expect(style('.tasks_newButton').minHeight).toBe('44px')
    expect(style('.tasks_menuButton').minHeight).toBe('44px')
    expect(style('.tasks_menuButton').minWidth).toBe('44px')
    expect(style('.tasks_emptyAction').minHeight).toBe('44px')
    expect(style('.tasks_detail').paddingTop).toBe('20px')
  } finally {
    dispose(); phone.remove(); host.remove()
    for (const node of proxy) node.remove()
    document.documentElement.removeAttribute('data-platform')
    document.body.replaceChildren()
  }
})
