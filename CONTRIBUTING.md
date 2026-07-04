# Contributing to CFR Find

Thanks for your interest! Issues and pull requests are welcome.

## Development setup

```bash
npm install
npm run dev    # watch build (outputs to dist/)
npm test       # unit tests (vitest)
npm run build  # type-check + production build
```

To test in Obsidian, copy `dist/main.js`, `dist/manifest.json`, and
`dist/styles.css` into `<your vault>/.obsidian/plugins/cfr-find/` and reload.

## Architecture in one paragraph

The search engine (MiniSearch/BM25) runs in a Web Worker that is bundled
separately and inlined into `main.js` as a blob URL. The main thread only
reads vault files and renders UI; contents are posted to the worker and never
kept resident. `src/shared/protocol.ts` is the message contract between the
two sides — start there.

## Guidelines

- Keep the main thread free of heavy work; anything O(vault) belongs in the
  worker or must be incremental.
- Pure logic (tokenizer, matcher, query parser, engine) must stay
  DOM-free so it runs in the worker and in tests.
- Add or update a vitest test for behavior changes in `src/__tests__/`.
- No lookbehind regexes (breaks iOS < 16.4) and no Node/Electron APIs
  (breaks mobile).

## License

GPL-3.0-or-later — contributions are accepted under the same license.
