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
