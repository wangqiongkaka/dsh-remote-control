/** Phone-shaped rewriting of the forwarded DSH document (viewport meta plus the narrow patch). */

import { NARROW_SCREEN_STYLE } from './narrow-style.ts'

/** Viewport meta for documents that ship none, with the soft-keyboard hint Chromium honors. */
export const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1, '
  + 'interactive-widget=resizes-content, viewport-fit=cover">'

/** A standalone phone page: pairing failures cannot load the authenticated shell's assets. */
export function remoteErrorDocument(reason: string): string {
  const message = reason.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' + VIEWPORT_META
    + '<title>无法打开远程页面</title><style>'
    + ':root{color-scheme:light dark;font:14px/22px system-ui,sans-serif;color:CanvasText;background:Canvas}'
    + 'body{margin:0;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) '
    + 'max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));min-height:100svh;box-sizing:border-box;display:grid;place-items:center}'
    + 'main{box-sizing:border-box;width:min(100%,440px);padding:24px;border:1px solid GrayText;border-radius:16px}'
    + 'h1{font-size:20px;line-height:28px;margin:0 0 16px}p{margin:0;overflow-wrap:anywhere}'
    + 'p+p{margin-top:12px;color:GrayText}</style></head><body><main>'
    + '<h1>无法打开远程页面</h1><p role="alert">' + message + '</p>'
    + '<p>请在电脑上重新打开远程控制弹窗，扫描新二维码。</p></main></body></html>'
}

const VIEWPORT_TAG = /<meta[^>]*name=["']viewport["'][^>]*>/iu

/** Preserve explicit host choices while enabling native safe-area and keyboard reporting. */
export function phoneViewport(content: string): string {
  return content + (/interactive-widget/iu.test(content) ? '' : ', interactive-widget=resizes-content')
    + (/viewport-fit/iu.test(content) ? '' : ', viewport-fit=cover')
}

/**
 * Ask the soft keyboard to shrink the layout viewport instead of covering it. Chromium only
 * (iOS ignores the key and follows the visual viewport instead, which the client patch handles),
 * and harmless where unsupported. An existing `interactive-widget` is left as the app asked.
 * @param body - the document text.
 * @returns the document with the viewport meta rewritten.
 */
export function keyboardViewport(body: string): string {
  const tag = VIEWPORT_TAG.exec(body)
  if (tag === null) return body
  const content = /content=["']([^"']*)["']/iu.exec(tag[0])
  if (content === null) return body
  const rewritten = tag[0].slice(0, content.index)
    + `content="${phoneViewport(content[1]!)}"`
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
