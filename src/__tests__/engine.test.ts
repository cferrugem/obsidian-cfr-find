import { describe, expect, it } from 'vitest'
import { Engine } from '../worker/engine'
import { parseQuery } from '../shared/query-parser'
import { DEFAULT_FUZZY, DocInput } from '../shared/protocol'

function doc(path: string, content: string, extra?: Partial<DocInput>): DocInput {
  const basename = path.split('/').pop()!.replace(/\.\w+$/, '')
  return {
    path,
    mtime: 1,
    kind: 'text',
    content,
    basename,
    directory: path.split('/').slice(0, -1).join('/'),
    aliases: '',
    tags: '',
    headings1: '',
    headings2: '',
    headings3: '',
    ...extra,
  }
}

function makeEngine(): Engine {
  const engine = new Engine(true)
  engine.addDocs([
    doc('notes/apple.md', 'A note about apple pie recipes.'),
    doc('notes/banana.md', 'Bananas are yellow. Apple appears here too.'),
    doc('archive/cherry.md', 'Cherry trees blossom in spring.'),
    doc('notes/code.md', 'The function getUserName returns the user name.'),
  ])
  return engine
}

describe('Engine', () => {
  it('finds documents by content', () => {
    const hits = makeEngine().search(parseQuery('apple'), 50, DEFAULT_FUZZY)
    expect(hits.map(h => h.path).sort()).toEqual([
      'notes/apple.md',
      'notes/banana.md',
    ])
  })

  it('ranks basename matches first', () => {
    const hits = makeEngine().search(parseQuery('apple'), 50, DEFAULT_FUZZY)
    expect(hits[0].path).toBe('notes/apple.md')
  })

  it('supports camelCase subtoken search', () => {
    // "getUserName" is indexed as getusername + get + user + name,
    // so both a subtoken and a prefix of the base token match.
    expect(
      makeEngine().search(parseQuery('user'), 50, DEFAULT_FUZZY).map(h => h.path)
    ).toContain('notes/code.md')
    expect(
      makeEngine().search(parseQuery('getuser'), 50, DEFAULT_FUZZY).map(h => h.path)
    ).toContain('notes/code.md')
  })

  it('appends partial (OR) matches below full (AND) matches', () => {
    // apple.md contains both terms; banana.md only "apple".
    const hits = makeEngine().search(parseQuery('apple pie'), 50, DEFAULT_FUZZY)
    expect(hits[0].path).toBe('notes/apple.md')
    expect(hits.map(h => h.path)).toContain('notes/banana.md')
    expect(hits[0].score).toBeGreaterThan(
      hits[hits.findIndex(h => h.path === 'notes/banana.md')].score
    )
  })

  it('word-form mismatch still surfaces the note (partial match)', () => {
    // Mirrors a real case: query "recuperação de arquivos" against a note
    // that says "recuperar arquivos" — AND fails, the OR fallback finds it.
    const engine = makeEngine()
    engine.addDocs([
      doc('notes/backup.md', 'como recuperar arquivos perdidos do vault'),
    ])
    const hits = engine.search(
      parseQuery('recuperação de arquivos'),
      50,
      DEFAULT_FUZZY
    )
    expect(hits.map(h => h.path)).toContain('notes/backup.md')
  })

  it('typo tolerance is configurable per search', () => {
    const engine = makeEngine()
    const exact = { fuzziness: 0, minFuzzyLength: 4, prefixMinLength: 2 }
    const fuzzy = { fuzziness: 0.2, minFuzzyLength: 4, prefixMinLength: 2 }
    // "aple" is one edit away from "apple".
    expect(engine.search(parseQuery('aple'), 50, exact)).toEqual([])
    expect(
      engine.search(parseQuery('aple'), 50, fuzzy).map(h => h.path)
    ).toContain('notes/apple.md')
  })

  it('short words stay exact below minFuzzyLength', () => {
    const engine = makeEngine()
    const fuzzy = { fuzziness: 0.3, minFuzzyLength: 5, prefixMinLength: 4 }
    // "aple" (4 chars) is below minFuzzyLength 5: no fuzzy expansion.
    expect(engine.search(parseQuery('aple'), 50, fuzzy)).toEqual([])
  })

  it('excludes terms with -', () => {
    const hits = makeEngine().search(parseQuery('apple -banana'), 50, DEFAULT_FUZZY)
    expect(hits.map(h => h.path)).toEqual(['notes/apple.md'])
  })

  it('filters by path', () => {
    const hits = makeEngine().search(parseQuery('blossom path:archive'), 50, DEFAULT_FUZZY)
    expect(hits.map(h => h.path)).toEqual(['archive/cherry.md'])
    expect(makeEngine().search(parseQuery('blossom -path:archive'), 50, DEFAULT_FUZZY)).toEqual(
      []
    )
  })

  it('filters by extension', () => {
    expect(makeEngine().search(parseQuery('apple ext:canvas'), 50, DEFAULT_FUZZY)).toEqual([])
    expect(
      makeEngine().search(parseQuery('apple ext:md'), 50, DEFAULT_FUZZY).length
    ).toBeGreaterThan(0)
  })

  it('updates documents on re-add (mtime change)', () => {
    const engine = makeEngine()
    engine.addDocs([doc('notes/apple.md', 'Now about oranges only.')])
    expect(engine.search(parseQuery('oranges'), 50, DEFAULT_FUZZY).map(h => h.path)).toEqual([
      'notes/apple.md',
    ])
    // "apple" still matches via the basename field, but not via content:
    const appleHits = engine.search(parseQuery('pie'), 50, DEFAULT_FUZZY)
    expect(appleHits.map(h => h.path)).not.toContain('notes/apple.md')
  })

  it('removes documents', () => {
    const engine = makeEngine()
    engine.removeDoc('notes/apple.md')
    expect(engine.search(parseQuery('pie'), 50, DEFAULT_FUZZY)).toEqual([])
    expect(engine.indexed.has('notes/apple.md')).toBe(false)
  })

  it('serializes and reloads', async () => {
    const engine = makeEngine()
    const json = engine.serialize()
    const manifest = engine.manifest()
    const fresh = new Engine(true)
    await fresh.loadSerialized(json, manifest)
    expect(fresh.search(parseQuery('apple'), 50, DEFAULT_FUZZY).length).toBeGreaterThan(0)
    expect(fresh.indexed.size).toBe(4)
  })

  it('extracts canvas text', () => {
    const engine = new Engine(true)
    engine.addDocs([
      doc('board.canvas', JSON.stringify({
        nodes: [{ text: 'brainstorm ideas here' }],
        edges: [{ label: 'leads to' }],
      }), { kind: 'canvas', basename: 'board' }),
    ])
    expect(engine.search(parseQuery('brainstorm'), 50, DEFAULT_FUZZY)).toHaveLength(1)
  })
})
