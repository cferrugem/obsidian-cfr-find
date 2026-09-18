import { vi } from 'vitest'

export interface ScopeHandler {
  modifiers: string[] | null
  key: string | null
  func: (evt: any) => boolean | void
}

export class Scope {
  handlers: ScopeHandler[] = []

  register(
    modifiers: string[] | null,
    key: string | null,
    func: (evt: any) => boolean | void
  ): ScopeHandler {
    const handler = { modifiers, key, func }
    this.handlers.push(handler)
    return handler
  }

  unregister(handler: ScopeHandler): void {
    this.handlers = this.handlers.filter(h => h !== handler)
  }
}

export class MockElement {
  children: MockElement[] = []
  classes = new Set<string>()
  eventListeners: Record<string, Function[]> = {}
  value = ''
  dataset: Record<string, string> = {}

  addClass(cls: string): this {
    this.classes.add(cls)
    return this
  }
  removeClass(cls: string): this {
    this.classes.delete(cls)
    return this
  }
  empty(): void {
    this.children = []
  }
  createDiv(options?: { cls?: string; text?: string }): MockElement {
    const el = new MockElement()
    if (options?.cls) el.addClass(options.cls)
    this.children.push(el)
    return el
  }
  createSpan(options?: { cls?: string; text?: string }): MockElement {
    const el = new MockElement()
    if (options?.cls) el.addClass(options.cls)
    this.children.push(el)
    return el
  }
  createEl(tag: string, options?: { cls?: string; type?: string; placeholder?: string }): MockElement {
    const el = new MockElement()
    if (options?.cls) el.addClass(options.cls)
    this.children.push(el)
    return el
  }
  appendText(_text: string): void {}
  addEventListener(event: string, handler: Function): void {
    if (!this.eventListeners[event]) this.eventListeners[event] = []
    this.eventListeners[event].push(handler)
  }
  focus(): void {}
  scrollIntoView(_options?: unknown): void {}
}

if (typeof (globalThis as any).HTMLElement === 'undefined') {
  ;(globalThis as any).HTMLElement = MockElement
}

export class Modal {
  scope = new Scope()
  modalEl = new MockElement()
  contentEl = new MockElement()
  app: any
  constructor(app: any) {
    this.app = app
  }
  open(): void {}
  close(): void {}
}

export class TFile {
  path = 'test.md'
  basename = 'test'
  extension = 'md'
}

export class MarkdownView {}
export const setIcon = vi.fn()
export const addIcon = vi.fn()
export const debounce = (fn: Function) => fn
export class Notice {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
