/** Generic selectable result list with keyboard navigation. */

export class ResultList<T> {
  private items: T[] = []
  private rows: HTMLElement[] = []
  private selected = 0

  constructor(
    private containerEl: HTMLElement,
    private renderItem: (item: T, el: HTMLElement, index: number) => void,
    private onChoose: (item: T, ev: KeyboardEvent | MouseEvent) => void
  ) {}

  setItems(items: T[]): void {
    this.items = items
    this.selected = 0
    this.containerEl.empty()
    this.rows = items.map((item, i) => {
      const row = this.containerEl.createDiv({ cls: 'cfr-find-result' })
      this.renderItem(item, row, i)
      row.addEventListener('click', ev => this.onChoose(item, ev))
      row.addEventListener('mousemove', () => this.select(i, false))
      return row
    })
    if (this.rows.length) this.select(0, false)
  }

  get selectedItem(): T | null {
    return this.items[this.selected] ?? null
  }

  get length(): number {
    return this.items.length
  }

  select(index: number, scroll = true): void {
    if (!this.rows.length) return
    this.rows[this.selected]?.removeClass('is-selected')
    this.selected = Math.max(0, Math.min(index, this.rows.length - 1))
    const row = this.rows[this.selected]
    row.addClass('is-selected')
    if (scroll) row.scrollIntoView({ block: 'nearest' })
  }

  move(delta: number): void {
    this.select(this.selected + delta)
  }

  chooseSelected(ev: KeyboardEvent): void {
    const item = this.selectedItem
    if (item) this.onChoose(item, ev)
  }
}
