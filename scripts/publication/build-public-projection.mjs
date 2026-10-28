#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectMarketDataset, projectBridge, serializePublicData } from '../../lib/publication-rights.mjs'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export async function projectPublicDirectory(directory) {
  const data = join(directory, 'data')
  for (const filename of ['global-drugs-v1.json', 'global-arms-economy-v1.json', 'narcoscope-palimpsest-v1.json', 'narcoscope-palimpsest-corridors-v2.json']) {
    const path = join(data, filename)
    const input = JSON.parse(await readFile(path, 'utf8'))
    const output = filename.startsWith('global-') ? projectMarketDataset(input) : projectBridge(input)
    await writeFile(path, serializePublicData(output))
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await projectPublicDirectory(resolve(root, process.argv[2] ?? 'dist'))
  console.log('Public static data projected through publication policy')
}
