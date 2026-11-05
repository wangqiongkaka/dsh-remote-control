// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

// dsh-superagent's own rules that the phone layer must override; the plugin appends them after the proxy's sheet.
const SUPERAGENT = '.dt-page{padding:28px 24px 0}.dt-head{display:flex;flex-wrap:wrap}[data-platform] .dt-page .dt-head{padding-top:48px}'
  + '.dt-toolbar{display:flex}.dt-search{width:240px}.dt-page .dt-tab{height:34px}.dt-btn-sm{height:28px}.dt-input{height:32px}'
  + '.dt-modal-root{position:fixed;inset:0;display:flex;align-items:center;padding:24px}.dt-modal{width:380px;border-radius:24px}'
  + '.dt-modal.dt-glossary-modal{width:680px}.dt-modal-close{width:28px;height:28px}'
  + '.dt-glossary th:nth-child(-n+2),.dt-glossary td:nth-child(-n+2){white-space:nowrap}.dt-toast{position:fixed;top:40px}'

it.each(['proxy', 'reload'])('fits the Superagent panel, dialogs and toast to phones (%s)', source => {
  document.documentElement.setAttribute('data-platform', 'darwin')
  const page = document.createElement('div')
  page.className = 'dt-page'
  page.innerHTML = '<div class="dt-column"><header class="dt-head"><div class="dt-head-title"><h1 class="dt-title">Superagent</h1></div>'
    + '<div class="dt-toolbar"><form class="dt-search"><span class="dt-input"><input type="search"></span></form>'
    + '<button class="dt-btn dt-btn-sm">打开主 Session</button></div></header>'
    + '<div class="dt-tabs"><button role="tab" class="dt-tab">概览</button></div>'
    + '<button class="dt-switch" role="switch"><span class="dt-switch-thumb"></span></button></div>'
  const modal = document.createElement('div')
  modal.className = 'dt-modal-root'
  modal.setAttribute('role', 'presentation')
  modal.innerHTML = '<div class="dt-modal-mask"></div><div class="dt-modal dt-glossary-modal" role="dialog">'
    + '<div class="dt-modal-header"><h2>术语表</h2><button class="dt-modal-close">关闭</button></div>'
    + '<div class="dt-modal-body"><table class="dt-glossary"><tbody><tr><td>工单</td><td>Ticket</td><td>一个获授权的工作单元</td></tr></tbody></table></div>'
    + '<div class="dt-modal-footer"><button class="dt-btn dt-btn-md">关闭</button></div></div>'
  const toast = document.createElement('div')
  toast.className = 'dt-toast'
  document.body.append(page, modal, toast)
  const proxy = source === 'proxy'
    ? Array.from(new DOMParser().parseFromString(phoneDocument('<head></head>'), 'text/html').querySelectorAll('style')) : []
  document.head.append(...proxy)
  const dispose = source === 'reload' ? applyDrawerSelection() : () => {}
  // jsdom does not apply media queries; activate only the built phone rules, then the plugin's own sheet after them.
  const phone = document.createElement('style')
  phone.textContent = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)')
    .flatMap(rule => Array.from(rule.cssRules).map(child => child.cssText)).join('')
  const superagent = document.createElement('style')
  superagent.textContent = SUPERAGENT
  document.head.append(phone, superagent)
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  try {
    expect(style('.dt-page').paddingLeft).toBe('16px')
    expect(style('.dt-page').paddingTop).toBe('8px')
    expect(style('.dt-head').paddingTop).toBe('0px')
    expect(style('.dt-toolbar').display).toBe('contents')
    expect(style('.dt-search').order).toBe('1')
    expect(style('.dt-search').width).toBe('100%')
    expect(style('.dt-tab').height).toBe('44px')
    expect(style('.dt-input').height).toBe('44px')
    expect(style('.dt-page .dt-btn').minHeight).toBe('36px')
    expect(phone.textContent).toContain('.dt-switch::after')
    expect(style('.dt-modal-root').alignItems).toBe('flex-end')
    expect(style('.dt-modal').width).toBe('100%')
    expect(style('.dt-modal').boxSizing).toBe('border-box')
    expect(style('.dt-modal-close').width).toBe('44px')
    expect(style('.dt-modal-footer .dt-btn').minHeight).toBe('36px')
    expect(style('.dt-glossary tr').display).toBe('grid')
    expect(style('.dt-glossary td').whiteSpace).toBe('normal')
    expect(style('.dt-glossary td:nth-child(3)').gridColumn).toBe('1 / -1')
    expect(style('.dt-toast').top).toContain('--dsh-remote-top-clearance')
  } finally {
    dispose(); phone.remove(); superagent.remove(); page.remove(); modal.remove(); toast.remove()
    for (const node of proxy) node.remove()
    document.documentElement.removeAttribute('data-platform')
  }
})
