/**
 * Minimal query syntax:
 *   "exact phrase"   -"excluded phrase"
 *   -excludedword
 *   ext:md  or  .md      file extension filter
 *   path:foo  -path:bar  path include/exclude (substring, case-insensitive)
 */

export interface ParsedQuery {
  /** Words + phrase words, fed to the ranked engine query. */
  textQuery: string
  phrases: string[]
  excludedPhrases: string[]
  excludedTerms: string[]
  ext: string[]
  paths: string[]
  excludedPaths: string[]
}

const QUOTE_RE = /(-?)"([^"]*)"/g

export function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = {
    textQuery: '',
    phrases: [],
    excludedPhrases: [],
    excludedTerms: [],
    ext: [],
    paths: [],
    excludedPaths: [],
  }

  const rest = raw.replace(QUOTE_RE, (_all, minus: string, phrase: string) => {
    const p = phrase.trim()
    if (p) {
      if (minus) parsed.excludedPhrases.push(p)
      else parsed.phrases.push(p)
    }
    return ' '
  })

  const words: string[] = []
  for (const token of rest.split(/\s+/)) {
    if (!token) continue
    const lower = token.toLowerCase()
    if (lower.startsWith('path:')) {
      const v = token.slice(5)
      if (v) parsed.paths.push(v.toLowerCase())
    } else if (lower.startsWith('-path:')) {
      const v = token.slice(6)
      if (v) parsed.excludedPaths.push(v.toLowerCase())
    } else if (lower.startsWith('ext:')) {
      const v = lower.slice(4).replace(/^\./, '')
      if (v) parsed.ext.push(v)
    } else if (/^\.[a-z0-9]+$/i.test(token)) {
      parsed.ext.push(lower.slice(1))
    } else if (token.startsWith('-') && token.length > 1) {
      parsed.excludedTerms.push(token.slice(1))
    } else {
      words.push(token)
    }
  }

  parsed.textQuery = [...words, ...parsed.phrases].join(' ').trim()
  return parsed
}
