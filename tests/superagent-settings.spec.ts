// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { phoneDocument } from '../dist/phone-document.js'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

const fixture = readFileSync('tests/fixtures/superagent-settings.html', 'utf8')
const desktop = '.dt-rows-item{display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto}'
  + '.dt-row-label{overflow:hidden;white-space:nowrap}.dt-rule-preview{white-space:nowrap}'

it.each(['proxy', 'reload'])('stacks settings with live localized admission labels (%s)', async source => {
  document.body.innerHTML = fixture
  const proxy = source === 'proxy'
    ? [...new DOMParser().parseFromString(phoneDocument('<head></head>'), 'text/html').querySelectorAll('style')] : []
  document.head.append(...proxy)
  const dispose = applyDrawerSelection()
  const phone = document.createElement('style')
  phone.textContent = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 720px)')
    .flatMap(rule => [...rule.cssRules].map(child => child.cssText)).join('')
  const host = document.createElement('style')
  host.textContent = desktop
  document.head.append(phone, host)
  const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  const cells = () => [...document.querySelectorAll('.dt-admission tbody td')]
  try {
    expect(cells().slice(1).map(cell => cell.getAttribute('data-dsh-admission-label')))
      .toEqual(['名单内 未 @', '名单外 点名智能体', '名单外 未 @'])
    expect(style('.dt-admission tbody tr').gridTemplateColumns).toBe('minmax(0,1fr)')
    expect(style('.dt-rows-item').gridTemplateColumns).toBe('minmax(0,1fr) auto')
    const single = document.createElement('li')
    single.className = 'dt-rows-item'
    single.dataset.single = ''
    single.innerHTML = '<input aria-label="账号"><button type="button">删除</button>'
    document.querySelector('.dt-rows')!.append(single)
    expect(style('[data-single] > :first-child').gridColumn).not.toBe('1 / -1')
    expect(style('[data-single] > :last-child').gridRow).not.toBe('2')
    expect(style('.dt-row-label').whiteSpace).toBe('normal')
    expect(style('.dt-rule-preview').whiteSpace).toBe('normal')
    // A changed locale and newly rendered rows must use the current headings, including unavailable cells.
    const header = document.querySelectorAll('.dt-admission th')[1]!
    header.firstChild!.textContent = 'Listed'
    const row = document.querySelector('.dt-admission tbody tr')!
    row.parentElement!.append(row.cloneNode(true))
    await vi.waitFor(() => expect(cells()[1]!.getAttribute('data-dsh-admission-label')).toBe('Listed 未 @'))
    expect(cells()[5]!.getAttribute('data-dsh-admission-label')).toBe('Listed 未 @')
    expect(document.querySelector('select')!.value).toBe('不同步')
    dispose()
    expect(document.querySelector('[data-dsh-admission-label]')).toBeNull()
  } finally {
    dispose(); phone.remove(); host.remove()
    for (const node of proxy) node.remove()
    document.body.replaceChildren()
  }
})
