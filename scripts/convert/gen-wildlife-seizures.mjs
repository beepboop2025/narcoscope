#!/usr/bin/env node
/**
 * CITES confiscation records -> src/data/wildlifeSeizures.json
 *
 * WHAT THIS IS, PRECISELY
 * -----------------------
 * The CITES trade database records international trade in protected species.
 * Most of it is LEGAL permitted trade — but rows with Source = 'I' are
 * CONFISCATIONS / SEIZURES. Filtering to those gives a real wildlife-seizure
 * dataset, parallel to the drug seizures already in the app, and it lets the
 * wildlife dimension of the trafficking convergence stand on its own data
 * rather than only the OFAC designation angle.
 *
 * HONESTY GUARDRAILS (this is a PARTIAL view, and the framing must say so)
 *   - Only CITES-LISTED species appear (many trafficked species are not listed).
 *   - Only what parties REPORT to CITES appears (reporting is uneven).
 *   - So this is "CITES-reported confiscations of protected species", NOT a
 *     comprehensive wildlife-trafficking dataset. The UI says exactly that.
 *   - Aggregated by RECORD COUNT, never summed quantity: quantities mix kg,
 *     litres, live animals, skins and items, so a summed "quantity" would be
 *     meaningless. Record count is the standard comparable CITES proxy.
 *
 * NOT A COLLECTOR SOURCE: the CITES download is ~463 MB (4.5 GB unzipped, 59
 * shards) and the data is annual, so this is a ONE-TIME manual build, not part
 * of the 24/7 pipeline. Registered 'manual' in sources.json.
 *
 * Usage:
 *   1. Download https://trade.cites.org/cites_trade/download_db and unzip.
 *   2. node scripts/convert/gen-wildlife-seizures.mjs <dir-of-trade_db_*.csv>
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = process.argv[2]
if (!DIR || !fs.existsSync(DIR)) {
  console.error('usage: gen-wildlife-seizures.mjs <dir-with-trade_db_*.csv>')
  process.exit(1)
}
const OUT = path.join(ROOT, 'src/data/wildlifeSeizures.json')

const shards = fs.readdirSync(DIR).filter((f) => /^trade_db_\d+\.csv$/.test(f)).sort()
if (!shards.length) { console.error(`no trade_db_*.csv in ${DIR}`); process.exit(1) }

// Minimal CSV line splitter for CITES' quoted format (no embedded newlines).
function split(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i += 1 } else q = !q }
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const inc = (m, k) => { if (k) m.set(k, (m.get(k) ?? 0) + 1) }

const byClass = new Map()
const byYear = new Map()
const byTaxon = new Map()
const taxonClass = new Map()
const byExporter = new Map()
const byImporter = new Map()
const byTerm = new Map()
const byAppendix = new Map()
let total = 0
let minYear = Infinity
let maxYear = -Infinity

let header = null
let col = {}

async function processShard(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, file)), crlfDelay: Infinity })
  let first = true
  for await (const line of rl) {
    if (!line) continue
    const f = split(line)
    if (first) {
      first = false
      if (!header) { header = f; header.forEach((h, i) => { col[h] = i }) }
      continue
    }
    if (f[col.Source] !== 'I') continue // confiscations only
    total += 1
    const year = Number(f[col.Year])
    if (Number.isFinite(year)) { inc(byYear, year); if (year < minYear) minYear = year; if (year > maxYear) maxYear = year }
    const cls = f[col.Class] || '(other)'
    inc(byClass, cls)
    const taxon = f[col.Taxon]
    inc(byTaxon, taxon)
    if (taxon && !taxonClass.has(taxon)) taxonClass.set(taxon, cls)
    inc(byExporter, f[col.Exporter])
    inc(byImporter, f[col.Importer])
    inc(byTerm, f[col.Term])
    inc(byAppendix, f[col.Appendix])
  }
}

const topN = (m, n, keyName = 'key') =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ [keyName]: k, records: v }))

for (const s of shards) {
  process.stdout.write(`\r· ${s} (${total.toLocaleString()} confiscation records so far)   `)
  await processShard(s)
}
process.stdout.write('\n')

const out = {
  meta: {
    source: 'CITES Trade Database — confiscation records (Source = I)',
    url: 'https://trade.cites.org/',
    downloaded: new Date().toISOString().slice(0, 10),
    unit: 'confiscation records (not summed quantity — CITES quantities mix units)',
    grain: 'CITES-reported confiscations of listed species, by class / taxon / country / year',
    yearRange: [minYear, maxYear],
    totalRecords: total,
    caveat:
      'CITES-reported confiscations of CITES-LISTED species only — a partial, ' +
      'reporting-dependent view, not a comprehensive wildlife-trafficking dataset. ' +
      'Counted as records, since quantities mix kg, litres, live animals and skins.',
  },
  byClass: topN(byClass, 14, 'class'),
  byYear: [...byYear.entries()].filter(([y]) => Number.isFinite(y)).sort((a, b) => a[0] - b[0]).map(([year, records]) => ({ year, records })),
  topTaxa: topN(byTaxon, 25, 'taxon').map((t) => ({ ...t, class: taxonClass.get(t.taxon) ?? '' })),
  topExporters: topN(byExporter, 15, 'country'),
  topImporters: topN(byImporter, 15, 'country'),
  byTerm: topN(byTerm, 15, 'term'),
  byAppendix: topN(byAppendix, 3, 'appendix'),
}

fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`✔ wrote wildlifeSeizures.json — ${total.toLocaleString()} confiscation records, ${minYear}–${maxYear}`)
console.log(`  top classes: ${out.byClass.slice(0, 5).map((c) => `${c.class} ${c.records}`).join(', ')}`)
console.log(`  top exporters: ${out.topExporters.slice(0, 5).map((c) => `${c.country} ${c.records}`).join(', ')}`)
console.log(`  size: ${(fs.statSync(OUT).size / 1024).toFixed(1)} kB`)
