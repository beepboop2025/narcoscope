#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { getMarketCatalog } from '../../lib/global-markets.mjs'

const target = fileURLToPath(new URL('../../public/data/global-market-catalog-v1.json', import.meta.url))
const catalog = await getMarketCatalog()
if (catalog.status !== 'available') throw new Error(`Cannot publish incomplete market catalog: missing ${catalog.unavailableDatasets.join(', ')}`)
const content = `${JSON.stringify(catalog, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== content) throw new Error('Global market catalog differs from its source datasets; rebuild it')
} else {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, target)
}
console.log(JSON.stringify({ status: 'verified', datasets: catalog.datasets.map(dataset => ({ id: dataset.id, sha256: dataset.sha256, ...dataset.coverage })) }))
