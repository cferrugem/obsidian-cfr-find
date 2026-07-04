/**
 * Message contract between the main thread and the search worker.
 * Single source of truth: imported by both bundles.
 */

/** Bump to invalidate persisted caches when the index format changes. */
export const SCHEMA_VERSION = 1

export type FileKind = 'text' | 'canvas'

/** A document prepared on the main thread (which owns the vault API). */
export interface DocInput {
  path: string
  mtime: number
  kind: FileKind
  /** Raw file content; canvas JSON is extracted worker-side. */
  content: string
  basename: string
  directory: string
  /** Space-joined frontmatter aliases. */
  aliases: string
  /** Space-joined tags, without '#'. */
  tags: string
  headings1: string
  headings2: string
  headings3: string
}

export interface IndexedEntry {
  path: string
  mtime: number
}

export interface SearchHit {
  path: string
  score: number
  /** Index terms that matched (after fuzzy/prefix expansion), for highlighting. */
  terms: string[]
}

/**
 * Search-time matching knobs. Sent with every search so settings changes
 * apply instantly — they never require touching the index.
 */
export interface FuzzyOptions {
  /** Edit-distance tolerance as a fraction of term length (0 = exact). */
  fuzziness: number
  /** Terms shorter than this are always matched exactly. */
  minFuzzyLength: number
  /** Minimum typed length before prefix matching kicks in. */
  prefixMinLength: number
}

export const DEFAULT_FUZZY: FuzzyOptions = {
  fuzziness: 0.1,
  minFuzzyLength: 4,
  prefixMinLength: 2,
}

export type WorkerRequest =
  | {
      id: number
      type: 'init'
      dbName: string
      optionsHash: string
      splitCamelCase: boolean
      useCache: boolean
    }
  | { id: number; type: 'add-docs'; docs: DocInput[] }
  | { id: number; type: 'remove-docs'; paths: string[] }
  | {
      id: number
      type: 'search'
      searchId: number
      query: string
      limit: number
      fuzzy: FuzzyOptions
    }
  | {
      id: number
      type: 'refine'
      searchId: number
      phrases: string[]
      excludedPhrases: string[]
      docs: { path: string; content: string }[]
    }
  | { id: number; type: 'persist' }
  | { id: number; type: 'clear-cache' }

export type WorkerResponse =
  | { id: number; type: 'ready'; indexed: IndexedEntry[] }
  | { id: number; type: 'ok' }
  | {
      id: number
      type: 'search-results'
      searchId: number
      results: SearchHit[]
      phrases: string[]
      excludedPhrases: string[]
    }
  | { id: number; type: 'refined'; searchId: number; keptPaths: string[] }
  | { id: number; type: 'error'; message: string }
