# CFR Find

Fast, worker-powered full-text search for [Obsidian](https://obsidian.md).

> **Credit where it's due:** CFR Find is heavily inspired by
> [**Omnisearch**](https://github.com/scambier/obsidian-omnisearch) by
> **Simon Cambier**, licensed under GPL-3. Omnisearch pioneered this style of
> ranked, typo-tolerant vault search in Obsidian, and CFR Find borrows many
> of its ideas (and its Text Extractor integration). If you need an HTTP API,
> a public plugin API, embed results, or Chinese word segmentation, use
> Omnisearch — it's excellent. CFR Find trades those features for raw speed.
> Like Omnisearch, CFR Find is licensed under GPL-3.

## Why another search plugin?

Omnisearch's slowness on large vaults is architectural: all indexing,
tokenization, and cache serialization run on Obsidian's UI thread, every
document is tokenized several times over, and the whole index is serialized
as one blob on the main thread. CFR Find keeps the same core idea
(BM25 ranked search via [MiniSearch](https://github.com/lucaong/minisearch))
but restructures everything around performance:

| | CFR Find | Omnisearch |
|---|---|---|
| Indexing & search thread | **Web Worker** (UI never blocks) | Main/UI thread |
| Tokenization | Single pass, deduplicated | 3–4 passes, duplicates kept |
| Diacritics normalization | Once per distinct token (memoized) | Per document + per term + per query |
| Note content in memory | Not retained | 2 full copies of every note |
| Cache serialization | In the worker, one atomic transaction | On the UI thread |
| Excerpt highlighting | Visible results only (IntersectionObserver), offset-based `<mark>` | All 50 results, regex replace |
| UI | Plain DOM, no framework | Svelte 5 |
| Bundle | ~75 KB | ~1 MB+ |

## Features

- **Vault-wide search** (`CFR Find: Search the vault`): ranked, typo-tolerant,
  prefix-matching search across markdown, canvas, and any plaintext extensions
  you configure.
- **In-file search** (`CFR Find: Search in the current note`): jump to any
  match in the active note. `Tab` switches between the two modes, carrying
  your query.
- **Query syntax**: `"exact phrases"`, `-excluded` words, `-"excluded phrases"`,
  `ext:md` / `.md` extension filters, `path:Daily` / `-path:Archive` filters.
- **Smart matching**: diacritics-insensitive (`cafe` finds `café`),
  camelCase-aware (`user` finds `getUserName`), hyphen-aware.
- **Instant restarts**: the index is persisted (IndexedDB) and only files whose
  modification time changed are re-indexed on launch.
- **Live index**: created/renamed/deleted notes update immediately; edits are
  re-indexed after a 2-second pause and always flushed before a search opens.
- **Configurable fuzzy search**: typo tolerance level (off → aggressive),
  minimum word length for fuzzy matching, and prefix-matching threshold —
  all applied instantly, no re-index needed.
- **PDF / image (OCR) / Office indexing** via the
  [Text Extractor](https://github.com/scambier/obsidian-text-extractor)
  community plugin. **Disabled by default** — extracting text is slow and can
  slow down Obsidian during indexing; a warning is shown when you enable it.
- Field-weighted ranking: filename and aliases > tags > headings > body.
- Respects Obsidian's **Excluded files** setting.
- Custom icon and a keyboard-first UI with a fixed-size result panel.

## What CFR Find does *not* do

Being honest about scope — these Omnisearch features are intentionally not in
CFR Find (use Omnisearch if you need them):

- No public API for other plugins and no `obsidian://` URL scheme.
- No local HTTP server.
- No embed results (images/documents surfaced under the notes that embed them).
- No Chinese word segmentation integration.
- PDF/image/Office indexing requires the separate Text Extractor plugin
  (desktop only, same as Omnisearch) and is off by default because text
  extraction is slow.

## Opening the search

The command is **`CFR Find: Search the vault`** (there is also
`CFR Find: Search in the current note`). Bind a key to it in
**Settings → Hotkeys**, or use the shortcut button in CFR Find's settings tab
which takes you straight there.

## Install (manual)

1. Run `npm install && npm run build`.
2. Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into
   `<your vault>/.obsidian/plugins/cfr-find/`.
3. Reload Obsidian and enable **CFR Find** in Community plugins.

## Development

```bash
npm install
npm run dev    # watch build
npm test       # unit tests (tokenizer, query parser, engine, worker core)
npm run build  # type-check + production build
```

Architecture notes: the search engine runs in a Web Worker that is bundled
separately and inlined into `main.js` as a blob URL (Obsidian plugins ship a
single file). The main thread only reads files and renders UI; file contents
are posted to the worker and never kept resident. See `src/shared/protocol.ts`
for the full message contract.

## Privacy and network use

CFR Find makes **no network requests**. All indexing and searching happens
locally on your device; the index is stored locally in IndexedDB. The only
external link in the plugin is the optional "Buy me a coffee" button in the
settings tab, which opens `buymeacoffee.com` in your browser **only if you
click it**.

## Support

If CFR Find is useful to you, you can
[buy me a coffee](https://buymeacoffee.com/cferrugem). ☕

## Credits

- [Omnisearch](https://github.com/scambier/obsidian-omnisearch) by
  Simon Cambier — the inspiration for this plugin and the pioneer of ranked
  fuzzy search in Obsidian.
- [MiniSearch](https://github.com/lucaong/minisearch) by Luca Ongaro — the
  BM25 full-text search engine CFR Find runs inside its worker.
- [Text Extractor](https://github.com/scambier/obsidian-text-extractor) by
  Simon Cambier — powers the optional PDF/image/Office indexing.

## License

[GPL-3.0-or-later](LICENSE). Inspired by
[Omnisearch](https://github.com/scambier/obsidian-omnisearch) © Simon Cambier.
