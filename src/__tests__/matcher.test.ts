import { describe, expect, it } from 'vitest'
import {
  findPhraseOffsets,
  findTermOffsets,
  matchSpans,
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

  it('matches by prefix', () => {
    const offsets = findTermOffsets('performance matters', ['perf'], true)
    expect(offsets).toHaveLength(1)
    expect(offsets[0].start).toBe(0)
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
