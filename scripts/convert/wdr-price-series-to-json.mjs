#!/usr/bin/env node
/**
 * UNODC WDR Annex 8.3 long-run price series -> src/data/priceSeries.json
 *
 * The Street Prices tab shows a dense but SHORT window (2019-2023). This is the
 * other half: retail heroin and cocaine street prices for Western/Central
 * European countries and the United States, per year, back to 1990 — a ~34-year
 * arc that shows the long collapse in heroin prices and the flatter cocaine
 * line that a five-year snapshot cannot.
 *
 * SHAPE: four sheets (Heroin/Cocaine × WesternEurope/US), each a country × year
 * matrix in US$/gram (retail). This flattens them to one record per
 * (drug, region, country, year, price).
 *
 * GRAIN GUARD (same as the rest of the app): country + year + annual figure, in
 * nominal USD as UNODC reports it. No sub-annual, no adjustment applied.
 *
 * Usage: node scripts/convert/wdr-price-series-to-json.mjs [path-to-xlsx]
 *   (defaults to the file in data-raw/)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

const SRC = process.argv[2]
  || path.join(ROOT, 'data-raw/8.3_Price_time_series_in_Western_Europe_and_United_States.xlsx')
const OUT = path.join(ROOT, 'src/data/priceSeries.json')

// xlsx is an optional dependency by design (upstream advisories); the pipeline
// installs it ephemerally. Fail with a clear hint if it is missing.
let XLSX
try {
  XLSX = require('xlsx')
} catch {
  console.error('xlsx not installed. Run: npm install --no-save xlsx  (the pipeline does this automatically)')
  process.exit(1)
}

if (!fs.existsSync(SRC)) {
  console.error(`ERROR: source not found at ${SRC}. Fetch WDR Annex 8.3 first (see sources.json).`)
  process.exit(1)
}

const SHEET_META = {
  Heroin_WesternEurope: { drug: 'heroin', region: 'Western Europe' },
  Cocaine_WesternEurope: { drug: 'cocaine', region: 'Western Europe' },
  Heroin_US: { drug: 'heroin', region: 'United States' },
  Cocaine_US: { drug: 'cocaine', region: 'United States' },
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

const wb = XLSX.readFile(SRC)
const records = []
const countries = new Set()
let minYear = Infinity
let maxYear = -Infinity

/** The year header is the first row containing plain 4-digit years 1990-2100. */
function yearsOf(rows) {
  const yearRow = rows.find((r) => r?.some((c) => typeof c === 'number' && c >= 1990 && c <= 2100))
  return yearRow ? yearRow.map((c) => (typeof c === 'number' && c >= 1990 && c <= 2100 ? c : null)) : null
}

/** Rows that mark the end of the FIRST (retail) table — averages, the wholesale
 *  table, and footnotes all start with one of these. */
const STOP = /average|weighted|source|wholesale|inflation|adjusted/i

function pushRow(meta, country, row, years) {
  let any = false
  for (let c = 1; c < row.length; c += 1) {
    const year = years[c]
    if (year == null) continue
    const price = num(row[c])
    if (price == null) continue
    any = true
    records.push({ drug: meta.drug, region: meta.region, country, year, priceUsdPerGram: price })
    if (year < minYear) minYear = year
    if (year > maxYear) maxYear = year
  }
  if (any) countries.add(`${meta.region}:${country}`)
}

for (const [sheetName, meta] of Object.entries(SHEET_META)) {
  const ws = wb.Sheets[sheetName]
  if (!ws) { console.warn(`  (sheet ${sheetName} not found — skipped)`); continue }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })
  const years = yearsOf(rows)
  if (!years) { console.warn(`  (no year header in ${sheetName} — skipped)`); continue }

  if (meta.region === 'United States') {
    // Single nominal series: the row starting "Average, in US$" (NOT the
    // inflation- or purity-adjusted variants below it, which STOP would catch).
    const priceRow = rows.find((r) => /^average,\s*in us\$/i.test(String(r?.[0] ?? '').trim()))
    if (priceRow) pushRow(meta, 'United States', priceRow, years)
    continue
  }

  // Western Europe: the first (retail $/gram) table only. Start after the
  // "Country/Territory" header, stop at the first average/wholesale marker so
  // the wholesale $/kg table below is never read.
  const headerIdx = rows.findIndex((r) => String(r?.[0] ?? '').toLowerCase().includes('country'))
  if (headerIdx === -1) { console.warn(`  (no country header in ${sheetName} — skipped)`); continue }
  for (const row of rows.slice(headerIdx + 1)) {
    const country = String(row?.[0] ?? '').trim()
    if (!country) continue
    if (STOP.test(country)) break // reached the averages / wholesale table
    pushRow(meta, country, row, years)
  }
}

records.sort((a, b) =>
  a.drug.localeCompare(b.drug) || a.country.localeCompare(b.country) || a.year - b.year)

const out = {
  meta: {
    source: 'UNODC World Drug Report — Annex 8.3, retail price time series (Western/Central Europe & United States)',
    url: 'https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report-2025.html',
    downloaded: new Date().toISOString().slice(0, 10),
    unit: 'USD per gram, retail (street), nominal',
    grain: 'country + year',
    drugs: ['heroin', 'cocaine'],
    regions: ['Western Europe', 'United States'],
    yearRange: [minYear, maxYear],
    countries: [...new Set(records.map((r) => r.country))].sort(),
    note: 'Long-run retail street prices; nominal USD as reported, not inflation-adjusted. Gaps are years a country did not report.',
  },
  records,
}
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`✔ wrote priceSeries.json — ${records.length} records, ${out.meta.countries.length} countries, ${minYear}–${maxYear}`)
console.log(`  ${(fs.statSync(OUT).size / 1024).toFixed(1)} kB`)
