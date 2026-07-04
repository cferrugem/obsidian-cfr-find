/**
 * Single-pass tokenizer. Design goals (learned from Omnisearch's hot spots):
 * - ONE regex scan per text; camelCase/hyphen subtokens emitted in the same pass.
 * - Normalization (NFKD + diacritics strip + lowercase) happens exactly once
 *   per distinct raw token, memoized. It is never re-applied per term or at
 *   query time by the engine (MiniSearch processTerm is the identity).
 * - Output is deduplicated per document via a Set.
 */

export const TOKEN_RE = /[\p{L}\p{N}\p{M}_'’-]+/gu
const DIACRITICS_RE = /\p{Diacritic}/gu
const HAS_ALNUM_RE = /[\p{L}\p{N}]/u
const EDGE_TRIM_RE = /^[-'’_]+|[-'’_]+$/g
const SUB_SPLIT_RE = /[-'’_]+/
// No lookbehind: regex literals with lookbehind fail to PARSE on iOS < 16.4,
// which would break the whole plugin on older mobile devices. Matches acronym
// runs (HTML in HTMLParser), Capitalized words, lowercase runs, digit runs.
const CAMEL_PARTS_RE = /\p{Lu}+(?!\p{Ll})|\p{Lu}\p{Ll}*|\p{Ll}+|\p{N}+/gu

const MAX_TOKEN_LEN = 64
const MEMO_CAP = 10_000

const memo = new Map<string, string>()

export function normalizeToken(raw: string): string {
  let n = memo.get(raw)
  if (n === undefined) {
    n = raw.normalize('NFKD').replace(DIACRITICS_RE, '').toLowerCase()
    if (memo.size >= MEMO_CAP) memo.clear()
    memo.set(raw, n)
  }
  return n
}

/**
 * All normalized index terms for one raw token: the base form plus
 * hyphen/apostrophe/underscore parts and (optionally) camelCase parts.
 */
export function tokenVariants(raw: string, splitCamelCase: boolean): string[] {
  const base = normalizeToken(raw).replace(EDGE_TRIM_RE, '')
  if (!base) return []
  const variants = [base]
  if (SUB_SPLIT_RE.test(base)) {
    for (const part of base.split(SUB_SPLIT_RE)) {
      if (part) variants.push(part)
    }
  }
  if (
    splitCamelCase &&
    raw.toLowerCase() !== raw &&
    raw.toUpperCase() !== raw
  ) {
    for (const part of raw.match(CAMEL_PARTS_RE) ?? []) {
      const n = normalizeToken(part).replace(EDGE_TRIM_RE, '')
      if (n && n !== base) variants.push(n)
    }
  }
  return variants
}

/** Tokenize a text into deduplicated normalized terms (for indexing/query). */
export function tokenize(text: string, splitCamelCase: boolean): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0]
    if (raw.length > MAX_TOKEN_LEN || !HAS_ALNUM_RE.test(raw)) continue
    for (const v of tokenVariants(raw, splitCamelCase)) out.add(v)
  }
  return [...out]
}

export interface TokenSpan {
  start: number
  length: number
  variants: string[]
}

/** Tokenize keeping original offsets — used for highlighting and phrases. */
export function tokenizeWithSpans(
  text: string,
  splitCamelCase: boolean,
  maxTokens = Infinity
): TokenSpan[] {
  const spans: TokenSpan[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0]
    if (raw.length > MAX_TOKEN_LEN || !HAS_ALNUM_RE.test(raw)) continue
    spans.push({
      start: m.index!,
      length: raw.length,
      variants: tokenVariants(raw, splitCamelCase),
    })
    if (spans.length >= maxTokens) break
  }
  return spans
}
