import { describe, expect, it } from 'vitest'
import { parseQuery } from '../shared/query-parser'

describe('parseQuery', () => {
  it('parses plain words', () => {
    const q = parseQuery('hello world')
    expect(q.textQuery).toBe('hello world')
    expect(q.phrases).toEqual([])
  })

  it('extracts quoted phrases (kept in textQuery for ranking)', () => {
    const q = parseQuery('foo "exact phrase" bar')
    expect(q.phrases).toEqual(['exact phrase'])
    expect(q.textQuery).toBe('foo bar exact phrase')
  })

  it('extracts excluded phrases', () => {
    const q = parseQuery('foo -"not this"')
    expect(q.excludedPhrases).toEqual(['not this'])
    expect(q.textQuery).toBe('foo')
  })

  it('extracts excluded terms', () => {
    const q = parseQuery('foo -bar')
    expect(q.excludedTerms).toEqual(['bar'])
    expect(q.textQuery).toBe('foo')
  })

  it('parses ext: and .ext filters', () => {
    expect(parseQuery('foo ext:md').ext).toEqual(['md'])
    expect(parseQuery('foo .canvas').ext).toEqual(['canvas'])
    expect(parseQuery('foo ext:.txt').ext).toEqual(['txt'])
  })

  it('parses path filters', () => {
    const q = parseQuery('foo path:Daily -path:Archive')
    expect(q.paths).toEqual(['daily'])
    expect(q.excludedPaths).toEqual(['archive'])
    expect(q.textQuery).toBe('foo')
  })

  it('handles empty input', () => {
    expect(parseQuery('').textQuery).toBe('')
  })
})
