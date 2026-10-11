/**
 * File links written as `path:line`.
 *
 * The shell reads a link's line only from a `#L12` fragment, so `[a.ts:12](src/a.ts:12)`, the form
 * coding agents write, asks the Host for a file literally named `a.ts:12` and the preview reports it
 * missing. Every file opener (chat links, mentions, references) reaches the right sidebar through
 * `openResource`, so the suffix is split off there and travels as the `line` navigation parameter.
 */

import type { Context } from '@deepseek-ai/cordis'

const FILE = 'dsh-resource://file/'

/** A trailing `:line`, `:line:column` or `:line-end`; the address grammar keeps `:` literal. */
const SUFFIX = /:(\d+)(?:[:-]\d+)?$/

/** The part of the shell's right sidebar service this needs. */
interface ResourceOpener {
  openResource(address: string, options?: { readonly params?: unknown }): void
}

/** Open `path:line` file addresses on the file itself, once the right sidebar is mounted. */
export function registerFileLineLinks(ctx: Context): void {
  ctx.inject(['sidebarRight'], (scope) => {
    const sidebar = scope.get('sidebarRight') as unknown as ResourceOpener
    const original = sidebar.openResource
    scope.effect(() => {
      sidebar.openResource = (address, options) => {
        const suffix = address.startsWith(FILE) ? SUFFIX.exec(address) : null
        if (suffix === null) { original.call(sidebar, address, options); return }
        // ponytail: a file really named `a.ts:12` opens only from the file tree, which bypasses this method.
        original.call(sidebar, address.slice(0, suffix.index),
          options?.params === undefined ? { ...options, params: { line: Number(suffix[1]) } } : options)
      }
      return () => { sidebar.openResource = original }
    }, 'remote-control: file line links')
  })
}
