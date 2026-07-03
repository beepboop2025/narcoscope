#!/usr/bin/env node
/**
 * Open-data pipeline orchestrator: fetch -> transform -> validate.
 *
 * Downloads every source marked "automation": "auto" in sources.json into
 * data-raw/ (gitignored), runs the registered transforms to regenerate the
 * bundled datasets, then runs the test suite as the validation gate (the
 * suite contains dataset-integrity tests, so bad data fails the pipeline).
 *
 * Usage:
 *   node scripts/pipeline/run.mjs            # fetch + transform + validate
 *   node scripts/pipeline/run.mjs --offline  # skip downloads, reuse data-raw/
 *
 * Sources marked "manual" or "api-key" in sources.json are listed at the end
 * with their integration notes — see docs/DATA_PIPELINE.md.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const offline = process.argv.includes('--offline')

const { sources } = JSON.parse(fs.readFileSync('scripts/pipeline/sources.json', 'utf8'))
const rawDir = 'data-raw'
fs.mkdirSync(rawDir, { recursive: true })

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) { console.error(`FAILED: ${cmd} ${args.join(' ')}`); process.exit(r.status ?? 1) }
}

// xlsx is an optional dependency by design (upstream advisories) — install
// it ephemerally for the pipeline run if it isn't present.
try {
  await import('xlsx')
} catch {
  console.log('· installing optional xlsx parser (--no-save)…')
  run('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'xlsx'])
}

const rawPath = (src) => path.join(rawDir, path.basename(new URL(src.url).pathname))

// ---- fetch -------------------------------------------------------------------
const auto = sources.filter((s) => s.automation === 'auto' && s.format === 'xlsx')
if (!offline) {
  for (const src of auto) {
    console.log(`· fetching ${src.id} …`)
    const res = await fetch(src.url)
    if (!res.ok) { console.error(`  download failed (${res.status}): ${src.url}`); process.exit(1) }
    fs.writeFileSync(rawPath(src), Buffer.from(await res.arrayBuffer()))
    console.log(`  saved ${rawPath(src)} (${(fs.statSync(rawPath(src)).size / 1024).toFixed(0)} kB)`)
  }
} else {
  console.log('· offline mode: reusing data-raw/')
}

// ---- transform -----------------------------------------------------------------
const bySourceId = Object.fromEntries(sources.map((s) => [s.id, s]))

console.log('· regenerating street prices (+ live World Bank GDP fetch) …')
run('node', ['scripts/convert/wdr-prices-to-ts.mjs', rawPath(bySourceId['wdr-prices'])])

console.log('· regenerating seizures dataset …')
run('node', ['scripts/convert/wdr-seizures-to-json.mjs', rawPath(bySourceId['wdr-seizures'])])

console.log('· regenerating country geo (centroids + feature ids) …')
run('node', ['scripts/convert/gen-country-geo.mjs'])

// ---- validate --------------------------------------------------------------------
console.log('· validating (typecheck + full test suite incl. dataset-integrity tests) …')
run('npx', ['tsc', '--noEmit'])
run('npx', ['vitest', 'run'])

// ---- report ------------------------------------------------------------------------
console.log('\n✔ pipeline complete. Changed files:')
const diff = spawnSync('git', ['status', '--porcelain', '--', 'src/data'], { encoding: 'utf8' }).stdout.trim()
console.log(diff || '  (no data changes — sources unchanged since last run)')

const pending = sources.filter((s) => s.automation !== 'auto')
console.log('\nSources needing a key or a manual step (see docs/DATA_PIPELINE.md):')
for (const s of pending) console.log(`  [${s.automation}] ${s.id} — ${s.feeds}`)
