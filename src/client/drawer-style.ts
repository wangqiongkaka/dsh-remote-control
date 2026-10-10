/**
 * Phone-only drawer and task-mode styling, injected by the client rather than the proxy.
 *
 * The shell paints the current session and the row under the pointer with one generic hover fill
 * (`--dsw-alias-interactive-bg-hover`), and a touch tap latches that hover — so in the drawer the
 * session you are in looks exactly like the row the finger last landed on. The theme ships a
 * sidebar navigation pair for precisely this: the settings nav paints hover with
 * `--dsw-specific-sidebar-nav-item-hover` and the open cell with `--dsw-specific-sidebar-nav-item-active`.
 *
 * The same latch also costs a tap. A row changes shape on hover — it grows its trailing action
 * strip, drops the timestamp, swaps the folder icon for a chevron — and WebKit reads a tap that
 * first produces such a change as the hover, so opening a session took two taps. On a touch device
 * session and search rows therefore keep their resting shape. Project actions must instead stay
 * visible because they contain the button that creates a session in that project.
 *
 * The drawer also groups the list into one outlined card per top-level Workspace, and at phone
 * width (where the proxy opens the drawer full screen) gives its rows touch-sized heights.
 *
 * It lives on the client because it only matters once someone interacts with the list, and the
 * client plugin reloads with the page while the proxy's patch layer is baked into the running host
 * process. The caller owns the phone gate (wide frames and plain local windows keep the shell's own
 * styling); this module only owns the sheet.
 */

import { PHONE_SAFE_AREA_STYLE } from '../narrow-style.ts'
import { phoneViewport } from '../phone-document.ts'

/** Attribute on the injected sheet; the proxy's layers use their own attribute names. */
export const DRAWER_STYLE_ATTRIBUTE = 'data-dsh-remote-control-drawer-selection'

/** A top-level Workspace section of the sidebar tree; search results and the flat list have none. */
const CARD = '[class*="_sidebarCol"] [role="tree"] > [class*="_groupSection"]'

/** The expanded drawer's single scrollport; its header and footer stay sticky. */
export const DRAWER_SCROLL_ROOT = '[class*="_frame"]:has([class*="_sidebarCol"]):not([data-sidebar-collapsed]) '
  + '[class*="_sidebarCol"] [class*="_root"]:has(> [class*="_logoRow"])'

/** Share the sticky top row with the shell's existing panel navigation, without moving its DOM. */
const DRAWER_HEADER = `${DRAWER_SCROLL_ROOT}:has(> [class*="_panelList"])`

const HEADER_BUTTON = `${DRAWER_HEADER} :is(button[class*="_toggle"],button[class*="_panelRow"],button[class*="_trigger"])`

/** The task catalog's own root keeps these phone text rules out of other panels. */
const TASKS = '[data-testid="task-manager-page"]'

/** Harness-provider's two task modes share the proxied phone's client stylesheet. */
const TASK_MODE = '.hp-delegate[data-hp-mode]'

/** Keep Git label gestures scoped to the history list, away from worktree and stash rows. */
export const GIT_HISTORY_REF = '[data-scroll-key="history"][class*="_gitSectionBodyHistory"] '
  + '[class*="_gitLogRow"] [class*="_gitLogRef"]'

const GIT_DETAILS = '[data-remote-control-git-details]'

/**
 * The current session's fill, the resting row shape that keeps a tap a tap on a touch device,
 * the Workspace cards, and touch-sized rows at phone width.
 */
// Standalone provider popups lack the host MenuSurface's opaque backing.
const DRAWER_SELECTION_STYLE = '.hp-menu,.hp-panel{background:var(--dsw-alias-bg-layer-2) !important}'
  // Five 34px file rows; the Git panel keeps its native scrolling and all entries.
  + '[data-scroll-key="changes"][class*="_gitSectionBodyChanges"]{max-height:170px !important;overflow-y:auto}'
  + `${GIT_HISTORY_REF}{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}`
  + `${GIT_DETAILS}{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-width:none;`
  + 'max-height:calc(100dvh - 32px);overflow-y:auto;margin:auto;padding:20px;border-radius:16px;'
  + 'border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:14px/22px system-ui}'
  + `${GIT_DETAILS}::backdrop{background:rgba(0,0,0,.5)}`
  + `${GIT_DETAILS} h2{margin:0 0 16px;font-size:16px;line-height:24px}`
  + `${GIT_DETAILS} dl{margin:0}`
  + `${GIT_DETAILS} dt{font-size:13px;color:var(--dsw-alias-label-secondary)}`
  + `${GIT_DETAILS} dd{margin:4px 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}`
  + `${GIT_DETAILS} button{width:100%;min-height:44px;border-radius:8px;font:inherit;`
  + 'border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit}'
  + '[class*="_sessionRow"][aria-selected="true"]'
  + '{background:var(--dsw-specific-sidebar-nav-item-active) !important}'
  // The Agent card takes New Session's seat; a Workspace row's own New Session button stays.
  + '[class*="_sidebarCol"] button[class*="_newSession"]{display:none !important}'
  // One scrollport lets the Agent card leave room for projects instead of squeezing their list.
  + `${DRAWER_SCROLL_ROOT}{overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:none;scrollbar-width:thin;`
  + 'scrollbar-gutter:stable;padding-top:0 !important;padding-bottom:0 !important;'
  + '--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}'
  + `${DRAWER_SCROLL_ROOT} > *{flex-shrink:0}`
  // Workspace negative margins reach past the header box; paint over both side insets
  // without widening its grid or shifting the controls.
  + `${DRAWER_SCROLL_ROOT} > [class*="_logoRow"]{position:sticky;top:0;z-index:3;`
  + 'height:66px;padding-top:14px;background:var(--dsw-specific-sidebar-fill);'
  + 'box-shadow:var(--dsh-sidebar-inline-padding,12px) 0 0 var(--dsw-specific-sidebar-fill),'
  + 'calc(-1 * var(--dsh-sidebar-inline-padding,12px)) 0 0 var(--dsw-specific-sidebar-fill)}'
  + `${DRAWER_HEADER}{display:grid;grid-template-columns:minmax(0,1fr) auto auto 40px;grid-template-rows:66px auto 1fr auto;column-gap:8px}`
  // Paint one full-width sticky header; its subgrid leaves the middle track to panel shortcuts.
  + `${DRAWER_HEADER} > [class*="_logoRow"]{grid-column:1 / -1;grid-row:1;display:grid;grid-template-columns:subgrid;`
  + 'gap:8px;min-width:0;padding:14px 0 12px 4px;margin-bottom:0}'
  + `${DRAWER_HEADER} > [class*="_logoRow"] [class*="_brand"]{grid-column:1}`
  + `${DRAWER_HEADER} > [class*="_logoRow"] button[class*="_toggle"]{grid-column:4}`
  + `${HEADER_BUTTON}{width:40px;height:40px;min-width:40px;min-height:40px;box-sizing:border-box;`
  + 'flex:none;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center}'
  + `${HEADER_BUTTON} svg{width:18px;height:18px;flex:none}`
  + `${DRAWER_HEADER} > [class*="_panelList"]{grid-column:3;grid-row:1;position:sticky;top:0;z-index:4;`
  + 'display:flex;flex-direction:row;align-items:center;align-self:start;gap:8px;height:66px;box-sizing:border-box;'
  + 'padding:14px 0 12px;margin:0;background:var(--dsw-specific-sidebar-fill)}'
  + `${DRAWER_HEADER} > [class*="_panelList"] [class*="_panelTitle"]{display:none}`
  // Flatten only the settings wrappers so the native trigger shares the sticky header.
  + `${DRAWER_HEADER} > [class*="_footArea"],${DRAWER_HEADER} > [class*="_footArea"] > [class*="_settingsArea"]{display:contents}`
  + `${DRAWER_HEADER} [class*="_settingsArea"] [class*="_triggerRow"]{grid-column:2;grid-row:1;position:sticky;top:0;z-index:4;`
  + 'display:flex;align-items:center;align-self:start;gap:8px;width:auto;height:66px;box-sizing:border-box;'
  + 'padding:14px 0 12px;margin:0;background:var(--dsw-specific-sidebar-fill)}'
  + `${DRAWER_HEADER} [class*="_settingsArea"] [class*="_triggerRow"] > :is([data-phase],[role="status"]){order:-1}`
  + `${DRAWER_HEADER} [class*="_triggerLabel"]{display:none}`
  + `${DRAWER_HEADER} > [data-remote-control-agents]{grid-column:1 / -1;grid-row:2;min-width:0}`
  + `${DRAWER_HEADER} > [class*="_regionArea"]{grid-column:1 / -1;grid-row:3;min-width:0;min-height:auto}`
  + `${DRAWER_HEADER} > [class*="_footArea"]{grid-column:1 / -1;grid-row:4}`
  + `${DRAWER_HEADER} [class*="_footerActions"]{grid-column:1 / -1;grid-row:4}`
  + `${DRAWER_SCROLL_ROOT} > [class*="_footArea"]{position:sticky;bottom:0;z-index:3;margin-top:auto;`
  + 'padding:6px 0 max(32px,env(safe-area-inset-bottom));background:var(--dsw-specific-sidebar-fill)}'
  + `${DRAWER_SCROLL_ROOT} > [class*="_regionArea"]{flex:none;overflow:visible}`
  + `${DRAWER_SCROLL_ROOT} [class*="_regionArea"] :is([class*="_root"],[class*="_list"],[class*="_treeBody"])`
  + '{flex:none;overflow:visible;overflow-y:visible;scrollbar-gutter:auto}'
  + `${DRAWER_SCROLL_ROOT} [class*="_regionArea"] [class*="_fade"]{display:none}`
  + `${DRAWER_SCROLL_ROOT} .rc-agents-list{max-height:none;overflow:visible}`
  + `${TASKS}{white-space:nowrap}`
  + `${TASKS} :is(h1,h2,h3,button,[class*="_rowSummary"],[class*="_metadata"],[class*="_nextRun"] p){white-space:nowrap}`
  + `${TASKS} :is([class*="_pageHeading"],[class*="_rowSummary"],[class*="_readonlyName"],[class*="_nextRun"] p,[class*="_empty"]){overflow-x:auto}`
  + `${TASKS} [class*="_pageHeading"] h1{flex:none}`
  + `${TASKS} [class*="_empty"] :is(h2,h3,p){max-width:100%;overflow-x:auto;text-align:left}`
  + '@media (hover: none){'
  // No latched fill behind the finger, on any row of the list.
  + '[class*="_sessionRow"]:hover:not([aria-selected="true"]),'
  + '[class*="_searchResultRow"]:hover:not([aria-selected="true"]),'
  + '[class*="_projectRow"]:hover{background:transparent !important}'
  // No latched layout on session/search rows. Project actions include New Session, so keep them visible.
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"],'
  + '[class*="_searchResultRow"]:hover:not([class*="_menuOpen"]) [class*="_rowActions"]{display:none !important}'
  + '[class*="_projectRow"] [class*="_rowActions"]{display:inline-flex !important}'
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_time"]{display:revert !important}'
  + '[class*="_sessionRow"]:hover:not([class*="_menuOpen"]) [class*="_pinIndicator"]{display:inline-flex !important}'
  + '[class*="_projectRow"]:hover [class*="_chevron"]{display:none !important}'
  // Preserve the host's flex slot: worktree decorations paint a sized ::before inside it.
  + '[class*="_projectRow"]:hover [class*="_folder"]{display:inline-flex !important}'
  // A long press opens a Session row's menu (see followRowHolds): no text selection or callout on it.
  + '[class*="_sessionRow"]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}'
  // With the hover fill gone, the finger needs the answer while it is still down: the pressed fill
  // is what tells a thumb the tap landed, and it is the only feedback a phone row has left.
  + '[class*="_sessionRow"]:active,'
  + '[class*="_searchResultRow"]:active,'
  + '[class*="_projectRow"]:active{background:var(--dsw-alias-interactive-bg-active) !important}'
  + '}'
  // Each top-level Workspace section — its row, Session rows and overflow control — reads as one
  // outlined card. A child Workspace in tree grouping sits inside its parent's section, so it stays
  // an indented row of that card instead of a card within a card.
  + `${CARD}{padding:4px;border-radius:16px;box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}`
  + `${CARD} + [class*="_groupSection"]{margin-top:8px !important}`
  + `${CARD} > [class*="_projectRow"] [class*="_title"]{font-weight:600}`
  // At phone width the drawer is the whole screen: rows grow to thumb size, and so does the logo
  // row's collapse control, which is the drawer's only way back there.
  + '@media (max-width: 1023px){' + PHONE_SAFE_AREA_STYLE + '}'
  + '@media (max-width: 720px){'
  // Client reloads do not replace the proxy HTML; keep live composer layout in this sheet.
  // Installed hosts lack data-composer-dock; the card's dock sibling exists in both versions.
  + '[data-composer-card] ~ [class*="_dock"]{order:-1;padding-top:0 !important;padding-bottom:4px}'
  + '[data-composer-card] ~ [class*="_dock"]:empty{display:none}'
  // The phone drawer's outer edge already reserves the shared home-indicator inset.
  + `${DRAWER_SCROLL_ROOT} > [class*="_footArea"]{padding-bottom:0}`
  // Task modes share one phone layout. A bounded dock leaves room for the draft and transcript
  // when the keyboard opens; full-width model picks cannot push their neighbours off-screen.
  + `${TASK_MODE}{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 8px;align-content:start;`
  + 'padding:8px;font-size:13px;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-specific-input-major);max-height:min(280px,calc(var(--dsh-remote-keyboard-height,100dvh) * .45));overflow-y:auto;overscroll-behavior-y:contain}'
  + `${TASK_MODE} > strong{grid-column:1 / -1;grid-row:1;display:flex;align-items:center;min-height:36px;padding-right:44px;position:sticky;top:-8px;z-index:1;background:var(--dsw-specific-input-major)}`
  + `${TASK_MODE} > .hp-delegate-exit{grid-column:2;grid-row:1;justify-self:end;margin:0;width:36px;height:36px;position:sticky;top:-8px;z-index:1;background:var(--dsw-specific-input-major)}`
  + `${TASK_MODE} > .hp-delegate-harness,${TASK_MODE} > .hp-anchor{grid-column:1 / -1;min-width:0}`
  + `${TASK_MODE} .hp-delegate-harness button{flex:1;justify-content:center;height:36px;padding:0 6px;white-space:nowrap}`
  + `${TASK_MODE} .hp-chip{width:100%;max-width:100%;height:36px;text-align:left}`
  + `${TASK_MODE} .hp-chip-label{flex:1}`
  + `${TASK_MODE} .hp-chip-effort{flex-shrink:0;max-width:35%}`
  + `${TASK_MODE} .hp-delegate-report{min-width:0;margin-left:0;min-height:44px;padding:0 8px;gap:8px;line-height:18px;font-size:12px;white-space:normal;overflow-wrap:anywhere}`
  + `${TASK_MODE} .hp-delegate-report input{flex:none;width:18px;height:18px}`
  // Fixed menus escape the dock's scroll clip; the client positions them above their own button.
  + `${TASK_MODE} .hp-menu{position:fixed;left:16px;right:16px;`
  + 'bottom:var(--dsh-remote-mode-menu-bottom,50px);'
  + 'background:var(--dsw-alias-bg-layer-2);opacity:1;backdrop-filter:none;-webkit-backdrop-filter:none;'
  + 'border:.5px solid var(--dsw-alias-border-l2);'
  + 'width:auto;min-width:0;max-width:none;max-height:var(--dsh-remote-mode-menu-height,360px) !important}'
  + `${TASK_MODE} .hp-menu > *{flex-shrink:0}`
  + `${TASK_MODE} .hp-menu :is(.hp-option,.hp-cell){min-height:44px}`
  + `${TASK_MODE} .hp-option-hint,${TASK_MODE} .hp-error{overflow-wrap:anywhere}`
  + '[class*="_projectRow"]{height:44px !important}'
  + '[class*="_sessionRow"]{height:40px !important}'
  + '[class*="_sessionOverflowButton"]{height:36px !important}'
  + '[class*="_logoRow"] button[class*="_toggle"]{width:40px !important;height:40px !important}'
  + '}'

/**
 * Append the drawer selection sheet to the document.
 * @returns a disposer that removes the sheet.
 */
export function applyDrawerSelection(): () => void {
  const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  const originalViewport = viewportMeta?.getAttribute('content')
  const fittedViewport = originalViewport == null ? undefined : phoneViewport(originalViewport)
  if (viewportMeta && fittedViewport !== undefined) viewportMeta.content = fittedViewport
  const style = document.createElement('style')
  style.setAttribute(DRAWER_STYLE_ATTRIBUTE, '')
  style.textContent = DRAWER_SELECTION_STYLE
  document.head.append(style)
  const selector = `${TASK_MODE} .hp-menu`
  const viewport = window.visualViewport
  let frame = 0
  const position = (): void => {
    frame = 0
    const viewportTop = viewport?.offsetTop ?? 0
    for (const menu of document.querySelectorAll<HTMLElement>(selector)) {
      const button = menu.closest('.hp-anchor')?.querySelector('.hp-chip')
      if (!button) continue
      // Keep an off-screen anchor from carrying the popup out of the visible band during a scroll.
      const top = Math.max(button.getBoundingClientRect().top, viewportTop + 60)
      const height = document.documentElement.clientHeight || window.innerHeight
      menu.style.setProperty('--dsh-remote-mode-menu-bottom', `${height - top + 8}px`)
      menu.style.setProperty('--dsh-remote-mode-menu-height', `${Math.min(360, top - viewportTop - 16)}px`)
    }
  }
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(position) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  document.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  position()
  return () => {
    if (viewportMeta && originalViewport != null && viewportMeta.content === fittedViewport) viewportMeta.content = originalViewport
    observer.disconnect()
    cancelAnimationFrame(frame)
    document.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    for (const menu of document.querySelectorAll<HTMLElement>(selector)) {
      menu.style.removeProperty('--dsh-remote-mode-menu-bottom')
      menu.style.removeProperty('--dsh-remote-mode-menu-height')
    }
    style.remove()
  }
}
