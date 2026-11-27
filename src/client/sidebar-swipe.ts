/** Open and close the phone drawers with horizontal swipes. */

import { AGENTS_COLLAPSED_ATTRIBUTE, DRAWER_WORKSPACE_SCROLL, GIT_HISTORY_REF } from './drawer-style.ts'
import { EASE, SLOW } from '../narrow-style.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'

const MIN_SWIPE = 48
const INTERACTIVE = 'button,a,input,textarea,select,[contenteditable], [role="dialog"], [data-composer-card]'

/**
 * Inside an open drawer a sideways drag never clicks the control under it, so only a field that
 * owns its own drag (and an open menu) keeps a closing swipe to itself.
 */
// The native sidebar is itself a dialog; only nested dialogs keep their own gesture.
const DRAWER_OWN_DRAG = 'input,textarea,select,[contenteditable], [role="dialog"]:not([data-shortcut-modal="sidebar"])'

/**
 * Which ways the horizontal scrollers between a touch and its area can still scroll: a drag that
 * would move one of them is that scroller's, not the drawer's.
 */
function scrollRoom(target: Element, area: Element): { back: boolean; forward: boolean; horizontal: boolean } {
  const room = { back: false, forward: false, horizontal: false }
  for (let element: Element | null = target; element !== null && element !== area; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth || !/^(auto|scroll)$/.test(getComputedStyle(element).overflowX)) continue
    room.horizontal = true
    if (element.scrollLeft > 0) room.back = true
    if (element.scrollLeft + element.clientWidth < element.scrollWidth - 1) room.forward = true
  }
  return room
}

const FRAME = '[class*="_frame"]:has([class*="_sidebarCol"])'
const RIGHT_TOGGLE = '[data-sidebar-right-panel][data-sidebar-right-open] [data-sidebar-right-toggle]'
/** Allow the shell's asynchronous Session and panel restoration to settle before recording. */
const LANDING = 10_000
/** A live document must not reapply its saved page when only the plugin reloads. */
const LANDED = 'data-remote-control-landed'
const LAST_PAGE = 'dsh-remote-control.last-page.v1'
type LastPage = { area: 'left' | 'center' | 'right'; panelId: string | null }

function savedPage(): LastPage {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_PAGE) ?? 'null')
    if (typeof value === 'object' && value !== null && 'area' in value && 'panelId' in value
      && (value.area === 'left' || value.area === 'center' || value.area === 'right')
      && (value.panelId === null || typeof value.panelId === 'string')) {
      return { area: value.area, panelId: value.panelId }
    }
  } catch { /* Storage may be disabled or its old record malformed. */ }
  return { area: 'left', panelId: null }
}

/**
 * Restore the phone's last visible area and global main panel. The host already remembers the
 * current Session and its right-panel tabs; keep those identities in their existing stores.
 * New documents and returning WebViews restore until the first user interaction or the startup
 * deadline. Hidden layout changes must not replace the last page the user actually saw.
 */
export function followLastPage(ctx: Context): () => void {
  let wanted = savedPage()
  let restoring = !document.documentElement.hasAttribute(LANDED)
  let hidden = document.visibilityState !== 'visible'
  document.documentElement.setAttribute(LANDED, '')
  let lastSaved: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let first: ReturnType<typeof setTimeout> | undefined
  let askedLeft = false
  let askedRight = false
  let cachedFrame: Element | null = null
  const currentFrame = (): Element | null => cachedFrame?.isConnected ? cachedFrame : (cachedFrame = document.querySelector(FRAME))
  const touchesSidebarPanel = (node: Node): boolean => node instanceof Element && (
    node.hasAttribute('data-sidebar-right-panel') || node.hasAttribute('data-sidebar-right-toggle')
    || (node.childElementCount > 0 && node.querySelector('[data-sidebar-right-panel],[data-sidebar-right-toggle]') !== null)
  )
  const save = (): void => {
    if (restoring || hidden) return
    const frame = currentFrame()
    if (!frame) return
    const panelId = ctx.layout.panelInfo.getSnapshot().activePanelId
    const area = !frame.hasAttribute('data-sidebar-collapsed') ? 'left'
      : panelId === null && frame.querySelector(RIGHT_TOGGLE) ? 'right' : 'center'
    const encoded = JSON.stringify({ area, panelId })
    if (encoded === lastSaved) return
    try { localStorage.setItem(LAST_PAGE, encoded); lastSaved = encoded } catch { /* Storage may be disabled. */ }
  }
  const update = (): void => {
    if (hidden) return
    if (!restoring) { save(); return }
    const frame = currentFrame()
    if (!frame) return
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== wanted.panelId) {
      const entry = ctx.slots.entries('main').find(entry => entry.options.key === wanted.panelId)
      // A main page may register after this plugin. Never select an unregistered key.
      if (wanted.panelId === null || entry) ctx.layout.selectPanel(wanted.panelId === null
        ? null : entry!.options.key as MainPanelId)
    }
    const right = frame.querySelector<HTMLButtonElement>(RIGHT_TOGGLE)
    const wantRight = wanted.area === 'right' && wanted.panelId === null
    if ((right !== null) === wantRight) askedRight = false
    else if (!askedRight) {
      const control = wantRight ? frame.querySelector<HTMLButtonElement>('[data-sidebar-right-expand]') : right
      if (control) { askedRight = true; control.click() }
    }
    const wantLeft = wanted.area === 'left'
    if ((!frame.hasAttribute('data-sidebar-collapsed')) === wantLeft) askedLeft = false
    else if (!askedLeft) {
      askedLeft = true
      ctx.layout.toggleSidebar()
    }
  }
  const onMutation = (records: MutationRecord[]): void => {
    if (hidden) return
    if (restoring || !cachedFrame?.isConnected) { update(); return }
    for (const record of records) {
      if (record.type === 'attributes') { save(); return }
      for (const node of record.addedNodes) if (touchesSidebarPanel(node)) { save(); return }
      for (const node of record.removedNodes) if (touchesSidebarPanel(node)) { save(); return }
    }
  }
  const stopListening = (): void => {
    clearTimeout(timer)
    clearTimeout(first)
    document.removeEventListener('touchstart', stop, true)
    document.removeEventListener('pointerdown', stop, true)
    document.removeEventListener('keydown', stop, true)
  }
  const stop = (): void => {
    stopListening()
    restoring = false
    save()
  }
  const listen = (): void => {
    document.addEventListener('touchstart', stop, { capture: true, passive: true })
    document.addEventListener('pointerdown', stop, { capture: true, passive: true })
    document.addEventListener('keydown', stop, true)
    // ponytail: retry late shell restoration for ten seconds; use a readiness signal if startup outgrows it.
    timer = setTimeout(stop, LANDING)
  }
  const hide = (): void => {
    save()
    hidden = true
    stopListening()
  }
  const show = (): void => {
    if (!hidden) return
    hidden = false
    wanted = savedPage()
    restoring = true
    askedLeft = askedRight = false
    listen()
    first = setTimeout(update, 0)
  }
  const onVisible = (): void => { if (document.visibilityState === 'visible') show(); else hide() }
  const observer = new MutationObserver(onMutation)
  observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-right-open'],
  })
  const offPanels = ctx.layout.panelInfo.subscribe(update)
  const offEntries = ctx.slots.subscribe('main', update)
  if (restoring && !hidden) listen()
  first = setTimeout(update, 0)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', show)
  return () => {
    stopListening()
    observer.disconnect()
    offPanels()
    offEntries()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', show)
  }
}

const HOLD = 500
const HOLD_SLOP = 10

/**
 * Long-press a Git history label to reveal the full commit details; the lift that ends the press is
 * kept from also tapping the row, and the rest of a history row keeps its own diff click and Git
 * context menu. (Session rows show their action strip outright on the phone, see drawer-style.)
 */
export function followRowHolds(): () => void {
  let hold: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined
  let fired = false
  let heldRow: HTMLElement | undefined
  let dialog: HTMLDialogElement | undefined
  const showDetails = (row: HTMLElement): void => {
    if (dialog) return
    const panel = document.createElement('dialog')
    dialog = panel
    panel.setAttribute('data-remote-control-git-details', '')
    panel.setAttribute('aria-label', '提交详情')
    panel.setAttribute('role', 'dialog')
    const heading = document.createElement('h2')
    heading.textContent = '提交详情'
    const list = document.createElement('dl')
    const [authorTime = '', hash = ''] = row.title.split('\n').slice(-2)
    const fields = [
      ['提交说明', row.querySelector('[class*="_gitLogSubject"]')?.textContent ?? ''],
      ['分支／标签', [...row.querySelectorAll('[class*="_gitLogRef"]')].map(ref => ref.textContent).join('\n')],
      ['作者／时间', authorTime],
      ['完整哈希', hash],
    ]
    for (const [label, value] of fields) {
      const term = document.createElement('dt')
      const detail = document.createElement('dd')
      term.textContent = label ?? ''
      detail.textContent = value ?? ''
      list.append(term, detail)
    }
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '关闭'
    close.onclick = () => { panel.close() }
    panel.onclick = event => { if (event.target === panel) panel.close() }
    panel.onclose = () => {
      panel.remove()
      if (dialog === panel) dialog = undefined
      heldRow = undefined
      if (!dialog && row.isConnected) row.focus({ preventScroll: true })
    }
    panel.append(heading, list, close)
    document.body.append(panel)
    row.focus({ preventScroll: true })
    panel.showModal()
  }
  const cancel = (): void => {
    if (hold !== undefined) clearTimeout(hold.timer)
    hold = undefined
  }
  const onStart = (event: TouchEvent): void => {
    cancel()
    fired = false
    heldRow = undefined
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || !(event.target instanceof Element)) return
    const row = event.target.closest(GIT_HISTORY_REF)?.closest<HTMLElement>('[class*="_gitLogRow"]')
    if (!row) return
    hold = { x: touch.clientX, y: touch.clientY, timer: setTimeout(() => {
      hold = undefined
      if (!row.isConnected) return
      fired = true
      heldRow = row
      showDetails(row)
    }, HOLD) }
  }
  const onMove = (event: TouchEvent): void => {
    const touch = event.touches[0]
    if (event.touches.length !== 1) { cancel(); return }
    if (hold === undefined || touch === undefined) return
    if (Math.hypot(touch.clientX - hold.x, touch.clientY - hold.y) > HOLD_SLOP) cancel()
  }
  const onEnd = (event: TouchEvent): void => {
    cancel()
    if (fired) {
      event.preventDefault()
      if (heldRow) event.stopImmediatePropagation()
    }
    fired = false
  }
  // Android answers a long press with the context menu as well.
  const onContextMenu = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const row = event.target.closest(GIT_HISTORY_REF)?.closest<HTMLElement>('[class*="_gitLogRow"]')
    if (row) {
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
      fired = true
      heldRow = row
      showDetails(row)
    }
  }
  const onClick = (event: Event): void => {
    if (event.target instanceof Node && heldRow?.contains(event.target)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    heldRow = undefined
  }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd, { capture: true, passive: false })
  document.addEventListener('touchcancel', cancel, { passive: true })
  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('click', onClick, true)
  return () => {
    cancel()
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    dialog?.close()
    dialog?.remove()
    dialog = undefined
    document.removeEventListener('touchend', onEnd, true)
    document.removeEventListener('touchcancel', cancel)
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('click', onClick, true)
  }
}

/** A release faster than this (px/ms) settles the drag its own way, however short it was. */
const FLING = 0.3
/** narrow-style's SLOW; the inline slide is cleared once it ends. */
const SETTLE = 300
/** What the shell slides for the right panel; its root stays untransformed so floating children escape. */
const RIGHT_PIECES = '[data-sidebar-right-panel] :is([data-dockkit-host="dock"],[data-dockkit-empty],[data-dockkit-divider])'
const SCRIM = '[data-remote-control-scrim]'
const SWIPING = 'data-remote-control-swiping'

/** Align a translation to physical device pixels so 3x Retina screens keep sub-pixel smoothness. */
function snap(value: number): number {
  const scale = window.devicePixelRatio || 1
  return Math.round((Math.round(value * scale) / scale) * 100) / 100
}

/** A light tap through the iOS App's native bridge (RemoteViewController); browsers have none. */
function haptic(): void {
  (window as { webkit?: { messageHandlers?: { haptic?: { postMessage(body: string): void } } } })
    .webkit?.messageHandlers?.haptic?.postMessage('')
}

/** The left drawer (-1) or right panel (1) a horizontal drag moves, opening or closing it. */
type Drag = {
  side: -1 | 1; opening: boolean; width: number; past: boolean
  prev: { x: number; t: number }; last: { x: number; t: number }
  pieces: HTMLElement[]; scrims: HTMLElement[]
  frameId: number; pendingX?: number
}

/**
 * Observe single-finger swipes without blocking native scrolling or clicks. Once a touch turns
 * sideways toward a drawer it owns the gesture: the drawer (opened at once, since a collapsed
 * sidebar renders only its rail) follows the finger, and the release keeps it past a third or on
 * a fling, otherwise springs it back.
 */
export function followSidebarSwipes(openLeft: () => void): () => void {
  let start: {
    id: number; x: number; y: number; frame: Element; area: 'center' | 'left' | 'right'
    room: { back: boolean; forward: boolean; horizontal: boolean }; at: number; moving: boolean; drag?: Drag
  } | undefined
  let settling: { frame: Element; pieces: HTMLElement[]; scrims: HTMLElement[]; timer: ReturnType<typeof setTimeout> } | undefined
  const selecting = (): boolean => document.getSelection()?.isCollapsed === false
  /** Which drawer a sideways swipe from this start opens or closes, if any. */
  const target = (from: NonNullable<typeof start>, dx: number): Pick<Drag, 'side' | 'opening'> | undefined => {
    if (from.area === 'left') {
      return dx < 0 && !from.room.forward && !from.frame.hasAttribute('data-sidebar-collapsed') ? { side: -1, opening: false } : undefined
    }
    // A phone frame leaves the right panel no track (the shell's computeColumns yields 0), so the
    // panel opens fullscreen over a frame still marked `data-rightbar-collapsed`: whether it is
    // open is the panel's own mark, which the collapse control's selector already requires.
    if (from.area === 'right') return dx > 0 && !from.room.back ? { side: 1, opening: false } : undefined
    if (dx > 0 && from.frame.hasAttribute('data-sidebar-collapsed')) return { side: -1, opening: true }
    if (dx < 0 && from.frame.hasAttribute('data-rightbar-collapsed') && from.frame.querySelector('[data-sidebar-right-expand]')) {
      return { side: 1, opening: true }
    }
    return undefined
  }
  const flip = (frame: Element, side: -1 | 1, open: boolean): void => {
    if (side < 0) openLeft()
    else frame.querySelector<HTMLButtonElement>(open ? '[data-sidebar-right-expand]' : RIGHT_TOGGLE)?.click()
  }
  const queryPieces = (frame: Element, side: -1 | 1): HTMLElement[] => [...frame.querySelectorAll<HTMLElement>(side < 0 ? '[class*="_sidebarCol"]' : RIGHT_PIECES)]
  const queryScrims = (side: -1 | 1): HTMLElement[] => side < 0 ? [...document.querySelectorAll<HTMLElement>(SCRIM)] : []
  const paint = (pieces: HTMLElement[], scrims: HTMLElement[], offset: number, openness: number, transition: string): void => {
    const move = transition ? `transform ${transition}` : 'none'
    const transform = `translate3d(${snap(offset)}px, 0, 0)`
    for (const piece of pieces) {
      piece.style.transition = move
      piece.style.visibility = 'visible'
      piece.style.willChange = 'transform'
      piece.style.transform = transform
    }
    if (scrims.length === 0) return
    const fade = transition ? `opacity ${transition}` : 'none'
    const opacity = String(openness)
    for (const scrim of scrims) {
      scrim.style.transition = fade
      scrim.style.willChange = 'opacity'
      scrim.style.opacity = opacity
    }
  }
  const clear = (frame: Element, pieces: HTMLElement[], scrims: HTMLElement[]): void => {
    frame.removeAttribute(SWIPING)
    for (const piece of pieces) for (const name of ['transform', 'transition', 'visibility', 'will-change']) piece.style.removeProperty(name)
    for (const scrim of scrims) for (const name of ['opacity', 'transition', 'will-change']) scrim.style.removeProperty(name)
  }
  const settle = (): void => {
    if (!settling) return
    clearTimeout(settling.timer)
    clear(settling.frame, settling.pieces, settling.scrims)
    settling = undefined
  }
  /** End a drag: commit leaves the drawer in its new state, otherwise it returns to where it was. */
  const finish = (commit: boolean): void => {
    const from = start
    start = undefined
    const drag = from?.drag
    if (!from || !drag) return
    if (drag.frameId !== 0) { cancelAnimationFrame(drag.frameId); drag.frameId = 0 }
    // Opening already flipped the shell at lock: undo it on cancel; closing flips only on commit.
    if (drag.opening !== commit) flip(from.frame, drag.side, false)
    const open = drag.opening === commit
    // A drag past its release point already tapped there; a fling settles with its own tap.
    if (commit && !drag.past) haptic()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(from.frame, drag.pieces, drag.scrims); return }
    // Slide the rest of the way inline, so the shell's own transition never retargets mid-flight.
    paint(drag.pieces, drag.scrims, open ? 0 : drag.side * drag.width, open ? 1 : 0, `${SLOW} ${EASE}`)
    settling = { frame: from.frame, pieces: drag.pieces, scrims: drag.scrims, timer: setTimeout(settle, SETTLE) }
  }
  const drawTo = (from: NonNullable<typeof start>, drag: Drag, x: number): void => {
    const base = drag.opening ? drag.side * drag.width : 0
    const offset = Math.min(Math.max(base + x - from.x, Math.min(0, drag.side * drag.width)), Math.max(0, drag.side * drag.width))
    paint(drag.pieces, drag.scrims, offset, 1 - Math.abs(offset) / drag.width, '')
  }
  const checkThreshold = (from: NonNullable<typeof start>, drag: Drag, x: number): void => {
    // Tap each time the drag crosses the point where letting go keeps the new state.
    const past = (x - from.x) * (drag.opening ? -drag.side : drag.side) >= drag.width / 3
    if (past !== drag.past) { drag.past = past; haptic() }
  }
  const onStart = (event: TouchEvent): void => {
    finish(false)
    settle()
    if (selecting() || event.touches.length !== 1 || !(event.target instanceof Element)) return
    const target = event.target
    const center = target.closest('[class*="_centerCol"]')
    const left = target.closest('[class*="_sidebarCol"]')
    const right = target.closest('[data-sidebar-right-panel][data-sidebar-right-open]')
    const area = center ?? left ?? right
    const frame = area?.closest('[class*="_frame"]:has([class*="_sidebarCol"])')
    if (!area || !frame) return
    // The conversation keeps every control and sideways scroller to itself; an open drawer lets a
    // closing swipe start on its rows and tabs (see DRAWER_OWN_DRAG and the direction check below).
    if (center ? target.closest(INTERACTIVE) : target.closest(DRAWER_OWN_DRAG)) return
    const room = scrollRoom(target, area)
    if (center && room.horizontal) return
    const touch = event.touches[0]
    if (touch === undefined) return
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, frame,
      area: center ? 'center' : left ? 'left' : 'right', room, at: Date.now(), moving: false }
  }
  const onMove = (event: TouchEvent): void => {
    if (selecting() || event.touches.length !== 1) { cancel(); return }
    const touch = event.touches[0]
    if (!start || !touch || touch.identifier !== start.id) return
    // Native WebView exit gestures can move its coordinate origin outside the viewport.
    if (touch.clientX < 0 || touch.clientX > window.innerWidth) { cancel(); return }
    const { drag } = start
    if (drag) {
      if (event.cancelable) event.preventDefault()
      drag.prev = drag.last
      drag.last = { x: touch.clientX, t: Date.now() }
      checkThreshold(start, drag, touch.clientX)
      drag.pendingX = touch.clientX
      if (drag.frameId === 0) {
        const current = start
        drag.frameId = requestAnimationFrame(() => {
          drag.frameId = 0
          if (start !== current || drag.pendingX === undefined) return
          drawTo(current, drag, drag.pendingX)
        })
      }
      return
    }
    if (start.moving) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.hypot(dx, dy) <= HOLD_SLOP) return
    // A stationary hold belongs to native text selection, even before its range is announced.
    if (Date.now() - start.at >= HOLD) { cancel(); return }
    start.moving = true
    const aim = Math.abs(dx) >= Math.abs(dy) * 1.5 && start.frame.isConnected ? target(start, dx) : undefined
    if (!aim) return
    if (event.cancelable) event.preventDefault()
    // Measure before toggling shell state so opening does not force a synchronous reflow.
    const sized = aim.side < 0 ? start.frame.querySelector('[class*="_sidebarCol"]') : start.frame.querySelector('[data-sidebar-right-panel]')
    const width = sized?.getBoundingClientRect().width || window.innerWidth
    if (aim.opening) flip(start.frame, aim.side, true)
    const pieces = queryPieces(start.frame, aim.side)
    const scrims = queryScrims(aim.side)
    start.frame.setAttribute(SWIPING, '')
    start.drag = { ...aim, width, past: false,
      prev: { x: start.x, t: start.at }, last: { x: touch.clientX, t: Date.now() },
      pieces, scrims, frameId: 0 }
    checkThreshold(start, start.drag, touch.clientX)
    drawTo(start, start.drag, touch.clientX)
  }
  const onEnd = (event: TouchEvent): void => {
    const from = start
    if (from?.drag) {
      const touch = event.changedTouches[0]
      if (event.touches.length !== 0 || touch?.identifier !== from.id) return
      const { drag } = from
      const toward = drag.opening ? -drag.side : drag.side
      const speed = (touch.clientX - drag.prev.x) / Math.max(1, Date.now() - drag.prev.t) * toward
      const moved = (touch.clientX - from.x) * toward
      const inside = touch.clientX >= 0 && touch.clientX <= window.innerWidth
      finish(inside && speed > -FLING && (speed >= FLING || moved >= drag.width / 3))
      return
    }
    start = undefined
    if (from === undefined || selecting() || (!from.moving && Date.now() - from.at >= HOLD)
      || event.touches.length !== 0 || event.changedTouches.length !== 1) return
    const touch = event.changedTouches[0]
    if (touch === undefined) return
    if (touch.identifier !== from.id || !from.frame.isConnected
      || touch.clientX < 0 || touch.clientX > window.innerWidth) return
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    if (Math.abs(dx) < MIN_SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const aim = target(from, dx)
    if (!aim) return
    flip(from.frame, aim.side, aim.opening)
    haptic()
  }
  const cancel = (): void => { finish(false) }
  const onSelection = (): void => { if (selecting()) cancel() }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd, { passive: false })
  document.addEventListener('touchcancel', cancel, { passive: true })
  document.addEventListener('selectionchange', onSelection)
  document.addEventListener('contextmenu', cancel, true)
  document.addEventListener('visibilitychange', cancel)
  window.addEventListener('pagehide', cancel)
  window.addEventListener('blur', cancel)
  return () => {
    finish(false)
    settle()
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', cancel)
    document.removeEventListener('selectionchange', onSelection)
    document.removeEventListener('contextmenu', cancel, true)
    document.removeEventListener('visibilitychange', cancel)
    window.removeEventListener('pagehide', cancel)
    window.removeEventListener('blur', cancel)
  }
}

/** Collect the real layout boxes inside the Workspace list scrollport so transforms never touch pinned bars. */
function workspacePullColumns(listArea: Element): HTMLElement[] {
  const result: HTMLElement[] = []
  for (const child of listArea.children) {
    if (!(child instanceof HTMLElement) || child.matches('[class*="_fade"]')) continue
    if (getComputedStyle(child).display === 'contents') result.push(...workspacePullColumns(child))
    else result.push(child)
  }
  return result
}

/** Progressive rubber-band resistance: smooth near zero and approaches `limit` without a hard stop. */
function rubberBand(distance: number, limit: number): number {
  const abs = Math.abs(distance)
  return Math.sign(distance) * ((abs * limit * 0.55) / (limit + abs * 0.55))
}

/** Find the sidebar's Agent board and its collapsible session list, if mounted. */
function agentBoardParts(scroller: Element): { board: HTMLElement; list: HTMLElement } | null {
  const board = scroller.closest('[class*="_sidebarCol"]')?.querySelector<HTMLElement>('[data-hp-agents]')
  const list = board?.querySelector<HTMLElement>('.hp-agents-list')
  return board && list ? { board, list } : null
}

/**
 * Bounce the chat and the drawer's Workspace list past either end with progressive resistance;
 * only a chat's top pull loads earlier messages. Yields drawer edge drags that progressively
 * collapse or expand the pinned Agent board to `followAgentBoardCollapse`. Claims boundary pulls
 * in the Workspace list from the first pixel so WebKit's native rubber band never drags pinned bars.
 */
export function followVerticalPulls(): () => void {
  const THRESHOLD = 72
  const LIMIT = 64
  const DURATION = 320
  const REBOUND_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
  let start: {
    id: number; x: number; y: number; lastY: number
    scroller: HTMLElement; columns: HTMLElement[]; drawer: boolean
    edgeY?: number | undefined; side?: 1 | -1 | undefined; distance: number; frameId: number
    pending?: number | undefined
  } | undefined
  let animated: HTMLElement[] = []
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  const resetColumns = (columns: HTMLElement[]): void => {
    for (const column of columns) {
      column.style.removeProperty('transform')
      column.style.removeProperty('transition')
      column.style.removeProperty('will-change')
    }
  }
  const clearAnimation = (): void => {
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
    cleanupTimer = undefined
    resetColumns(animated)
    animated = []
  }
  const paint = (columns: HTMLElement[], distance: number): void => {
    const offset = snap(rubberBand(distance, LIMIT))
    const transform = `translate3d(0px, ${offset}px, 0px)`
    for (const column of columns) {
      column.style.transition = 'none'
      column.style.willChange = 'transform'
      column.style.transform = transform
    }
  }
  const onStart = (event: TouchEvent): void => {
    if (start?.distance) finish(false)
    else {
      if (start?.frameId) cancelAnimationFrame(start.frameId)
      start = undefined
    }
    if (event.touches.length !== 1 || !(event.target instanceof Element)
      || event.target.closest(`[data-composer-seat],${DRAWER_OWN_DRAG},[role="menu"]`)) return
    const target = event.target
    const scroller = event.target.closest<HTMLElement>(`[data-conversation-scroll],${DRAWER_WORKSPACE_SCROLL}`)
    if (!scroller) return
    const chat = scroller.querySelector<HTMLElement>('[data-chat-flow]')
    const columns = chat ? [chat] : workspacePullColumns(scroller)
    const inColumns = chat
      ? columns.some(column => column.contains(target))
      : columns.length > 0 && (target === scroller || columns.some(column => column.contains(target)))
    if (!inColumns) return
    for (let element: Element | null = target; element !== null && element !== scroller; element = element.parentElement) {
      const horiz = element.scrollWidth > element.clientWidth
      const vert = element !== target && element.scrollHeight > element.clientHeight
      if (!horiz && !vert) continue
      const style = getComputedStyle(element)
      if ((horiz && /^(auto|scroll)$/u.test(style.overflowX))
        || (vert && /^(auto|scroll)$/u.test(style.overflowY))) return
    }
    const touch = event.touches[0]
    if (touch === undefined) return
    clearAnimation()
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastY: touch.clientY,
      scroller, columns, drawer: !chat, distance: 0, frameId: 0 }
  }
  const onMove = (event: TouchEvent): void => {
    const from = start
    if (!from) return
    if (event.touches.length !== 1 || !event.cancelable) { finish(false); return }
    const touch = event.touches[0]
    if (!touch || touch.identifier !== from.id) return
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    const prevY = from.lastY
    const stepY = touch.clientY - prevY
    from.lastY = touch.clientY
    const { scroller, columns } = from
    if (from.edgeY === undefined || from.side === undefined) {
      const atTop = scroller.scrollTop <= 1
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
      const pullDown = stepY > 0 && atTop
      const pullUp = stepY < 0 && atBottom
      if (!pullDown && !pullUp) return
      // In the drawer, yield pulls that expand a collapsed board or collapse an open board,
      // and claim remaining boundary pulls from the first pixel against WebKit rubber-band.
      if (from.drawer) {
        const parts = agentBoardParts(scroller)
        if (parts) {
          const isCollapsed = parts.board.hasAttribute(AGENTS_COLLAPSED_ATTRIBUTE)
          if ((pullDown && isCollapsed) || (pullUp && !isCollapsed)) return
        }
        if (Math.abs(dy) < Math.abs(dx)) return
      } else if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx) * 1.2) {
        return
      }
      from.edgeY = prevY
      from.side = pullDown ? 1 : -1
    } else if (Math.abs(dx) >= 8 && Math.abs(dy) < Math.abs(dx) * 1.2) {
      finish(false)
      return
    }
    const over = (touch.clientY - from.edgeY) * from.side
    if (over <= 0) {
      // Pulled back inside the scrollport: hand control cleanly back to native scrolling.
      if (from.frameId !== 0) { cancelAnimationFrame(from.frameId); from.frameId = 0 }
      from.edgeY = undefined
      from.side = undefined
      from.distance = 0
      from.pending = undefined
      resetColumns(columns)
      return
    }
    event.preventDefault()
    const signed = over * from.side
    const firstPaint = from.distance === 0
    from.distance = signed
    from.pending = signed
    if (firstPaint) {
      paint(columns, signed)
    } else if (from.frameId === 0) {
      from.frameId = requestAnimationFrame(() => {
        from.frameId = 0
        if (start !== from || from.pending === undefined) return
        paint(columns, from.pending)
      })
    }
  }
  const finish = (load: boolean): void => {
    const from = start
    start = undefined
    if (!from) return
    if (from.frameId !== 0) { cancelAnimationFrame(from.frameId); from.frameId = 0 }
    if (from.distance === 0) return
    const { scroller, columns } = from
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      resetColumns(columns)
    } else {
      for (const column of columns) {
        column.style.transition = `transform ${DURATION}ms ${REBOUND_EASE}`
        column.style.transform = 'translate3d(0px, 0px, 0px)'
      }
      animated = columns
      cleanupTimer = setTimeout(clearAnimation, DURATION)
    }
    if (load && !from.drawer && from.distance >= THRESHOLD) {
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
    if (start?.frameId) cancelAnimationFrame(start.frameId)
    if (start?.distance) animated.push(...start.columns)
    start = undefined
    clearAnimation()
  }
}

/**
 * Progressively collapse and expand the pinned Agent board's session list in step with vertical
 * Workspace drags, snapping cleanly past a third or on a fling. Tapping a status tile smoothly
 * expands the list (or collapses it when tapping the already-active tile).
 */
export function followAgentBoardCollapse(): () => void {
  const SLOP = 4
  const SCROLL_COLLAPSE = 12
  const CARD_GAP = 6
  const DURATION = 240
  const SNAP_RATIO = 1 / 3
  const STALE_VELOCITY = 80
  const BOARD_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const TRANSITION = `height ${DURATION}ms ${BOARD_EASE}, max-height ${DURATION}ms ${BOARD_EASE}, margin-top ${DURATION}ms ${BOARD_EASE}, opacity ${DURATION}ms ${BOARD_EASE}`
  const STYLE_PROPS = ['height', 'max-height', 'margin-top', 'opacity', 'overflow', 'visibility', 'pointer-events', 'transition', 'will-change'] as const
  let drag: {
    id: number; x: number; y: number; lastY: number; prevY: number; prevT: number; lastT: number
    scroller: HTMLElement; board: HTMLElement; list: HTMLElement; height: number
    startOpen: boolean; openness: number; active: boolean; painted: boolean
    frameId: number; pending?: number | undefined
  } | undefined
  let settling: {
    list: HTMLElement; height: number; timer?: ReturnType<typeof setTimeout> | undefined; frameId?: number | undefined
  } | undefined
  const clearListStyle = (list: HTMLElement): void => {
    for (const prop of STYLE_PROPS) list.style.removeProperty(prop)
  }
  const stopSettling = (clear: boolean): void => {
    if (!settling) return
    if (settling.timer !== undefined) clearTimeout(settling.timer)
    if (settling.frameId !== undefined) cancelAnimationFrame(settling.frameId)
    if (clear) clearListStyle(settling.list)
    settling = undefined
  }
  const measureHeight = (list: HTMLElement): number => {
    const measured = list.scrollHeight || list.getBoundingClientRect().height
    return measured > 0 ? measured : 0
  }
  const paintList = (list: HTMLElement, height: number, openness: number, transition: string): void => {
    const clamped = Math.min(1, Math.max(0, openness))
    const px = snap(height * clamped)
    const margin = Math.round((clamped - 1) * CARD_GAP * 100) / 100
    const opacity = Math.round(clamped * 1000) / 1000
    list.style.transition = transition || 'none'
    list.style.willChange = 'height, opacity'
    list.style.overflow = 'hidden'
    list.style.height = `${px}px`
    list.style.maxHeight = `${px}px`
    list.style.marginTop = `${margin}px`
    list.style.opacity = String(opacity)
    list.style.visibility = clamped > 0 || Boolean(transition) ? 'visible' : 'hidden'
    list.style.pointerEvents = clamped > 0 ? '' : 'none'
  }
  const animateTo = (
    board: HTMLElement,
    list: HTMLElement,
    targetOpen: boolean,
    fromOpenness?: number,
    knownHeight?: number,
  ): void => {
    const sameList = settling?.list === list
    stopSettling(!sameList)
    if (targetOpen) board.removeAttribute(AGENTS_COLLAPSED_ATTRIBUTE)
    else board.setAttribute(AGENTS_COLLAPSED_ATTRIBUTE, '')
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      clearListStyle(list)
      return
    }
    const height = knownHeight && knownHeight > 0 ? knownHeight : measureHeight(list)
    if (height <= 0) {
      clearListStyle(list)
      return
    }
    const finishLater = (targetHeight: number): void => {
      settling = {
        list,
        height: targetHeight,
        timer: setTimeout(() => {
          clearListStyle(list)
          settling = undefined
        }, DURATION),
      }
    }
    if (fromOpenness !== undefined) {
      const target = targetOpen ? 1 : 0
      if ((targetOpen && fromOpenness >= 1) || (!targetOpen && fromOpenness <= 0)) {
        clearListStyle(list)
        return
      }
      paintList(list, height, target, TRANSITION)
      finishLater(height)
      return
    }
    if (!targetOpen) {
      paintList(list, height, 1, '')
      void list.offsetHeight
      paintList(list, height, 0, TRANSITION)
      finishLater(height)
      return
    }
    // Expanding via a tile click may also swap the list's content; measure on the next frame after React commits.
    paintList(list, height, 0, '')
    const current: NonNullable<typeof settling> = { list, height }
    current.frameId = requestAnimationFrame(() => {
      current.frameId = undefined
      if (settling !== current) return
      const nextHeight = measureHeight(list) || height
      current.height = nextHeight
      paintList(list, nextHeight, 1, TRANSITION)
      current.timer = setTimeout(() => {
        clearListStyle(list)
        if (settling === current) settling = undefined
      }, DURATION)
    })
    settling = current
  }
  const finishDrag = (commit: boolean): void => {
    const from = drag
    drag = undefined
    if (!from) return
    if (from.frameId !== 0) { cancelAnimationFrame(from.frameId); from.frameId = 0 }
    if (!from.active) return
    const dt = from.lastT - from.prevT
    const stale = Date.now() - from.lastT > STALE_VELOCITY
    const vy = !stale && dt > 0 ? (from.lastY - from.prevY) / dt : 0
    let targetOpen: boolean
    if (!commit) {
      targetOpen = from.startOpen
    } else if (from.scroller.scrollTop > 0 && from.openness === 0) {
      targetOpen = false
    } else if (from.startOpen) {
      const collapse = vy < FLING && (-vy >= FLING || 1 - from.openness >= SNAP_RATIO)
      targetOpen = !collapse
    } else {
      targetOpen = -vy < FLING && (vy >= FLING || from.openness >= SNAP_RATIO)
    }
    if (commit && targetOpen !== from.startOpen) haptic()
    animateTo(from.board, from.list, targetOpen, from.openness, from.height)
  }
  const onStart = (event: TouchEvent): void => {
    finishDrag(false)
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || !(event.target instanceof Element)) return
    if (event.target.closest(`[data-composer-seat],${DRAWER_OWN_DRAG},[role="menu"]`)) return
    const scroller = event.target.closest<HTMLElement>(DRAWER_WORKSPACE_SCROLL)
    if (!scroller) return
    for (let element: Element | null = event.target; element !== null && element !== scroller; element = element.parentElement) {
      const horiz = element.scrollWidth > element.clientWidth
      const vert = element !== event.target && element.scrollHeight > element.clientHeight
      if (!horiz && !vert) continue
      const style = getComputedStyle(element)
      if ((horiz && /^(auto|scroll)$/u.test(style.overflowX))
        || (vert && /^(auto|scroll)$/u.test(style.overflowY))) return
    }
    const parts = agentBoardParts(scroller)
    if (!parts) return
    const height = settling?.list === parts.list ? settling.height : measureHeight(parts.list)
    if (height <= 0) return
    let openness: number
    let startOpen: boolean
    if (settling?.list === parts.list) {
      const currentH = parseFloat(getComputedStyle(parts.list).height)
      openness = Number.isFinite(currentH) ? Math.min(1, Math.max(0, currentH / height)) : (parts.board.hasAttribute(AGENTS_COLLAPSED_ATTRIBUTE) ? 0 : 1)
      startOpen = openness >= 0.5
      stopSettling(false)
      paintList(parts.list, height, openness, '')
    } else {
      startOpen = !parts.board.hasAttribute(AGENTS_COLLAPSED_ATTRIBUTE)
      openness = startOpen ? 1 : 0
    }
    const now = Date.now()
    drag = {
      id: touch.identifier, x: touch.clientX, y: touch.clientY,
      lastY: touch.clientY, prevY: touch.clientY, prevT: now, lastT: now,
      scroller, board: parts.board, list: parts.list, height,
      startOpen, openness, active: false, painted: false, frameId: 0,
    }
  }
  const onMove = (event: TouchEvent): void => {
    const from = drag
    if (!from) return
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || touch.identifier !== from.id) { finishDrag(false); return }
    const now = Date.now()
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    const stepY = touch.clientY - from.lastY
    if (!from.active) {
      const canCollapse = from.openness > 0 && dy <= -SLOP && Math.abs(dy) >= Math.abs(dx) * 1.2
      const canExpand = from.openness === 0 && from.scroller.scrollTop <= 1 && stepY > 0 && Math.abs(dy) >= Math.abs(dx)
      if (!canCollapse && !canExpand) {
        if (touch.clientY !== from.lastY) {
          from.prevY = from.lastY
          from.prevT = from.lastT
          from.lastY = touch.clientY
          from.lastT = now
        }
        return
      }
      if (!event.cancelable) { drag = undefined; return }
      from.active = true
    } else if (!event.cancelable) {
      finishDrag(false)
      return
    }
    event.preventDefault()
    if (touch.clientY !== from.lastY) {
      from.prevY = from.lastY
      from.prevT = from.lastT
      from.lastY = touch.clientY
      from.lastT = now
    }
    if (from.openness === 0 && from.scroller.scrollTop > 0) {
      if (stepY > 0) {
        const consumed = Math.min(from.scroller.scrollTop, stepY)
        from.scroller.scrollTop -= consumed
        const rest = stepY - consumed
        if (rest > 0) from.openness = Math.min(1, rest / from.height)
      } else {
        from.scroller.scrollTop += -stepY
      }
    } else {
      const nextPx = from.openness * from.height + stepY
      if (nextPx < 0) {
        from.openness = 0
        from.scroller.scrollTop += -nextPx
      } else if (nextPx > from.height) {
        from.openness = 1
      } else {
        from.openness = nextPx / from.height
      }
    }
    from.pending = from.openness
    if (!from.painted) {
      from.painted = true
      paintList(from.list, from.height, from.openness, '')
    } else if (from.frameId === 0) {
      from.frameId = requestAnimationFrame(() => {
        from.frameId = 0
        if (drag !== from || from.pending === undefined) return
        paintList(from.list, from.height, from.pending, '')
      })
    }
  }
  const onEnd = (event: TouchEvent): void => {
    if (drag && event.touches.length === 0 && event.changedTouches[0]?.identifier === drag.id) finishDrag(true)
  }
  const onCancel = (): void => { finishDrag(false) }
  const onScroll = (event: Event): void => {
    if (drag?.active) return
    const target = event.target
    if (target instanceof HTMLElement && target.scrollTop >= SCROLL_COLLAPSE && target.matches(DRAWER_WORKSPACE_SCROLL)) {
      const parts = agentBoardParts(target)
      if (parts && !parts.board.hasAttribute(AGENTS_COLLAPSED_ATTRIBUTE)) animateTo(parts.board, parts.list, false)
    }
  }
  const onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const tile = event.target.closest<HTMLElement>('[data-hp-agents] .hp-agents-tile')
    const board = tile?.closest<HTMLElement>('[data-hp-agents]')
    const list = board?.querySelector<HTMLElement>('.hp-agents-list')
    if (!tile || !board || !list) return
    if (board.hasAttribute(AGENTS_COLLAPSED_ATTRIBUTE)) {
      animateTo(board, list, true)
    } else if (tile.getAttribute('aria-pressed') === 'true') {
      animateTo(board, list, false)
    }
  }
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', onCancel, { passive: true })
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('click', onClick, true)
  return () => {
    if (drag?.frameId) cancelAnimationFrame(drag.frameId)
    if (drag) clearListStyle(drag.list)
    drag = undefined
    stopSettling(true)
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onCancel)
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('click', onClick, true)
    for (const board of document.querySelectorAll(`[${AGENTS_COLLAPSED_ATTRIBUTE}]`)) {
      board.removeAttribute(AGENTS_COLLAPSED_ATTRIBUTE)
      const list = board.querySelector<HTMLElement>('.hp-agents-list')
      if (list) clearListStyle(list)
    }
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
