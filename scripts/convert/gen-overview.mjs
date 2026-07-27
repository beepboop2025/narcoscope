#!/usr/bin/env node
/**
 * Precomputes the Overview dashboard's headline numbers -> src/data/overview.json
 *
 * WHY A PRECOMPUTED SUMMARY
 * -------------------------
 * The Overview is the landing tab, so it must be cheap: dragging the ~850 kB of
 * bundled CDC/OFAC/StatCan JSON onto the first paint would undo the bundle
 * quarantine for every visitor. Instead this script reads those datasets at
 * BUILD time and emits a few-kB summary the landing renders instantly. The heavy
 * datasets still lazy-load only when a user opens Triangulation or Designations.
 *
 * Everything here is a straight aggregate of real bundled data — counts, sums,
 * year-over-year deltas. Nothing is modelled or invented; the Overview is a
 * dense window onto data the app already holds, which is the honest cure for a
 * site that looks empty while sitting on 11k seizure records and 54 CDC
 * jurisdictions it never shows.
 *
 * Regenerate via the pipeline (scripts/pipeline/run.mjs) or directly:
 *   node scripts/convert/gen-overview.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

const overdose = readJson('src/data/overdose.json')
const seizures = readJson('src/data/seizures.json')
const designations = readJson('src/data/designations.json')
const wastewater = readJson('src/data/wastewater.json')

const round = (n, dp = 0) => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}
const pct = (cur, base) => (base > 0 ? round((cur - base) / base, 3) : null)

// --- US overdose: latest full year, YoY, and by substance ---------------------
// Full-year (December) US-national records only, so YoY compares like with like.
const usAnnual = overdose.records.filter(
  (r) => r.jurisdiction === 'US' && !r.partialYear,
)
const overdoseYears = [...new Set(usAnnual.map((r) => r.year))].sort((a, b) => a - b)
const latestYear = overdoseYears[overdoseYears.length - 1]
const prevYear = overdoseYears[overdoseYears.length - 2]

const usDeaths = (substance, year) =>
  usAnnual.find((r) => r.substance === substance && r.year === year)?.deaths ?? null

const allDrugsLatest = usDeaths('all_drugs', latestYear)
const allDrugsPrev = usDeaths('all_drugs', prevYear)

const SUBSTANCE_LABEL = {
  synthetic_opioids: 'Synthetic opioids (fentanyl)',
  psychostimulants: 'Psychostimulants (meth)',
  cocaine: 'Cocaine',
  heroin: 'Heroin',
  opioids_all: 'All opioids',
  all_drugs: 'All drug overdoses',
}
const overdoseBySubstance = ['synthetic_opioids', 'psychostimulants', 'cocaine', 'heroin']
  .map((s) => ({
    substance: s,
    label: SUBSTANCE_LABEL[s],
    deaths: usDeaths(s, latestYear),
    yoy: pct(usDeaths(s, latestYear) ?? 0, usDeaths(s, prevYear) ?? 0),
  }))
  .filter((x) => x.deaths != null)
  .sort((a, b) => b.deaths - a.deaths)

// --- seizures: world total latest year + top countries ------------------------
const seizureYears = seizures.meta.years
const seizureLatest = seizureYears[seizureYears.length - 1]
const countryByIndex = seizures.countries
const kgByCountry = new Map()
let worldSeizureKg = 0
for (const [c, , y, kg] of seizures.records) {
  if (y !== seizureLatest) continue
  worldSeizureKg += kg
  const iso3 = countryByIndex[c][0]
  kgByCountry.set(iso3, (kgByCountry.get(iso3) ?? 0) + kg)
}
const topSeizureCountries = [...kgByCountry.entries()]
  .map(([iso3, kg]) => {
    const meta = countryByIndex.find((x) => x[0] === iso3)
    return { iso3, name: meta ? meta[1] : iso3, kg: round(kg) }
  })
  .sort((a, b) => b.kg - a.kg)
  .slice(0, 8)

// --- designations: by program + top countries ---------------------------------
const programCounts = {}
const desCountryCounts = {}
for (const r of designations.records) {
  for (const p of r.programs) programCounts[p] = (programCounts[p] ?? 0) + 1
  for (const c of r.countries) desCountryCounts[c] = (desCountryCounts[c] ?? 0) + 1
}
const designationsByProgram = Object.entries(designations.meta.programs)
  .map(([code, label]) => ({ code, label, count: programCounts[code] ?? 0 }))
  .sort((a, b) => b.count - a.count)
const topDesignationCountries = Object.entries(desCountryCounts)
  .map(([country, count]) => ({ country, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 8)

// --- divergence highlights: seizures vs consumption, precomputed --------------
// The flagship finding, computed here with simple ratio math (not the full
// triangulate engine, which is TS) so the landing can show it without loading
// the heavy datasets. Two hand-picked, verified cases.
function seizureGroupKg(iso3, groupName, year) {
  const gIdx = seizures.groups.indexOf(groupName)
  if (gIdx === -1) return 0
  const cIdx = seizures.countries.findIndex((x) => x[0] === iso3)
  if (cIdx === -1) return 0
  let sum = 0
  for (const [c, d, y, kg] of seizures.records) {
    if (c === cIdx && y === year && seizures.drugs[d][1] === gIdx) sum += kg
  }
  return sum
}
const wwMean = (iso3, drug, year) => {
  const v = wastewater.records.filter((r) => r.iso3 === iso3 && r.drug === drug && r.year === year)
  return v.length ? v.reduce((s, r) => s + r.mgPer1000PerDay, 0) / v.length : null
}

const divergences = []
// US methamphetamine: seizures (ATS group) vs mortality (psychostimulants).
{
  const s0 = seizureGroupKg('USA', 'Amphetamine-type stimulants (excluding “ecstasy”)', 2019)
  const s1 = seizureGroupKg('USA', 'Amphetamine-type stimulants (excluding “ecstasy”)', 2023)
  const m0 = usDeaths('psychostimulants', 2019)
  const m1 = usDeaths('psychostimulants', 2023)
  if (s0 && s1 && m0 && m1) {
    divergences.push({
      label: 'US methamphetamine',
      window: '2019→2023',
      supplyLabel: 'seizures',
      supplyPct: pct(s1, s0),
      demandLabel: 'overdose deaths',
      demandPct: pct(m1, m0),
      reading: 'expansion interdiction missed',
    })
  }
}
// Canada cannabis: seizures vs wastewater consumption.
{
  const s0 = seizureGroupKg('CAN', 'Cannabis-type drugs (excluding synthetic cannabinoids)', 2019)
  const s1 = seizureGroupKg('CAN', 'Cannabis-type drugs (excluding synthetic cannabinoids)', 2023)
  const w0 = wwMean('CAN', 'cannabis', 2019)
  const w1 = wwMean('CAN', 'cannabis', 2023)
  if (s0 && s1 && w0 && w1) {
    divergences.push({
      label: 'Canada cannabis',
      window: '2019→2023',
      supplyLabel: 'seizures',
      supplyPct: pct(s1, s0),
      demandLabel: 'wastewater consumption',
      demandPct: pct(w1, w0),
      reading: 'legalisation — enforcement stopped, use did not',
    })
  }
}

// --- data freshness -----------------------------------------------------------
const freshness = [
  { source: 'CDC overdose mortality', downloaded: overdose.meta.downloaded, cadence: 'monthly', latest: overdose.meta.latestWindow },
  { source: 'OFAC designations', downloaded: designations.meta.downloaded, cadence: 'continuous', latest: `${designations.records.length} entities` },
  { source: 'StatCan wastewater', downloaded: wastewater.meta.downloaded, cadence: 'irregular', latest: wastewater.meta.years.join('/') },
  { source: 'UNODC seizures', downloaded: seizures.meta.downloaded, cadence: 'annual', latest: String(seizureLatest) },
]

const overview = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    note: 'Precomputed headline aggregates for the Overview landing. All figures are direct sums/counts of the bundled official datasets.',
  },
  headline: {
    usOverdoseLatest: allDrugsLatest,
    usOverdoseYoY: pct(allDrugsLatest ?? 0, allDrugsPrev ?? 0),
    usOverdoseYear: latestYear,
    usOverdoseWindow: overdose.meta.latestWindow,
    worldSeizureTonnes: round(worldSeizureKg / 1000),
    seizureYear: seizureLatest,
    designations: designations.records.length,
    seizureCountries: seizures.countries.length,
    wastewaterCities: wastewater.meta.sites.length,
  },
  overdoseBySubstance,
  topSeizureCountries,
  designationsByProgram,
  topDesignationCountries,
  divergences,
  freshness,
}

const OUT = path.join(ROOT, 'src/data/overview.json')
fs.writeFileSync(OUT, `${JSON.stringify(overview)}\n`)
console.log(`✔ wrote overview.json (${(fs.statSync(OUT).size / 1024).toFixed(1)} kB)`)
console.log(`  US overdose ${latestYear}: ${allDrugsLatest?.toLocaleString()} (${(overview.headline.usOverdoseYoY * 100).toFixed(1)}% YoY)`)
console.log(`  world seizures ${seizureLatest}: ${overview.headline.worldSeizureTonnes.toLocaleString()} t`)
console.log(`  divergences precomputed: ${divergences.length}`)
