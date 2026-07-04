import { describe, expect, it } from 'vitest'
import {
  findApproxPhraseInSpans,
  frontmatterEnd,
  findPhraseOffsets,
  findTermOffsets,
  matchSpans,
  matchSpansDetailed,
  pickExcerptOffsets,
  significantTerms,
  textContainsPhrase,
} from '../shared/matcher'
import { tokenizeWithSpans } from '../shared/tokenizer'

describe('findTermOffsets', () => {
  it('finds exact term offsets in original text', () => {
    const offsets = findTermOffsets('the quick brown fox', ['quick'], true)
    expect(offsets).toEqual([{ start: 4, length: 5 }])
  })

  it('matches diacritic text with plain terms, offsets unshifted', () => {
    const text = 'un café très bon'
    const offsets = findTermOffsets(text, ['cafe'], true)
    expect(offsets).toEqual([{ start: 3, length: 4 }])
    expect(text.slice(3, 7)).toBe('café')
  })

  it('matches by prefix (highlights only prefix length)', () => {
    const offsets = findTermOffsets('performance matters', ['perf'], true)
    expect(offsets).toEqual([{ start: 0, length: 4 }])
  })

  it('matches camelCase subtokens (highlights whole token)', () => {
    const offsets = findTermOffsets('call getUserName()', ['user'], true)
    expect(offsets).toEqual([{ start: 5, length: 11 }])
  })

  it('respects maxMatches', () => {
    const offsets = findTermOffsets('a a a a a', ['a'], true, 2)
    expect(offsets).toHaveLength(2)
  })
})

describe('phrase matching', () => {
  it('finds consecutive token sequences', () => {
    const offsets = findPhraseOffsets(
      'the quick brown fox',
      'quick brown',
      true
    )
    expect(offsets).toEqual([{ start: 4, length: 11 }])
  })

  it('ignores punctuation and case between tokens', () => {
    expect(textContainsPhrase('Quick, brown!', 'quick brown', true)).toBe(true)
  })

  it('rejects non-consecutive words', () => {
    expect(textContainsPhrase('quick red brown', 'quick brown', true)).toBe(
      false
    )
  })

  it('matches diacritics-insensitively', () => {
    expect(textContainsPhrase('um café bom', 'cafe bom', true)).toBe(true)
  })
})

describe('matchSpans', () => {
  it('re-matches cached spans without re-tokenizing', () => {
    const spans = tokenizeWithSpans('alpha beta gamma beta', true)
    const offsets = matchSpans(spans, ['beta'])
    expect(offsets.map(o => o.start)).toEqual([6, 17])
  })
})

describe('significantTerms', () => {
  it('drops stopword-sized terms when longer terms exist', () => {
    expect(significantTerms(['recuperacao', 'de', 'arquivos'])).toEqual([
      'recuperacao',
      'arquivos',
    ])
  })

  it('keeps short terms when the query has nothing longer', () => {
    expect(significantTerms(['de', 'a'])).toEqual(['de', 'a'])
  })

  it('filters expanded index terms based on queryTerms', () => {
    // When "de" gets prefix-expanded to "dentro" and "dele" but "recuperacao" is significant,
    // we should only keep "recuperacao".
    const queryTerms = ['recuperacao', 'de']
    const matchedTerms = ['recuperacao', 'dentro', 'dele']
    expect(significantTerms(matchedTerms, queryTerms)).toEqual(['recuperacao'])
  })

  it('keeps all expanded terms if all query terms are significant', () => {
    // When "recu" expands to "recuperacao", both are kept because "recu" is >= 3 chars.
    const queryTerms = ['recu']
    const matchedTerms = ['recuperacao', 'recuperar']
    expect(significantTerms(matchedTerms, queryTerms)).toEqual(['recuperacao', 'recuperar'])
  })

  it('keeps prefix-expanded terms for short query terms when query has nothing longer', () => {
    const queryTerms = ['de']
    const matchedTerms = ['dentro', 'dele', 'de']
    expect(significantTerms(matchedTerms, queryTerms)).toEqual(['dentro', 'dele', 'de'])
  })

  it('filters out fuzzy matching expanded terms of insignificant query terms', () => {
    // If the query is "recuperacao de", and we have a fuzzy match of "recuperacao" -> "recuperacao"
    // and "de" matched "dentro" and "dele", "dentro" and "dele" should be filtered out,
    // but fuzzy match of "recuperacao" should be kept.
    const queryTerms = ['recuperasao', 'de']
    const matchedTerms = ['recuperacao', 'dentro', 'dele']
    expect(significantTerms(matchedTerms, queryTerms, 0.1, 4)).toEqual(['recuperacao'])
  })
})

describe('findApproxPhraseInSpans', () => {
  it('anchors a query on its inflected phrase (arquivo → arquivos)', () => {
    const text = 'O plugin core Recuperação de arquivos mantém snapshots.'
    const spans = tokenizeWithSpans(text, true)
    const offsets = findApproxPhraseInSpans(spans, 'recuperação de arquivo')
    expect(offsets).toHaveLength(1)
    expect(
      text.slice(offsets[0].start, offsets[0].start + offsets[0].length)
    ).toBe('Recuperação de arquivos')
  })

  it('anchors a query with a 1-character last term as a prefix (de a → de arquivos)', () => {
    const text = 'O plugin core Recuperação de arquivos mantém snapshots.'
    const spans = tokenizeWithSpans(text, true)
    const offsets = findApproxPhraseInSpans(spans, 'recuperação de a')
    expect(offsets).toHaveLength(1)
    expect(
      text.slice(offsets[0].start, offsets[0].start + offsets[0].length)
    ).toBe('Recuperação de arquivos')
  })

  it('does not match scattered words', () => {
    const spans = tokenizeWithSpans(
      'recuperação total dos meus arquivos',
      true
    )
    expect(findApproxPhraseInSpans(spans, 'recuperação de arquivo')).toEqual([])
  })
})

describe('pickExcerptOffsets', () => {
  it('prefers the window with the most distinct terms over the first match', () => {
    // "arquivos" appears alone early; both terms appear together later.
    const text =
      'lista de arquivos e pastas do vault. ' +
      'x '.repeat(200) +
      'a recuperação de arquivos usa snapshots automáticos'
    const spans = tokenizeWithSpans(text, true)
    const matches = matchSpansDetailed(spans, ['recuperacao', 'arquivos'])
    const picked = pickExcerptOffsets(matches)
    // The chosen window must contain a "recuperacao" match (late region only).
    expect(picked.some(o => o.start > 400)).toBe(true)
    expect(picked.length).toBeGreaterThanOrEqual(2)
  })
})

describe('findApproxPhraseInSpans — typed-word leniency', () => {
  it('anchors on the phrase while the last word is still being typed', () => {
    // The user has typed "recuperação de ar" — "ar" is the word in progress.
    const text = 'O plugin core Recuperação de arquivos mantém snapshots.'
    const spans = tokenizeWithSpans(text, true)
    const offsets = findApproxPhraseInSpans(spans, 'recuperação de ar')
    expect(offsets).toHaveLength(1)
    expect(
      text.slice(offsets[0].start, offsets[0].start + offsets[0].length)
    ).toBe('Recuperação de arquivos')
  })

  it('keeps middle stopwords exact (no "de" → "desktop" anchoring)', () => {
    const spans = tokenizeWithSpans(
      'recuperação desktop arquivos aqui',
      true
    )
    expect(findApproxPhraseInSpans(spans, 'recuperação de arquivos')).toEqual(
      []
    )
  })
})

describe('frontmatterEnd', () => {
  it('returns the body offset after a YAML frontmatter block', () => {
    const content = '---\ndata: 2026-06-27\nrevisar: false\n---\n# Título\ncorpo'
    const end = frontmatterEnd(content)
    expect(content.slice(end).startsWith('# Título')).toBe(true)
  })

  it('handles CRLF frontmatter', () => {
    const content = '---\r\nkey: value\r\n---\r\nbody here'
    expect(content.slice(frontmatterEnd(content))).toBe('body here')
  })

  it('returns 0 when there is no frontmatter', () => {
    expect(frontmatterEnd('# Título\ncorpo')).toBe(0)
    // A --- ruler later in the note is not frontmatter.
    expect(frontmatterEnd('texto\n---\nmais texto')).toBe(0)
  })
})
