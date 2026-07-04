import { MarkdownView, Modal, setIcon } from 'obsidian'
import { fuzzyOptions } from '../../settings'
import { CFR_FIND_ICON } from './icon'
import type CfrFindPlugin from '../../main'
import { SearchHit } from '../../shared/protocol'
import {
  findApproxPhraseInSpans,
  findTermOffsets,
  matchSpansDetailed,
  pickExcerptOffsets,
  significantTerms,
} from '../../shared/matcher'
import { tokenize, tokenizeWithSpans } from '../../shared/tokenizer'
import { parseQuery } from '../../shared/query-parser'
import { renderExcerpt, renderHighlighted } from '../excerpts'
import { ResultList } from './result-list'
import { InFileSearchModal } from './infile-modal'
import { jumpToMatch } from './jump'

const DEBOUNCE_MS = 80
const RESULT_LIMIT = 50

export class VaultSearchModal extends Modal {
  private inputEl!: HTMLInputElement
  private list!: ResultList<SearchHit>
  private currentSearchId = 0
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private observer: IntersectionObserver | null = null
  private syncPromise: Promise<void> = Promise.resolve()

  constructor(
    private plugin: CfrFindPlugin,
    private initialQuery = ''
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.modalEl.addClass('cfr-find-modal')
    this.contentEl.empty()

    const inputRow = this.contentEl.createDiv({ cls: 'cfr-find-input-row' })
    const iconEl = inputRow.createSpan({ cls: 'cfr-find-input-icon' })
    setIcon(iconEl, CFR_FIND_ICON)
    this.inputEl = inputRow.createEl('input', {
      type: 'text',
      placeholder: 'Search your vault…',
      cls: 'cfr-find-input',
    })
    this.inputEl.value = this.initialQuery

    const resultsEl = this.contentEl.createDiv({ cls: 'cfr-find-results' })
    this.list = new ResultList<SearchHit>(
      resultsEl,
      (hit, el) => this.renderHit(hit, el),
      (hit, ev) => this.openHit(hit, ev.ctrlKey || ev.metaKey)
    )

    const footer = this.contentEl.createDiv({ cls: 'cfr-find-footer' })
    const hint = (keys: string, label: string) => {
      const chip = footer.createSpan({ cls: 'cfr-find-hint' })
      chip.createEl('kbd', { text: keys })
      chip.appendText(` ${label}`)
    }
    hint('↑ ↓', 'navigate')
    hint('↵', 'open')
    hint('ctrl ↵', 'new pane')
    hint('tab', 'search inside note')

    this.inputEl.addEventListener('input', () => this.scheduleUpdate())
    this.registerKeys()
    this.inputEl.focus()

    // Self-heal the index before the first search: catches pending edits,
    // sync/git pulls, and anything a lost event missed. updateResults
    // awaits this, so results are never computed against a stale index.
    this.syncPromise =
      this.plugin.indexer?.syncBeforeSearch().catch(console.error) ??
      Promise.resolve()
    if (this.initialQuery) this.scheduleUpdate()
  }

  onClose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.observer?.disconnect()
    this.contentEl.empty()
  }

  private registerKeys(): void {
    this.scope.register([], 'ArrowDown', e => {
      e.preventDefault()
      this.list.move(1)
    })
    this.scope.register([], 'ArrowUp', e => {
      e.preventDefault()
      this.list.move(-1)
    })
    this.scope.register(['Ctrl'], 'j', () => this.list.move(1))
    this.scope.register(['Ctrl'], 'k', () => this.list.move(-1))
    this.scope.register([], 'Enter', e => {
      e.preventDefault()
      this.list.chooseSelected(e)
    })
    this.scope.register(['Mod'], 'Enter', e => {
      e.preventDefault()
      const hit = this.list.selectedItem
      if (hit) this.openHit(hit, true)
    })
    this.scope.register([], 'Tab', e => {
      e.preventDefault()
      this.switchToInFile()
    })
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.updateResults(), DEBOUNCE_MS)
  }

  private async updateResults(): Promise<void> {
    const query = this.inputEl.value.trim()
    const client = this.plugin.client
    if (!client || !query) {
      this.observer?.disconnect()
      this.list.setItems([])
      return
    }
    const searchId = client.newSearchId()
    this.currentSearchId = searchId
    await this.syncPromise
    const resp = await client.search(
      searchId,
      query,
      fuzzyOptions(this.plugin.settings),
      RESULT_LIMIT
    )
    if (searchId !== this.currentSearchId) return // stale

    let hits = resp.results
    // Phrase queries: verify real phrase presence before rendering.
    // Only text files can be verified (binary content lives in the index
    // only); non-text hits pass through unverified.
    if (hits.length && (resp.phrases.length || resp.excludedPhrases.length)) {
      const textPaths = hits
        .map(h => h.path)
        .filter(p => {
          const file = this.app.vault.getFileByPath(p)
          return this.isTextLike(file?.extension)
        })
      const docs = await this.readContents(textPaths)
      if (searchId !== this.currentSearchId) return
      const kept = new Set(
        await client.refine(searchId, resp.phrases, resp.excludedPhrases, docs)
      )
      if (searchId !== this.currentSearchId) return
      const verified = new Set(textPaths)
      hits = hits.filter(h => kept.has(h.path) || !verified.has(h.path))
    }

    this.observer?.disconnect()
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this.observer?.unobserve(entry.target)
          this.fillExcerpt(entry.target as HTMLElement).catch(console.error)
        }
      }
    })
    this.list.setItems(hits)
  }

  private isTextLike(ext: string | undefined): boolean {
    if (!ext) return false
    const lower = ext.toLowerCase()
    return (
      lower === 'md' ||
      lower === 'canvas' ||
      this.plugin.settings.extraFileTypes.includes(lower)
    )
  }

  private async readContents(
    paths: string[]
  ): Promise<{ path: string; content: string }[]> {
    const out: { path: string; content: string }[] = []
    await Promise.all(
      paths.map(async path => {
        const file = this.app.vault.getFileByPath(path)
        if (file) {
          out.push({ path, content: await this.app.vault.cachedRead(file) })
        }
      })
    )
    return out
  }

  private renderHit(hit: SearchHit, el: HTMLElement): void {
    const file = this.app.vault.getFileByPath(hit.path)
    const title = el.createDiv({ cls: 'cfr-find-result-title' })
    const typeIcon = title.createSpan({ cls: 'cfr-find-result-icon' })
    setIcon(typeIcon, iconForExtension(file?.extension ?? 'md'))
    const titleText = title.createSpan()
    const basename = file?.basename ?? hit.path
    renderHighlighted(
      titleText,
      basename,
      findTermOffsets(
        basename,
        significantTerms(
          hit.terms,
          tokenize(this.inputEl.value, this.plugin.settings.splitCamelCase),
          this.plugin.settings.fuzziness,
          this.plugin.settings.minFuzzyLength
        ),
        this.plugin.settings.splitCamelCase,
        10
      )
    )
    el.createDiv({ cls: 'cfr-find-result-path', text: hit.path })
    // Excerpts only for text files: cachedRead on a PDF/image would render
    // binary garbage (their extracted text lives only in the index).
    if (this.plugin.settings.showExcerpts && this.isTextLike(file?.extension)) {
      const excerpt = el.createDiv({ cls: 'cfr-find-result-excerpt' })
      excerpt.dataset.path = hit.path
      excerpt.dataset.terms = JSON.stringify(hit.terms)
      excerpt.dataset.query = this.inputEl.value
      this.observer?.observe(excerpt)
    }
  }

  /**
   * Lazily builds the excerpt when the row first scrolls into view.
   * Anchor priority: (1) the query typed as a near-phrase in the note,
   * (2) the character window covering the most distinct query terms,
   * so the excerpt shows the note's BEST spot, not its first stray token.
   */
  private async fillExcerpt(el: HTMLElement): Promise<void> {
    const path = el.dataset.path
    if (!path) return
    const file = this.app.vault.getFileByPath(path)
    if (!file) return
    const terms: string[] = JSON.parse(el.dataset.terms ?? '[]')
    const query = el.dataset.query ?? ''
    const raw = await this.app.vault.cachedRead(file)
    const content = raw.replace(/\r\n/g, '\n')
    const splitCamel = this.plugin.settings.splitCamelCase
    const spans = tokenizeWithSpans(content, splitCamel)

    const phrase = findApproxPhraseInSpans(spans, parseQuery(query).textQuery, 1)
    if (phrase.length) {
      renderExcerpt(el, content, phrase)
      return
    }
    const matches = matchSpansDetailed(
      spans,
      significantTerms(
        terms,
        tokenize(query, splitCamel),
        this.plugin.settings.fuzziness,
        this.plugin.settings.minFuzzyLength
      ),
      500
    )
    renderExcerpt(el, content, pickExcerptOffsets(matches))
  }

  private async openHit(hit: SearchHit, newLeaf: boolean): Promise<void> {
    const query = this.inputEl.value
    this.close()
    await this.app.workspace.openLinkText(hit.path, '', newLeaf)
    // Jump to the note's best match: the typed query as a near-phrase if it
    // occurs, otherwise the densest cluster of query terms.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view || view.file?.path !== hit.path) return
    const splitCamel = this.plugin.settings.splitCamelCase
    const content = view.editor.getValue()
    const spans = tokenizeWithSpans(content, splitCamel)
    let offsets = findApproxPhraseInSpans(spans, parseQuery(query).textQuery, 1)
    if (!offsets.length) {
      offsets = pickExcerptOffsets(
        matchSpansDetailed(
          spans,
          significantTerms(
            hit.terms,
            tokenize(query, splitCamel),
            this.plugin.settings.fuzziness,
            this.plugin.settings.minFuzzyLength
          ),
          500
        )
      )
    }
    if (offsets.length) {
      await jumpToMatch(view, offsets[0].start, offsets[0].length)
    }
  }

  /**
   * Tab: drill into the SELECTED result without opening it in the workspace.
   * The in-file modal reads the file directly; Enter there opens it at the
   * chosen match, Tab/Shift+Tab comes back here with the query intact.
   */
  private switchToInFile(): void {
    const query = this.inputEl.value
    const hit = this.list.selectedItem
    const file = hit ? this.app.vault.getFileByPath(hit.path) : null
    const target = file && this.isTextLike(file.extension) ? file : undefined
    this.close()
    new InFileSearchModal(this.plugin, query, target).open()
  }
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

function iconForExtension(ext: string): string {
  const lower = ext.toLowerCase()
  if (lower === 'canvas') return 'layout-dashboard'
  if (lower === 'pdf') return 'file-type'
  if (IMAGE_EXTENSIONS.has(lower)) return 'image'
  if (lower === 'docx' || lower === 'xlsx') return 'file-spreadsheet'
  return 'file-text'
}
