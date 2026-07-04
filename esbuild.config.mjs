import esbuild from 'esbuild'
import process from 'process'
import builtins from 'builtin-modules'
import fs from 'fs'
import path from 'path'

const prod = process.argv[2] === 'production'

const banner = `/*
CFR Find - fast, worker-powered vault search for Obsidian.
Inspired by Omnisearch (https://github.com/scambier/obsidian-omnisearch)
by Simon Cambier. Licensed under GPL-3.0-or-later.
*/
`

/**
 * Bundles src/worker/index.ts as a standalone IIFE and exposes it to the main
 * bundle as a string (import workerCode from 'virtual:worker'), so the plugin
 * can ship a single main.js and still spawn a real Worker from a blob URL.
 */
const inlineWorkerPlugin = {
  name: 'inline-worker',
  setup(build) {
    build.onResolve({ filter: /^virtual:worker$/ }, args => ({
      path: args.path,
      namespace: 'worker-inline',
    }))
    build.onLoad({ filter: /.*/, namespace: 'worker-inline' }, async () => {
      const result = await esbuild.build({
        entryPoints: ['src/worker/index.ts'],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify: prod,
        metafile: true,
        logLevel: 'silent',
      })
      const watchFiles = Object.keys(result.metafile.inputs).map(p =>
        path.resolve(p)
      )
      return {
        contents: `export default ${JSON.stringify(result.outputFiles[0].text)}`,
        loader: 'js',
        watchFiles,
      }
    })
  },
}

const copyAssetsPlugin = {
  name: 'copy-assets',
  setup(build) {
    build.onEnd(() => {
      fs.mkdirSync('dist', { recursive: true })
      fs.copyFileSync('manifest.json', 'dist/manifest.json')
      fs.copyFileSync('styles.css', 'dist/styles.css')
    })
  },
}

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
  ],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  minify: prod,
  outfile: 'dist/main.js',
  plugins: [inlineWorkerPlugin, copyAssetsPlugin],
})

if (prod) {
  await context.rebuild()
  process.exit(0)
} else {
  await context.watch()
}
