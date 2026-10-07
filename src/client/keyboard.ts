/**
 * Soft-keyboard follow for the proxied phone shell.
 *
 * The shell is a full-height fixed layout, so a keyboard that overlays the layout viewport has
 * nowhere to scroll: on iOS (whose WebKit keeps the layout viewport at full height and shrinks
 * only the visual viewport) the composer ends up under the keyboard. Chromium honors the
 * `interactive-widget=resizes-content` viewport key the proxy injects and needs nothing here;
 * this covers the rest by publishing the visual viewport's height while a keyboard is up.
 *
 * What a keyboard hides is measured against the layout viewport — the height the shell's
 * `height: 100%` resolves against — never against `window.innerHeight`, which an in-app WebView
 * (WeChat, QQ, …) shrinks together with the visual viewport while leaving the layout viewport
 * tall. Comparing the two viewports with each other reads that WebView's keyboard as "no
 * keyboard", leaving the shell unshrunk and the composer under the keyboard.
 *
 * The shell only shrinks while a keyboard is actually detected, so an idle phone keeps the
 * browser's own viewport behavior (including a visible URL bar) untouched.
 */

/** Root attribute the narrow-screen stylesheet keys the keyboard-shrunk shell on. */
export const KEYBOARD_ATTRIBUTE = 'data-dsh-remote-keyboard'

/** Root variable carrying the visual viewport height in px while the keyboard is up. */
export const KEYBOARD_HEIGHT_VARIABLE = '--dsh-remote-keyboard-height'

/** Root variable carrying how far the browser panned the visual viewport down the layout viewport. */
export const KEYBOARD_SHIFT_VARIABLE = '--dsh-remote-keyboard-shift'

/** Keyboard inset below which the visual viewport is read as browser chrome, not a keyboard. */
const KEYBOARD_MIN_INSET = 120

/** Viewport scale above which the user is pinch-zooming rather than typing. */
const MAX_SCALE = 1.05

/**
 * WebViews exist that move the visual viewport for a keyboard without firing either resize or
 * scroll on it; the follow then watches those windows itself. Only two states need watching: a
 * text field holds focus, or the shell is currently shrunk and the keyboard has yet to close.
 */
const POLL_INTERVAL = 250

/** Whether an element can raise a soft keyboard when focused. */
function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches('input, textarea, [contenteditable="true"]'))
}

/** Inline tool popups, plus native model cards portaled through their trigger's aria-controls. */
function composerMenuContains(card: HTMLElement, target: Element): boolean {
  if (card.contains(target) && target.closest('button[aria-haspopup]:not([class*="_add"]),'
    + '[data-slot="conversation.input.permission"] button,[data-slot="conversation.input.plan"] button,'
    + '[role="menu"],[role="dialog"],.hp-panel')) return true
  // ponytail: native permissions expose no owner ID; use their open chevron until aria-controls is available.
  if (card.querySelector('[data-slot="conversation.input.permission"] [class*="_chevronOpen"]') !== null
    && target.closest('[data-menu-material][role="menu"][class*="_list"]') !== null) return true
  return [...card.querySelectorAll('[aria-haspopup][aria-controls]')].some(trigger => {
    const id = trigger.getAttribute('aria-controls')
    return id !== null && document.getElementById(id)?.contains(target) === true
  })
}

/**
 * Follow the phone keyboard on the root element, shrinking the shell to the visual viewport.
 * @returns a disposer that removes every write this made.
 */
export function followKeyboard(): () => void {
  const viewport = window.visualViewport
  /* v8 ignore next -- every browser shipped with visualViewport on phones; jsdom ships none. */
  if (viewport === null || viewport === undefined) return () => {}
  const root = document.documentElement
  let focused = false
  let shrunk = false
  /** The previous run's verdict: revealing the field belongs to the keyboard opening, not every tick. */
  let wasShrunk = false
  /** A native file picker is open: no keyboard is read until it closes. */
  let released = false
  /** The tallest area the phone has reported while no keyboard was up; a keyboard only lowers it. */
  let resting = 0
  let poll: ReturnType<typeof setInterval> | undefined
  let dismissTimer: ReturnType<typeof setTimeout> | undefined
  let sessionBody: HTMLElement | null = null
  let sessionId: string | null = null
  let blockEntryFocus = false
  let commandEditor: HTMLElement | null = null
  let commandInputMode: string | null = null
  let menuFocus: { card: HTMLElement; editor: HTMLElement; field: HTMLElement } | undefined
  let drag: { id: number; x: number; y: number; target: Element; boundary: Element; vertical?: boolean } | undefined
  const restoreInputMode = (): void => {
    if (commandEditor === null) return
    // WebKit can raise the keyboard at the mode change, before an outside tap blurs the editor.
    // Release suppressed focus first; a direct editor tap can then focus it normally again.
    if (document.activeElement === commandEditor) commandEditor.blur()
    if (commandInputMode === null) commandEditor.removeAttribute('inputmode')
    else commandEditor.setAttribute('inputmode', commandInputMode)
    commandEditor = null
  }
  const sessionObserver = new MutationObserver(() => { watchSession(true) })
  /** The Host focuses its resident editor on mount and every session switch. */
  const watchSession = (blurFocused: boolean): void => {
    const body = document.querySelector<HTMLElement>('[data-conversation-content]')
    const id = body?.getAttribute('data-conversation-session') ?? null
    if (body === sessionBody && id === sessionId) return
    if (body !== sessionBody) {
      sessionObserver.disconnect()
      sessionBody = body
      if (body !== null) sessionObserver.observe(body, { attributes: true, attributeFilter: ['data-conversation-session'] })
    }
    sessionId = id
    menuFocus = undefined
    blockEntryFocus = id !== null
    const active = document.activeElement
    if (blurFocused && active instanceof HTMLElement && active.matches('[data-composer-input]')
      && body?.contains(active)) active.blur()
  }
  /** Write only on a real change: this runs on every viewport scroll and poll tick. */
  const write = (property: string, value: string): void => {
    if (root.style.getPropertyValue(property) !== value) root.style.setProperty(property, value)
  }
  /**
   * Bring the field the keyboard opened for back into the visible band. WebKit reveals a focused
   * field only once the user types, so without this the composer stays outside the band — below the
   * keyboard, or above it once the browser panned — until the first keystroke.
   */
  const reveal = (): void => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !isTextField(active)) return
    const top = viewport.offsetTop
    const rect = active.getBoundingClientRect()
    if (rect.top >= top && rect.bottom <= top + viewport.height) return
    active.scrollIntoView({ block: 'end', inline: 'nearest' })
  }
  const syncPoll = (): void => {
    if (focused || shrunk) { poll ??= setInterval(apply, POLL_INTERVAL) }
    else if (poll !== undefined) { clearInterval(poll); poll = undefined }
  }
  const apply = (): void => {
    // Either viewport can carry the keyboard — an in-app WebView may shrink the visual viewport,
    // the layout viewport, or both — so nothing is compared against a single metric. What the user
    // can see is the smaller of the two, and how much of the phone that is missing is the drop from
    // the tallest either has ever reported with no keyboard up.
    const visible = Math.min(root.clientHeight, viewport.height)
    resting = Math.max(resting, root.clientHeight, viewport.height)
    shrunk = !released && viewport.scale <= MAX_SCALE && resting - visible >= KEYBOARD_MIN_INSET
    if (!shrunk) {
      root.removeAttribute(KEYBOARD_ATTRIBUTE)
      root.style.removeProperty(KEYBOARD_HEIGHT_VARIABLE)
      root.style.removeProperty(KEYBOARD_SHIFT_VARIABLE)
    } else {
      write(KEYBOARD_HEIGHT_VARIABLE, `${Math.round(visible)}px`)
      // WebKit reveals a focused field by panning the visual viewport, and this page has nothing
      // to scroll: the shell follows the pan so it stays inside the visible band rather than above it.
      write(KEYBOARD_SHIFT_VARIABLE, `${Math.round(viewport.offsetTop)}px`)
      root.setAttribute(KEYBOARD_ATTRIBUTE, '')
      // A panned layout viewport is the other half of the same reveal; ask for the unpanned page back.
      if (viewport.offsetTop > 0) window.scrollTo(0, 0)
      // The shell has just taken its new height: a field the phone never scrolled to is still
      // outside the band, so bring it back the moment the keyboard opens rather than on a keystroke.
      if (!wasShrunk) reveal()
    }
    wasShrunk = shrunk
    syncPoll()
  }
  const onFocusIn = (event: FocusEvent): void => {
    if (menuFocus && (!menuFocus.editor.isConnected || menuFocus.editor.getAttribute('contenteditable') !== 'true')) menuFocus = undefined
    if (menuFocus && shrunk && event.target instanceof HTMLElement
      && !isTextField(event.target) && composerMenuContains(menuFocus.card, event.target)) {
      // Native model menus focus buttons on open, drill and selection. Hand focus back in the
      // same event; a menu search field is allowed to take over and keeps its own keyboard.
      const field = menuFocus.field.isConnected ? menuFocus.field : menuFocus.editor
      event.stopImmediatePropagation()
      field.focus({ preventScroll: true })
      return
    }
    if (menuFocus && event.target instanceof HTMLElement && isTextField(event.target)) {
      if (composerMenuContains(menuFocus.card, event.target)) menuFocus.field = event.target
      else if (event.target !== menuFocus.editor) menuFocus = undefined
    }
    if (!isTextField(event.target)) return
    if (released && event.target instanceof HTMLElement) {
      // The source dialog closing over the picker hands focus back to the editor. A keyboard rising
      // under the sheet is taken straight back down by it, and WeChat leaves the page panned.
      event.target.blur()
      return
    }
    watchSession(false)
    if (blockEntryFocus && event.target instanceof HTMLElement
      && event.target.matches('[data-composer-input]') && sessionBody?.contains(event.target)) {
      event.target.blur()
      return
    }
    focused = true
    apply()
  }
  const onFocusOut = (event: FocusEvent): void => {
    if (menuFocus && event.target instanceof Element && composerMenuContains(menuFocus.card, event.target)
      && (event.relatedTarget === menuFocus.editor || event.relatedTarget === menuFocus.field)) {
      // The native model card closes on blur outside its subtree; our focus return is not a dismissal.
      event.stopImmediatePropagation()
    }
    focused = false
    // Keep watching while the shell is still shrunk: with no events coming, the poll is the only
    // thing that can notice the keyboard closing.
    syncPoll()
  }
  /**
   * iOS hides the keyboard under its file sheet while the editor keeps focus and the viewport keeps
   * reporting the keyboard, so the shell stayed shrunk and panned behind the sheet. Close the
   * keyboard for real as the picker opens (the host clicks its resident input from a menu pick) and
   * rest the shell without waiting for a viewport that will not report it. Whether a keyboard was
   * read yet does not matter: a field left focused can still have one reported under the sheet.
   * The picker's own change or cancel ends this, and so does the next touch — nothing reaches the
   * page while the sheet is up, and older WebKit sends no cancel. Focus does not, and no text field
   * keeps focus until then (see the focus handler).
   */
  const onFilePicker = (event: MouseEvent): void => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return
    released = true
    const active = document.activeElement
    if (active instanceof HTMLElement && isTextField(active)) active.blur()
    window.scrollTo(0, 0)
    apply()
  }
  const onPickerClosed = (): void => { released = false }
  /** Let the host handle the gesture, then dismiss only a committed or processing submission. */
  const dismissCommitted = (editor: HTMLElement): void => {
    const card = editor.closest('[data-composer-card]')
    if (document.activeElement !== editor || editor.getAttribute('contenteditable') !== 'true' || card === null) return
    const hadText = (editor.textContent?.trim() ?? '') !== ''
    const hadRail = card.querySelector('[class*="_rail"]') !== null
    const beforePhase = editor.getAttribute('data-phase')
    if (!hadText && !hadRail) return
    if (dismissTimer !== undefined) clearTimeout(dismissTimer)
    dismissTimer = setTimeout(() => {
      dismissTimer = undefined
      const phase = editor.getAttribute('data-phase')
      const processing = phase !== beforePhase && (phase === 'adjudicating' || phase === 'submitting')
      if (document.activeElement === editor && editor.isConnected
        && (processing || ((editor.textContent?.trim() ?? '') === ''
          && (!hadRail || card.querySelector('[class*="_rail"]') === null)))) editor.blur()
    }, 0)
  }
  const onSubmitClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button[class*="_primary"]')
    if (!(button instanceof HTMLButtonElement) || button.disabled) return
    const editor = button.closest('[data-composer-card]')?.querySelector<HTMLElement>('[data-composer-input]')
    if (editor !== undefined && editor !== null) dismissCommitted(editor)
  }
  const onSubmitKey = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') menuFocus = undefined
    if (event.key === 'Tab' || (event.target instanceof Element
      && event.target.closest('[data-composer-card]') !== null)) blockEntryFocus = false
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.getModifierState('AltGraph')
      || event.isComposing
      || event.keyCode === 229 || (event.ctrlKey && event.metaKey)) return
    const editor = event.target instanceof Element ? event.target.closest('[data-composer-input]') : null
    // Both the Lexical composer and history textarea already support Shift+Enter. Keep the
    // original event and native editing path so the phone's Return key never submits a draft.
    if (!event.ctrlKey && !event.metaKey
      && ((editor instanceof HTMLElement && editor.getAttribute('contenteditable') === 'true'
        && !editor.hasAttribute('data-composer-composing'))
        || (event.target instanceof HTMLTextAreaElement
          && event.target.matches('.hp-edit textarea:not(:disabled):not([readonly])')))) {
      Object.defineProperty(event, 'shiftKey', { value: true })
      return
    }
    if (event.repeat) return
    if (editor instanceof HTMLElement && !editor.hasAttribute('data-composer-composing')) dismissCommitted(editor)
  }
  const onPointerDown = (event: PointerEvent): void => {
    released = false
    if (!(event.target instanceof Element)) return
    watchSession(false)
    const active = document.activeElement
    const card = active instanceof HTMLElement && active.matches('[data-composer-input][contenteditable="true"]')
      ? active.closest<HTMLElement>('[data-composer-card]') : null
    if (shrunk && card && active instanceof HTMLElement && composerMenuContains(card, event.target)) {
      menuFocus = { card, editor: active, field: active }
    } else if (menuFocus && (!shrunk || !composerMenuContains(menuFocus.card, event.target))) menuFocus = undefined
    const launcher = event.target.closest('button[aria-haspopup="listbox"][class*="_add"]')
    const editor = launcher instanceof HTMLButtonElement && !launcher.disabled
      ? launcher.closest('[data-composer-card]')?.querySelector<HTMLElement>('[data-composer-input]')
      : null
    if (editor !== undefined && editor !== null) {
      if (shrunk) {
        // An already-open keyboard stays open; do not move focus onto the launcher either.
        event.preventDefault()
      } else {
        if (commandEditor !== editor) {
          restoreInputMode()
          commandEditor = editor
          commandInputMode = editor.getAttribute('inputmode')
          editor.setAttribute('inputmode', 'none')
        }
        editor.blur()
      }
    } else if (event.target.closest('[data-trigger-menu]') === null) {
      restoreInputMode()
    }
    // A menu pick keeps the launcher's inputmode until the editor is tapped: restoring it here
    // opens the keyboard and moves the tapped row before its mousedown handler can pick the file.
    if (sessionBody?.contains(event.target) && event.target.closest('[data-composer-card]') !== null) {
      blockEntryFocus = false
    }
  }
  const onMenuMouseDown = (event: MouseEvent): void => {
    if (menuFocus && shrunk && document.activeElement === menuFocus.field
      && event.target instanceof Element && composerMenuContains(menuFocus.card, event.target)
      && event.target.closest('input,textarea,select,[contenteditable]') === null) event.preventDefault()
  }
  const clearDrag = (): void => { drag = undefined }
  const onTouchStart = (event: TouchEvent): void => {
    clearDrag()
    if (!shrunk || event.touches.length !== 1 || !(event.target instanceof Element)) return
    const body = event.target.closest('[data-conversation-content]')
    const touch = event.touches[0]
    if (!body || !touch) return
    drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, target: event.target,
      boundary: event.target.closest('[data-composer-card]') ?? body }
  }
  const onTouchMove = (event: TouchEvent): void => {
    if (!drag) return
    if (!shrunk || event.touches.length !== 1 || !drag.target.isConnected) { clearDrag(); return }
    const touch = event.touches[0]
    if (!touch || touch.identifier !== drag.id || !event.cancelable) return
    const dx = touch.clientX - drag.x
    const dy = touch.clientY - drag.y
    if (drag.vertical === undefined) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
      drag.vertical = Math.abs(dy) > Math.abs(dx)
    }
    drag.x = touch.clientX
    drag.y = touch.clientY
    if (!drag.vertical || dy === 0) return
    const selection = window.getSelection()
    if (selection?.isCollapsed === false
      && drag.target.closest('[data-composer-input]')?.contains(selection.anchorNode)) return
    // Keep native scrolling inside the draft or messages, but never chain a drag from the
    // input card into the transcript or page: WebKit can pan the keyboard's viewport there.
    for (let element: Element | null = drag.target; element && element !== drag.boundary; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight
        && /^(auto|scroll)$/u.test(getComputedStyle(element).overflowY)
        && (dy > 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1)) return
    }
    event.preventDefault()
  }
  watchSession(true)
  apply()
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('mousedown', onMenuMouseDown, true)
  document.addEventListener('click', onSubmitClick, true)
  document.addEventListener('click', onFilePicker, true)
  document.addEventListener('change', onPickerClosed, true)
  document.addEventListener('cancel', onPickerClosed, true)
  document.addEventListener('keydown', onSubmitKey, true)
  document.addEventListener('touchstart', onTouchStart, { passive: true })
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', clearDrag, { passive: true })
  document.addEventListener('touchcancel', clearDrag, { passive: true })
  return () => {
    if (poll !== undefined) clearInterval(poll)
    if (dismissTimer !== undefined) clearTimeout(dismissTimer)
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    menuFocus = undefined
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('mousedown', onMenuMouseDown, true)
    document.removeEventListener('click', onSubmitClick, true)
    document.removeEventListener('click', onFilePicker, true)
    document.removeEventListener('change', onPickerClosed, true)
    document.removeEventListener('cancel', onPickerClosed, true)
    document.removeEventListener('keydown', onSubmitKey, true)
    document.removeEventListener('touchstart', onTouchStart)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', clearDrag)
    document.removeEventListener('touchcancel', clearDrag)
    clearDrag()
    sessionObserver.disconnect()
    restoreInputMode()
    root.removeAttribute(KEYBOARD_ATTRIBUTE)
    root.style.removeProperty(KEYBOARD_HEIGHT_VARIABLE)
    root.style.removeProperty(KEYBOARD_SHIFT_VARIABLE)
  }
}
