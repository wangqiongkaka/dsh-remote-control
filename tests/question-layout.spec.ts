// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection, DRAWER_STYLE_ATTRIBUTE } from '../dist/client/drawer-style.js'

it.each(['proxy', 'client'])('keeps long approval headings scrollable and the action row reachable via %s styles', delivery => {
  const host = document.createElement('style')
  host.textContent = '.host_card{display:flex;flex-direction:column;max-height:min(60vh,520px);overflow:hidden}'
    + '.host_header{display:flex;flex-shrink:0}.host_headingBlock{min-width:0}'
    + '.host_body{min-height:0;overflow-y:auto}.host_footer{display:flex;flex-shrink:0}'
  const root = document.createElement('div')
  root.setAttribute('data-question-key', 'approval-long-command')
  root.innerHTML = '<section class="host_card"><header class="host_header"><div class="host_headingBlock">'
    + `<h2>${'xcrun simctl launch preview --design-preview; '.repeat(100)}</h2></div><button>收起</button></header>`
    + '<div class="host_body" data-question-scroll><button role="radio">允许本次</button><button role="radio">拒绝</button></div>'
    + '<footer class="host_footer"><button>跳过</button><button>提交</button></footer></section>'
  document.head.append(host)
  document.body.append(root)
  const proxy = document.createElement('div')
  proxy.innerHTML = phoneDocument('<head></head>')
  const style = delivery === 'proxy' ? proxy.querySelector<HTMLStyleElement>('style[data-dsh-remote-control]')! : null
  const dispose = delivery === 'client' ? applyDrawerSelection() : () => { style?.remove() }
  if (style) document.head.append(style)
  const active = document.createElement('style')
  // jsdom has no media layout. Activate only the delivered narrow-screen question rules.
  const rules = (list: CSSRuleList): string => Array.from(list).flatMap(rule => {
    if (rule instanceof CSSMediaRule) return rules(rule.cssRules)
    return rule instanceof CSSStyleRule && rule.selectorText.includes('[data-question-key]') ? [rule.cssText] : []
  }).join('')
  const delivered = style ?? document.head.querySelector<HTMLStyleElement>(`style[${DRAWER_STYLE_ATTRIBUTE}]`)!
  active.textContent = rules(delivered.sheet!.cssRules)
  document.head.append(active)
  try {
    const heading = root.querySelector<HTMLElement>('.host_headingBlock')!
    expect(getComputedStyle(heading).overflowY).toBe('auto')
    expect(getComputedStyle(heading).maxHeight).toContain('var(--dsh-remote-keyboard-height,100dvh)')
    expect(getComputedStyle(heading).maxHeight).toContain('160px')
    expect(getComputedStyle(heading).overflowWrap).toBe('anywhere')
    expect(getComputedStyle(heading).overscrollBehaviorY).toBe('contain')
    expect(getComputedStyle(root.querySelector('section')!).maxHeight).toContain('var(--dsh-remote-keyboard-height,100dvh)')
    expect(getComputedStyle(root.querySelector('footer')!).flexWrap).toBe('wrap')
    expect(root.querySelectorAll('[role="radio"]')).toHaveLength(2)
    expect(root.querySelector('footer')!.textContent).toContain('提交')
    expect(heading.textContent).toBe('xcrun simctl launch preview --design-preview; '.repeat(100))
  } finally { dispose(); active.remove(); root.remove(); host.remove() }
})
