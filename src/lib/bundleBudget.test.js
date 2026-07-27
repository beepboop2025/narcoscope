import { describe, it, assert } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards the entry-bundle quarantine described in src/data/bundled.ts.
 *
 * The CDC mortality and OFAC designation extracts are ~450 kB each. If anything
 * in the EAGER module graph (App.tsx -> dataStore.ts -> ...) imports them, the
 * bundler pulls both into the entry chunk and every visitor downloads a
 * megabyte of JSON to read the street-prices tab. That regression is invisible
 * in review and silent at runtime, so it is asserted here instead.
 */

const SRC = path.resolve(import.meta.dirname, '..')
// wastewater.json is only ~26 kB, but it is listed here on purpose: the guard
// is about which module OWNS the dataset imports, not about byte count. Letting
// the small one leak into the eager graph is the precedent the next big one
// follows.
const HEAVY_JSON = ['overdose.json', 'designations.json', 'wastewater.json']

/** Modules reachable from App.tsx without crossing a React.lazy boundary. */
const EAGER_MODULES = [
  'App.tsx',
  'main.tsx',
  'lib/dataStore.ts',
  'lib/ingest.ts',
  'lib/seizures.ts',
  'components/DataLoader.tsx',
  'components/Explorer.tsx',
  'components/Flows.tsx',
]

describe('entry-bundle budget', () => {
  it.each(EAGER_MODULES)('%s does not import a heavy JSON dataset', (rel) => {
    const file = path.join(SRC, rel)
    if (!fs.existsSync(file)) return
    const source = fs.readFileSync(file, 'utf8')
    for (const asset of HEAVY_JSON) {
      assert.notInclude(
        source,
        asset,
        `${rel} imports ${asset}, which drags it into the entry chunk. ` +
        'Import it from src/data/bundled.ts inside a lazy-loaded component instead.',
      )
    }
  })

  it('routes heavy datasets through the quarantine module only', () => {
    const bundled = fs.readFileSync(path.join(SRC, 'data/bundled.ts'), 'utf8')
    for (const asset of HEAVY_JSON) {
      assert.include(bundled, asset, `src/data/bundled.ts should own the ${asset} import`)
    }
  })

  it('keeps the store defaults empty so the quarantine cannot be bypassed', () => {
    // If these defaulted to the bundled arrays, dataStore would need the import
    // and the whole arrangement would collapse.
    const store = fs.readFileSync(path.join(SRC, 'lib/dataStore.ts'), 'utf8')
    assert.match(store, /overdoseRecords: \[\]/)
    assert.match(store, /designationRecords: \[\]/)
  })

  it('only imports the quarantine module from lazily-loaded components', () => {
    // Triangulation and Designations are both React.lazy() in App.tsx.
    const importers = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.includes('.test.')) continue
        const source = fs.readFileSync(full, 'utf8')
        if (/from '.*data\/bundled'/.test(source)) importers.push(path.relative(SRC, full))
      }
    }
    walk(SRC)
    const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8')
    for (const importer of importers) {
      const componentName = path.basename(importer).replace(/\.(ts|tsx)$/, '')
      assert.match(
        app,
        new RegExp(`lazy\\(\\(\\) => import\\('\\./components/${componentName}'\\)\\)`),
        `${importer} imports the heavy datasets but is not lazily loaded in App.tsx`,
      )
    }
  })
})

describe('CSV loader completeness', () => {
  it('exposes a picker for every dataset loadData() can ingest', () => {
    // The Triangulation tab instructs users to "load a CSV export to enable this
    // modality". That is only true if DataLoader actually offers a picker, and
    // for three datasets it did not — the parsers were wired into the store but
    // unreachable from the UI, which made both the parsers and the instruction
    // dead.
    const types = fs.readFileSync(path.join(SRC, 'types.ts'), 'utf8')
    const loadable = fs.readFileSync(path.join(SRC, 'data/loadableDatasets.ts'), 'utf8')
    const store = fs.readFileSync(path.join(SRC, 'lib/dataStore.ts'), 'utf8')

    const bundleBlock = types.slice(
      types.indexOf('export interface LoadBundle'),
      types.indexOf('export interface LoadReport'),
    )
    const keys = [...bundleBlock.matchAll(/^ {2}(\w+)\?:/gm)].map((m) => m[1])
    assert.isAbove(keys.length, 5, 'failed to parse LoadBundle keys')

    for (const key of keys) {
      // Every ingestible dataset must be offered by the shared picker list
      // (loadableDatasets.ts, which DataLoader renders verbatim) AND applied by
      // loadData(). This is the drift that once left 3 parsers unreachable.
      assert.include(
        loadable,
        `key: '${key}'`,
        `LoadBundle.${key} has no picker in loadableDatasets.ts — the parser is unreachable`,
      )
      assert.include(
        store,
        `bundle.${key}`,
        `LoadBundle.${key} is never applied in loadData()`,
      )
    }
  })
})
