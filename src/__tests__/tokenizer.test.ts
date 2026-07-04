import { describe, expect, it } from 'vitest'
import { normalizeToken, tokenize, tokenizeWithSpans } from '../shared/tokenizer'

describe('normalizeToken', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeToken('Café')).toBe('cafe')
    expect(normalizeToken('ÀÉÎÕÜ')).toBe('aeiou')
    expect(normalizeToken('São')).toBe('sao')
  })

  it('keeps CJK intact', () => {
    expect(normalizeToken('日本語')).toBe('日本語')
  })
})

describe('tokenize', () => {
  it('splits on spaces and punctuation', () => {
    expect(tokenize('hello, world! (foo)', true).sort()).toEqual([
      'foo',
      'hello',
      'world',
    ])
  })

  it('deduplicates tokens', () => {
    expect(tokenize('note note NOTE Nóte', true)).toEqual(['note'])
  })

  it('emits camelCase subtokens plus the base token', () => {
    const tokens = tokenize('getUserName', true)
    expect(tokens).toContain('getusername')
    expect(tokens).toContain('get')
    expect(tokens).toContain('user')
    expect(tokens).toContain('name')
  })

  it('does not split camelCase when disabled', () => {
    expect(tokenize('getUserName', false)).toEqual(['getusername'])
  })

  it('emits hyphen subtokens plus the base token', () => {
    const tokens = tokenize('quick-brown', true)
    expect(tokens).toContain('quick-brown')
    expect(tokens).toContain('quick')
    expect(tokens).toContain('brown')
  })

  it('trims edge separators', () => {
    expect(tokenize("'quoted'", true)).toContain('quoted')
  })

  it('skips overly long tokens', () => {
    expect(tokenize('a'.repeat(100), true)).toEqual([])
  })

  it('skips separator-only runs', () => {
    expect(tokenize('--- ___', true)).toEqual([])
  })
})

describe('tokenizeWithSpans', () => {
  it('reports offsets into the original text', () => {
    const spans = tokenizeWithSpans('Héllo wörld', true)
    expect(spans).toHaveLength(2)
    expect(spans[0].start).toBe(0)
    expect(spans[0].length).toBe(5)
    expect(spans[0].variants).toContain('hello')
    expect(spans[1].start).toBe(6)
    expect(spans[1].variants).toContain('world')
  })
})
