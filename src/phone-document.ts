/** Phone-shaped rewriting of the forwarded DSH document (viewport meta plus the narrow patch). */

import { NARROW_SCREEN_STYLE } from './narrow-style.ts'

/** Viewport meta for documents that ship none, with the soft-keyboard hint Chromium honors. */
export const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1, '
  + 'interactive-widget=resizes-content">'

const VIEWPORT_TAG = /<meta[^>]*name=["']viewport["'][^>]*>/iu

/**
 * Ask the soft keyboard to shrink the layout viewport instead of covering it. Chromium only
 * (iOS ignores the key and follows the visual viewport instead, which the client patch handles),
 * and harmless where unsupported. An existing `interactive-widget` is left as the app asked.
 * @param body - the document text.
 * @returns the document with the viewport meta rewritten.
 */
export function keyboardViewport(body: string): string {
  const tag = VIEWPORT_TAG.exec(body)
  if (tag === null || /interactive-widget/iu.test(tag[0])) return body
  const content = /content=["']([^"']*)["']/iu.exec(tag[0])
  if (content === null) return body
  const rewritten = tag[0].slice(0, content.index)
    + `content="${content[1]}, interactive-widget=resizes-content"`
    + tag[0].slice(content.index + content[0].length)
  return body.slice(0, tag.index) + rewritten + body.slice(tag.index + tag[0].length)
}

/**
 * Patch a document for phones: the keyboard-aware viewport meta (added when the document ships
 * none) followed by the narrow-screen layer, both right after `<head>`.
 * @param body - the document text.
 * @returns the rewritten document.
 */
export function phoneDocument(body: string): string {
  const patched = keyboardViewport(body)
  const head = /<head[^>]*>/iu.exec(patched)
  const at = head === null ? 0 : head.index + head[0].length
  const meta = VIEWPORT_TAG.test(patched) ? '' : VIEWPORT_META
  return patched.slice(0, at) + meta + NARROW_SCREEN_STYLE + patched.slice(at)
}
