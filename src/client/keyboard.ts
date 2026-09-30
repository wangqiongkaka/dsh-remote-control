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
  /** The tallest area the phone has reported while no keyboard was up; a keyboard only lowers it. */
  let resting = 0
  let poll: ReturnType<typeof setInterval> | undefined
  let dismissTimer: ReturnType<typeof setTimeout> | undefined
  let sessionBody: HTMLElement | null = null
  let sessionId: string | null = null
  let blockEntryFocus = false
  let commandEditor: HTMLElement | null = null
  let commandInputMode: string | null = null
  const restoreInputMode = (): void => {
    if (commandEditor === null) return
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
    shrunk = viewport.scale <= MAX_SCALE && resting - visible >= KEYBOARD_MIN_INSET
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
    if (!isTextField(event.target)) return
    watchSession(false)
    if (blockEntryFocus && event.target instanceof HTMLElement
      && event.target.matches('[data-composer-input]') && sessionBody?.contains(event.target)) {
      event.target.blur()
      return
    }
    focused = true
    apply()
  }
  const onFocusOut = (): void => {
    focused = false
    // Keep watching while the shell is still shrunk: with no events coming, the poll is the only
    // thing that can notice the keyboard closing.
    syncPoll()
  }
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
    if (event.key === 'Tab' || (event.target instanceof Element
      && event.target.closest('[data-composer-card]') !== null)) blockEntryFocus = false
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.getModifierState('AltGraph')
      || event.repeat || event.isComposing
      || event.keyCode === 229 || (event.ctrlKey && event.metaKey)) return
    const editor = event.target instanceof Element ? event.target.closest('[data-composer-input]') : null
    if (editor instanceof HTMLElement && !editor.hasAttribute('data-composer-composing')) dismissCommitted(editor)
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return
    watchSession(false)
    const launcher = event.target.closest('button[aria-haspopup="listbox"][class*="_add"]')
    const editor = launcher instanceof HTMLButtonElement && !launcher.disabled
      ? launcher.closest('[data-composer-card]')?.querySelector<HTMLElement>('[data-composer-input]')
      : null
    if (editor !== undefined && editor !== null) {
      if (commandEditor !== editor) {
        restoreInputMode()
        commandEditor = editor
        commandInputMode = editor.getAttribute('inputmode')
        editor.setAttribute('inputmode', 'none')
      }
      editor.blur()
    } else {
      const previous = commandEditor
      // A focused editor needs a new focus transition for a direct tap to reopen the keyboard.
      if (event.target.closest('[data-composer-input]') === previous) previous?.blur()
      restoreInputMode()
    }
    if (sessionBody?.contains(event.target) && event.target.closest('[data-composer-card]') !== null) {
      blockEntryFocus = false
    }
  }
  watchSession(true)
  apply()
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('click', onSubmitClick, true)
  document.addEventListener('keydown', onSubmitKey, true)
  return () => {
    if (poll !== undefined) clearInterval(poll)
    if (dismissTimer !== undefined) clearTimeout(dismissTimer)
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
    window.removeEventListener('orientationchange', apply)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('click', onSubmitClick, true)
    document.removeEventListener('keydown', onSubmitKey, true)
    sessionObserver.disconnect()
    restoreInputMode()
    root.removeAttribute(KEYBOARD_ATTRIBUTE)
    root.style.removeProperty(KEYBOARD_HEIGHT_VARIABLE)
    root.style.removeProperty(KEYBOARD_SHIFT_VARIABLE)
  }
}
