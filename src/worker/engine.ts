/**
 * MiniSearch wrapper. Everything here runs off the UI thread.
 * processTerm is the identity: the tokenizer already normalized terms once.
 */

import MiniSearch, { Options, SearchOptions } from 'minisearch'
import { tokenize } from '../shared/tokenizer'
import { ParsedQuery } from '../shared/query-parser'
import {
  DocInput,
  FuzzyOptions,
  IndexedEntry,
  SearchHit,
} from '../shared/protocol'
import { extractCanvasText } from './extract'

interface EngineDoc {
  path: string
  mtime: number
  basename: string
  directory: string
  aliases: string
  tags: string
  headings1: string
  headings2: string
  headings3: string
  content: string
}

const FIELD_BOOSTS: Record<string, number> = {
  basename: 3,
  aliases: 3,
  directory: 1.5,
  tags: 2,
  headings1: 1.8,
  headings2: 1.4,
  headings3: 1.2,
}

export class Engine {
  private ms: MiniSearch<EngineDoc>
  /** path → mtime for everything currently in the index. */
  readonly indexed = new Map<string, number>()

  constructor(private splitCamelCase: boolean) {
    this.ms = new MiniSearch(this.options())
  }

  private options(): Options<EngineDoc> {
    return {
      idField: 'path',
      fields: [
        'basename',
        'directory',
        'aliases',
        'tags',
        'headings1',
        'headings2',
        'headings3',
        'content',
      ],
      storeFields: ['mtime'],
      tokenize: (text: string) => tokenize(text, this.splitCamelCase),
      processTerm: (term: string) => term,
    }
  }

  async loadSerialized(json: string, manifest: IndexedEntry[]): Promise<void> {
    this.ms = await MiniSearch.loadJSONAsync(json, this.options())
    this.indexed.clear()
    for (const entry of manifest) this.indexed.set(entry.path, entry.mtime)
  }

  serialize(): string {
    return JSON.stringify(this.ms)
  }

  manifest(): IndexedEntry[] {
    return [...this.indexed].map(([path, mtime]) => ({ path, mtime }))
  }

  addDocs(docs: DocInput[]): void {
    for (const doc of docs) {
      if (this.indexed.has(doc.path)) this.removeDoc(doc.path)
      const content =
        doc.kind === 'canvas' ? extractCanvasText(doc.content) : doc.content
      this.ms.add({
        path: doc.path,
        mtime: doc.mtime,
        basename: doc.basename,
        directory: doc.directory,
        aliases: doc.aliases,
        tags: doc.tags,
        headings1: doc.headings1,
        headings2: doc.headings2,
        headings3: doc.headings3,
        content,
      })
      this.indexed.set(doc.path, doc.mtime)
    }
  }

  removeDoc(path: string): void {
    if (!this.indexed.has(path)) return
    this.ms.discard(path)
    this.indexed.delete(path)
  }

  search(parsed: ParsedQuery, limit: number, fuzzy: FuzzyOptions): SearchHit[] {
    if (!parsed.textQuery) return []
    const options: SearchOptions = {
      combineWith: 'AND',
      prefix: (term, index, terms) =>
        term.length >= fuzzy.prefixMinLength || index === terms.length - 1,
      fuzzy: term =>
        term.length < fuzzy.minFuzzyLength ? false : fuzzy.fuzziness,
      boost: FIELD_BOOSTS,
    }
    // Precision first: require every term (AND). When that leaves room,
    // append partial (OR) matches, penalized by how few terms they matched,
    // so "recuperação de arquivos" still surfaces notes that only say
    // "recuperar arquivos". Stopword-sized terms (<3 chars) are excluded
    // from the OR pass to keep it cheap.
    let results = this.ms.search(parsed.textQuery, options)
    if (results.length < limit) {
      const orTerms = tokenize(parsed.textQuery, this.splitCamelCase).filter(
        t => t.length >= 3
      )
      if (orTerms.length) {
        const seen = new Set(results.map(r => r.id as string))
        const partial = this.ms.search(orTerms.join(' '), {
          ...options,
          combineWith: 'OR',
        })
        for (const r of partial) {
          if (seen.has(r.id as string)) continue
          const matched = new Set(r.queryTerms).size
          r.score *= 0.5 * (matched / orTerms.length)
          results.push(r)
        }
        results.sort((a, b) => b.score - a.score)
      }
    }

    if (parsed.excludedTerms.length) {
      const excluded = new Set(
        this.ms
          .search(parsed.excludedTerms.join(' '), {
            combineWith: 'OR',
            prefix: false,
            fuzzy: false,
          })
          .map(r => r.id as string)
      )
      results = results.filter(r => !excluded.has(r.id as string))
    }

    if (parsed.ext.length || parsed.paths.length || parsed.excludedPaths.length) {
      results = results.filter(r => {
        const path = (r.id as string).toLowerCase()
        if (parsed.ext.length) {
          const ext = path.slice(path.lastIndexOf('.') + 1)
          if (!parsed.ext.includes(ext)) return false
        }
        if (parsed.paths.length && !parsed.paths.some(p => path.includes(p))) {
          return false
        }
        if (parsed.excludedPaths.some(p => path.includes(p))) return false
        return true
      })
    }

    return results.slice(0, limit).map(r => ({
      path: r.id as string,
      score: r.score,
      terms: r.terms,
    }))
  }
}
