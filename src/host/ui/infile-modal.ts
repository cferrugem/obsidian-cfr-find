import { MarkdownView, Modal, setIcon, TFile } from 'obsidian'
import type CfrFindPlugin from '../../main'
import { tokenize, tokenizeWithSpans, TokenSpan } from '../../shared/tokenizer'
import {
  findApproxPhraseInSpans,
  matchSpansDetailed,
  MatchOffset,
  significantTerms,
} from '../../shared/matcher'
import { renderHighlighted } from '../excerpts'
import { ResultList } from './result-list'
import { CFR_FIND_ICON } from './icon'
import { jumpToMatch } from './jump'

const DEBOUNCE_MS = 60
const MAX_MATCHES = 2000
const MAX_ROWS = 200

/** One row = one LINE of the note, with every match in it highlighted. */
interface LineMatch {
  line: number
  lineStart: number
  lineText: string
  offsets: MatchOffset[]
  /** Distinct query terms present in this line. */
  distinct: number
  /** Line contains the query as a near-phrase. */
  phrase: boolean
}

/**
 * Searches inside ONE note: the given target file (drill-down from a vault
 * search result — the file does not need to be open) or the active note.
 * Enter opens the note at the selected match. Tab/Shift+Tab returns to the
 * vault search, carrying the query.
 */
export class InFileSearchModal extends Modal {
  private inputEl!: HTMLInputElement
  private list!: ResultList<LineMatch>
  private debounceTimer: number | null = null
  // Content is tokenized ONCE on open; each keystroke only re-matches
  // the cached spans, so typing stays O(tokens) with zero re-tokenization.
  private spans: TokenSpan[] = []
  private lineStarts: number[] = []
  private lines: string[] = []
  private file: TFile | null = null

  constructor(
    private plugin: CfrFindPlugin,
    private initialQuery = '',
    private targetFile?: TFile
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.modalEl.addClass('cfr-find-modal')
    this.contentEl.empty()

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
    this.file = this.targetFile ?? activeView?.file ?? null
    if (!this.file) {
      this.contentEl.createDiv({
        cls: 'cfr-find-empty',
        text: 'Open a note (or pick a result with Tab) to search inside it.',
      })
      return
    }

    const inputRow = this.contentEl.createDiv({ cls: 'cfr-find-input-row' })
    const iconEl = inputRow.createSpan({ cls: 'cfr-find-input-icon' })
    setIcon(iconEl, CFR_FIND_ICON)
    this.inputEl = inputRow.createEl('input', {
      type: 'text',
      placeholder: `Search in ${this.file.basename}…`,
      cls: 'cfr-find-input',
    })
    this.inputEl.value = this.initialQuery

    const resultsEl = this.contentEl.createDiv({ cls: 'cfr-find-results' })
    this.list = new ResultList<LineMatch>(
      resultsEl,
      (m, el) => this.renderMatch(m, el),
      m => {
        void this.jumpTo(m)
      }
    )

    const footer = this.contentEl.createDiv({ cls: 'cfr-find-footer' })
    const hint = (keys: string, label: string) => {
      const chip = footer.createSpan({ cls: 'cfr-find-hint' })
      chip.createEl('kbd', { text: keys })
      chip.appendText(` ${label}`)
    }
    hint('↑ ↓', 'navigate')
    hint('↵', 'open at match')
    hint('tab', 'back to vault search')

    this.inputEl.addEventListener('input', () => this.scheduleUpdate())
    this.registerKeys()
    this.inputEl.focus()

    this.loadContent(activeView).catch(console.error)
  }

  /** Reads and tokenizes the note once. Uses the live editor buffer when the
   *  target IS the active note, so unsaved edits are searched too. */
  private async loadContent(activeView: MarkdownView | null): Promise<void> {
    if (!this.file) return
    // CRLF → LF: the editor uses LF offsets, so jump positions stay exact
    // even for files checked out with Windows line endings.
    const content = (
      activeView && activeView.file?.path === this.file.path
        ? activeView.editor.getValue()
        : await this.app.vault.cachedRead(this.file)
    ).replace(/\r\n/g, '\n')

    this.spans = tokenizeWithSpans(content, this.plugin.settings.splitCamelCase)
    this.lines = content.split('\n')
    this.lineStarts = new Array<number>(this.lines.length)
    let pos = 0
    for (let i = 0; i < this.lines.length; i++) {
      this.lineStarts[i] = pos
      pos += this.lines[i].length + 1
    }
    if (this.initialQuery) this.updateResults()
  }

  onClose(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
    this.spans = []
    this.lines = []
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
    this.scope.register([], 'Tab', e => {
      e.preventDefault()
      this.switchToVault()
    })
    this.scope.register(['Shift'], 'Tab', e => {
      e.preventDefault()
      this.switchToVault()
    })
  }

  private scheduleUpdate(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
    this.debounceTimer = window.setTimeout(() => this.updateResults(), DEBOUNCE_MS)
  }

  /**
   * One row per line, ranked like the user expects: lines containing the
   * query as a near-phrase first, then lines matching more distinct terms,
   * then document order. Stopword-sized terms ("de") don't count unless
   * the whole query is made of them.
   */
  private updateResults(): void {
    const query = this.inputEl.value.trim()
    if (!query || !this.spans.length) {
      this.list.setItems([])
      return
    }
    const terms = significantTerms(
      tokenize(query, this.plugin.settings.splitCamelCase)
    )
    const matches = matchSpansDetailed(this.spans, terms, MAX_MATCHES)

    const byLine = new Map<number, { offsets: MatchOffset[]; terms: Set<string> }>()
    for (const m of matches) {
      const line = this.lineOf(m.start)
      let entry = byLine.get(line)
      if (!entry) {
        entry = { offsets: [], terms: new Set() }
        byLine.set(line, entry)
      }
      entry.offsets.push({ start: m.start, length: m.length })
      entry.terms.add(m.term)
    }

    const phraseLines = new Set(
      findApproxPhraseInSpans(this.spans, query, 50).map(o => this.lineOf(o.start))
    )

    const rows: LineMatch[] = [...byLine.entries()].map(([line, entry]) => ({
      line,
      lineStart: this.lineStarts[line],
      lineText: this.lines[line],
      offsets: entry.offsets,
      distinct: entry.terms.size,
      phrase: phraseLines.has(line),
    }))
    rows.sort(
      (a, b) =>
        Number(b.phrase) - Number(a.phrase) ||
        b.distinct - a.distinct ||
        a.line - b.line
    )
    this.list.setItems(rows.slice(0, MAX_ROWS))
  }

  /** Binary search the line containing a character offset. */
  private lineOf(offset: number): number {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  private renderMatch(m: LineMatch, el: HTMLElement): void {
    el.addClass('cfr-find-infile-row')
    el.createSpan({ cls: 'cfr-find-line-number', text: String(m.line + 1) })
    const textEl = el.createSpan({ cls: 'cfr-find-line-text' })
    renderHighlighted(textEl, m.lineText, m.offsets, m.lineStart)
  }

  /** Opens the note (if needed) and places the cursor on the line's first match. */
  private async jumpTo(m: LineMatch): Promise<void> {
    const file = this.file
    const target = m.offsets[0]
    if (!file || !target) return
    this.close()

    let view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view || view.file?.path !== file.path) {
      await this.app.workspace.openLinkText(file.path, '', false)
      view = this.app.workspace.getActiveViewOfType(MarkdownView)
    }
    if (!view || view.file?.path !== file.path) return

    await jumpToMatch(view, target.start, target.length)
  }

  private switchToVault(): void {
    const query = this.inputEl?.value ?? this.initialQuery
    this.close()
    this.plugin.openVaultSearch(query)
  }
}
