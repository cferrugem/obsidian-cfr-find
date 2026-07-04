/**
 * Excerpt and highlight rendering. Built from match offsets with text nodes
 * and <mark> elements — no regex-replace, no innerHTML.
 */

import { MatchOffset } from '../shared/matcher'

const EXCERPT_RADIUS = 120

/** Renders `text` into `el`, wrapping each offset range in <mark>. */
export function renderHighlighted(
  el: HTMLElement,
  text: string,
  offsets: MatchOffset[],
  base = 0
): void {
  let cursor = 0
  for (const { start, length } of offsets) {
    const s = start - base
    const e = s + length
    if (s < cursor || s >= text.length) continue
    if (s > cursor) el.appendChild(document.createTextNode(text.slice(cursor, s)))
    el.createEl('mark', {
      cls: 'cfr-find-highlight',
      text: text.slice(s, Math.min(e, text.length)),
    })
    cursor = Math.min(e, text.length)
  }
  if (cursor < text.length) {
    el.appendChild(document.createTextNode(text.slice(cursor)))
  }
}

/** Renders a window of `content` around the first match into `el`. */
export function renderExcerpt(
  el: HTMLElement,
  content: string,
  offsets: MatchOffset[]
): void {
  el.empty()
  if (!offsets.length) {
    const flat = content.slice(0, EXCERPT_RADIUS * 2).replace(/\s+/g, ' ')
    el.appendChild(document.createTextNode(flat))
    return
  }
  const first = offsets[0]
  let from = Math.max(0, first.start - EXCERPT_RADIUS)
  let to = Math.min(content.length, first.start + first.length + EXCERPT_RADIUS * 2)
  // Snap to whitespace so we don't cut words mid-way.
  if (from > 0) {
    const ws = content.indexOf(' ', from)
    if (ws !== -1 && ws < first.start) from = ws + 1
  }
  const windowText = content.slice(from, to).replace(/[\r\n]+/g, ' ')
  const visible = offsets.filter(o => o.start >= from && o.start < to)
  if (from > 0) el.appendChild(document.createTextNode('…'))
  renderHighlighted(el, windowText, visible, from)
  if (to < content.length) el.appendChild(document.createTextNode('…'))
}
