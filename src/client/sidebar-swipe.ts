/** Open and close the phone drawers with horizontal swipes. */

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
    if (center ? target.closest(INTERACTIVE) || scrollsHorizontally(target, area) : target.closest(DRAWER_OWN_DRAG)) return
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
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })
  return () => {
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', cancel)
  }
}

/** Pull past the chat's top to page history, or past its bottom to bounce the transcript. */
export function followChatPulls(): () => void {
  const THRESHOLD = 72
  const LIMIT = 56
  const DURATION = 220
  let start: { id: number; x: number; y: number; scroller: HTMLElement; column: HTMLElement; distance: number } | undefined
  let animated: HTMLElement | undefined
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  const clearAnimation = (): void => {
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
    cleanupTimer = undefined
    animated?.style.removeProperty('transform')
    animated?.style.removeProperty('transition')
    animated = undefined
  }
  const onStart = (event: TouchEvent): void => {
    if (start?.distance) finish(false)
    else start = undefined
    if (event.touches.length !== 1 || !(event.target instanceof Element)
      || event.target.closest('[data-composer-seat], [role="dialog"]')) return
    const scroller = event.target.closest<HTMLElement>('[data-conversation-scroll]')
    const column = scroller?.querySelector<HTMLElement>('[data-chat-flow]')
    if (!scroller || !column || !column.contains(event.target)
      || scrollsHorizontally(event.target, scroller)) return
    for (let element = event.target.parentElement; element !== null && element !== scroller; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight
        && /^(auto|scroll)$/u.test(getComputedStyle(element).overflowY)) return
    }
    const touch = event.touches[0]
    if (touch === undefined) return
    clearAnimation()
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, scroller, column, distance: 0 }
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
    const { scroller, column } = from
    if ((dy > 0 && scroller.scrollTop > 1)
      || (dy < 0 && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1)) {
      if (from.distance) finish(false)
      return
    }
    event.preventDefault()
    from.distance = dy
    column.style.transition = 'none'
    column.style.transform = `translateY(${Math.round(Math.sign(dy) * Math.min(LIMIT, Math.abs(dy) * 0.45))}px)`
  }
  const finish = (load: boolean): void => {
    const from = start
    start = undefined
    if (!from || from.distance === 0) return
    const { scroller, column } = from
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      column.style.removeProperty('transform')
      column.style.removeProperty('transition')
    } else {
      column.style.transition = `transform ${DURATION}ms ease-out`
      column.style.transform = 'translateY(0px)'
      animated = column
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
