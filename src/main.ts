import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian'
import {
  DEFAULT_SETTINGS,
  optionsHash,
  CfrFindSettings,
  CfrFindSettingTab,
} from './settings'
import { WorkerClient } from './host/worker-client'
import { Indexer } from './host/indexer'
import { VaultSearchModal } from './host/ui/vault-modal'
import { InFileSearchModal } from './host/ui/infile-modal'
import { CFR_FIND_ICON, registerCfrFindIcon } from './host/ui/icon'

export default class CfrFindPlugin extends Plugin {
  settings: CfrFindSettings = DEFAULT_SETTINGS
  client: WorkerClient | null = null
  indexer: Indexer | null = null
  private statusBarEl: HTMLElement | null = null
  private restartTimer: number | null = null

  async onload(): Promise<void> {
    await this.loadSettings()
    registerCfrFindIcon()
    this.addSettingTab(new CfrFindSettingTab(this.app, this))

    this.addCommand({
      id: 'vault-search',
      name: 'Search the vault',
      icon: CFR_FIND_ICON,
      callback: () => this.openVaultSearch(),
    })
    this.addCommand({
      id: 'in-file-search',
      name: 'Search in the current note',
      icon: CFR_FIND_ICON,
      callback: () => new InFileSearchModal(this).open(),
    })
    this.addRibbonIcon(CFR_FIND_ICON, 'CFR Find: Search the vault', () =>
      this.openVaultSearch()
    )

    this.app.workspace.onLayoutReady(() => {
      this.startEngine().catch(e => {
        console.error('CFR Find: failed to start engine', e)
        new Notice('CFR Find failed to start — see console.')
      })
      // Registered once; handlers delegate to the current indexer so an
      // engine restart never double-registers events.
      this.registerEvent(
        this.app.vault.on('create', file => {
          if (file instanceof TFile) this.indexer?.onCreate(file)
        })
      )
      this.registerEvent(
        this.app.vault.on('delete', file => {
          if (file instanceof TFile) this.indexer?.onDelete(file.path)
        })
      )
      this.registerEvent(
        this.app.vault.on('modify', file => {
          if (file instanceof TFile) this.indexer?.onModify(file)
        })
      )
      this.registerEvent(
        this.app.vault.on(
          'rename',
          (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile) this.indexer?.onRename(file, oldPath)
          }
        )
      )
    })
  }

  onunload(): void {
    if (this.restartTimer) window.clearTimeout(this.restartTimer)
    this.stopEngine(true)
  }

  openVaultSearch(query = ''): void {
    new VaultSearchModal(this, query).open()
  }

  private dbName(): string {
    const appId =
      (this.app as unknown as { appId?: string }).appId ?? 'default'
    return `cfr-find/${appId}`
  }

  private async startEngine(): Promise<void> {
    const client = new WorkerClient()
    client.start()
    this.client = client
    this.indexer = new Indexer(this.app, client, this.settings, (done, total) =>
      this.showProgress(done, total)
    )
    const manifest = await client.init({
      dbName: this.dbName(),
      optionsHash: optionsHash(this.settings),
      splitCamelCase: this.settings.splitCamelCase,
      useCache: this.settings.useCache,
    })
    await this.indexer.populate(manifest)
    this.hideProgress()
  }

  private stopEngine(persist: boolean): void {
    this.indexer?.stop()
    const client = this.client
    this.client = null
    this.indexer = null
    if (!client) return
    if (persist) {
      // Let the cache write finish before killing the worker.
      client
        .persist()
        .catch(() => {})
        .finally(() => client.terminate())
    } else {
      client.terminate()
    }
    this.hideProgress()
  }

  /**
   * Debounced full engine restart, used by settings that change index
   * content (the options hash mismatch makes the worker rebuild from
   * scratch on init).
   */
  scheduleEngineRestart(): void {
    if (this.restartTimer) window.clearTimeout(this.restartTimer)
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null
      this.stopEngine(false)
      this.startEngine().catch(console.error)
    }, 1500)
  }

  async clearCacheAndRebuild(): Promise<void> {
    await this.client?.clearCache().catch(() => {})
    this.stopEngine(false)
    await this.startEngine()
  }

  private showProgress(done: number, total: number): void {
    if (!this.statusBarEl) this.statusBarEl = this.addStatusBarItem()
    this.statusBarEl.setText(`CFR Find: ${done}/${total}`)
  }

  private hideProgress(): void {
    this.statusBarEl?.setText('')
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<CfrFindSettings> | null
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored)
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }
}
