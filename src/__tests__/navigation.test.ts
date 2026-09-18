import { describe, expect, it, vi } from 'vitest'
import { ResultList } from '../host/ui/result-list'
import { VaultSearchModal } from '../host/ui/vault-modal'
import { InFileSearchModal } from '../host/ui/infile-modal'
import { MockElement, ScopeHandler, TFile } from './__mocks__/obsidian'

describe('ResultList navigation', () => {
  it('moves selection down and up with clamping', () => {
    const container = new MockElement() as unknown as HTMLElement
    const list = new ResultList<string>(
      container,
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

    // Move back up
    list.move(-1)
    expect(list.selectedItem).toBe('second')

    list.move(-1)
    expect(list.selectedItem).toBe('first')

    // Clamped at top
    list.move(-1)
    expect(list.selectedItem).toBe('first')
  })
})

describe('VaultSearchModal keyboard navigation', () => {
  it('registers Ctrl+N and Ctrl+P handlers that navigate suggestions and prevent default', () => {
    const mockPlugin: any = {
      app: {
        workspace: {
          getActiveViewOfType: () => null,
        },
        vault: {
          cachedRead: vi.fn().mockResolvedValue(''),
          getFileByPath: () => null,
        },
      },
      settings: {
        splitCamelCase: false,
        extraFileTypes: [],
        showExcerpts: false,
      },
      indexer: {
        syncBeforeSearch: vi.fn().mockResolvedValue(undefined),
      },
      client: null,
    }

    const modal = new VaultSearchModal(mockPlugin)
    modal.onOpen()

    const scope = (modal as any).scope as { handlers: ScopeHandler[] }

    const ctrlNHandler = scope.handlers.find(
      h =>
        h.key === 'n' &&
        h.modifiers?.length === 1 &&
        h.modifiers[0] === 'Ctrl'
    )
    const ctrlPHandler = scope.handlers.find(
      h =>
        h.key === 'p' &&
        h.modifiers?.length === 1 &&
        h.modifiers[0] === 'Ctrl'
    )

    expect(ctrlNHandler).toBeDefined()
    expect(ctrlPHandler).toBeDefined()

    // Populate the modal's list with test items
    const list = (modal as any).list as ResultList<any>
    list.setItems([
      { path: 'note1.md', terms: [] },
      { path: 'note2.md', terms: [] },
      { path: 'note3.md', terms: [] },
    ])
    expect(list.selectedItem?.path).toBe('note1.md')

    // Trigger Ctrl+N -> moves down to note2
    const nEvent = { preventDefault: vi.fn() }
    ctrlNHandler!.func(nEvent)
    expect(nEvent.preventDefault).toHaveBeenCalled()
    expect(list.selectedItem?.path).toBe('note2.md')

    // Trigger Ctrl+N -> moves down to note3
    ctrlNHandler!.func(nEvent)
    expect(list.selectedItem?.path).toBe('note3.md')

    // Trigger Ctrl+P -> moves up to note2
    const pEvent = { preventDefault: vi.fn() }
    ctrlPHandler!.func(pEvent)
    expect(pEvent.preventDefault).toHaveBeenCalled()
    expect(list.selectedItem?.path).toBe('note2.md')

    // Trigger Ctrl+P -> moves up to note1
    ctrlPHandler!.func(pEvent)
    expect(list.selectedItem?.path).toBe('note1.md')
  })
})

describe('InFileSearchModal keyboard navigation', () => {
  it('registers Ctrl+N and Ctrl+P handlers that navigate suggestions and prevent default', () => {
    const mockPlugin: any = {
      app: {
        workspace: {
          getActiveViewOfType: () => null,
        },
        vault: {
          cachedRead: vi.fn().mockResolvedValue('line 1\nline 2\nline 3'),
        },
      },
      settings: {
        splitCamelCase: false,
      },
    }

    const mockFile = new TFile()
    const modal = new InFileSearchModal(mockPlugin, '', mockFile as any)
    modal.onOpen()

    const scope = (modal as any).scope as { handlers: ScopeHandler[] }

    const ctrlNHandler = scope.handlers.find(
      h =>
        h.key === 'n' &&
        h.modifiers?.length === 1 &&
        h.modifiers[0] === 'Ctrl'
    )
    const ctrlPHandler = scope.handlers.find(
      h =>
        h.key === 'p' &&
        h.modifiers?.length === 1 &&
        h.modifiers[0] === 'Ctrl'
    )

    expect(ctrlNHandler).toBeDefined()
    expect(ctrlPHandler).toBeDefined()

    // Populate the modal's list with test items
    const list = (modal as any).list as ResultList<any>
    list.setItems([
      { line: 0, lineText: 'first line', offsets: [] },
      { line: 1, lineText: 'second line', offsets: [] },
      { line: 2, lineText: 'third line', offsets: [] },
    ])
    expect(list.selectedItem?.line).toBe(0)

    // Trigger Ctrl+N -> moves down to line 1
    const nEvent = { preventDefault: vi.fn() }
    ctrlNHandler!.func(nEvent)
    expect(nEvent.preventDefault).toHaveBeenCalled()
    expect(list.selectedItem?.line).toBe(1)

    // Trigger Ctrl+P -> moves up to line 0
    const pEvent = { preventDefault: vi.fn() }
    ctrlPHandler!.func(pEvent)
    expect(pEvent.preventDefault).toHaveBeenCalled()
    expect(list.selectedItem?.line).toBe(0)
  })
})
