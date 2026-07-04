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

/** A match that remembers WHICH query term it satisfied. */
export interface TermMatch extends MatchOffset {
  term: string
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  )
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        )
      }
    }
  }
  return dp[a.length][b.length]
}

function termMatches(
  t: string,
  q: string,
  fuzziness = 0.1,
  minFuzzyLength = 4
): boolean {
  if (t === q) return true
  if (t.startsWith(q)) return true
  if (q.length >= minFuzzyLength) {
    const maxDist = Math.floor(fuzziness * q.length)
    if (maxDist > 0 && Math.abs(t.length - q.length) <= maxDist) {
      return editDistance(t, q) <= maxDist
    }
  }
  return false
}

/**
 * Terms worth highlighting/ranking by. Stopword-sized terms ("de", "a")
 * only count when the query has nothing longer — otherwise they drown
 * results and excerpts in noise.
 * If queryTerms is provided, terms (which are the expanded matched index terms)
 * are filtered to only keep those matching at least one significant query term.
 */
export function significantTerms(
  terms: string[],
  queryTerms?: string[],
  fuzziness = 0.1,
  minFuzzyLength = 4
): string[] {
  if (!queryTerms) {
    const significant = terms.filter(t => t.length >= 3)
    return significant.length ? significant : terms
  }

  const sigQuery = queryTerms.filter(t => t.length >= 3)
  const sigQueryTerms = sigQuery.length ? sigQuery : queryTerms

  if (sigQueryTerms.length === queryTerms.length) {
    return terms
  }

  return terms.filter(t =>
    sigQueryTerms.some(q => termMatches(t, q, fuzziness, minFuzzyLength))
  )
}


/** The query term this span satisfies, or null. */
function matchedTerm(
  span: TokenSpan,
  termSet: Set<string>,
  prefixTerms: string[]
): string | null {
  for (const v of span.variants) {
    if (termSet.has(v)) return v
    for (const p of prefixTerms) {
      if (v.startsWith(p)) return p
    }
  }
  return null
}

function spanMatches(
  span: TokenSpan,
  termSet: Set<string>,
  prefixTerms: string[]
): boolean {
  return matchedTerm(span, termSet, prefixTerms) !== null
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
    const term = matchedTerm(span, termSet, prefixTerms)
    if (term !== null) {
      const base = span.variants[0]
      const length = (base && base.startsWith(term)) ? Math.min(span.length, term.length) : span.length
      out.push({ start: span.start, length })
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
    const term = matchedTerm(span, termSet, prefixTerms)
    if (term !== null) {
      const base = span.variants[0]
      const length = (base && base.startsWith(term)) ? Math.min(span.length, term.length) : span.length
      out.push({ start: span.start, length })
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

/** Like matchSpans, but each hit remembers the query term it matched. */
export function matchSpansDetailed(
  spans: TokenSpan[],
  terms: string[],
  maxMatches = 2000
): TermMatch[] {
  if (!terms.length) return []
  const termSet = new Set(terms)
  const prefixTerms = terms.filter(t => t.length >= 2)
  const out: TermMatch[] = []
  for (const span of spans) {
    const term = matchedTerm(span, termSet, prefixTerms)
    if (term !== null) {
      const base = span.variants[0]
      const length = (base && base.startsWith(term)) ? Math.min(span.length, term.length) : span.length
      out.push({ start: span.start, length, term })
      if (out.length >= maxMatches) break
    }
  }
  return out
}

/**
 * Lenient phrase matching for anchoring excerpts and jumps: consecutive
 * tokens where each query token equals OR prefixes the document token
 * ("recuperação de arquivo" anchors on "Recuperação de arquivos").
 */
export function findApproxPhraseInSpans(
  spans: TokenSpan[],
  phrase: string,
  maxMatches = 3
): MatchOffset[] {
  const seq = phraseSequence(phrase)
  if (seq.length < 2) return []
  const out: MatchOffset[] = []
  outer: for (let i = 0; i + seq.length <= spans.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      const want = seq[j]
      const ok = spans[i + j].variants.some(
        v =>
          v === want ||
          (want.length >= 3 && v.startsWith(want)) ||
          (j === seq.length - 1 && v.startsWith(want))
      )
      if (!ok) continue outer
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

/**
 * Picks the excerpt anchor: the window (in characters) covering the most
 * DISTINCT query terms — ties broken by more matches, then earliest.
 * This is what makes the excerpt show "Recuperação de arquivos" instead of
 * the first lone "arquivos" at the top of the note.
 */
export function pickExcerptOffsets(
  matches: TermMatch[],
  windowChars = 240
): MatchOffset[] {
  if (matches.length <= 1) return matches
  let best = { distinct: 0, count: 0, from: 0, to: 0 }
  let lo = 0
  const inWindow = new Map<string, number>()
  for (let hi = 0; hi < matches.length; hi++) {
    const m = matches[hi]
    inWindow.set(m.term, (inWindow.get(m.term) ?? 0) + 1)
    while (m.start + m.length - matches[lo].start > windowChars) {
      const t = matches[lo].term
      const n = inWindow.get(t)! - 1
      if (n === 0) inWindow.delete(t)
      else inWindow.set(t, n)
      lo++
    }
    const distinct = inWindow.size
    const count = hi - lo + 1
    if (
      distinct > best.distinct ||
      (distinct === best.distinct && count > best.count)
    ) {
      best = { distinct, count, from: lo, to: hi }
    }
  }
  return matches.slice(best.from, best.to + 1)
}
