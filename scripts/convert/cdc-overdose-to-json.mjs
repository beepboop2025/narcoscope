#!/usr/bin/env node
/**
 * CDC VSRR Provisional Drug Overdose Death Counts -> src/data/overdose.json
 *
 * WHY THIS DATASET EXISTS IN NARCOSCOPE
 * ------------------------------------
 * Every other bundled dataset here is SUPPLY-side (seizures, precursor
 * corridors, cultivation). Seizure volume is a proxy that moves with
 * enforcement capacity at least as much as with trafficking volume — a
 * doubled seizure figure can mean twice the drugs or twice the customs
 * officers, and nothing inside the seizure data can tell those apart.
 * Overdose mortality is an INDEPENDENT modality: it is measured by coroners
 * and vital-statistics registrars, not by interdiction agencies, so it does
 * not inherit enforcement-capacity bias. Reading the two together is what
 * `src/lib/triangulate.ts` does.
 *
 * SOURCE
 *   NCHS/CDC "VSRR Provisional Drug Overdose Death Counts", Socrata dataset
 *   xkb8-kh2a on data.cdc.gov. Public, keyless, refreshed monthly.
 *   https://data.cdc.gov/NCHS/VSRR-Provisional-Drug-Overdose-Death-Counts/xkb8-kh2a
 *
 * GRAIN (deliberate guardrail, matching the rest of the app)
 *   Jurisdiction (US national / state) + year + substance class + an annual
 *   12-month-ending count. NEVER county, city, ZIP, or individual-level. The
 *   source publishes nothing finer than state, and this converter must never
 *   be extended to join it against finer geography.
 *
 * EXTRACTION RULES (conservative, mirroring wdr-prices-to-ts.mjs)
 *   - period = "12 month-ending" only. CDC's rolling-12 window is the
 *     comparable series; monthly counts are noisy and seasonal.
 *   - month = December gives the calendar-year-aligned snapshot, so a record's
 *     `year` means the same thing it means in prices.ts and seizures.json.
 *     The single most recent partial-year window is also kept, flagged
 *     `partialYear: true`, so the app can show the freshest reading without
 *     silently comparing 8 months against 12.
 *   - Rows CDC suppresses (no data_value: low count or failed data-quality
 *     review) are dropped and COUNTED, never zero-filled. A suppressed cell
 *     is missing evidence, not evidence of zero.
 *   - `predictedValue` (CDC's completeness-adjusted estimate) is carried
 *     through separately rather than substituted for the reported count.
 *
 * Usage:  node scripts/convert/cdc-overdose-to-json.mjs [--out <path>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATASET_URL = 'https://data.cdc.gov/resource/xkb8-kh2a.json'
const LANDING_URL =
  'https://data.cdc.gov/NCHS/VSRR-Provisional-Drug-Overdose-Death-Counts/xkb8-kh2a'
const SOURCE_NAME = 'CDC NCHS VSRR Provisional Drug Overdose Death Counts'
const PAGE_SIZE = 50_000

/**
 * CDC ICD-10 indicator -> NarcoScope substance id.
 *
 * `psychostimulants` is deliberately NOT collapsed into "methamphetamine".
 * T43.6 covers psychostimulants with abuse potential as a class; meth
 * dominates it in the US but does not exhaust it, and silently relabelling a
 * class code as one drug would launder an assumption into the dataset. The
 * meth<->psychostimulant substitution is made once, explicitly and
 * reversibly, in triangulate.ts's DEMAND_PROXY map where it can be read and
 * argued with.
 */
const INDICATOR_MAP = {
  'Cocaine (T40.5)': 'cocaine',
  'Heroin (T40.1)': 'heroin',
  'Psychostimulants with abuse potential (T43.6)': 'psychostimulants',
  'Synthetic opioids, excl. methadone (T40.4)': 'synthetic_opioids',
  'Opioids (T40.0-T40.4,T40.6)': 'opioids_all',
  'Number of Drug Overdose Deaths': 'all_drugs',
}

const MONTH_INDEX = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
}

const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const OUT_PATH = path.resolve(
  ROOT,
  outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'src/data/overdose.json',
)

/** Socrata caps a page at 50k rows; page until short read. */
async function fetchAll(where) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url =
      `${DATASET_URL}?$where=${encodeURIComponent(where)}` +
      `&$limit=${PAGE_SIZE}&$offset=${offset}&$order=year,state,indicator`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`CDC fetch failed (${res.status}) for offset ${offset}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

const num = (v) => {
  if (v === undefined || v === null) return null
  // CDC ships counts as strings, occasionally with thousands separators.
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

async function main() {
  const indicatorList = Object.keys(INDICATOR_MAP)
    .map((i) => `'${i.replace(/'/g, "''")}'`)
    .join(',')
  const where = `period='12 month-ending' AND indicator in(${indicatorList})`

  console.log('· fetching CDC VSRR provisional overdose counts …')
  const raw = await fetchAll(where)
  console.log(`  ${raw.length.toLocaleString()} rows returned`)

  // The freshest 12-month-ending window present in the file. Everything else
  // is pinned to December so `year` stays calendar-aligned with prices.ts.
  let latestYear = 0
  let latestMonth = 0
  for (const row of raw) {
    const y = num(row.year)
    const m = MONTH_INDEX[row.month]
    if (y === null || !m) continue
    if (y > latestYear || (y === latestYear && m > latestMonth)) {
      latestYear = y
      latestMonth = m
    }
  }

  const records = []
  // Code -> display name, hoisted into meta rather than repeated on every
  // record (54 names vs. 3,000 copies of the same strings).
  const jurisdictionNames = new Map()
  let suppressed = 0
  let skippedWindow = 0

  for (const row of raw) {
    const substance = INDICATOR_MAP[row.indicator]
    const year = num(row.year)
    const month = MONTH_INDEX[row.month]
    if (!substance || year === null || !month) continue

    const isDecemberSnapshot = month === 12
    const isLatestWindow = year === latestYear && month === latestMonth
    if (!isDecemberSnapshot && !isLatestWindow) {
      skippedWindow += 1
      continue
    }

    const deaths = num(row.data_value)
    if (deaths === null) {
      // CDC suppressed this cell (low count / failed data-quality review).
      // Dropped, never zero-filled — see header.
      suppressed += 1
      continue
    }

    jurisdictionNames.set(row.state, row.state_name ?? row.state)

    const pctComplete = num(row.percent_complete)
    const predicted = num(row.predicted_value)
    records.push({
      jurisdiction: row.state,
      year,
      periodEndMonth: month,
      partialYear: !isDecemberSnapshot,
      substance,
      deaths,
      // Only carried when it actually differs from the reported count —
      // for complete periods CDC echoes `deaths` back, and storing 3,000
      // duplicate numbers in a bundled asset is pure weight.
      predictedDeaths: predicted !== null && predicted !== deaths ? predicted : null,
      // One decimal is well inside the precision this is ever read at (it
      // gates a completeness threshold, it is not itself an estimate).
      percentComplete: pctComplete === null ? null : Math.round(pctComplete * 10) / 10,
    })
  }

  records.sort(
    (a, b) =>
      a.year - b.year ||
      a.jurisdiction.localeCompare(b.jurisdiction) ||
      a.substance.localeCompare(b.substance),
  )

  const years = [...new Set(records.map((r) => r.year))].sort((a, b) => a - b)
  const jurisdictions = [...new Set(records.map((r) => r.jurisdiction))].sort()

  const out = {
    meta: {
      source: SOURCE_NAME,
      url: LANDING_URL,
      dataset: DATASET_URL,
      downloaded: new Date().toISOString().slice(0, 10),
      period: '12 month-ending',
      unit: 'deaths',
      grain: 'jurisdiction (US national / state) + year + substance class',
      latestWindow: `${latestYear}-${String(latestMonth).padStart(2, '0')}`,
      years,
      jurisdictions: jurisdictions.length,
      jurisdictionNames: Object.fromEntries(
        [...jurisdictionNames.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      substances: [...new Set(Object.values(INDICATOR_MAP))].sort(),
      note:
        'Provisional counts; later months are incomplete (see percentComplete). ' +
        'Suppressed cells are omitted, never zero-filled. Psychostimulants (T43.6) ' +
        'is a class code, not a synonym for methamphetamine.',
    },
    records,
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out)}\n`)

  console.log(`✔ wrote ${records.length.toLocaleString()} records -> ${path.relative(ROOT, OUT_PATH)}`)
  console.log(`  years ${years[0]}–${years[years.length - 1]}, ${jurisdictions.length} jurisdictions`)
  console.log(`  latest 12-month window: ${out.meta.latestWindow}`)
  console.log(`  ${suppressed.toLocaleString()} suppressed cells dropped, ${skippedWindow.toLocaleString()} non-snapshot months skipped`)
  console.log(`  file size: ${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} kB`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
