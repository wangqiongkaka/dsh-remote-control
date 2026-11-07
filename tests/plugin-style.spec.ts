// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

it.each([
  ['proxy', 'header', false], ['reload', 'header', false], ['proxy', 'div', false], ['reload', 'div', false],
  ['proxy', 'header', true], ['reload', 'header', true],
] as const)('fits plugin lists, details and install dialogs to phones (%s, %s, measured: %s)', (source, headTag, measured) => {
  const host = document.createElement('style')
  host.textContent = '.plugins_cardTitle{white-space:nowrap;overflow:hidden}.plugins_cardDesc{display:-webkit-box;-webkit-line-clamp:1;overflow:hidden}'
    + '.plugins_toolbar[hidden]{display:none}.plugins_pageTabList{min-width:240px}.plugins_rowLine{display:flex}'
    + '.tabs_indicator{border:1px solid #555;box-shadow:0 0 2px #555}'
    + '.modal_dialog{display:flex;flex-direction:column}.modal_footer{display:flex}.settings_close{width:28px}'
    + '.shell_frame[data-sidebar-drawer] .shell_mainPanel[data-global-panel]{padding-top:48px}'
    + '[data-plugin-panel]{display:flex;align-items:center}'
    + '.plugins_toolbar{order:3;flex-basis:100%}.plugins_pageHeading{flex-basis:100%}'
    + '.plugins_pageHead,.plugins_detailTop,.plugins_moreHead{padding-top:76px}'
    + '.plugins_pageBody{flex:1;overflow-y:auto;scroll-padding-top:88px}'
    + '.plugins_pageBar[data-natural]{position:sticky;top:0}'
    + '.plugins_pageBar[data-natural] .plugins_pageHead{height:260px;clip-path:inset(0 0 40px 0)}'
    + '.plugins_pageBar[data-natural] .plugins_pageHeading{display:contents}'
    + '.plugins_pageBar[data-natural] [data-plugin-header-part]{position:absolute;top:76px;width:300px}'
  const page = document.createElement('section')
  page.setAttribute('data-plugin-panel', '')
  page.innerHTML = `<${headTag} class="plugins_pageHead"><div class="plugins_pageHeading"><h1 class="plugins_pageTitle">插件</h1><div class="plugins_pageIntro"><span>安装、启用和配置插件</span><button class="plugins_infoButton" aria-label="说明">?</button></div></div><div class="plugins_toolbar"><button class="plugins_iconButton"><span class="plugins_toolbarLabel">刷新</span></button>`
    + '<span class="plugins_addGroup"><button class="plugins_addPrimary">添加插件</button><button class="plugins_addMore">更多</button></span></div>'
    + `<div class="plugins_toolbar" hidden>不可用操作</div></${headTag}>`
    + '<div class="plugins_pageTabs"><div class="plugins_pageTabList" role="tablist"><span class="tabs_indicator" aria-hidden="true"></span><button role="tab" aria-selected="true">已安装</button><button role="tab" aria-selected="false">插件市场</button></div></div>'
    + '<ul class="plugins_cards"><li class="plugins_card"><div class="plugins_cardHead"><div class="plugins_cardMain">'
    + '<button class="plugins_cardTitle plugins_cardOpen">@organization/a-very-long-plugin-package-name</button>'
    + '<span class="plugins_cardDesc">较长的插件说明应该完整显示，帮助手机用户判断插件用途。</span></div>'
    + '<div class="plugins_cardEnd"><button role="switch" aria-checked="true">启用</button></div></div></li></ul>'
    + '<div class="plugins_detail"><div class="plugins_detailTop"><button class="plugins_crumb">返回插件列表</button></div>'
    + '<h3 class="plugins_detailTitle">很长的插件标题</h3><div class="plugins_detailActions"><button>卸载</button></div>'
    + '<input class="plugins_partsFilter" type="search"><div class="plugins_rowLine"><span class="plugins_rowIcon"></span>'
    + '<div class="plugins_rowMain">组件名称</div><span class="plugins_rowState">正在运行</span><button role="switch">启用</button></div></div>'
    + '<div class="plugins_moreHead"><button class="plugins_moreBack">返回</button><h1>实验性插件</h1></div>'
  if (measured) {
    const body = document.createElement('div')
    body.className = 'plugins_pageBody'
    body.setAttribute('data-plugin-body', '')
    body.append(...page.childNodes)
    const bar = document.createElement('div')
    bar.className = 'plugins_pageBar'
    bar.setAttribute('data-plugin-bar', '')
    bar.setAttribute('data-natural', '')
    bar.append(body.querySelector('.plugins_pageHead')!)
    body.prepend(bar)
    const title = bar.querySelector<HTMLElement>('h1')!
    title.setAttribute('data-plugin-header-part', 'title')
    bar.querySelector('.plugins_toolbar')!.setAttribute('data-plugin-header-part', 'toolbar')
    title.style.cssText = 'translate:0 -20px;width:300px;clip-path:inset(20% 0 0)'
    page.append(body)
  }
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'presentation')
  overlay.innerHTML = '<div role="dialog" class="modal_dialog plugins_installDialog"><div class="modal_content">'
    + '<div class="modal_header"><h2>添加插件</h2><button class="modal_close">关闭</button></div>'
    + '<div class="modal_body"><div class="plugins_installField"><input type="text"></div></div></div>'
    + '<div class="modal_footer"><button>取消</button><button>安装</button></div></div>'
  const wizard = document.createElement('div')
  wizard.setAttribute('role', 'presentation')
  wizard.innerHTML = '<div role="dialog" class="modal_dialog plugins_installDialog"><div class="plugins_wizard">'
    + '<button class="plugins_wizardClose">关闭</button><div class="plugins_wizardScroll">安装结果和日志</div>'
    + '<div class="plugins_wizardFoot"><button>展开日志</button><span class="plugins_wizardActions"><button>重试</button></span></div></div></div>'
  const registry = document.createElement('div')
  registry.className = 'plugins_registry'
  registry.style.cssText = 'position:fixed;top:600px;left:100px'
  registry.innerHTML = '<label class="plugins_registryOption"><input type="radio">npm 官方源</label><input class="plugins_registryCustomField">'
  const settings = document.createElement('div')
  settings.setAttribute('role', 'presentation')
  settings.innerHTML = '<div role="dialog" data-shortcut-modal="settings"><div class="settings_header"><button class="settings_close">关闭设置</button></div></div>'
  document.head.append(host)
  const frame = document.createElement('main')
  frame.className = 'shell_frame'
  frame.setAttribute('data-sidebar-drawer', '')
  frame.innerHTML = '<aside class="shell_sidebarCol"></aside><div class="shell_mainPanel" data-global-panel></div>'
  frame.querySelector('[data-global-panel]')!.append(page)
  document.body.append(frame, overlay, wizard, registry, settings)
  const proxy = source === 'proxy'
    ? Array.from(new DOMParser().parseFromString(phoneDocument('<head></head>'), 'text/html').querySelectorAll('style')) : []
  document.head.append(...proxy)
  const dispose = source === 'reload' ? applyDrawerSelection() : () => {}
  // jsdom does not apply media queries; activate only the built phone rules.
  const phone = document.createElement('style')
  phone.textContent = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)')
    .flatMap(rule => Array.from(rule.cssRules).map(child => child.cssText)).join('')
  document.head.append(phone)
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  try {
    expect(style('[data-global-panel]').paddingTop).toBe('0px')
    expect(style('.plugins_pageHead').display).toBe('contents')
    expect(style('.plugins_pageTitle').position).toBe(measured ? 'fixed' : 'sticky')
    expect(getComputedStyle(page).display).toBe(measured ? 'flex' : 'grid')
    expect(style('.plugins_pageTitle').height).toBe('66px')
    expect(style('.plugins_pageTitle').maxHeight).toBe('66px')
    expect(style('.plugins_pageTitle').overflow).toBe('hidden')
    expect(style('.plugins_toolbar:not([hidden])').maxHeight).toBe('66px')
    expect(style('.plugins_toolbar:not([hidden])').position).toBe(measured ? 'fixed' : 'sticky')
    expect(style('.plugins_toolbar:not([hidden])').height).toBe('66px')
    expect(style('.plugins_toolbarLabel').position).not.toBe('sticky')
    expect(style('.plugins_toolbarLabel').height).not.toBe('66px')
    expect(style('.plugins_toolbar:not([hidden])').gridColumn).toBe('2')
    expect(style('.plugins_toolbar:not([hidden])').gridRow).toBe('1')
    expect(style('.plugins_pageTabs').gridColumn).toBe('2')
    expect(style('.plugins_pageTabs').gridRow).toBe('2')
    expect(style('.plugins_pageTabs').justifySelf).toBe('end')
    expect(style('.plugins_pageIntro').gridColumn).toBe('1')
    expect(style('.plugins_pageIntro').gridRow).toBe('2')
    expect(style('.plugins_cards').gridColumn).toBe('1 / -1')
    expect(getComputedStyle(page).paddingLeft).toBe('12px')
    expect(getComputedStyle(page).paddingRight).toBe('12px')
    expect(getComputedStyle(page).getPropertyValue('--plugin-page-inset')).toBe('12px')
    expect(getComputedStyle(page).scrollbarWidth).toBe('none')
    expect(getComputedStyle(page).scrollbarGutter).toBe('auto')
    const scrollbar = [...phone.sheet!.cssRules].find((rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule && rule.selectorText.includes('[data-plugin-body]::-webkit-scrollbar'))
    expect(scrollbar?.style.display).toBe('none')
    expect(style('.plugins_cardTitle').whiteSpace).toBe('normal')
    expect(style('.plugins_cardTitle').overflowWrap).toBe('anywhere')
    expect(style('.plugins_cardDesc').display).toBe('block')
    expect(style('.plugins_cardDesc').overflow).toBe('visible')
    expect(style('.plugins_pageHead').paddingTop).toBe('0px')
    expect(style('.plugins_detailTop').paddingTop).toBe('0px')
    expect(style('.plugins_moreHead').paddingTop).toBe('0px')
    if (measured) {
      expect(style('[data-plugin-header-part]').position).toBe('fixed')
      expect(style('.plugins_pageTitle').left).toBe('12px')
      expect(style('.plugins_toolbar:not([hidden])').right).toBe('12px')
      expect(style('[data-plugin-header-part]').translate).toBe('none')
      expect(style('[data-plugin-header-part]').clipPath).toBe('none')
      expect(style('[data-plugin-header-part]').width).toBe('auto')
      expect(style('.plugins_pageHead').height).toBe('auto')
      expect(style('.plugins_pageHead').clipPath).toBe('none')
      expect(style('.plugins_pageHeading').display).toBe('contents')
      expect(style('[data-plugin-bar]').display).toBe('contents')
      expect(style('[data-plugin-body]').display).toBe('grid')
      expect(style('[data-plugin-body]').overflowY).toBe('auto')
      expect(style('[data-plugin-body]').scrollbarWidth).toBe('none')
      expect(style('[data-plugin-body]').flexGrow).toBe('1')
      const bar = page.querySelector('[data-plugin-bar]')!
      bar.removeAttribute('data-natural')
      expect(getComputedStyle(bar).display).toBe('contents')
      bar.setAttribute('data-natural', '')
      expect(getComputedStyle(page).overflowY).toBe('clip')
    }
    expect(style('.plugins_pageHeading').paddingTop).not.toBe('16px')
    expect(style('.plugins_iconButton').height).toBe('36px')
    expect(style('.plugins_iconButton').minHeight).toBe('36px')
    expect(style('.plugins_iconButton').fontSize).toBe('13px')
    expect(style('.plugins_addMore').width).toBe('36px')
    expect(style('.plugins_addPrimary').minHeight).toBe('36px')
    expect(style('.plugins_toolbar[hidden]').display).toBe('none')
    expect(style('.plugins_pageTabs').overflowX).toBe('auto')
    expect(parseFloat(style('.plugins_pageTabList').minWidth)).toBe(0)
    expect(style('[role="tab"]').minHeight).toBe('36px')
    expect(style('[role="tab"]').fontSize).toBe('13px')
    expect(style('.tabs_indicator').borderTopWidth).toBe('0px')
    expect(style('.tabs_indicator').boxShadow).toBe('none')
    expect(style('[aria-selected="true"]').fontWeight).toBe('600')
    const tabs = page.querySelectorAll('[role="tab"]')
    tabs[0]!.setAttribute('aria-selected', 'false')
    tabs[1]!.setAttribute('aria-selected', 'true')
    expect(getComputedStyle(tabs[0]!).fontWeight).toBe('400')
    expect(getComputedStyle(tabs[1]!).fontWeight).toBe('600')
    expect(style('.plugins_crumb').minHeight).toBe('44px')
    expect(style('.plugins_partsFilter').width).toBe('100%')
    expect(style('.plugins_rowLine').display).toBe('grid')
    expect(style('.plugins_rowMain').gridColumn).toBe('2')
    expect(style('.plugins_rowLine [role="switch"]').gridColumn).toBe('3')
    expect(style('.plugins_rowState').gridColumn).toBe('2')
    expect(phone.textContent).toContain('[data-plugin-panel] [role="switch"]::after')
    expect(phone.textContent).toContain('inset: -12px -4px')
    expect(getComputedStyle(overlay).alignItems).toBe('flex-end')
    expect(style('.plugins_installDialog').width).toBe('100%')
    expect(style('.modal_content').overflowY).toBe('auto')
    expect(style('.modal_footer').flexShrink).toBe('0')
    expect(style('.modal_footer button').minHeight).toBe('44px')
    expect(style('.modal_close').width).toBe('44px')
    expect(style('.plugins_installField input').minHeight).toBe('44px')
    expect(style('.plugins_wizardClose').width).toBe('44px')
    expect(style('.plugins_wizardFoot').flexDirection).toBe('column')
    expect(style('.plugins_wizardScroll').overflowY).toBe('auto')
    expect(style('.plugins_registry').overflowY).toBe('auto')
    expect(style('.plugins_registry').top).toBe('auto')
    expect(style('.plugins_registry').left).toBe('12px')
    expect(style('.plugins_registryCustomField').minHeight).toBe('44px')
    expect(style('.settings_close').width).toBe('44px')
    // Dialog sizing belongs to plugin management, and disappears with the page.
    page.remove()
    expect(getComputedStyle(overlay).alignItems).not.toBe('flex-end')
    phone.remove(); dispose()
    for (const node of proxy) node.remove()
    document.body.append(page)
    expect(style('.plugins_cardTitle').whiteSpace).toBe('nowrap')
  } finally {
    dispose(); phone.remove(); host.remove(); frame.remove(); page.remove(); overlay.remove(); wizard.remove(); registry.remove(); settings.remove()
    for (const node of proxy) node.remove()
  }
})
