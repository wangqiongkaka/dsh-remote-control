// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

it.each(['proxy', 'reload'])('adapts settings navigation, long rows and font controls on phones (%s)', source => {
  const host = document.createElement('style')
  host.textContent = '.pref_row{display:flex;align-items:center}.font_arrows{position:absolute;opacity:0}'
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'presentation')
  overlay.innerHTML = '<div role="dialog" data-shortcut-modal="settings"><nav><div class="settings_navTitle">设置</div>'
    + '<div class="settings_navList"><button class="settings_navCell">通用设置</button></div></nav>'
    + '<div class="settings_content"><div class="settings_header"><button class="settings_close">关闭</button></div>'
    + '<div class="settings_options"><div data-slot="settings.general.item">'
    + '<div class="pref_row" id="language"><div class="pref_rowText">语言</div><button class="pref_selector">中文</button></div>'
    + '<div class="pref_row" id="links"><div class="pref_rowText"><div>网页链接默认打开方式</div>'
    + '<div class="pref_desc">对话中网页链接的打开位置</div></div><span><button class="pref_selector">应用内侧边栏</button></span></div>'
    + '<div class="pref_row"><div class="pref_rowText">字号大小</div><div class="font_control"><div class="font_stepper">'
    + '<span class="font_value">14</span><span class="font_arrows"><button class="font_arrow">增大</button>'
    + '<button class="font_arrow">减小</button></span></div></div></div></div></div></div></div>'
  document.head.append(host)
  document.body.append(overlay)
  const proxyStyles = source === 'proxy'
    ? Array.from(new DOMParser().parseFromString(phoneDocument('<head></head>'), 'text/html').querySelectorAll('style')) : []
  for (const style of proxyStyles) document.head.append(style)
  const dispose = source === 'reload' ? applyDrawerSelection() : () => {}
  const injected = Array.from(document.head.querySelectorAll('style')).map(node => node.textContent).join('')
  // jsdom does not apply media queries; activate the built phone rules for layout assertions.
  const phone = document.createElement('style')
  phone.textContent = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)')
    .flatMap(rule => Array.from(rule.cssRules).map(child => child.cssText)).join('')
  document.head.append(phone)
  const style = (selector: string) => getComputedStyle(overlay.querySelector(selector)!)
  try {
    expect(getComputedStyle(overlay).alignItems).toBe('flex-end')
    expect(injected).toContain('var(--dsh-settings-ratio,.5)')
    expect(parseFloat(style('[role="dialog"]').borderBottomLeftRadius)).toBe(0)
    expect(parseFloat(style('[role="dialog"]').borderBottomRightRadius)).toBe(0)
    expect(injected).toContain('@keyframes dsh-remote-settings-in{from{transform:translateY(100%)}to{transform:translateY(0)}}')
    expect(injected).toContain('@media (prefers-reduced-motion: reduce){[data-shortcut-modal="settings"]{animation:none !important}}')
    expect(style('.settings_close').width).toBe('44px')
    expect(style('.settings_close').height).toBe('44px')
    expect(style('.settings_navCell').minHeight).toBe('44px')
    expect(style('.settings_navList').overflowX).toBe('auto')
    expect(style('.settings_content').overflow).toBe('hidden')
    expect(parseFloat(style('.settings_content').paddingBottom)).toBe(0)
    expect(style('.settings_options').overscrollBehaviorY).toBe('contain')
    expect(style('.settings_options').paddingBottom).toBe('16px')
    expect(injected).not.toContain('mask-image:linear-gradient')
    expect(injected).toContain('mask-image:none')
    expect(getComputedStyle(overlay).height).toBe('var(--dsh-remote-keyboard-height,100dvh)')
    expect(style('#links').flexDirection).toBe('column')
    expect(style('#links .pref_selector').width).toBe('100%')
    expect(style('#language').flexDirection).not.toBe('column')
    expect(style('.font_arrows').display).toBe('contents')
    expect(style('.font_arrow').width).toBe('44px')
    expect(style('.font_arrow').height).toBe('44px')
  } finally {
    dispose(); phone.remove(); host.remove(); overlay.remove()
    for (const node of proxyStyles) node.remove()
  }
})
