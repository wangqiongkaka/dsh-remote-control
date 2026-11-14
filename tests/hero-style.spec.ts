// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'

it('keeps the whole New Session row on one line on a phone', () => {
  const doc = new DOMParser().parseFromString(phoneDocument('<head></head>'), 'text/html')
  const proxy = Array.from(doc.querySelectorAll('style')).map((node) => {
    const style = document.createElement('style')
    style.textContent = node.textContent
    return style
  })
  const frame = document.createElement('main')
  frame.className = 'AppFrame_frame_x'
  frame.innerHTML = '<aside class="Layout_sidebarCol_x"></aside>'
    + '<div data-phase="hero"><div data-conversation-content=""><div class="ConversationRoot_heroWorkspaceRow_x">'
    + '<button class="HeroShell_workspace_x"><span class="HeroShell_workspaceLabel_x">kube-vip</span></button>'
    + '<span class="AgentPresetSeat_menuAnchor_x"><button class="AgentPresetSeat_seat_x">标准模式</button></span>'
    + '<div class="ConversationRoot_heroOptions_x"><span data-forge-worktree="">'
    + '<button class="WorktreeToggle_current_x">main</button>'
    + '<label class="WorktreeToggle_toggle_x"><input type="checkbox">新建工作树</label>'
    + '</span></div>'
    + '</div></div></div>'
  // ui-forge's 600px rule in its active form (jsdom does not evaluate media queries): below 600px
  // that branch is part of the phone layout, and the patch has to outrank it.
  const forge = document.createElement('style')
  forge.textContent = '[data-forge-worktree]{display:inline-flex;flex:none;flex-direction:column;align-items:flex-end;gap:0}'
    + '[class*="_current"],[class*="_toggle"]{padding:0 8px;gap:6px}'
  document.head.append(forge, ...proxy)
  document.body.append(frame)
  // jsdom does not apply media queries; activate only the built phone rules.
  const phone = document.createElement('style')
  phone.textContent = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)')
    .flatMap(rule => Array.from(rule.cssRules).map(child => child.cssText)).join('')
  document.head.append(phone)
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  try {
    // One line: nothing wraps, and forge's stacked column is undone.
    expect(style('[class*="_heroWorkspaceRow"]').flexWrap).toBe('nowrap')
    expect(style('[data-forge-worktree]').flexDirection).toBe('row')
    expect(style('[data-forge-worktree]').alignItems).toBe('center')
    // The room that buys comes from padding and gaps, not from the labels.
    expect(style('[class*="_heroWorkspaceRow"]').paddingLeft).toBe('10px')
    expect(style('[class*="_heroWorkspaceRow"]').paddingRight).toBe('10px')
    expect(style('[class*="_workspace"]').paddingLeft).toBe('5px')
    expect(style('[class*="_seat"]').paddingLeft).toBe('5px')
    expect(style('[class*="_current"]').paddingLeft).toBe('4px')
    expect(style('[class*="_toggle"]').paddingLeft).toBe('4px')
    // The leading chips may shrink instead of pushing the row past its width.
    expect(style('[class*="_workspace"]').minWidth).toBe('0px')
    expect(style('[class*="_menuAnchor"]').minWidth).toBe('0px')
  } finally {
    phone.remove()
    forge.remove()
    frame.remove()
    for (const node of proxy) node.remove()
  }
})
