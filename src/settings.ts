import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import { FuzzyOptions, SCHEMA_VERSION } from './shared/protocol'
import type CfrFindPlugin from './main'

export enum DisplayNameMode {
  Title = 'title',
  Smart = 'smart',
}

export interface CfrFindSettings {
  extraFileTypes: string[]
  respectExcluded: boolean
  displayNameMode: DisplayNameMode
  /** 0 = exact … 0.3 = aggressive. */
  fuzziness: number
  /** Words shorter than this are never fuzzy-matched (guards precision). */
  minFuzzyLength: number
  /** Typed length required before prefix (autocomplete-style) matching. */
  prefixMinLength: number
  showExcerpts: boolean
  splitCamelCase: boolean
  useCache: boolean
  indexPDFs: boolean
  indexImages: boolean
  indexOfficeDocs: boolean
}

export const DEFAULT_SETTINGS: CfrFindSettings = {
  extraFileTypes: [],
  respectExcluded: true,
  displayNameMode: DisplayNameMode.Smart,
  fuzziness: 0.1,
  minFuzzyLength: 4,
  prefixMinLength: 2,
  showExcerpts: true,
  splitCamelCase: true,
  useCache: true,
  indexPDFs: false,
  indexImages: false,
  indexOfficeDocs: false,
}

export function fuzzyOptions(settings: CfrFindSettings): FuzzyOptions {
  return {
    fuzziness: settings.fuzziness,
    minFuzzyLength: settings.minFuzzyLength,
    prefixMinLength: settings.prefixMinLength,
  }
}

/**
 * Only options that change how STORED tokens look participate in the hash
 * (a mismatch discards the whole cache). Which files are indexed is handled
 * incrementally by the startup manifest diff, and fuzzy options are applied
 * at query time — neither needs a rebuild.
 */
export function optionsHash(settings: CfrFindSettings): string {
  return [SCHEMA_VERSION, settings.splitCamelCase ? 'camel' : 'nocamel'].join(
    '|'
  )
}

const SLOW_INDEXING_WARNING =
  '⚠️ Extracting text is slow: the first indexing pass and edits to these ' +
  'files can slow down Obsidian. Requires the "Text Extractor" community plugin.'

export class CfrFindSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: CfrFindPlugin
  ) {
    super(app, plugin)
  }

  private hasTextExtractor(): boolean {
    return !!(
      this.app as unknown as {
        plugins?: { plugins?: Record<string, { api?: unknown }> }
      }
    ).plugins?.plugins?.['text-extractor']?.api
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    // General settings stay at the top without a heading (Obsidian guideline).
    new Setting(containerEl)
    .setName("Display name")
    .setDesc("Choose how note names are displayed in search results.")
    .addDropdown(dropdown =>
    dropdown
    .addOption(DisplayNameMode.Title, "Title")
    .addOption(DisplayNameMode.Smart, "Smart Alias")
    .setValue(this.plugin.settings.displayNameMode)
    .onChange(async value => {
      this.plugin.settings.displayNameMode = value as DisplayNameMode;
      await this.plugin.saveSettings();
    })
    );

    new Setting(containerEl)
      .setName('Keyboard shortcut')
      .setDesc(
        'Open the vault search with the command "CFR Find: Search the vault". ' +
          "Assign or change its key combination in Obsidian's Hotkeys settings."
      )
      .addButton(button =>
        button
          .setButtonText('Configure hotkey')
          .setCta()
          .onClick(() => this.openHotkeySettings())
      )

    // ---- Search behavior ----
    new Setting(containerEl).setName('Fuzzy search').setHeading()

    new Setting(containerEl)
      .setName('Typo tolerance')
      .setDesc(
        'How forgiving matching is with typos ("recieve" still finds "receive"). ' +
          'Higher values find more, with more noise. Applies instantly.'
      )
      .addDropdown(dropdown =>
        dropdown
          .addOptions({
            '0': 'Off — exact words only',
            '0.1': 'Light (recommended)',
            '0.2': 'Normal',
            '0.3': 'Aggressive',
          })
          .setValue(String(this.plugin.settings.fuzziness))
          .onChange(async value => {
            this.plugin.settings.fuzziness = Number(value)
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Minimum word length for typo tolerance')
      .setDesc(
        'Words shorter than this always match exactly, so short words stay precise.'
      )
      .addSlider(slider =>
        slider
          .setLimits(3, 6, 1)
          .setValue(this.plugin.settings.minFuzzyLength)

          .onChange(async value => {
            this.plugin.settings.minFuzzyLength = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Prefix matching from')
      .setDesc(
        'How many characters you must type before words are matched by their ' +
          'beginning ("perf" finds "performance"). Lower = more results while typing.'
      )
      .addSlider(slider =>
        slider
          .setLimits(1, 3, 1)
          .setValue(this.plugin.settings.prefixMinLength)

          .onChange(async value => {
            this.plugin.settings.prefixMinLength = value
            await this.plugin.saveSettings()
          })
      )

    // ---- Indexing ----
    new Setting(containerEl).setName('Indexing').setHeading()

    if (!this.hasTextExtractor()) {
      containerEl.createDiv({
        cls: 'cfr-find-settings-note',
        text:
          'To index PDFs, images, and Office documents, install and enable the ' +
          '"Text Extractor" community plugin first.',
      })
    }

    new Setting(containerEl)
      .setName('Index PDF content')
      .setDesc(SLOW_INDEXING_WARNING)
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.indexPDFs).onChange(async value => {
          this.plugin.settings.indexPDFs = value
          await this.plugin.saveSettings()
          this.warnSlow(value, 'PDFs')
          this.plugin.scheduleEngineRestart()
        })
      )

    new Setting(containerEl)
      .setName('Index image text (OCR)')
      .setDesc(SLOW_INDEXING_WARNING)
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.indexImages)
          .onChange(async value => {
            this.plugin.settings.indexImages = value
            await this.plugin.saveSettings()
            this.warnSlow(value, 'images')
            this.plugin.scheduleEngineRestart()
          })
      )

    new Setting(containerEl)
      .setName('Index Office documents (.docx, .xlsx)')
      .setDesc(SLOW_INDEXING_WARNING)
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.indexOfficeDocs)
          .onChange(async value => {
            this.plugin.settings.indexOfficeDocs = value
            await this.plugin.saveSettings()
            this.warnSlow(value, 'Office documents')
            this.plugin.scheduleEngineRestart()
          })
      )

    new Setting(containerEl)
      .setName('Additional file types')
      .setDesc(
        'Comma-separated plaintext extensions to index besides md and canvas (e.g. "txt, org, csv").'
      )
      .addText(text =>
        text
          .setValue(this.plugin.settings.extraFileTypes.join(', '))
          .onChange(async value => {
            this.plugin.settings.extraFileTypes = value
              .split(',')
              .map(s => s.trim().replace(/^\./, '').toLowerCase())
              .filter(Boolean)
            await this.plugin.saveSettings()
            this.plugin.scheduleEngineRestart()
          })
      )

    new Setting(containerEl)
      .setName('Respect excluded files')
      .setDesc(
        "Skip files matched by Obsidian's Settings → Files & Links → Excluded files."
      )
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.respectExcluded)
          .onChange(async value => {
            this.plugin.settings.respectExcluded = value
            await this.plugin.saveSettings()
            this.plugin.scheduleEngineRestart()
          })
      )

    new Setting(containerEl)
      .setName('Split camelCase words')
      .setDesc(
        'Index "getUserName" also as "get", "user", "name". Changing this rebuilds the index.'
      )
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.splitCamelCase)
          .onChange(async value => {
            this.plugin.settings.splitCamelCase = value
            await this.plugin.saveSettings()
            this.plugin.scheduleEngineRestart()
          })
      )

    // ---- Interface ----
    new Setting(containerEl).setName('Interface').setHeading()

    new Setting(containerEl)
      .setName('Show excerpts')
      .setDesc('Show a text excerpt around the first match in results.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.showExcerpts)
          .onChange(async value => {
            this.plugin.settings.showExcerpts = value
            await this.plugin.saveSettings()
          })
      )

    // ---- Cache ----
    new Setting(containerEl).setName('Cache').setHeading()

    new Setting(containerEl)
      .setName('Save index to cache')
      .setDesc('Persist the index so restarts are near-instant.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.useCache)
          .onChange(async value => {
            this.plugin.settings.useCache = value
            await this.plugin.saveSettings()
            this.plugin.scheduleEngineRestart()
          })
      )

    new Setting(containerEl)
      .setName('Clear cache and rebuild index')
      .addButton(button => {
        button.setButtonText('Rebuild').onClick(async () => {
          await this.plugin.clearCacheAndRebuild()
          new Notice('CFR Find: index rebuilt')
        })
        // Destructive styling via the CSS class both old and new Obsidian
        // versions understand: setWarning() is deprecated and
        // setDestructive() does not exist before ~1.9, but our
        // minAppVersion is 1.5.7.
        button.buttonEl.addClass('mod-warning')
      })

    new Setting(containerEl)
      .setName('Reset settings to defaults')
      .setDesc(
        'Restore every CFR Find option to its default value. The index is ' +
          'updated automatically if any indexing option changes.'
      )
      .addButton(button => {
        let armed = false
        button.setButtonText('Reset').onClick(async () => {
          // Two-click confirmation so a stray tap cannot wipe the settings.
          if (!armed) {
            armed = true
            button.setButtonText('Click again to confirm')
            window.setTimeout(() => {
              armed = false
              button.setButtonText('Reset')
            }, 4000)
            return
          }
          this.plugin.settings = {
            ...DEFAULT_SETTINGS,
            extraFileTypes: [...DEFAULT_SETTINGS.extraFileTypes],
          }
          await this.plugin.saveSettings()
          this.plugin.scheduleEngineRestart()
          this.display()
          new Notice('CFR Find: settings restored to defaults')
        })
        button.buttonEl.addClass('mod-warning')
      })

    // ---- About ----
    new Setting(containerEl).setName('About').setHeading()

    new Setting(containerEl)
      .setName('Support development')
      .setDesc('If CFR Find is useful to you, you can buy me a coffee.')
      .addButton(button =>
        button
          .setButtonText('☕ Buy me a coffee')
          .setCta()
          .onClick(() => {
            window.open('https://buymeacoffee.com/cferrugem')
          })
      )

    const credits = containerEl.createDiv({ cls: 'cfr-find-credits' })
    credits.appendText('CFR Find is heavily inspired by ')
    credits.createEl('a', {
      text: 'Omnisearch',
      href: 'https://github.com/scambier/obsidian-omnisearch',
    })
    credits.appendText(' by Simon Cambier. Search is powered by the ')
    credits.createEl('a', {
      text: 'MiniSearch',
      href: 'https://github.com/lucaong/minisearch',
    })
    credits.appendText(
      ' library by Luca Ongaro. PDF, image, and Office indexing uses the '
    )
    credits.createEl('a', {
      text: 'Text Extractor',
      href: 'https://github.com/scambier/obsidian-text-extractor',
    })
    credits.appendText(' plugin, also by Simon Cambier. Licensed under GPL-3.')
  }

  private warnSlow(enabled: boolean, what: string): void {
    if (!enabled) return
    if (!this.hasTextExtractor()) {
      new Notice(
        `CFR Find: install the "Text Extractor" plugin to index ${what}.`,
        8000
      )
      return
    }
    new Notice(
      `⚠️ CFR Find: indexing ${what} can slow down Obsidian while their text is extracted.`,
      8000
    )
  }

  /** Opens Obsidian's Hotkeys tab pre-filtered to this plugin's commands. */
  private openHotkeySettings(): void {
    const setting = (
      this.app as unknown as {
        setting: {
          open: () => void
          openTabById: (id: string) => void
          activeTab?: {
            searchComponent?: {
              inputEl: HTMLInputElement
              onChanged?: () => void
            }
          }
        }
      }
    ).setting
    setting.open()
    setting.openTabById('hotkeys')
    const search = setting.activeTab?.searchComponent
    if (search) {
      search.inputEl.value = 'CFR Find'
      if (search.onChanged) search.onChanged()
      else search.inputEl.dispatchEvent(new Event('input'))
    }
  }
}
