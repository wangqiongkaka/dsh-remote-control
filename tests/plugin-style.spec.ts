// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

it.each(['proxy', 'reload'])('fits plugin lists, details and install dialogs to phones (%s)', source => {
  const host = document.createElement('style')
  host.textContent = '.plugins_cardTitle{white-space:nowrap;overflow:hidden}.plugins_cardDesc{display:-webkit-box;-webkit-line-clamp:1;overflow:hidden}'
    + '.plugins_toolbar[hidden]{display:none}.plugins_pageTabList{min-width:240px}.plugins_rowLine{display:flex}'
    + '.modal_dialog{display:flex;flex-direction:column}.modal_footer{display:flex}.settings_close{width:28px}'
  const page = document.createElement('section')
  page.setAttribute('data-plugin-panel', '')
  page.innerHTML = '<header class="plugins_pageHead"><div class="plugins_pageHeading"><h1>插件</h1></div><div class="plugins_toolbar"><button class="plugins_iconButton">刷新</button>'
    + '<span class="plugins_addGroup"><button class="plugins_addPrimary">添加插件</button><button class="plugins_addMore">更多</button></span></div>'
    + '<div class="plugins_toolbar" hidden>不可用操作</div></header>'
    + '<div class="plugins_pageTabs"><div class="plugins_pageTabList"><button role="tab">已安装</button><button role="tab">插件市场</button></div></div>'
    + '<ul class="plugins_cards"><li class="plugins_card"><div class="plugins_cardHead"><div class="plugins_cardMain">'
    + '<button class="plugins_cardTitle plugins_cardOpen">@organization/a-very-long-plugin-package-name</button>'
    + '<span class="plugins_cardDesc">较长的插件说明应该完整显示，帮助手机用户判断插件用途。</span></div>'
    + '<div class="plugins_cardEnd"><button role="switch" aria-checked="true">启用</button></div></div></li></ul>'
    + '<div class="plugins_detail"><div class="plugins_detailTop"><button class="plugins_crumb">返回插件列表</button></div>'
    + '<h3 class="plugins_detailTitle">很长的插件标题</h3><div class="plugins_detailActions"><button>卸载</button></div>'
    + '<input class="plugins_partsFilter" type="search"><div class="plugins_rowLine"><span class="plugins_rowIcon"></span>'
    + '<div class="plugins_rowMain">组件名称</div><span class="plugins_rowState">正在运行</span><button role="switch">启用</button></div></div>'
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
  document.body.append(page, overlay, wizard, registry, settings)
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
    expect(getComputedStyle(page).paddingLeft).toBe('16px')
    expect(style('.plugins_cardTitle').whiteSpace).toBe('normal')
    expect(style('.plugins_cardTitle').overflowWrap).toBe('anywhere')
    expect(style('.plugins_cardDesc').display).toBe('block')
    expect(style('.plugins_cardDesc').overflow).toBe('visible')
    expect(style('.plugins_pageHeading').paddingTop).not.toBe('16px')
    expect(style('.plugins_iconButton').width).toBe('44px')
    expect(style('.plugins_addMore').width).toBe('44px')
    expect(style('.plugins_addPrimary').minHeight).toBe('44px')
    expect(style('.plugins_toolbar[hidden]').display).toBe('none')
    expect(style('.plugins_pageTabs').overflowX).toBe('auto')
    expect(parseFloat(style('.plugins_pageTabList').minWidth)).toBe(0)
    expect(style('[role="tab"]').minHeight).toBe('44px')
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
    dispose(); phone.remove(); host.remove(); page.remove(); overlay.remove(); wizard.remove(); registry.remove(); settings.remove()
    for (const node of proxy) node.remove()
  }
})
