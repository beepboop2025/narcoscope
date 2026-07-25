#!/usr/bin/env node
/**
 * Statistics Canada wastewater drug-metabolite loads -> src/data/wastewater.json
 *
 * WHY CANADA, WHEN THE QUESTION WAS EUROPE
 * ----------------------------------------
 * Wastewater is the only modality in `src/lib/triangulate.ts` that measures
 * CONSUMPTION directly: it is blind to enforcement effort, blind to reporting
 * willingness, and blind to who dies. Without it, divergence detection leans on
 * mortality alone, which only exists at this grain for the United States.
 *
 * The two famous programmes are unusable as automated sources. EUDA/SCORE
 * returns HTTP 403 to non-browser clients on both its current and legacy data
 * URLs (re-verified 2026-07-26, including the copy linked from data.europa.eu),
 * and ACIC publishes the Australian NWDMP as PDF reports only.
 *
 * Statistics Canada publishes the same measurement, at the same grain, in the
 * same unit, through a keyless REST API under an open licence. It reports
 * "Load per capita (milligrams per one thousand people per day)" — literally
 * the SCORE standard unit that `WastewaterRecord.mgPer1000PerDay` was declared
 * in. So the modality gets switched on with real figures, and Canada becomes
 * the second country where a full cross-modality read is possible.
 *
 * SOURCE
 *   Statistics Canada tables 13-10-0820-01 (2019-2020) and 13-10-0871-01
 *   (2022-2023), "Drug metabolites in wastewater in select Canadian cities,
 *   by month". Statistics Canada Open Licence: reproduction and distribution
 *   permitted with attribution.
 *   https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1310087101
 *
 * EXTRACTION RULES (conservative, matching the other converters)
 *   - Characteristics = the point estimate only. The confidence-interval,
 *     standard-error and imputation-rate rows are separate `Characteristics`
 *     values in the same file and are NOT loads; including them would trible-
 *     count every city-month.
 *   - Geography excludes "Weighted average, cities measured". It is an
 *     aggregate over the same cities, and triangulate.ts already takes its own
 *     mean across sites — keeping it would weight the national average twice.
 *   - Monthly loads are averaged to an annual mean per city. Averaging (not
 *     summing) is what makes a partial year comparable: these are already
 *     per-day rates, so the mean of ten months and the mean of twelve are the
 *     same kind of quantity. `monthsObserved` is recorded per record anyway so
 *     a consumer can see the coverage rather than assume it.
 *   - Metabolite -> drug mapping is deliberately narrow; see METABOLITE_MAP.
 *
 * Usage:  node scripts/convert/statcan-wastewater-to-json.mjs [--out <path>] [--offline]
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW_DIR = path.join(ROOT, 'data-raw')
const SOURCE_NAME = 'Statistics Canada — Drug metabolites in wastewater in select Canadian cities'
const LICENCE = 'Statistics Canada Open Licence — reproduction and distribution permitted with attribution'

/** StatCan product ids, oldest first. Both are needed to span the triangulation window. */
const TABLES = [
  { productId: '13100820', label: '13-10-0820-01 (2019-2020)' },
  { productId: '13100871', label: '13-10-0871-01 (2022-2023)' },
]

const tableUrl = (id) => `https://www150.statcan.gc.ca/n1/tbl/csv/${id}-eng.zip`
const tablePage = (id) =>
  `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${id.slice(0, 2)}${id.slice(2)}01`

/**
 * The Characteristics values that are an actual load rather than a dispersion
 * measure. The two source tables label the same quantity differently, and the
 * two units are DIMENSIONALLY IDENTICAL, so no conversion is applied:
 *
 *   grams per one million people per day = 10^3 mg / 10^6 people / day
 *   milligrams per one thousand people per day = 1 mg / 10^3 people / day
 *
 * both reduce to 10^-3 mg per person per day. Sanity-checked against the data:
 * benzoylecgonine averages 885 in 2019 (old label) and cocaine 1,136 in 2022
 * (new label) — same order of magnitude, as an unchanged scale requires.
 * Everything else under `Characteristics` is a confidence bound, standard
 * error, imputation rate or detection rate; including any of them would
 * multiply-count every city-month.
 */
const LOAD_CHARACTERISTICS = new Set([
  'Load per capita (milligrams per one thousand people per day)',
  'Load per capita (grams per one million people per day)',
])

/** Aggregate geography row, excluded — see header. */
const WEIGHTED_AVERAGE_GEO = 'Weighted average, cities measured'

/**
 * StatCan metabolite -> NarcoScope `Drug`. Covers BOTH tables' vocabularies:
 * the 2019-2020 release names measures differently from the 2022-2023 one, and
 * a map written against only the newer table silently yields zero records for
 * the older — which is exactly what the first version of this converter did.
 *
 * Deliberately narrow, and the exclusions matter more than the inclusions
 * because each is a case where a looser mapping would manufacture a signal:
 *
 *   Cocaine (parent)  NOT used, even though the 2019-2020 table reports it
 *                     alongside the metabolite. Parent cocaine in wastewater
 *                     can arrive by direct disposal of unused product, which
 *                     is not consumption. Benzoylecgonine is the human
 *                     metabolite and the SCORE-standard consumption marker, so
 *                     it is used for both tables and the series stays
 *                     comparable across the vocabulary change.
 *   Heroin (parent)   NOT used for the same reason — and heroin hydrolyses too
 *                     fast in sewage to be a meaningful measurement anyway.
 *                     6-MAM is the heroin-specific marker and is what maps.
 *   Amphetamine       NOT mapped to methamphetamine. StatCan measures the two
 *                     separately and they are different drugs; folding one in
 *                     would inflate the meth series.
 *   Morphine          NOT mapped to heroin. Morphine in wastewater comes from
 *                     heroin, from prescribed morphine, and from codeine
 *                     metabolism, and nothing in the data separates them.
 *   Fentanyl          No `Drug` id exists for it, and it is not folded into
 *                     heroin: the mortality layer keeps synthetic opioids
 *                     separate precisely because the two are not substitutes.
 *
 * Note that 6-MAM appears ONLY in the 2019-2020 table, so heroin has no 2022+
 * reading. That asymmetry is left in the data rather than papered over —
 * triangulate.ts reports a modality with no reading for both comparison years
 * as absent, which is the correct answer.
 */
const METABOLITE_MAP = {
  // 2022-2023 vocabulary
  'Cocaine (Benzoylecgonine)': 'cocaine',
  'Cannabis (THC-COOH)': 'cannabis',
  // 2019-2020 vocabulary
  'Benzoylecgonine': 'cocaine',
  'THC-COOH (Cannabis metabolite)': 'cannabis',
  '6-monoacetylmorphine (6-MAM)': 'heroin',
  // identical in both
  'Methamphetamine': 'methamphetamine',
}

const args = process.argv.slice(2)
const offline = args.includes('--offline')
const outFlag = args.indexOf('--out')
const OUT_PATH = path.resolve(
  ROOT,
  outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'src/data/wastewater.json',
)

/** Minimal RFC-4180 line splitter — StatCan quotes every field. */
function splitLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1 } else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((f) => f.trim())
}

async function loadTable(productId) {
  const zipPath = path.join(RAW_DIR, `statcan-${productId}.zip`)
  if (!offline) {
    const res = await fetch(tableUrl(productId))
    if (!res.ok) throw new Error(`StatCan fetch failed (${res.status}) for ${productId}`)
    fs.mkdirSync(RAW_DIR, { recursive: true })
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
  }
  if (!fs.existsSync(zipPath)) throw new Error(`--offline but ${zipPath} is missing`)

  // StatCan ships a zip. Unpacked to a temp dir with the system unzip rather
  // than adding an archive dependency for two files.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `statcan-${productId}-`))
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp])
    const csvPath = path.join(tmp, `${productId}.csv`)
    if (!fs.existsSync(csvPath)) throw new Error(`${productId}.csv not found inside the archive`)
    return fs.readFileSync(csvPath, 'utf8')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function parseTable(csv, productId, accumulator, stats) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  // Strip the UTF-8 BOM StatCan prefixes to the header row.
  const headers = splitLine(lines[0].replace(/^﻿/, '')).map((h) => h.replace(/^"|"$/g, ''))
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]))
  for (const required of ['REF_DATE', 'GEO', 'Measure', 'Characteristics', 'VALUE']) {
    if (!(required in idx)) throw new Error(`${productId}: expected column ${required} is missing`)
  }

  for (const line of lines.slice(1)) {
    const row = splitLine(line)
    const characteristic = row[idx.Characteristics]
    if (!LOAD_CHARACTERISTICS.has(characteristic)) continue

    const geo = row[idx.GEO]
    if (geo === WEIGHTED_AVERAGE_GEO) { stats.skippedAggregate += 1; continue }

    const drug = METABOLITE_MAP[row[idx.Measure]]
    if (!drug) { stats.skippedMetabolite += 1; continue }

    const refDate = row[idx.REF_DATE]
    const year = Number(refDate.slice(0, 4))
    if (!Number.isFinite(year)) continue

    const value = Number(row[idx.VALUE])
    if (!Number.isFinite(value)) { stats.suppressed += 1; continue }

    // City name only; StatCan writes "Vancouver, British Columbia".
    const site = geo.split(',')[0].trim()
    const key = `${site}|${year}|${drug}`
    const entry = accumulator.get(key) ?? { site, year, drug, total: 0, months: 0, productIds: new Set() }
    entry.total += value
    entry.months += 1
    entry.productIds.add(productId)
    accumulator.set(key, entry)
  }
}

async function main() {
  const accumulator = new Map()
  const stats = { skippedAggregate: 0, skippedMetabolite: 0, suppressed: 0 }

  for (const table of TABLES) {
    console.log(`· fetching StatCan ${table.label} …`)
    const csv = await loadTable(table.productId)
    parseTable(csv, table.productId, accumulator, stats)
  }

  const records = [...accumulator.values()]
    .map((e) => ({
      site: e.site,
      country: 'Canada',
      iso3: 'CAN',
      year: e.year,
      drug: e.drug,
      // Mean of the monthly per-day loads — see header on why mean, not sum.
      // Rounded to significant figures, NOT decimal places: the 6-MAM (heroin)
      // series runs in the hundredths, and fixed 2-dp rounding collapsed a real
      // Halifax 2020 measurement to exactly 0.00 — which then reads downstream
      // as "no consumption" rather than "very little". Significant-figure
      // rounding preserves small magnitudes and large ones alike.
      mgPer1000PerDay: Number((e.total / e.months).toPrecision(6)),
      monthsObserved: e.months,
      sourceName: SOURCE_NAME,
      sourceUrl: tablePage([...e.productIds].sort()[0]),
    }))
    .sort((a, b) => a.year - b.year || a.drug.localeCompare(b.drug) || a.site.localeCompare(b.site))

  const years = [...new Set(records.map((r) => r.year))].sort((a, b) => a - b)
  const sites = [...new Set(records.map((r) => r.site))].sort()
  const coverage = {}
  for (const year of years) {
    const forYear = records.filter((r) => r.year === year)
    coverage[year] = {
      records: forYear.length,
      monthsObserved: Math.max(...forYear.map((r) => r.monthsObserved)),
    }
  }

  const out = {
    meta: {
      source: SOURCE_NAME,
      url: tablePage('13100871'),
      tables: TABLES.map((t) => ({ productId: t.productId, label: t.label, url: tableUrl(t.productId) })),
      downloaded: new Date().toISOString().slice(0, 10),
      license: LICENCE,
      unit: 'mg per 1,000 inhabitants per day (SCORE standard)',
      grain: 'city + year + drug, annual mean of monthly per-capita loads',
      years,
      sites,
      drugs: [...new Set(records.map((r) => r.drug))].sort(),
      coverage,
      note:
        'Annual means of monthly per-day loads. Month coverage varies by year and is ' +
        'recorded per record as monthsObserved: 2019 and 2020 start and end mid-series, ' +
        'and 2023 is sampled bi-monthly by design (Jan/Mar/May/Jul/Sep/Nov), not truncated. ' +
        'Averaging rather than summing keeps uneven coverage comparable, since the ' +
        'underlying figure is already a per-day rate. The two source tables use different ' +
        'measure names and different unit LABELS for the same quantity — grams per million ' +
        'people per day and milligrams per thousand people per day are dimensionally ' +
        'identical, so no conversion is applied. Cocaine uses benzoylecgonine (the human ' +
        'metabolite), never parent cocaine, which can enter sewage by direct disposal. ' +
        'Heroin uses 6-MAM and therefore exists only for 2019-2020; morphine is not used ' +
        'as a heroin proxy because it cannot be separated from prescribed morphine or ' +
        'codeine metabolism. Amphetamine is reported separately from methamphetamine and ' +
        'is not folded into it.',
    },
    records,
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out)}\n`)

  console.log(`✔ wrote ${records.length} records -> ${path.relative(ROOT, OUT_PATH)}`)
  console.log(`  years ${years.join(', ')} | ${sites.length} cities | drugs: ${out.meta.drugs.join(', ')}`)
  for (const [year, c] of Object.entries(coverage)) {
    console.log(`    ${year}: ${c.records} records, up to ${c.monthsObserved} months observed`)
  }
  console.log(`  skipped: ${stats.skippedAggregate} weighted-average rows, ${stats.skippedMetabolite} unmapped metabolites, ${stats.suppressed} suppressed values`)
  console.log(`  file size: ${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} kB`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
