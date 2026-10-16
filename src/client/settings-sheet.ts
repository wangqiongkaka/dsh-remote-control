/** Add a phone-only resize handle without moving the host's settings controls. */
export function followSettingsSheet(): () => void {
  const panels = new Map<HTMLElement, () => void>()
  const attach = (panel: HTMLElement): (() => void) => {
    const handle = document.createElement('button')
    handle.type = 'button'
    handle.setAttribute('data-dsh-settings-resize', '')
    panel.setAttribute('data-dsh-settings-sheet', '')
    panel.prepend(handle)
    let ratio = .5
    let drag: { id: number; y: number; height: number; ratio: number; moved: boolean } | undefined
    let suppressClick = false
    let clickTimer = 0
    const set = (value: number): void => {
      ratio = Math.max(.5, Math.min(1, value))
      panel.style.setProperty('--dsh-settings-ratio', String(ratio))
      handle.setAttribute('aria-expanded', String(ratio > .5))
      handle.setAttribute('aria-label', ratio > .5 ? '拖动调整高度，点击收起设置' : '拖动调整高度，点击展开设置')
    }
    const down = (event: PointerEvent): void => {
      if (!event.isPrimary || event.button !== 0 || drag) return
      event.preventDefault()
      drag = { id: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height, ratio, moved: false }
      handle.setPointerCapture?.(event.pointerId)
    }
    const move = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return
      event.preventDefault()
      const distance = drag.y - event.clientY
      if (Math.abs(distance) > 4) drag.moved = true
      if (!drag.moved) return
      const height = panel.parentElement?.getBoundingClientRect().height || window.innerHeight
      set((drag.height + distance) / Math.max(1, height))
    }
    const finish = (event: PointerEvent, cancelled: boolean): void => {
      if (!drag || event.pointerId !== drag.id) return
      const from = drag
      drag = undefined
      if (cancelled) set(from.ratio)
      suppressClick = from.moved && !cancelled
      window.clearTimeout(clickTimer)
      clickTimer = window.setTimeout(() => { suppressClick = false }, 0)
      if (handle.hasPointerCapture?.(from.id)) handle.releasePointerCapture(from.id)
    }
    const up = (event: PointerEvent): void => { move(event); finish(event, false) }
    const cancel = (event: PointerEvent): void => { finish(event, true) }
    const click = (): void => { if (!suppressClick) set(ratio > .5 ? .5 : 1) }
    const keydown = (event: KeyboardEvent): void => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      set(event.key === 'Home' ? .5 : event.key === 'End' ? 1 : ratio + (event.key === 'ArrowUp' ? .1 : -.1))
    }
    handle.addEventListener('pointerdown', down)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', cancel)
    handle.addEventListener('lostpointercapture', cancel)
    handle.addEventListener('click', click)
    handle.addEventListener('keydown', keydown)
    set(.5)
    return () => {
      drag = undefined
      window.clearTimeout(clickTimer)
      handle.removeEventListener('pointerdown', down)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', cancel)
      handle.removeEventListener('lostpointercapture', cancel)
      handle.removeEventListener('click', click)
      handle.removeEventListener('keydown', keydown)
      handle.remove()
      panel.removeAttribute('data-dsh-settings-sheet')
      panel.style.removeProperty('--dsh-settings-ratio')
    }
  }
  const sync = (): void => {
    for (const [panel, dispose] of panels) {
      if (panel.isConnected && window.innerWidth <= 720) continue
      dispose()
      panels.delete(panel)
    }
    if (window.innerWidth > 720) return
    for (const panel of document.querySelectorAll<HTMLElement>('[data-shortcut-modal="settings"]')) {
      if (!panels.has(panel)) panels.set(panel, attach(panel))
    }
  }
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', sync)
  sync()
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', sync)
    for (const dispose of panels.values()) dispose()
    panels.clear()
  }
}
