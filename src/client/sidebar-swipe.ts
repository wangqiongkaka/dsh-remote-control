/** Open and close the phone drawers with horizontal swipes. */

import { DRAWER_SCROLL_ROOT } from './drawer-style.ts'

const MIN_SWIPE = 48
const INTERACTIVE = 'button,a,input,textarea,select,[contenteditable], [role="dialog"], [data-composer-card]'

/** Leave a child horizontal scroller's gesture to that scroller. */
function scrollsHorizontally(target: Element, center: Element): boolean {
  for (let element: Element | null = target; element !== null && element !== center; element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth && /^(auto|scroll)$/.test(getComputedStyle(element).overflowX)) return true
  }
  return false
}

/**
 * Inside an open drawer a sideways drag never clicks the control under it, so only a field that
 * owns its own drag (and an open menu) keeps a closing swipe to itself.
 */
const DRAWER_OWN_DRAG = 'input,textarea,select,[contenteditable], [role="dialog"]'

/**
 * Which ways the horizontal scrollers between a touch and its area can still scroll: a drag that
 * would move one of them is that scroller's, not the drawer's.
 */
function scrollRoom(target: Element, area: Element): { back: boolean; forward: boolean } {
  const room = { back: false, forward: false }
  for (let element: Element | null = target; element !== null && element !== area; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth || !/^(auto|scroll)$/.test(getComputedStyle(element).overflowX)) continue
    if (element.scrollLeft > 0) room.back = true
    if (element.scrollLeft + element.clientWidth < element.scrollWidth - 1) room.forward = true
  }
  return room
}

const FRAME = '[class*="_frame"]:has([class*="_sidebarCol"])'
const RIGHT_TOGGLE = '[data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle]'
/** How long a landing keeps up with the shell restoring its panels, unless a touch ends it first. */
const LANDING = 10_000

/**
 * Land on the left drawer whenever the phone page loads or comes back to the foreground. The right
 * panel's expanded state persists per Session, so a page the phone reloaded from the background
 * would otherwise reopen on it, and its opening folds the drawer: until the user's first touch,
 * every render that shows the right panel is answered by closing it and reopening the drawer.
 */
export function landOnDrawer(openLeft: () => void): () => void {
  let observer: MutationObserver | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let first: ReturnType<typeof setTimeout> | undefined
  // toggleSidebar flips the shell's state and renders later: ask once until the drawer shows open.
  let asked = false
  const settle = (): void => {
    const frame = document.querySelector(FRAME)
    if (frame === null) return
    frame.querySelector<HTMLButtonElement>(RIGHT_TOGGLE)?.click()
    if (!frame.hasAttribute('data-sidebar-collapsed')) asked = false
    else if (!asked) {
      asked = true
      openLeft()
    }
  }
  const stop = (): void => {
    observer?.disconnect()
    observer = undefined
    clearTimeout(timer)
    clearTimeout(first)
    document.removeEventListener('touchstart', stop, true)
  }
  const land = (): void => {
    stop()
    asked = false
    observer = new MutationObserver(settle)
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-right-open'],
    })
    document.addEventListener('touchstart', stop, { capture: true, passive: true })
    timer = setTimeout(stop, LANDING)
    // The shell may not have rendered yet, or be mid-render: look once it has had its turn.
    first = setTimeout(settle, 0)
  }
  const onVisible = (): void => { if (document.visibilityState === 'visible') land() }
  document.addEventListener('visibilitychange', onVisible)
  land()
  return () => {
    stop()
    document.removeEventListener('visibilitychange', onVisible)
  }
}

const SESSION_ROW = '[class*="_sidebarCol"] [class*="_sessionRow"]'
const HOLD = 500
const HOLD_SLOP = 10

/**
 * Long-press a drawer Session row to open its "…" menu (pin, rename, fork, archive). A touch screen
 * never shows the row's hover strip (see drawer-style), so this is the phone's way to those actions.
 * The row's trigger is the strip's first button; the lift that ends the press is kept from also
 * tapping the row open.
 */
export function followRowHolds(): () => void {
  let hold: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined
  let fired = false
  const cancel = (): void => {
    if (hold !== undefined) clearTimeout(hold.timer)
    hold = undefined
  }
  const onStart = (event: TouchEvent): void => {
    cancel()
    fired = false
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || !(event.target instanceof Element)
      || event.target.closest('[class*="_rowActions"]')) return
    const trigger = event.target.closest(SESSION_ROW)?.querySelector<HTMLButtonElement>('[class*="_rowActions"] button')
    if (!trigger) return
    hold = { x: touch.clientX, y: touch.clientY, timer: setTimeout(() => {
      hold = undefined
      fired = true
      trigger.click()
    }, HOLD) }
  }
  const onMove = (event: TouchEvent): void => {
    const touch = event.touches[0]
    if (hold === undefined || touch === undefined) return
    if (Math.hypot(touch.clientX - hold.x, touch.clientY - hold.y) > HOLD_SLOP) cancel()
  }
  const onEnd = (event: TouchEvent): void => {
    cancel()
    if (fired) event.preventDefault()
    fired = false
  }
  // Android answers a long press with the context menu as well.
  const onContextMenu = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest(SESSION_ROW)) event.preventDefault()
  }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd, { passive: false })
  document.addEventListener('touchcancel', cancel, { passive: true })
  document.addEventListener('contextmenu', onContextMenu)
  return () => {
    cancel()
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', cancel)
    document.removeEventListener('contextmenu', onContextMenu)
  }
}

/** Observe single-finger swipes without blocking native scrolling or clicks. */
export function followSidebarSwipes(openLeft: () => void): () => void {
  let start: {
    id: number; x: number; y: number; frame: Element; area: 'center' | 'left' | 'right'
    room: { back: boolean; forward: boolean }
  } | undefined
  const onStart = (event: TouchEvent): void => {
    start = undefined
    if (event.touches.length !== 1 || !(event.target instanceof Element)) return
    const target = event.target
    const center = target.closest('[class*="_centerCol"]')
    const left = target.closest('[class*="_sidebarCol"]')
    const right = target.closest('[data-sidebar-right-panel][data-sidebar-right-open]')
    const area = center ?? left ?? right
    const frame = area?.closest('[class*="_frame"]:has([class*="_sidebarCol"])')
    if (!area || !frame) return
    // The conversation keeps every control and sideways scroller to itself; an open drawer lets a
    // closing swipe start on its rows and tabs (see DRAWER_OWN_DRAG and the direction check below).
    const ownDrag = target.closest(DRAWER_OWN_DRAG)
    if (center ? target.closest(INTERACTIVE) || scrollsHorizontally(target, area) : ownDrag) return
    const touch = event.touches[0]
    if (touch === undefined) return
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, frame,
      area: center ? 'center' : left ? 'left' : 'right', room: scrollRoom(target, area) }
  }
  const onEnd = (event: TouchEvent): void => {
    const from = start
    start = undefined
    if (from === undefined || event.touches.length !== 0 || event.changedTouches.length !== 1) return
    const touch = event.changedTouches[0]
    if (touch === undefined) return
    if (touch.identifier !== from.id || !from.frame.isConnected) return
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    if (Math.abs(dx) < MIN_SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (from.area === 'left') {
      if (dx < 0 && !from.room.forward && !from.frame.hasAttribute('data-sidebar-collapsed')) openLeft()
    } else if (from.area === 'right') {
      // A phone frame leaves the right panel no track (the shell's computeColumns yields 0), so the
      // panel opens fullscreen over a frame still marked `data-rightbar-collapsed`: whether it is
      // open is the panel's own mark, which the collapse control's selector already requires.
      if (dx > 0 && !from.room.back) {
        from.frame.querySelector<HTMLButtonElement>('[data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle]')?.click()
      }
    } else if (dx > 0 && from.frame.hasAttribute('data-sidebar-collapsed')) openLeft()
    else if (dx < 0 && from.frame.hasAttribute('data-rightbar-collapsed')) {
      from.frame.querySelector<HTMLButtonElement>('[data-sidebar-right-expand]')?.click()
    }
  }
  const cancel = (): void => { start = undefined }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchend', onEnd, { passive: false })
  document.addEventListener('touchcancel', cancel, { passive: true })
  return () => {
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', cancel)
  }
}

/** Bounce the chat or drawer past its ends; only a chat's top pull loads earlier messages. */
export function followVerticalPulls(): () => void {
  const THRESHOLD = 72
  const LIMIT = 56
  const DURATION = 220
  let start: { id: number; x: number; y: number; scroller: HTMLElement; columns: HTMLElement[]; distance: number } | undefined
  let animated: HTMLElement[] = []
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  const clearAnimation = (): void => {
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
    cleanupTimer = undefined
    for (const column of animated) {
      column.style.removeProperty('transform')
      column.style.removeProperty('transition')
    }
    animated = []
  }
  const onStart = (event: TouchEvent): void => {
    if (start?.distance) finish(false)
    else start = undefined
    if (event.touches.length !== 1 || !(event.target instanceof Element)
      || event.target.closest(`[data-composer-seat],${DRAWER_OWN_DRAG},[role="menu"]`)) return
    const target = event.target
    const scroller = event.target.closest<HTMLElement>(`[data-conversation-scroll],${DRAWER_SCROLL_ROOT}`)
    if (!scroller) return
    const chat = scroller.querySelector<HTMLElement>('[data-chat-flow]')
    const columns = chat ? [chat] : [...scroller.querySelectorAll<HTMLElement>(
      ':scope > :not([class*="_logoRow"]):not([class*="_footArea"]):not([class*="_topStrip"])',
    )]
    if (!columns.some(column => column.contains(target))
      || scrollsHorizontally(event.target, scroller)) return
    for (let element = event.target.parentElement; element !== null && element !== scroller; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight
        && /^(auto|scroll)$/u.test(getComputedStyle(element).overflowY)) return
    }
    const touch = event.touches[0]
    if (touch === undefined) return
    clearAnimation()
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, scroller, columns, distance: 0 }
  }
  const onMove = (event: TouchEvent): void => {
    const from = start
    if (!from) return
    if (event.touches.length !== 1 || !event.cancelable) { finish(false); return }
    const touch = event.touches[0]
    if (!touch || touch.identifier !== from.id) return
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx) * 1.2) {
      if (from.distance) finish(false)
      return
    }
    const { scroller, columns } = from
    if ((dy > 0 && scroller.scrollTop > 1)
      || (dy < 0 && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1)) {
      if (from.distance) finish(false)
      return
    }
    event.preventDefault()
    from.distance = dy
    for (const column of columns) {
      column.style.transition = 'none'
      column.style.transform = `translateY(${Math.round(Math.sign(dy) * Math.min(LIMIT, Math.abs(dy) * 0.45))}px)`
    }
  }
  const finish = (load: boolean): void => {
    const from = start
    start = undefined
    if (!from || from.distance === 0) return
    const { scroller, columns } = from
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const column of columns) {
      if (reducedMotion) {
        column.style.removeProperty('transform')
        column.style.removeProperty('transition')
      } else {
        column.style.transition = `transform ${DURATION}ms ease-out`
        column.style.transform = 'translateY(0px)'
      }
    }
    if (!reducedMotion) {
      animated = columns
      cleanupTimer = setTimeout(clearAnimation, DURATION)
    }
    if (load && from.distance >= THRESHOLD) {
      const button = scroller.querySelector<HTMLButtonElement>('[data-chat-flow] [class*="_older"] > button')
      if (button && !button.disabled) button.click()
    }
  }
  const onEnd = (event: TouchEvent): void => {
    if (start && event.touches.length === 0 && event.changedTouches[0]?.identifier === start.id) finish(true)
  }
  const onCancel = (): void => { finish(false) }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', onCancel, { passive: true })
  return () => {
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onCancel)
    if (start?.distance) animated.push(...start.columns)
    start = undefined
    clearAnimation()
  }
}

/** The phone composer's tool strip; narrow-style pins its ends and turns off its native overscroll. */
const STRIP = '[data-composer-card] > [class*="_row"]'

/** The chips between the pinned ends: every tool seat, and the model seat of the trailing group. */
const STRIP_CHIPS = ':scope > [class*="_tools"] [data-slot] > *, :scope > [class*="_trailing"] > [class*="_standardControls"] [data-slot] > *'

/**
 * Past either end of the phone composer's tool strip, stretch its chips and spring them back.
 * WebKit's own rubber-band would drag the pinned attach, microphone and send buttons along with
 * the strip, so the strip has none (see narrow-style) and this moves only the chips between them.
 */
export function followStripPulls(): () => void {
  const LIMIT = 40
  const DURATION = 220
  let drag: {
    id: number; x: number; y: number; lastX: number; strip: HTMLElement
    horizontal?: boolean; edge?: number | undefined; side?: 1 | -1 | undefined; pull: number
  } | undefined
  let settling: { chips: HTMLElement[]; timer: ReturnType<typeof setTimeout> } | undefined
  const chipsOf = (strip: HTMLElement): HTMLElement[] => [...strip.querySelectorAll<HTMLElement>(STRIP_CHIPS)]
  const clear = (chips: HTMLElement[]): void => {
    for (const chip of chips) {
      chip.style.removeProperty('transform')
      chip.style.removeProperty('transition')
    }
  }
  const settle = (): void => {
    if (!settling) return
    clearTimeout(settling.timer)
    clear(settling.chips)
    settling = undefined
  }
  const paint = (strip: HTMLElement, pull: number): void => {
    for (const chip of chipsOf(strip)) {
      chip.style.transition = 'none'
      chip.style.transform = `translateX(${pull}px)`
    }
  }
  const release = (): void => {
    const from = drag
    drag = undefined
    if (!from || from.pull === 0) return
    const chips = chipsOf(from.strip)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(chips); return }
    for (const chip of chips) {
      chip.style.transition = `transform ${DURATION}ms ease-out`
      chip.style.transform = 'translateX(0px)'
    }
    settling = { chips, timer: setTimeout(settle, DURATION) }
  }
  const onStart = (event: TouchEvent): void => {
    release()
    settle()
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || !(event.target instanceof Element)) return
    const strip = event.target.closest<HTMLElement>(STRIP)
    if (strip) drag = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastX: touch.clientX, strip, pull: 0 }
  }
  const onMove = (event: TouchEvent): void => {
    const from = drag
    if (!from) return
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || touch.identifier !== from.id) { release(); return }
    if (from.horizontal === undefined) {
      const dx = Math.abs(touch.clientX - from.x)
      const dy = Math.abs(touch.clientY - from.y)
      if (Math.max(dx, dy) < 6) return
      from.horizontal = dx > dy
    }
    if (!from.horizontal) { release(); return }
    const { strip } = from
    const step = touch.clientX - from.lastX
    from.lastX = touch.clientX
    if (from.edge === undefined || from.side === undefined) {
      // The strip scrolls natively until it reaches an end; the pull starts from where it did.
      const atStart = strip.scrollLeft <= 0
      const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1
      if (!((step > 0 && atStart) || (step < 0 && atEnd))) return
      from.edge = touch.clientX - step
      from.side = step > 0 ? 1 : -1
    }
    const over = (touch.clientX - from.edge) * from.side
    if (over <= 0) {
      // Back inside: hand the gesture to native scrolling again.
      from.edge = undefined
      from.side = undefined
      from.pull = 0
      clear(chipsOf(strip))
      return
    }
    if (event.cancelable) event.preventDefault()
    from.pull = from.side * Math.round(Math.min(LIMIT, over * 0.45))
    paint(strip, from.pull)
  }
  const onEnd = (event: TouchEvent): void => {
    if (drag && event.touches.length === 0) release()
  }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', release, { passive: true })
  return () => {
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', release)
    if (drag) clear(chipsOf(drag.strip))
    drag = undefined
    settle()
  }
}
