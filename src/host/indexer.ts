/**
 * Main-thread indexing orchestration. The main thread owns the vault API,
 * so it reads files (cachedRead) and posts text to the worker in batches.
 * Content is never kept resident here — it is read, posted, and released.
 */

import {
  App,
  TFile,
  getAllTags,
  parseFrontMatterAliases,
} from 'obsidian'
import { DocInput, IndexedEntry } from '../shared/protocol'
import { WorkerClient } from './worker-client'
import { CfrFindSettings } from '../settings'

const READ_BATCH = 100
const MODIFY_DEBOUNCE_MS = 2000

/** API of the community "Text Extractor" plugin (same one Omnisearch uses). */
interface TextExtractorApi {
  extractText: (file: TFile) => Promise<string>
  canFileBeExtracted: (filePath: string) => boolean
}

const PDF_EXTS = new Set(['pdf'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])
const OFFICE_EXTS = new Set(['docx', 'xlsx'])

export class Indexer {
  private dirtyTimers = new Map<string, number>()
  private ignoreFilters: (string | RegExp)[] = []
  /** Local mirror of what the worker has indexed: path → mtime. */
  private known = new Map<string, number>()
  ready = false

  constructor(
    private app: App,
    private client: WorkerClient,
    private settings: CfrFindSettings,
    private onProgress: (done: number, total: number) => void
  ) {}

  private indexableExtensions(): Set<string> {
    const exts = new Set(['md', 'canvas'])
    for (const e of this.settings.extraFileTypes) {
      const clean = e.trim().replace(/^\./, '').toLowerCase()
      if (clean) exts.add(clean)
    }
    return exts
  }

  private loadIgnoreFilters(): void {
    this.ignoreFilters = []
    if (!this.settings.respectExcluded) return
    const raw: string[] =
      (this.app.vault as unknown as {
        getConfig?: (k: string) => string[] | undefined
      }).getConfig?.('userIgnoreFilters') ?? []
    for (const f of raw) {
      if (f.length > 2 && f.startsWith('/') && f.endsWith('/')) {
        try {
          this.ignoreFilters.push(new RegExp(f.slice(1, -1)))
        } catch {
          // invalid user regex: skip
        }
      } else {
        this.ignoreFilters.push(f.toLowerCase())
      }
    }
  }

  private isIgnored(path: string): boolean {
    const lower = path.toLowerCase()
    return this.ignoreFilters.some(f =>
      typeof f === 'string' ? lower.startsWith(f) : f.test(path)
    )
  }

  private getTextExtractor(): TextExtractorApi | undefined {
    return (
      this.app as unknown as {
        plugins?: {
          plugins?: Record<string, { api?: TextExtractorApi }>
        }
      }
    ).plugins?.plugins?.['text-extractor']?.api
  }

  /** Extractor-backed file (PDF/image/Office) with its toggle enabled? */
  private isExtractableFile(file: TFile): boolean {
    const ext = file.extension.toLowerCase()
    const enabled =
      (PDF_EXTS.has(ext) && this.settings.indexPDFs) ||
      (IMAGE_EXTS.has(ext) && this.settings.indexImages) ||
      (OFFICE_EXTS.has(ext) && this.settings.indexOfficeDocs)
    if (!enabled) return false
    const extractor = this.getTextExtractor()
    return !!extractor?.canFileBeExtracted(file.path)
  }

  isIndexable(file: TFile): boolean {
    if (this.isIgnored(file.path)) return false
    return (
      this.indexableExtensions().has(file.extension.toLowerCase()) ||
      this.isExtractableFile(file)
    )
  }

  collectIndexableFiles(): TFile[] {
    this.loadIgnoreFilters()
    return this.app.vault.getFiles().filter(f => this.isIndexable(f))
  }

  private async readContent(file: TFile): Promise<string> {
    if (this.isExtractableFile(file)) {
      try {
        return (await this.getTextExtractor()!.extractText(file)) ?? ''
      } catch {
        return ''
      }
    }
    return this.app.vault.cachedRead(file)
  }

  private async buildDoc(file: TFile): Promise<DocInput> {
    const content = await this.readContent(file)
    const cache = this.app.metadataCache.getFileCache(file)
    const aliases = cache?.frontmatter
      ? (parseFrontMatterAliases(cache.frontmatter) ?? []).join(' ')
      : ''
    const tags = cache
      ? (getAllTags(cache) ?? []).map(t => t.replace(/^#/, '')).join(' ')
      : ''
    const headings: Record<1 | 2 | 3, string[]> = { 1: [], 2: [], 3: [] }
    for (const h of cache?.headings ?? []) {
      if (h.level <= 3) headings[h.level as 1 | 2 | 3].push(h.heading)
    }
    return {
      path: file.path,
      mtime: file.stat.mtime,
      kind: file.extension.toLowerCase() === 'canvas' ? 'canvas' : 'text',
      content,
      basename: file.basename,
      directory: file.parent?.path ?? '',
      aliases,
      tags,
      headings1: headings[1].join(' '),
      headings2: headings[2].join(' '),
      headings3: headings[3].join(' '),
    }
  }

  /** Startup: diff vault against the worker's cache manifest, index the delta. */
  async populate(cachedManifest: IndexedEntry[]): Promise<void> {
    this.known = new Map(cachedManifest.map(e => [e.path, e.mtime]))
    const files = this.collectIndexableFiles()
    const current = new Map(files.map(f => [f.path, f]))

    const toRemove: string[] = []
    for (const [path] of this.known) {
      if (!current.has(path)) toRemove.push(path)
    }
    const toAdd: TFile[] = []
    for (const [path, file] of current) {
      if (this.known.get(path) !== file.stat.mtime) toAdd.push(file)
    }

    if (toRemove.length) {
      await this.client.removeDocs(toRemove)
      for (const path of toRemove) this.known.delete(path)
    }

    // Markdown first so notes are searchable before other file types.
    toAdd.sort((a, b) =>
      a.extension === b.extension ? 0 : a.extension === 'md' ? -1 : 1
    )

    let done = 0
    for (let i = 0; i < toAdd.length; i += READ_BATCH) {
      const batch = toAdd.slice(i, i + READ_BATCH)
      const docs = await Promise.all(batch.map(f => this.buildDoc(f)))
      await this.client.addDocs(docs)
      for (const f of batch) this.known.set(f.path, f.stat.mtime)
      done += batch.length
      this.onProgress(done, toAdd.length)
    }

    this.ready = true
    if (toAdd.length || toRemove.length) {
      this.client.persist().catch(() => {})
    }
  }

  // ---- live vault events ----

  onCreate(file: TFile): void {
    if (!this.isIndexable(file)) return
    this.reindexNow(file).catch(console.error)
  }

  onDelete(path: string): void {
    this.cancelDirty(path)
    this.known.delete(path)
    this.client.removeDocs([path]).catch(console.error)
  }

  onRename(file: TFile, oldPath: string): void {
    this.cancelDirty(oldPath)
    this.known.delete(oldPath)
    this.client.removeDocs([oldPath]).catch(console.error)
    if (this.isIndexable(file)) this.reindexNow(file).catch(console.error)
  }

  onModify(file: TFile): void {
    if (!this.isIndexable(file)) return
    this.cancelDirty(file.path)
    this.dirtyTimers.set(
      file.path,
      window.setTimeout(() => {
        this.dirtyTimers.delete(file.path)
        this.reindexNow(file).catch(console.error)
      }, MODIFY_DEBOUNCE_MS)
    )
  }

  /**
   * Self-healing sync, awaited before the first search of every modal
   * session: cancels pending debounces and re-diffs the whole vault against
   * what the worker has (path + mtime). Anything missed — a lost event, a
   * git/sync pull, an interrupted indexing run — is caught here. Cost when
   * nothing changed: one map diff, no file reads.
   */
  async syncBeforeSearch(): Promise<void> {
    for (const [, timer] of this.dirtyTimers) window.clearTimeout(timer)
    this.dirtyTimers.clear()

    const files = this.collectIndexableFiles()
    const currentPaths = new Set<string>()
    const toAdd: TFile[] = []
    for (const f of files) {
      currentPaths.add(f.path)
      if (this.known.get(f.path) !== f.stat.mtime) toAdd.push(f)
    }
    const toRemove = [...this.known.keys()].filter(p => !currentPaths.has(p))

    if (toRemove.length) {
      await this.client.removeDocs(toRemove)
      for (const path of toRemove) this.known.delete(path)
    }
    for (let i = 0; i < toAdd.length; i += READ_BATCH) {
      const batch = toAdd.slice(i, i + READ_BATCH)
      const docs = await Promise.all(batch.map(f => this.buildDoc(f)))
      await this.client.addDocs(docs)
      for (const f of batch) this.known.set(f.path, f.stat.mtime)
    }
  }

  private cancelDirty(path: string): void {
    const timer = this.dirtyTimers.get(path)
    if (timer) {
      window.clearTimeout(timer)
      this.dirtyTimers.delete(path)
    }
  }

  private async reindexNow(file: TFile): Promise<void> {
    const doc = await this.buildDoc(file)
    await this.client.addDocs([doc])
    this.known.set(file.path, file.stat.mtime)
  }

  stop(): void {
    for (const [, timer] of this.dirtyTimers) window.clearTimeout(timer)
    this.dirtyTimers.clear()
  }
}
