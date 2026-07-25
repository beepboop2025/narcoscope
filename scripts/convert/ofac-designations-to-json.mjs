#!/usr/bin/env node
/**
 * OFAC Specially Designated Nationals list -> src/data/designations.json
 *
 * WHY OFAC DIRECT, NOT OPENSANCTIONS / ALEPH / SAYARI
 * ---------------------------------------------------
 * Treasury's SDN files are a work of the US Government: public domain under
 * 17 U.S.C. §105, redistributable with no licence condition, which is the
 * only footing on which a designation layer can be bundled into an MIT repo.
 * OpenSanctions aggregates the same lists more conveniently but publishes no
 * licence on its bulk artifacts; Sayari and Kharon are commercial. Those stay
 * in scripts/pipeline/sources.json as analyst lookup pointers.
 *
 * WHAT THIS LAYER IS
 * ------------------
 * An OFFICIAL DESIGNATION is a published act of a government: a named entity
 * has been placed on a sanctions list under a stated legal authority, on a
 * stated date. That is a fact about the government's action. It is NOT an
 * adjudication of guilt, and this converter must never be extended to mix in
 * allegations from journalism, crowd-sourced compound databases, or leaked
 * documents — those are analyst leads, and they belong in the governed
 * scraper work queue (scripts/scrape/), never in a bundled dataset that the
 * app renders as fact.
 *
 * PROGRAM FILTER (why these four)
 *   SDNTK                  Foreign Narcotics Kingpin Designation Act
 *   SDNT                   Narcotics Trafficking sanctions (Colombia-era)
 *   ILLICIT-DRUGS-EO14059  E.O. 14059, the fentanyl/precursor authority
 *   TCO                    Transnational Criminal Organizations — included
 *                          because the convergence networks (Zhao Wei's
 *                          Golden Triangle SEZ, triad-linked groups) are
 *                          designated under TCO rather than a drug program,
 *                          and dropping it would silently hide exactly the
 *                          drug/arms/wildlife/laundering overlap the border
 *                          zones are notable for.
 *
 * GRAIN: entity + program + countries of record. Deliberately NO addresses,
 * NO passport/ID numbers, NO dates of birth — the SDN file carries all three
 * and none of them belong in a public explorer whose stated scope is
 * aggregate awareness. Country is kept because corridor analysis needs it.
 *
 * Usage:  node scripts/convert/ofac-designations-to-json.mjs [--out <path>] [--offline]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv'
const ADD_URL = 'https://www.treasury.gov/ofac/downloads/add.csv'
const ALT_URL = 'https://www.treasury.gov/ofac/downloads/alt.csv'
const LANDING_URL = 'https://sanctionslist.ofac.treas.gov/Home/SdnList'
const SOURCE_NAME = 'US Treasury OFAC — Specially Designated Nationals List'
const RAW_DIR = path.join(ROOT, 'data-raw')

/** Programs kept, and how each is labelled in the UI. */
const PROGRAMS = {
  SDNTK: 'Narcotics Kingpin Act',
  SDNT: 'Narcotics Trafficking',
  'ILLICIT-DRUGS-EO14059': 'Illicit Drugs (E.O. 14059)',
  TCO: 'Transnational Criminal Organization',
}

const args = process.argv.slice(2)
const offline = args.includes('--offline')
const outFlag = args.indexOf('--out')
const OUT_PATH = path.resolve(
  ROOT,
  outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'src/data/designations.json',
)

/**
 * OFAC's CSV is a fixed-column dialect: quoted fields, no header row, and the
 * literal token `-0-` standing in for null. Parsed inline rather than pulling
 * a dependency, matching the hand-rolled parser in src/lib/ingest.ts.
 */
function parseOfacCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { field += '"'; i += 1 } else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      row.push(field); field = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** OFAC writes `-0-` where a field is absent. */
const clean = (v) => {
  const t = String(v ?? '').trim()
  return t === '' || t === '-0-' ? null : t
}

async function load(url, filename) {
  const cached = path.join(RAW_DIR, filename)
  if (offline) {
    if (!fs.existsSync(cached)) throw new Error(`--offline but ${cached} is missing`)
    return fs.readFileSync(cached, 'utf8')
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OFAC fetch failed (${res.status}): ${url}`)
  const text = await res.text()
  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.writeFileSync(cached, text)
  return text
}

/**
 * A row's program cell can carry several authorities at once, written as
 * `SDNTK] [SDGT] [ILLICIT-DRUGS-EO14059`. Split on that separator so an entity
 * designated under both a drug and a terrorism authority is matched on the
 * drug one rather than being missed by an exact-string comparison.
 */
function splitPrograms(cell) {
  return String(cell ?? '')
    .split(/\]\s*\[/)
    .map((p) => p.replace(/[[\]]/g, '').trim())
    .filter(Boolean)
}

async function main() {
  console.log('· fetching OFAC SDN list …')
  const [sdnText, addText, altText] = await Promise.all([
    load(SDN_URL, 'ofac-sdn.csv'),
    load(ADD_URL, 'ofac-add.csv'),
    load(ALT_URL, 'ofac-alt.csv'),
  ])

  // Alias table. This is the entity-resolution problem that criminal-network
  // KG papers (CORE-KG, LINK-KG) build machine-learning pipelines to solve:
  // one actor appears as "WEI, Zhao", "WEI, Chao", "SAECHOU, Thanchai" across
  // sources and languages. OFAC has already done that resolution by hand and
  // publishes the result, so the aliases are ground truth rather than an
  // inference we would have to caveat. Extracted so a search for a
  // transliteration variant reaches the canonical designation.
  const aliasesByEntity = new Map()
  for (const row of parseOfacCsv(altText)) {
    if (row.length < 4) continue
    const ent = clean(row[0])
    const alias = clean(row[3])
    if (!ent || !alias) continue
    if (!aliasesByEntity.has(ent)) aliasesByEntity.set(ent, new Set())
    aliasesByEntity.get(ent).add(alias)
  }

  // Countries come from the address file, keyed on entity number. Only the
  // country column is read — street addresses are deliberately discarded.
  const countriesByEntity = new Map()
  for (const row of parseOfacCsv(addText)) {
    if (row.length < 5) continue
    const ent = clean(row[0])
    const country = clean(row[4])
    if (!ent || !country) continue
    if (!countriesByEntity.has(ent)) countriesByEntity.set(ent, new Set())
    countriesByEntity.get(ent).add(country)
  }

  const sdnRows = parseOfacCsv(sdnText)
  const records = []
  const programCounts = {}

  for (const row of sdnRows) {
    if (row.length < 4) continue
    const entityNumber = clean(row[0])
    const name = clean(row[1])
    if (!entityNumber || !name) continue

    const programs = splitPrograms(row[3]).filter((p) => p in PROGRAMS)
    if (programs.length === 0) continue

    // Row 2 is SDN type: 'individual', 'vessel', 'aircraft', or null for an
    // organisation. Normalised so the UI can separate people from companies
    // without string-matching OFAC's dialect at render time.
    const rawType = (clean(row[2]) ?? '').toLowerCase()
    const entityType =
      rawType === 'individual' ? 'individual'
        : rawType === 'vessel' ? 'vessel'
          : rawType === 'aircraft' ? 'aircraft'
            : 'organization'

    const countries = [...(countriesByEntity.get(entityNumber) ?? [])].sort()
    for (const p of programs) programCounts[p] = (programCounts[p] ?? 0) + 1

    records.push({
      entityNumber: Number(entityNumber),
      name,
      entityType,
      programs,
      countries,
      aliases: [...(aliasesByEntity.get(entityNumber) ?? [])].sort(),
    })
  }

  records.sort((a, b) => a.name.localeCompare(b.name))

  const countryCounts = {}
  for (const r of records) {
    for (const c of r.countries) countryCounts[c] = (countryCounts[c] ?? 0) + 1
  }

  const out = {
    meta: {
      source: SOURCE_NAME,
      url: LANDING_URL,
      files: [SDN_URL, ADD_URL],
      downloaded: new Date().toISOString().slice(0, 10),
      license: 'US Government work — public domain (17 U.S.C. §105)',
      programs: PROGRAMS,
      grain: 'designated entity + sanctions program + countries of record',
      note:
        'A designation is a published government action under a stated legal ' +
        'authority. It is not an adjudication of guilt, and OFAC delists ' +
        'entities — always check the live SDN list before relying on a row. ' +
        'Addresses, identity documents and dates of birth are present in the ' +
        'upstream file and are deliberately not extracted here.',
      totalDesignations: records.length,
      byProgram: programCounts,
    },
    records,
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out)}\n`)

  console.log(`✔ wrote ${records.length.toLocaleString()} designations -> ${path.relative(ROOT, OUT_PATH)}`)
  for (const [p, label] of Object.entries(PROGRAMS)) {
    console.log(`  ${String(programCounts[p] ?? 0).padStart(5)}  ${p} (${label})`)
  }
  const topCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  top countries: ${topCountries.map(([c, n]) => `${c} ${n}`).join(', ')}`)
  console.log(`  file size: ${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} kB`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
