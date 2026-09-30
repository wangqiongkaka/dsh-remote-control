/**
 * Compact Chat presentation for the remote page.
 *
 * The Host persists Chat preferences for loopback pages only; a page that came through the proxy
 * holds them in memory, so every phone load would open work steps and performance usage at the
 * shell's Detailed default. The shell's own Settings rows carry the setters that drive both, so the
 * remote page starts each at Compact through them. Each registration is set once: a choice made on
 * the phone afterwards holds for the rest of the page.
 */

import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

const SETTINGS = 'settings.general.item'

/** Chat Settings rows by entry id, with the setter each one's injected face carries. */
const ROWS: Readonly<Record<string, string>> = {
  'transcript-view': 'setTranscriptView',
  'performance-usage': 'setPerformanceUsage',
}

/**
 * The slot ledger surface this needs: raw entries and their change notifications. Method syntax
 * keeps the frame registry assignable: this plugin's type view does not declare the Settings slot.
 */
export interface SettingsLedger {
  entries(key: string): readonly StoredEntry[]
  subscribe(key: string, fn: () => void): () => void
}

/**
 * Start the Chat work steps and performance usage rows at Compact, now and when they register.
 * @param slots - the frame slot ledger.
 * @returns a disposer that stops watching for registrations.
 */
export function compactChatDefaults(slots: SettingsLedger): () => void {
  const applied = new WeakSet<StoredEntry>()
  const sync = (): void => {
    for (const entry of slots.entries(SETTINGS)) {
      const setter = ROWS[entry.options.id ?? '']
      if (setter === undefined || entry.inject === undefined || applied.has(entry)) continue
      applied.add(entry)
      const set = entry.inject()[setter]
      if (typeof set === 'function') set('compact')
    }
  }
  sync()
  return slots.subscribe(SETTINGS, sync)
}
