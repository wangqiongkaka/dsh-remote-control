// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  followKeyboard, KEYBOARD_ATTRIBUTE, KEYBOARD_HEIGHT_VARIABLE, KEYBOARD_SHIFT_VARIABLE,
} from '../dist/client/keyboard.js'

/**
 * Install a fake viewport pair; jsdom ships no visual viewport and reports a 0-height layout box.
 * @param state.layout - the layout viewport (`documentElement.clientHeight`) the shell is sized to.
 * @param state.height - the visual viewport height.
 * @returns the viewport, plus `set` (silent, as an in-app WebView moves it) and `resize` (announced).
 */
function visualViewport(state: { layout: number; height: number; scale?: number; offsetTop?: number }): {
  set: (next: Partial<typeof state>) => void
  resize: (next: Partial<typeof state>) => void
} {
  const listeners = new Map<string, Set<() => void>>()
  const viewport = {
    height: state.height,
    scale: state.scale ?? 1,
    offsetTop: state.offsetTop ?? 0,
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, fn: () => void) => { listeners.get(type)?.delete(fn) },
  }
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: state.layout, configurable: true,
  })
  Object.defineProperty(window, 'innerHeight', { value: state.layout, configurable: true })
  return {
    set: (next) => { Object.assign(viewport, next) },
    resize: (next) => {
      Object.assign(viewport, next)
      for (const fn of listeners.get('resize') ?? []) fn()
    },
  }
}

/** Focus a fresh text field, the only thing on this page that can raise a keyboard. */
function focusField(): HTMLTextAreaElement {
  const field = document.createElement('textarea')
  document.body.append(field)
  field.focus()
  return field
}

function composer(): { card: HTMLElement; editor: HTMLElement; send: HTMLButtonElement; tool: HTMLButtonElement } {
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  card.innerHTML = '<div data-composer-input contenteditable="true" tabindex="0">草稿</div>'
    + '<button class="_primary">发送</button><button class="_add">工具</button>'
  document.body.append(card)
  return {
    card,
    editor: card.querySelector<HTMLElement>('[data-composer-input]')!,
    send: card.querySelector<HTMLButtonElement>('button._primary')!,
    tool: card.querySelector<HTMLButtonElement>('button._add')!,
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  document.documentElement.removeAttribute(KEYBOARD_ATTRIBUTE)
  document.documentElement.style.removeProperty(KEYBOARD_HEIGHT_VARIABLE)
  document.documentElement.style.removeProperty(KEYBOARD_SHIFT_VARIABLE)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('leaves the phone composer unfocused on session entry but focuses it when tapped', async () => {
  visualViewport({ layout: 800, height: 800 })
  const { card, editor } = composer()
  const body = document.createElement('div')
  body.setAttribute('data-conversation-content', '')
  body.setAttribute('data-conversation-session', 'session-1')
  body.append(card)
  document.body.append(body)
  const dispose = followKeyboard()
  try {
    // The Host focuses its resident editor after a session mounts.
    editor.focus()
    expect(document.activeElement).not.toBe(editor)
    editor.focus()
    expect(document.activeElement).not.toBe(editor)

    editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    editor.focus()
    expect(document.activeElement).toBe(editor)

    // Switching sessions keeps the same editor DOM node, so a focused draft must release it.
    body.setAttribute('data-conversation-session', 'session-2')
    await Promise.resolve()
    expect(document.activeElement).not.toBe(editor)
    editor.focus()
    expect(document.activeElement).not.toBe(editor)

    editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    editor.focus()
    expect(document.activeElement).toBe(editor)
  } finally {
    dispose()
    body.remove()
  }
})

it('opens the command launcher without raising the keyboard and restores typing on editor tap', () => {
  visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor, tool } = composer()
  tool.setAttribute('aria-haspopup', 'listbox')
  tool.addEventListener('click', () => { editor.focus() })
  try {
    editor.focus()
    tool.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(document.activeElement).not.toBe(editor)
    tool.click()
    expect(editor.getAttribute('inputmode')).toBe('none')

    editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(editor.hasAttribute('inputmode')).toBe(false)
    editor.focus()
    expect(document.activeElement).toBe(editor)
  } finally {
    dispose()
    card.remove()
  }
})

it('keeps an already-open keyboard and editor focus when the command launcher is tapped', () => {
  const viewport = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor, tool } = composer()
  tool.setAttribute('aria-haspopup', 'listbox')
  tool.addEventListener('click', () => { editor.focus() })
  const blur = vi.fn()
  editor.addEventListener('blur', blur)
  try {
    editor.focus()
    viewport.resize({ height: 480 })
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(true)
    const press = new Event('pointerdown', { bubbles: true, cancelable: true })
    tool.dispatchEvent(press)
    tool.click()
    expect(blur).not.toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(editor)
    expect(editor.hasAttribute('inputmode')).toBe(false)
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(true)
  } finally {
    dispose()
    card.remove()
  }
})

it.each(['额度', '模型', '权限', 'Harness', '推理强度'])('keeps the open keyboard through %s menu clicks and picks', (label) => {
  const viewport = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor } = composer()
  const anchor = document.createElement('div')
  anchor.innerHTML = `<button aria-haspopup="menu"><span>${label}</span></button><div role="menu"><button role="menuitemradio">选择</button></div>`
  card.append(anchor)
  const trigger = anchor.querySelector('button')!
  const pick = anchor.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!
  const clicked = vi.fn()
  trigger.onclick = clicked
  pick.onclick = clicked
  const blur = vi.fn()
  editor.addEventListener('blur', blur)
  // Model picks and quota triggers use click handlers; emulate the browser's separate focus default.
  const press = (target: HTMLElement): MouseEvent => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    target.dispatchEvent(down)
    if (!down.defaultPrevented) target.closest<HTMLButtonElement>('button')?.focus()
    target.click()
    return down
  }
  try {
    editor.focus()
    viewport.resize({ height: 480 })
    expect(press(trigger.firstElementChild as HTMLElement).defaultPrevented).toBe(true)
    expect(press(pick).defaultPrevented).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(editor)
    expect(editor.textContent).toBe('草稿')
    expect(editor.hasAttribute('inputmode')).toBe(false)
    expect(blur).not.toHaveBeenCalled()
    // Inspecting plain quota panel content also keeps focus, without eating its events.
    const panel = document.createElement('div')
    panel.className = 'hp-panel'
    panel.textContent = '剩余额度 95%'
    anchor.append(panel)
    expect(press(panel).defaultPrevented).toBe(true)
    // A deliberate tap elsewhere keeps its normal dismissal behavior.
    const outside = document.createElement('button')
    card.append(outside)
    expect(press(outside).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(outside)
  } finally { dispose(); card.remove() }
})

it('preserves typing through native model menu focus, while allowing model search and keyboard navigation', async () => {
  const viewport = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor } = composer()
  const trigger = document.createElement('button')
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-controls', 'native-model-menu')
  card.append(trigger)
  const menu = document.createElement('div')
  menu.id = 'native-model-menu'
  menu.setAttribute('role', 'menu')
  menu.innerHTML = '<button role="menuitem">模型</button><input type="search" aria-label="搜索模型">'
  document.body.append(menu)
  const item = menu.querySelector('button')!
  const search = menu.querySelector('input')!
  const closed = vi.fn()
  trigger.addEventListener('focusout', closed)
  menu.addEventListener('focusout', event => {
    if (event.relatedTarget !== trigger && !menu.contains(event.relatedTarget as Node)) closed()
  })
  try {
    editor.focus()
    viewport.resize({ height: 480 })
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    trigger.focus() // The native model picker explicitly focuses its trigger on open.
    expect(document.activeElement).toBe(editor)
    expect(closed).not.toHaveBeenCalled()
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    item.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
    item.focus() // A drilled pane focuses the checked option.
    expect(document.activeElement).toBe(editor)
    expect(closed).not.toHaveBeenCalled()
    const searchPress = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    search.dispatchEvent(searchPress)
    expect(searchPress.defaultPrevented).toBe(false)
    search.focus()
    expect(document.activeElement).toBe(search)
    trigger.focus() // Selection hands focus to the trigger; keep the search keyboard open.
    expect(document.activeElement).toBe(search)
    expect(closed).not.toHaveBeenCalled()
    menu.remove()
    await Promise.resolve()
    trigger.focus() // Returning from an unmounted search resumes the draft.
    expect(document.activeElement).toBe(editor)
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
  } finally { dispose(); menu.remove(); card.remove() }
})

it('retains focus through the native permission portal without claiming unrelated menus', () => {
  const viewport = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor } = composer()
  const slot = document.createElement('div')
  slot.setAttribute('data-slot', 'conversation.input.permission')
  slot.innerHTML = '<span class="primitives_root"><button><span class="permission_chevron">权限</span></button></span>'
  card.append(slot)
  const trigger = slot.querySelector('button')!
  const chevron = slot.querySelector('span.permission_chevron')!
  const menu = document.createElement('div')
  menu.className = 'primitives_list primitives_portal'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('data-menu-material', 'translucent')
  menu.innerHTML = '<button role="menuitem">自动批准</button>'
  document.body.append(menu)
  const pick = menu.querySelector('button')!
  const press = (target: HTMLElement) => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }
  try {
    editor.focus()
    viewport.resize({ height: 480 })
    expect(press(trigger).defaultPrevented).toBe(true)
    chevron.className = 'permission_chevron permission_chevronOpen'
    expect(press(pick).defaultPrevented).toBe(true)
    pick.focus()
    expect(document.activeElement).toBe(editor)
    chevron.className = 'permission_chevron'
    // A shared MenuSurface after the permission picker closes is no longer ours.
    expect(press(pick).defaultPrevented).toBe(false)
    pick.focus()
    expect(document.activeElement).toBe(pick)
  } finally { dispose(); menu.remove(); card.remove() }
})

it('leaves menu clicks alone without an open composer keyboard and restores them on disposal', () => {
  const viewport = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor } = composer()
  const trigger = document.createElement('button')
  trigger.setAttribute('aria-haspopup', 'menu')
  card.append(trigger)
  const down = () => {
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    trigger.dispatchEvent(event)
    return event
  }
  try {
    expect(down().defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(editor)
    editor.focus()
    expect(down().defaultPrevented).toBe(false)
    viewport.resize({ height: 480 })
    const other = document.createElement('textarea')
    card.append(other)
    other.focus()
    expect(down().defaultPrevented).toBe(false)
    editor.focus()
    expect(down().defaultPrevented).toBe(true)
    dispose()
    expect(down().defaultPrevented).toBe(false)
  } finally { dispose(); card.remove() }
})

it('picks a file in one menu press without reopening the suppressed keyboard', () => {
  visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor, tool } = composer()
  tool.setAttribute('aria-haspopup', 'listbox')
  tool.addEventListener('click', () => { editor.focus() })
  const menu = document.createElement('div')
  menu.setAttribute('data-trigger-menu', '')
  const item = document.createElement('button')
  item.setAttribute('role', 'option')
  const file = document.createElement('input')
  file.type = 'file'
  file.hidden = true
  const openPicker = vi.spyOn(file, 'click')
  // MenuView picks on mousedown; the File action synchronously clicks the resident native input.
  item.addEventListener('mousedown', event => {
    event.preventDefault()
    file.click()
    menu.remove()
  })
  menu.append(item)
  card.append(menu, file)
  try {
    tool.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    tool.click()
    expect(editor.getAttribute('inputmode')).toBe('none')
    item.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    expect(editor.getAttribute('inputmode')).toBe('none')
    expect(document.activeElement).toBe(editor)
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(openPicker).toHaveBeenCalledTimes(1)
    expect(menu.isConnected).toBe(false)
    // Typing resumes normally after the picker: the direct editor tap releases suppression.
    editor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(editor.hasAttribute('inputmode')).toBe(false)
  } finally {
    dispose()
    card.remove()
  }
})

it('dismisses the keyboard only after a sent draft clears', () => {
  vi.useFakeTimers()
  visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor, send, tool } = composer()
  try {
    editor.focus()
    send.click()
    vi.advanceTimersByTime(0)
    expect(document.activeElement).toBe(editor)

    tool.addEventListener('click', () => { editor.textContent = '' })
    tool.click()
    vi.advanceTimersByTime(0)
    expect(document.activeElement).toBe(editor)

    editor.textContent = '草稿'
    send.addEventListener('click', () => { editor.textContent = '' })
    send.click()
    vi.advanceTimersByTime(0)
    expect(document.activeElement).not.toBe(editor)

    const rail = document.createElement('div')
    rail.className = 'ui_attachment__rail__h1'
    card.append(rail)
    editor.focus()
    send.click()
    vi.advanceTimersByTime(0)
    expect(document.activeElement).toBe(editor)
    send.addEventListener('click', () => { rail.remove() })
    send.click()
    vi.advanceTimersByTime(0)
    expect(document.activeElement).not.toBe(editor)
  } finally {
    dispose()
    card.remove()
  }
})

it('dismisses after Enter submits but preserves Shift+Enter and IME composition', () => {
  vi.useFakeTimers()
  visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor } = composer()
  try {
    editor.focus()
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    vi.advanceTimersByTime(0)
    expect(document.activeElement).toBe(editor)

    editor.setAttribute('data-composer-composing', '')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    vi.advanceTimersByTime(0)
    expect(document.activeElement).toBe(editor)
    editor.removeAttribute('data-composer-composing')

    editor.addEventListener('keydown', () => { editor.textContent = '' })
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    vi.advanceTimersByTime(0)
    expect(document.activeElement).not.toBe(editor)
  } finally {
    dispose()
    card.remove()
  }
})

it('dismisses when a submitted command enters processing before clearing its draft', () => {
  vi.useFakeTimers()
  visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const { card, editor, send } = composer()
  try {
    editor.textContent = '/goal review'
    editor.setAttribute('data-phase', 'claimed')
    editor.focus()
    send.addEventListener('click', () => { editor.setAttribute('data-phase', 'submitting') })
    send.click()
    vi.advanceTimersByTime(0)
    expect(document.activeElement).not.toBe(editor)
  } finally {
    dispose()
    card.remove()
  }
})

it('shrinks the shell to the visual viewport while a keyboard is up', () => {
  const fake = visualViewport({ layout: 800, height: 450 })
  const dispose = followKeyboard()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(true)
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_VARIABLE)).toBe('450px')

  // Dismissing the keyboard restores the shell's own height.
  fake.resize({ height: 800 })
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_VARIABLE)).toBe('')

  dispose()
})

// WeChat and its kin shrink `innerHeight` along with the visual viewport while the layout viewport
// — the box the shell's `height: 100%` resolves against — stays full height. Measuring the keyboard
// against `innerHeight` read this as no keyboard at all, so the composer stayed under it.
it('detects the keyboard of a WebView that shrinks innerHeight with it', () => {
  visualViewport({ layout: 800, height: 450 })
  Object.defineProperty(window, 'innerHeight', { value: 450, configurable: true })
  const dispose = followKeyboard()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(true)
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_VARIABLE)).toBe('450px')
  dispose()
})

it('follows the browser panning the visual viewport down the layout viewport', () => {
  const fake = visualViewport({ layout: 800, height: 450 })
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const dispose = followKeyboard()
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_SHIFT_VARIABLE)).toBe('0px')

  fake.resize({ offsetTop: 300 })
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_SHIFT_VARIABLE)).toBe('300px')
  expect(scrollTo).toHaveBeenCalledWith(0, 0)

  // The keyboard closing clears the shift with the rest of the state.
  fake.resize({ height: 800, offsetTop: 0 })
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_SHIFT_VARIABLE)).toBe('')
  dispose()
})

it('detects a keyboard an in-app WebView reports only by resizing the layout viewport', () => {
  const fake = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)

  // The other half of the WebView family: the layout viewport shrinks, the visual one stays tall.
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 450, configurable: true })
  fake.resize({})
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(true)
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_VARIABLE)).toBe('450px')

  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true })
  fake.resize({})
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)
  dispose()
})

// WebKit only reveals a focused field once the user types, so the phone reports a composer that
// stays outside the band (below the keyboard, or above it after a pan) until that first keystroke.
it('brings the focused field back into the band when the keyboard opens', () => {
  const fake = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const field = focusField()
  const scrollIntoView = vi.fn()
  field.scrollIntoView = scrollIntoView
  const rect = { top: -5284, bottom: -5156, left: 0, right: 300, width: 300, height: 128, x: 0, y: -5284 }
  field.getBoundingClientRect = () => rect as DOMRect

  fake.resize({ height: 395 })
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' })

  // A field already inside the band is left where the phone put it.
  scrollIntoView.mockClear()
  fake.resize({ height: 800 })
  Object.assign(rect, { top: 10, bottom: 138, y: 10 })
  fake.resize({ height: 395 })
  expect(scrollIntoView).not.toHaveBeenCalled()
  dispose()
})

it('leaves an idle phone (browser chrome only) to the browser', () => {
  visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)
  dispose()
})

it('ignores a pinch-zoomed viewport, which is not a keyboard', () => {
  visualViewport({ layout: 800, height: 400, scale: 2 })
  const dispose = followKeyboard()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)
  dispose()
})

// A WebView that moves the visual viewport for a keyboard without announcing it would otherwise
// never be noticed at all: while a field holds focus, and afterwards for as long as the shell is
// still shrunk, the follow reads the viewport itself and stops as soon as neither is true.
it('catches a keyboard a silent WebView never announces', () => {
  vi.useFakeTimers()
  const fake = visualViewport({ layout: 800, height: 800 })
  const dispose = followKeyboard()
  const field = focusField()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)

  fake.set({ height: 450 })
  vi.advanceTimersByTime(250)
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_VARIABLE)).toBe('450px')

  // Focus leaves before the keyboard animates away; the shell is still shrunk, so keep watching.
  field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  fake.set({ height: 800 })
  vi.advanceTimersByTime(250)
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)

  // Nothing is focused and nothing is shrunk: the follow has stopped reading the viewport.
  fake.set({ height: 450 })
  vi.advanceTimersByTime(5_000)
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)
  dispose()
  vi.useRealTimers()
})

it('clears every write on disposal', () => {
  visualViewport({ layout: 800, height: 400 })
  const dispose = followKeyboard()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(true)
  dispose()
  expect(document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE)).toBe(false)
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_HEIGHT_VARIABLE)).toBe('')
  expect(document.documentElement.style.getPropertyValue(KEYBOARD_SHIFT_VARIABLE)).toBe('')
})
