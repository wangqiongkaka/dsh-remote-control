// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyDrawerSelection } from '../dist/client/drawer-style.js'

let dispose: (() => void) | undefined
beforeEach(() => { vi.stubGlobal('innerWidth', 420); vi.stubGlobal('innerHeight', 900) })
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function mount() {
  const overlay = document.createElement('div')
  overlay.innerHTML = '<div data-shortcut-modal="settings" role="dialog"><nav>设置</nav><div class="settings_options">正文</div></div>'
  document.body.append(overlay)
  const panel = overlay.firstElementChild as HTMLElement
  vi.spyOn(overlay, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 420, 900))
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 420, ratio() * 900))
  function ratio() { return Number(panel.style.getPropertyValue('--dsh-settings-ratio') || '.5') }
  return { overlay, panel, ratio }
}

function pointer(target: Element, type: string, y: number, id = 1) {
  target.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: true, button: 0, clientY: y, bubbles: true, cancelable: true }))
}

it('resizes continuously from half height, clamps both ends and ignores scrolling outside the handle', () => {
  vi.useFakeTimers()
  const { panel, ratio } = mount()
  dispose = applyDrawerSelection()
  const handle = panel.querySelector<HTMLButtonElement>('[data-dsh-settings-resize]')
  expect(handle).not.toBeNull()
  expect(ratio()).toBe(.5)
  pointer(handle!, 'pointerdown', 500)
  pointer(handle!, 'pointermove', 200, 2)
  expect(ratio()).toBe(.5)
  pointer(handle!, 'pointermove', 200)
  expect(ratio()).toBeCloseTo(750 / 900)
  pointer(handle!, 'pointermove', -500)
  expect(ratio()).toBe(1)
  pointer(handle!, 'pointerup', -500)
  handle!.click()
  expect(ratio()).toBe(1)
  vi.runAllTimers()
  pointer(handle!, 'pointerdown', 100)
  pointer(handle!, 'pointermove', 1500)
  pointer(handle!, 'pointerup', 1500)
  expect(ratio()).toBe(.5)
  pointer(panel.querySelector('.settings_options')!, 'pointerdown', 500)
  pointer(handle!, 'pointermove', 100)
  expect(ratio()).toBe(.5)
})

it('supports click and keyboard resizing and restores the previous height when a drag is cancelled', () => {
  const { panel, ratio } = mount()
  dispose = applyDrawerSelection()
  const handle = panel.querySelector<HTMLButtonElement>('[data-dsh-settings-resize]')
  expect(handle).not.toBeNull()
  pointer(handle!, 'pointerdown', 500)
  pointer(handle!, 'pointerup', 499)
  expect(ratio()).toBe(.5)
  handle!.click()
  expect(ratio()).toBe(1)
  expect(handle!.getAttribute('aria-expanded')).toBe('true')
  handle!.click()
  handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  expect(ratio()).toBeCloseTo(.6)
  pointer(handle!, 'pointerdown', 500)
  pointer(handle!, 'pointermove', 200)
  pointer(handle!, 'pointercancel', 200)
  expect(ratio()).toBeCloseTo(.6)
  handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  expect(ratio()).toBe(1)
  handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  expect(ratio()).toBe(.5)
})

it('handles newly opened dialogs, removes controls on wider screens and cleans up on reload', async () => {
  dispose = applyDrawerSelection()
  const first = mount()
  await Promise.resolve()
  expect(first.panel.querySelectorAll('[data-dsh-settings-resize]')).toHaveLength(1)
  first.overlay.remove()
  const next = mount()
  await Promise.resolve()
  expect(next.panel.querySelectorAll('[data-dsh-settings-resize]')).toHaveLength(1)
  expect(next.ratio()).toBe(.5)
  vi.stubGlobal('innerWidth', 820)
  window.dispatchEvent(new Event('resize'))
  expect(next.panel.querySelector('[data-dsh-settings-resize]')).toBeNull()
  vi.stubGlobal('innerWidth', 420)
  window.dispatchEvent(new Event('resize'))
  expect(next.panel.querySelectorAll('[data-dsh-settings-resize]')).toHaveLength(1)
  dispose()
  expect(next.panel.querySelector('[data-dsh-settings-resize]')).toBeNull()
  expect(next.panel.hasAttribute('data-dsh-settings-sheet')).toBe(false)
  expect(next.panel.style.getPropertyValue('--dsh-settings-ratio')).toBe('')
})
