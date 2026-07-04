/**
 * Pure match-offset utilities shared by the worker (phrase refinement) and
 * the main thread (title highlighting, excerpts, in-file search).
 * Offsets always refer to the ORIGINAL text, so diacritics never shift marks.
 */

import {
  TokenSpan,
  tokenizeWithSpans,
  tokenVariants,
  TOKEN_RE,
} from './tokenizer'

export interface MatchOffset {
  start: number
  length: number
}

function spanMatches(
  span: TokenSpan,
  termSet: Set<string>,
  prefixTerms: string[]
): boolean {
  for (const v of span.variants) {
    if (termSet.has(v)) return true
    for (const p of prefixTerms) {
      if (v.startsWith(p)) return true
    }
  }
  return false
}

/** Offsets of tokens matching any of the given normalized terms. */
export function findTermOffsets(
  text: string,
  terms: string[],
  splitCamelCase: boolean,
  maxMatches = 100
): MatchOffset[] {
  if (!terms.length) return []
  const termSet = new Set(terms)
  const prefixTerms = terms.filter(t => t.length >= 2)
  const out: MatchOffset[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0]
    if (raw.length > 64) continue
    const span: TokenSpan = {
      start: m.index!,
      length: raw.length,
      variants: tokenVariants(raw, splitCamelCase),
    }
    if (spanMatches(span, termSet, prefixTerms)) {
      out.push({ start: span.start, length: span.length })
      if (out.length >= maxMatches) break
    }
  }
  return out
}

/** Offsets on precomputed spans (in-file search re-matches cached tokens). */
export function matchSpans(
  spans: TokenSpan[],
  terms: string[],
  maxMatches = 1000
): MatchOffset[] {
  if (!terms.length) return []
  const termSet = new Set(terms)
  const prefixTerms = terms.filter(t => t.length >= 2)
  const out: MatchOffset[] = []
  for (const span of spans) {
    if (spanMatches(span, termSet, prefixTerms)) {
      out.push({ start: span.start, length: span.length })
      if (out.length >= maxMatches) break
    }
  }
  return out
}

/** Normalized base-token sequence of a phrase (no subtoken expansion). */
export function phraseSequence(phrase: string): string[] {
  return tokenizeWithSpans(phrase, false).map(s => s.variants[0])
}

/**
 * Token-sequence phrase matching: "quick brown" matches any text whose
 * consecutive tokens normalize to [quick, brown].
 */
export function findPhraseOffsetsInSpans(
  spans: TokenSpan[],
  phrase: string,
  maxMatches = 100
): MatchOffset[] {
  const seq = phraseSequence(phrase)
  if (!seq.length) return []
  const out: MatchOffset[] = []
  outer: for (let i = 0; i + seq.length <= spans.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (!spans[i + j].variants.includes(seq[j])) continue outer
    }
    const first = spans[i]
    const last = spans[i + seq.length - 1]
    out.push({
      start: first.start,
      length: last.start + last.length - first.start,
    })
    if (out.length >= maxMatches) break
  }
  return out
}

export function findPhraseOffsets(
  text: string,
  phrase: string,
  splitCamelCase: boolean,
  maxMatches = 100
): MatchOffset[] {
  return findPhraseOffsetsInSpans(
    tokenizeWithSpans(text, splitCamelCase),
    phrase,
    maxMatches
  )
}

export function textContainsPhrase(
  text: string,
  phrase: string,
  splitCamelCase: boolean
): boolean {
  return findPhraseOffsets(text, phrase, splitCamelCase, 1).length > 0
}
