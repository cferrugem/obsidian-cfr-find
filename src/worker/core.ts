/**
 * Message dispatcher shared by the real Worker entry and the main-thread
 * fallback (used if Worker construction fails in an exotic webview).
 *
 * Mutations (init/add/remove/persist/clear) run serialized on a promise
 * queue; searches run immediately so they interleave between add-docs
 * chunks and stay responsive during first-run indexing.
 */

import { SCHEMA_VERSION, WorkerRequest, WorkerResponse } from '../shared/protocol'
import { parseQuery } from '../shared/query-parser'
import {
  findPhraseOffsets,
  textContainsPhrase,
} from '../shared/matcher'
import { Engine } from './engine'
import { Cache } from './cache'

const ADD_CHUNK = 200
const PERSIST_DEBOUNCE_MS = 60_000

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function createCore(post: (msg: WorkerResponse) => void) {
  let engine: Engine | null = null
  let cache: Cache | null = null
  let useCache = true
  let optionsHash = ''
  let splitCamelCase = true
  let latestSearchId = 0
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let queue: Promise<void> = Promise.resolve()

  async function persist(): Promise<void> {
    if (!engine || !cache || !useCache) return
    await cache.write(engine.serialize(), engine.manifest(), {
      schemaVersion: SCHEMA_VERSION,
      optionsHash,
    })
  }

  function schedulePersist(): void {
    if (!useCache) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      queue = queue.then(() => persist()).catch(() => {})
    }, PERSIST_DEBOUNCE_MS)
  }

  async function handleInit(
    msg: Extract<WorkerRequest, { type: 'init' }>
  ): Promise<void> {
    splitCamelCase = msg.splitCamelCase
    optionsHash = msg.optionsHash
    useCache = msg.useCache
    engine = new Engine(msg.splitCamelCase)
    cache = new Cache()
    try {
      await cache.open(msg.dbName)
    } catch {
      cache = null
    }
    if (cache && useCache) {
      try {
        const stored = await cache.read()
        if (
          stored.index &&
          stored.manifest &&
          stored.meta &&
          stored.meta.schemaVersion === SCHEMA_VERSION &&
          stored.meta.optionsHash === optionsHash
        ) {
          await engine.loadSerialized(stored.index, stored.manifest)
        } else if (stored.meta) {
          await cache.clear()
        }
      } catch {
        // Corrupt cache: start from an empty index.
        engine = new Engine(msg.splitCamelCase)
      }
    }
    post({ id: msg.id, type: 'ready', indexed: engine.manifest() })
  }

  async function handleMutation(msg: WorkerRequest): Promise<void> {
    switch (msg.type) {
      case 'init':
        await handleInit(msg)
        return
      case 'add-docs': {
        for (let i = 0; i < msg.docs.length; i += ADD_CHUNK) {
          engine?.addDocs(msg.docs.slice(i, i + ADD_CHUNK))
          if (i + ADD_CHUNK < msg.docs.length) await sleep(0)
        }
        schedulePersist()
        post({ id: msg.id, type: 'ok' })
        return
      }
      case 'remove-docs': {
        for (const path of msg.paths) engine?.removeDoc(path)
        schedulePersist()
        post({ id: msg.id, type: 'ok' })
        return
      }
      case 'persist': {
        if (persistTimer) {
          clearTimeout(persistTimer)
          persistTimer = null
        }
        await persist()
        post({ id: msg.id, type: 'ok' })
        return
      }
      case 'clear-cache': {
        await cache?.clear()
        post({ id: msg.id, type: 'ok' })
        return
      }
    }
  }

  function handleSearch(
    msg: Extract<WorkerRequest, { type: 'search' }>
  ): void {
    if (msg.searchId > latestSearchId) latestSearchId = msg.searchId
    const parsed = parseQuery(msg.query)
    // Stale or engine not ready yet: answer empty so the caller resolves.
    const results =
      msg.searchId < latestSearchId || !engine
        ? []
        : engine.search(parsed, msg.limit, msg.fuzzy)
    post({
      id: msg.id,
      type: 'search-results',
      searchId: msg.searchId,
      results,
      phrases: parsed.phrases,
      excludedPhrases: parsed.excludedPhrases,
    })
  }

  function handleRefine(
    msg: Extract<WorkerRequest, { type: 'refine' }>
  ): void {
    const keptPaths: string[] = []
    for (const doc of msg.docs) {
      const hasAll = msg.phrases.every(
        p => findPhraseOffsets(doc.content, p, splitCamelCase, 1).length > 0
      )
      const hasExcluded = msg.excludedPhrases.some(p =>
        textContainsPhrase(doc.content, p, splitCamelCase)
      )
      if (hasAll && !hasExcluded) keptPaths.push(doc.path)
    }
    post({ id: msg.id, type: 'refined', searchId: msg.searchId, keptPaths })
  }

  function handle(msg: WorkerRequest): void {
    try {
      switch (msg.type) {
        case 'search':
          handleSearch(msg)
          break
        case 'refine':
          handleRefine(msg)
          break
        default:
          queue = queue
            .then(() => handleMutation(msg))
            .catch(e =>
              post({
                id: msg.id,
                type: 'error',
                message: e instanceof Error ? e.message : String(e),
              })
            )
      }
    } catch (e) {
      post({
        id: msg.id,
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { handle }
}
