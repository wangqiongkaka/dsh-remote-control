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

/** Observe single-finger swipes without blocking native scrolling or clicks. */
export function followSidebarSwipes(openLeft: () => void): () => void {
  let start: { id: number; x: number; y: number; frame: Element; area: 'center' | 'left' | 'right' } | undefined
  const onStart = (event: TouchEvent): void => {
    start = undefined
    if (event.touches.length !== 1 || !(event.target instanceof Element)) return
    const target = event.target
    const center = target.closest('[class*="_centerCol"]')
    const left = target.closest('[class*="_sidebarCol"]')
    const right = target.closest('[data-sidebar-right-panel][data-sidebar-right-open]')
    const area = center ?? left ?? right
    const frame = area?.closest('[class*="_frame"]:has([class*="_sidebarCol"])')
    if (!area || !frame || target.closest(INTERACTIVE)
      || scrollsHorizontally(target, area)) return
    const touch = event.touches[0]
    if (touch === undefined) return
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, frame,
      area: center ? 'center' : left ? 'left' : 'right' }
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
      if (dx < 0 && !from.frame.hasAttribute('data-sidebar-collapsed')) openLeft()
    } else if (from.area === 'right') {
      if (dx > 0 && !from.frame.hasAttribute('data-rightbar-collapsed')) {
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
