#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { projectMarketDataset, projectBridge, serializePublicData } from '../../lib/publication-rights.mjs'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const directory = resolve(root, process.argv[2] ?? 'dist')
for (const name of ['global-drugs-v1.json', 'global-arms-economy-v1.json', 'narcoscope-palimpsest-v1.json', 'narcoscope-palimpsest-corridors-v2.json']) {
  const original = JSON.parse(await readFile(join(root, 'public/data', name), 'utf8'))
  const expected = serializePublicData(name.startsWith('global-') ? projectMarketDataset(original) : projectBridge(original))
  assert.equal(await readFile(join(directory, 'data', name), 'utf8'), expected, 'Unprojected or stale public JSON: ' + name)
}
const names = []
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) await walk(file)
    else if (/\.(?:js|html|css)$/.test(entry.name)) names.push(file)
  }
}
await walk(directory)
const rawSeizures = JSON.parse(await readFile(join(root, 'src/data/seizures.json'), 'utf8'))
const rowSentinel = JSON.stringify(rawSeizures.records.slice(0, 4)).slice(1, -1)
const forbidden = [/(?:["']?priceUsdPerGram["']?)\s*:\s*\d/, /(?:["']?worldSeizureTonnes["']?)\s*:\s*\d/, /(?:["']?seizureCountries["']?)\s*:\s*\d/]
for (const file of names) {
  const text = await readFile(file, 'utf8')
  assert.ok(!text.includes(rowSentinel), 'Retained WDR seizure rows in built asset: ' + file)
  for (const pattern of forbidden) assert.ok(!pattern.test(text), 'WDR measurement/derivative in built asset: ' + file)
}
console.log(JSON.stringify({ status: 'verified', projectedJson: 4, checkedAssets: names.length, originalSourceRetained: true }))
