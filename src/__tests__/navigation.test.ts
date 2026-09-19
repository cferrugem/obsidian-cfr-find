import { describe, expect, it } from 'vitest'
import { ResultList } from '../host/ui/result-list'

/**
 * Minimal stand-in for the DOM helpers Obsidian adds to HTMLElement
 * (createDiv, empty, addClass...), enough for ResultList to run in Node.
 */
class FakeElement {
  children: FakeElement[] = []
  classes = new Set<string>()

  createDiv(options?: { cls?: string }): FakeElement {
    const el = new FakeElement()
    if (options?.cls) el.addClass(options.cls)
    this.children.push(el)
    return el
  }
  empty(): void {
    this.children = []
  }
  addClass(cls: string): void {
    this.classes.add(cls)
  }
  removeClass(cls: string): void {
    this.classes.delete(cls)
  }
  addEventListener(): void {}
  scrollIntoView(): void {}
}

describe('ResultList navigation', () => {
  it('moves selection down and up with clamping', () => {
    const container = new FakeElement()
    const list = new ResultList<string>(
      container as unknown as HTMLElement,
      () => {},
      () => {}
    )

    list.setItems(['first', 'second', 'third'])
    expect(list.selectedItem).toBe('first')

    list.move(1)
    expect(list.selectedItem).toBe('second')

    list.move(1)
    expect(list.selectedItem).toBe('third')

    // Clamped at bottom
    list.move(1)
    expect(list.selectedItem).toBe('third')

    list.move(-1)
    expect(list.selectedItem).toBe('second')

    list.move(-1)
    expect(list.selectedItem).toBe('first')

    // Clamped at top
    list.move(-1)
    expect(list.selectedItem).toBe('first')
  })

  it('marks only the selected row', () => {
    const container = new FakeElement()
    const list = new ResultList<string>(
      container as unknown as HTMLElement,
      () => {},
      () => {}
    )

    list.setItems(['a', 'b', 'c'])
    list.move(1)

    const selected = container.children.map(row => row.classes.has('is-selected'))
    expect(selected).toEqual([false, true, false])
  })
})
