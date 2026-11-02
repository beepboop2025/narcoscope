#!/usr/bin/env node
/**
 * Convert UNODC World Drug Report 2025 Statistical Annex 7.1
 * ("Drug seizures 2019-2023", sheet "Seizures") into the compact JSON bundled
 * at src/data/seizures.json for the interactive globe.
 *
 * Source file (download first):
 *   https://www.unodc.org/documents/data-and-analysis/WDR_2025/Annex/7.1_Drug_seizures_2019-2023.xlsx
 *
 * Usage:
 *   npm install --no-save xlsx   # optional dep, not shipped (see from-spreadsheet.mjs)
 *   node scripts/convert/wdr-seizures-to-json.mjs <path-to-7.1.xlsx>
 *
 * Rules (conservative, mirror the prices extraction):
 *   - Rows with a non-numeric Kilograms value are dropped (they carry no
 *     usable quantity) and counted in the summary.
 *   - Everything else is kept verbatim at (country, drug name, year) grain —
 *     no aggregation, no unit conversion (the sheet is kilograms throughout).
 *   - Output is a compact columnar encoding to keep the lazy-loaded map chunk
 *     small: string tables for groups/drugs/countries + integer-indexed rows.
 */

import fs from 'node:fs'
import path from 'node:path'
import { originalPath, writeWithheld } from '../../lib/withheld-originals.mjs'

const xlsxPath = process.argv[2]
if (!xlsxPath) {
  console.error('Usage: node wdr-seizures-to-json.mjs <path-to-7.1_Drug_seizures.xlsx>')
  process.exit(1)
}

let xlsx
try {
  xlsx = (await import('xlsx')).default
} catch {
  console.error('The optional "xlsx" package is required: npm install --no-save xlsx')
  process.exit(1)
}

const wb = xlsx.readFile(xlsxPath)
const rows = xlsx.utils.sheet_to_json(wb.Sheets['Seizures'], { header: 1, defval: '' }).slice(2)

const groups = []
const groupIdx = new Map()
const drugs = [] // [name, groupIndex]
const drugIdx = new Map()
const countries = [] // [iso3, name, region]
const countryIdx = new Map()
const records = [] // [countryIndex, drugIndex, year, kg]
let dropped = 0

for (const r of rows) {
  const [region, , country, group, , drugName, year, kg, iso3] = r
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg < 0) { dropped++; continue }
  if (!iso3 || !country || !drugName || !group) { dropped++; continue }

  if (!groupIdx.has(group)) { groupIdx.set(group, groups.length); groups.push(group) }
  const dKey = `${drugName}|${group}`
  if (!drugIdx.has(dKey)) { drugIdx.set(dKey, drugs.length); drugs.push([drugName, groupIdx.get(group)]) }
  if (!countryIdx.has(iso3)) { countryIdx.set(iso3, countries.length); countries.push([iso3, country, region]) }

  records.push([countryIdx.get(iso3), drugIdx.get(dKey), year, Math.round(kg * 100) / 100])
}

const out = {
  meta: {
    source: 'UNODC World Drug Report 2025 — Statistical Annex 7.1: Drug seizures 2019-2023 (kilograms)',
    url: 'https://www.unodc.org/documents/data-and-analysis/WDR_2025/Annex/7.1_Drug_seizures_2019-2023.xlsx',
    downloaded: '2026-07-03',
    unit: 'kg',
    years: [...new Set(records.map((r) => r[2]))].sort(),
  },
  groups,
  drugs,
  countries,
  records,
}

// WDR seizures are withheld from public surfaces; only the projection is tracked.
writeWithheld(process.cwd(), 'src/data/seizures.json', JSON.stringify(out))
const outPath = originalPath(process.cwd(), 'src/data/seizures.json')
console.log(`groups: ${groups.length}, drugs: ${drugs.length}, countries: ${countries.length}, records: ${records.length}, dropped: ${dropped}`)
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} kB)`)
