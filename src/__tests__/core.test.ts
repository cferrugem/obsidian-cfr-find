import { describe, expect, it } from 'vitest'
import { createCore } from '../worker/core'
import { DEFAULT_FUZZY, WorkerRequest, WorkerResponse } from '../shared/protocol'

/**
 * Drives the dispatcher exactly like the worker entry does (no IndexedDB in
 * Node: init falls back to an empty index, same as a first launch).
 */
function makeHarness() {
  const responses: WorkerResponse[] = []
  const waiters = new Map<number, (msg: WorkerResponse) => void>()
  const core = createCore(msg => {
    responses.push(msg)
    if ('id' in msg) waiters.get(msg.id)?.(msg)
  })
  let nextId = 1
  type Sendable = WorkerRequest extends infer T
    ? T extends WorkerRequest
      ? Omit<T, 'id'>
      : never
    : never
  function send(msg: Sendable): Promise<WorkerResponse> {
    const id = nextId++
    return new Promise(resolve => {
      waiters.set(id, resolve)
      core.handle({ ...msg, id } as WorkerRequest)
    })
  }
  return { send, responses }
}

const baseDoc = {
  mtime: 1,
  kind: 'text' as const,
  aliases: '',
  tags: '',
  headings1: '',
  headings2: '',
  headings3: '',
}

describe('worker core', () => {
  it('init → add → search → remove round-trip', async () => {
    const { send } = makeHarness()
    const ready = await send({
      type: 'init',
      dbName: 'test',
      optionsHash: 'x',
      splitCamelCase: true,
      useCache: false,
    })
    expect(ready.type).toBe('ready')

    await send({
      type: 'add-docs',
      docs: [
        {
          ...baseDoc,
          path: 'a.md',
          basename: 'a',
          directory: '',
          content: 'searchable content here',
        },
      ],
    })

    const result = await send({
      type: 'search',
      searchId: 1,
      query: 'searchable',
      limit: 10,
      fuzzy: DEFAULT_FUZZY,
    })
    expect(result.type).toBe('search-results')
    if (result.type === 'search-results') {
      expect(result.results.map(r => r.path)).toEqual(['a.md'])
    }

    await send({ type: 'remove-docs', paths: ['a.md'] })
    const after = await send({
      type: 'search',
      searchId: 2,
      query: 'searchable',
      limit: 10,
      fuzzy: DEFAULT_FUZZY,
    })
    if (after.type === 'search-results') {
      expect(after.results).toEqual([])
    }
  })

  it('answers stale searches with empty results', async () => {
    const { send } = makeHarness()
    await send({
      type: 'init',
      dbName: 'test',
      optionsHash: 'x',
      splitCamelCase: true,
      useCache: false,
    })
    await send({
      type: 'add-docs',
      docs: [
        {
          ...baseDoc,
          path: 'b.md',
          basename: 'b',
          directory: '',
          content: 'hello world',
        },
      ],
    })
    // Newer search first, then an out-of-order older one.
    const fresh = await send({ type: 'search', searchId: 5, query: 'hello', limit: 10, fuzzy: DEFAULT_FUZZY })
    const stale = await send({ type: 'search', searchId: 3, query: 'hello', limit: 10, fuzzy: DEFAULT_FUZZY })
    if (fresh.type === 'search-results') expect(fresh.results).toHaveLength(1)
    if (stale.type === 'search-results') expect(stale.results).toEqual([])
  })

  it('refine keeps only docs containing the phrase', async () => {
    const { send } = makeHarness()
    await send({
      type: 'init',
      dbName: 'test',
      optionsHash: 'x',
      splitCamelCase: true,
      useCache: false,
    })
    const resp = await send({
      type: 'refine',
      searchId: 1,
      phrases: ['quick brown'],
      excludedPhrases: ['lazy dog'],
      docs: [
        { path: 'yes.md', content: 'the quick brown fox' },
        { path: 'no-phrase.md', content: 'quick red brown' },
        { path: 'excluded.md', content: 'quick brown but lazy dog too' },
      ],
    })
    expect(resp.type).toBe('refined')
    if (resp.type === 'refined') {
      expect(resp.keptPaths).toEqual(['yes.md'])
    }
  })
})
