/**
 * Spawns the inlined worker from a blob URL and exposes a typed async API.
 * If Worker construction fails (some mobile webviews), the same dispatcher
 * core runs inline on the main thread — callers never know the difference.
 */

import workerCode from 'virtual:worker'
import { createCore } from '../worker/core'
import {
  DocInput,
  FuzzyOptions,
  IndexedEntry,
  SearchHit,
  WorkerRequest,
  WorkerResponse,
} from '../shared/protocol'

export interface SearchResponse {
  searchId: number
  results: SearchHit[]
  phrases: string[]
  excludedPhrases: string[]
}

interface Pending {
  resolve: (msg: WorkerResponse) => void
  reject: (err: Error) => void
}

/** Omit that distributes over union members (plain Omit collapses unions). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export class WorkerClient {
  private worker: Worker | null = null
  private inlineHandle: ((msg: WorkerRequest) => void) | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private searchCounter = 0

  start(): void {
    try {
      const url = URL.createObjectURL(
        new Blob([workerCode], { type: 'text/javascript' })
      )
      this.worker = new Worker(url)
      URL.revokeObjectURL(url)
      this.worker.onmessage = e => this.receive(e.data as WorkerResponse)
    } catch (e) {
      console.warn('CFR Find: Worker unavailable, running engine inline', e)
      const core = createCore(msg => this.receive(msg))
      this.inlineHandle = msg => core.handle(msg)
    }
  }

  terminate(): void {
    this.worker?.terminate()
    this.worker = null
    this.inlineHandle = null
    for (const p of this.pending.values()) {
      p.reject(new Error('CFR Find worker terminated'))
    }
    this.pending.clear()
  }

  private post(msg: WorkerRequest): void {
    if (this.worker) {
      this.worker.postMessage(msg)
    } else if (this.inlineHandle) {
      const handle = this.inlineHandle
      queueMicrotask(() => handle(msg))
    } else {
      throw new Error('CFR Find worker not started')
    }
  }

  private receive(msg: WorkerResponse): void {
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    if (msg.type === 'error') pending.reject(new Error(msg.message))
    else pending.resolve(msg)
  }

  private request(
    msg: DistributiveOmit<WorkerRequest, 'id'>
  ): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ ...msg, id } as WorkerRequest)
    })
  }

  async init(options: {
    dbName: string
    optionsHash: string
    splitCamelCase: boolean
    useCache: boolean
  }): Promise<IndexedEntry[]> {
    const resp = await this.request({ type: 'init', ...options })
    return resp.type === 'ready' ? resp.indexed : []
  }

  async addDocs(docs: DocInput[]): Promise<void> {
    await this.request({ type: 'add-docs', docs })
  }

  async removeDocs(paths: string[]): Promise<void> {
    await this.request({ type: 'remove-docs', paths })
  }

  async persist(): Promise<void> {
    await this.request({ type: 'persist' })
  }

  async clearCache(): Promise<void> {
    await this.request({ type: 'clear-cache' })
  }

  /** Monotonic id used by callers to drop stale result sets. */
  newSearchId(): number {
    return ++this.searchCounter
  }

  async search(
    searchId: number,
    query: string,
    fuzzy: FuzzyOptions,
    limit = 50
  ): Promise<SearchResponse> {
    const resp = await this.request({
      type: 'search',
      searchId,
      query,
      limit,
      fuzzy,
    })
    if (resp.type !== 'search-results') {
      return { searchId, results: [], phrases: [], excludedPhrases: [] }
    }
    return {
      searchId: resp.searchId,
      results: resp.results,
      phrases: resp.phrases,
      excludedPhrases: resp.excludedPhrases,
    }
  }

  async refine(
    searchId: number,
    phrases: string[],
    excludedPhrases: string[],
    docs: { path: string; content: string }[]
  ): Promise<string[]> {
    const resp = await this.request({
      type: 'refine',
      searchId,
      phrases,
      excludedPhrases,
      docs,
    })
    return resp.type === 'refined' ? resp.keptPaths : docs.map(d => d.path)
  }
}
