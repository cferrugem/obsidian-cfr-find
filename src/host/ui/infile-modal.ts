import { MarkdownView, Modal, setIcon, TFile } from 'obsidian'
import type CfrFindPlugin from '../../main'
import { tokenize, tokenizeWithSpans, TokenSpan } from '../../shared/tokenizer'
import { matchSpans, MatchOffset } from '../../shared/matcher'
import { renderHighlighted } from '../excerpts'
import { ResultList } from './result-list'
import { CFR_FIND_ICON } from './icon'

const DEBOUNCE_MS = 60
const MAX_MATCHES = 500

interface LineMatch {
  offset: MatchOffset
  line: number
  lineStart: number
  lineText: string
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
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
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
      m => this.jumpTo(m)
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
    const content =
      activeView && activeView.file?.path === this.file.path
        ? activeView.editor.getValue()
        : await this.app.vault.cachedRead(this.file)

    this.spans = tokenizeWithSpans(content, this.plugin.settings.splitCamelCase)
    this.lines = content.split('\n')
    this.lineStarts = new Array(this.lines.length)
    let pos = 0
    for (let i = 0; i < this.lines.length; i++) {
      this.lineStarts[i] = pos
      pos += this.lines[i].length + 1
    }
    if (this.initialQuery) this.updateResults()
  }

  onClose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
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
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.updateResults(), DEBOUNCE_MS)
  }

  private updateResults(): void {
    const query = this.inputEl.value.trim()
    if (!query || !this.spans.length) {
      this.list.setItems([])
      return
    }
    const terms = tokenize(query, this.plugin.settings.splitCamelCase)
    const offsets = matchSpans(this.spans, terms, MAX_MATCHES)
    this.list.setItems(offsets.map(o => this.toLineMatch(o)))
  }

  private toLineMatch(offset: MatchOffset): LineMatch {
    // Binary search the line containing this offset.
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid] <= offset.start) lo = mid
      else hi = mid - 1
    }
    return {
      offset,
      line: lo,
      lineStart: this.lineStarts[lo],
      lineText: this.lines[lo],
    }
  }

  private renderMatch(m: LineMatch, el: HTMLElement): void {
    el.addClass('cfr-find-infile-row')
    el.createSpan({ cls: 'cfr-find-line-number', text: String(m.line + 1) })
    const textEl = el.createSpan({ cls: 'cfr-find-line-text' })
    renderHighlighted(textEl, m.lineText, [m.offset], m.lineStart)
  }

  /** Opens the note (if needed) and places the cursor on the match. */
  private async jumpTo(m: LineMatch): Promise<void> {
    const file = this.file
    if (!file) return
    this.close()

    let view = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view || view.file?.path !== file.path) {
      await this.app.workspace.openLinkText(file.path, '', false)
      view = this.app.workspace.getActiveViewOfType(MarkdownView)
    }
    if (!view || view.file?.path !== file.path) return

    const editor = view.editor
    const from = editor.offsetToPos(m.offset.start)
    const to = editor.offsetToPos(m.offset.start + m.offset.length)
    editor.setSelection(from, to)
    editor.scrollIntoView({ from, to }, true)
  }

  private switchToVault(): void {
    const query = this.inputEl?.value ?? this.initialQuery
    this.close()
    this.plugin.openVaultSearch(query)
  }
}
