/**
 * Phone Settings without the Models section.
 *
 * The Settings nav lists every `settings.section` registration, and its cells carry no section id,
 * only the section's label; so the phone finds the Models cell by the label that section registered
 * (in the current locale) and hides it. A dialog that opens on Models moves to the first section
 * still shown.
 */

import type { SettingsLedger } from './chat-defaults.ts'

const NAV_CELLS = '[data-shortcut-modal="settings"] nav button'

/** The Models section's nav label in the current locale, while that section is registered. */
function modelsLabel(slots: SettingsLedger): string | undefined {
  const label = slots.entries('settings.section').find(entry => entry.options.id === 'models')?.options.label
  return typeof label === 'function' ? label() : label
}

/**
 * Keep the Models cell out of every Settings dialog on the page.
 * @param slots - the frame slot ledger.
 * @returns a disposer that stops watching and shows the cells again.
 */
export function hideModelsSettings(slots: SettingsLedger): () => void {
  const hidden = new Set<HTMLElement>()
  const sync = (): void => {
    const label = modelsLabel(slots)
    if (label === undefined) return
    const cells = [...document.querySelectorAll<HTMLElement>(NAV_CELLS)]
    for (const cell of cells) {
      if (cell.querySelector('[class*="_navLabel"]')?.textContent !== label || hidden.has(cell)) continue
      hidden.add(cell)
      cell.style.display = 'none'
      if (cell.getAttribute('aria-current') === 'true') cells.find(other => !hidden.has(other))?.click()
    }
  }
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  sync()
  return () => {
    observer.disconnect()
    for (const cell of hidden) cell.style.display = ''
  }
}
