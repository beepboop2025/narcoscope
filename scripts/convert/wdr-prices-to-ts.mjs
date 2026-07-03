#!/usr/bin/env node
/**
 * Regenerate src/data/prices.ts from the UNODC World Drug Report 2025
 * Statistical Annex 8.1 ("Prices and purities of drugs") plus World Bank
 * GDP-per-capita (fetched live, NY.GDP.PCAP.CD) for the affordability lens.
 *
 * Source file (download first, or let scripts/pipeline/run.mjs do it):
 *   https://www.unodc.org/documents/data-and-analysis/WDR_2025/Annex/8.1_Prices_and_purities_of_drugs.xlsx
 *
 * Usage:
 *   npm install --no-save xlsx
 *   node scripts/convert/wdr-prices-to-ts.mjs <path-to-8.1.xlsx>
 *
 * Extraction rules (documented in the generated header too):
 *   - Retail level, per-GRAM rows, four tracked drugs only.
 *   - Price = Typical_USD, else midpoint of a COMPLETE min-max range, else skip.
 *   - Multiple observations for one (drug, country, year) are averaged.
 *   - Retail purity (percent) joined by country/drug/year where reported.
 */

import fs from 'node:fs'

const xlsxPath = process.argv[2]
if (!xlsxPath) {
  console.error('Usage: node wdr-prices-to-ts.mjs <path-to-8.1_Prices_and_purities.xlsx>')
  process.exit(1)
}

let xlsx
try {
  xlsx = (await import('xlsx')).default
} catch {
  console.error('The optional "xlsx" package is required: npm install --no-save xlsx')
  process.exit(1)
}

const DRUG_MAP = {
  'Cocaine salts': 'cocaine',
  'Heroin': 'heroin',
  'Marijuana (herb)': 'cannabis',
  'Methamphetamine': 'methamphetamine',
}

/** UNODC country name -> [ISO3, display label]. Extend when UNODC adds reporters. */
const ISO3 = {
  'Albania': ['ALB', 'Albania'], 'Australia': ['AUS', 'Australia'], 'Bangladesh': ['BGD', 'Bangladesh'],
  'Belarus': ['BLR', 'Belarus'], 'Belgium': ['BEL', 'Belgium'],
  'Bolivia (Plurinational State of)': ['BOL', 'Bolivia'], 'Brunei Darussalam': ['BRN', 'Brunei'],
  'Bulgaria': ['BGR', 'Bulgaria'], 'Chile': ['CHL', 'Chile'], 'China': ['CHN', 'China'],
  'China, Hong Kong SAR': ['HKG', 'Hong Kong SAR'], 'China, Macao SAR': ['MAC', 'Macao SAR'],
  'Cyprus': ['CYP', 'Cyprus'], 'Czechia': ['CZE', 'Czechia'], 'Denmark': ['DNK', 'Denmark'],
  'Ecuador': ['ECU', 'Ecuador'], 'Egypt': ['EGY', 'Egypt'], 'El Salvador': ['SLV', 'El Salvador'],
  'Estonia': ['EST', 'Estonia'], 'Finland': ['FIN', 'Finland'], 'France': ['FRA', 'France'],
  'Georgia': ['GEO', 'Georgia'], 'Germany': ['DEU', 'Germany'], 'Greece': ['GRC', 'Greece'],
  'Guatemala': ['GTM', 'Guatemala'], 'Hungary': ['HUN', 'Hungary'], 'Iceland': ['ISL', 'Iceland'],
  'India': ['IND', 'India'], 'Indonesia': ['IDN', 'Indonesia'],
  'Iran (Islamic Republic of)': ['IRN', 'Iran'], 'Ireland': ['IRL', 'Ireland'], 'Italy': ['ITA', 'Italy'],
  'Japan': ['JPN', 'Japan'], 'Kazakhstan': ['KAZ', 'Kazakhstan'], 'Kenya': ['KEN', 'Kenya'],
  'Kuwait': ['KWT', 'Kuwait'], 'Kyrgyzstan': ['KGZ', 'Kyrgyzstan'], 'Latvia': ['LVA', 'Latvia'],
  'Lebanon': ['LBN', 'Lebanon'], 'Liechtenstein': ['LIE', 'Liechtenstein'], 'Lithuania': ['LTU', 'Lithuania'],
  'Luxembourg': ['LUX', 'Luxembourg'], 'Malaysia': ['MYS', 'Malaysia'], 'Montenegro': ['MNE', 'Montenegro'],
  'Morocco': ['MAR', 'Morocco'], 'Myanmar': ['MMR', 'Myanmar'], 'Nepal': ['NPL', 'Nepal'],
  'New Zealand': ['NZL', 'New Zealand'], 'North Macedonia': ['MKD', 'North Macedonia'],
  'Oman': ['OMN', 'Oman'], 'Pakistan': ['PAK', 'Pakistan'], 'Philippines': ['PHL', 'Philippines'],
  'Poland': ['POL', 'Poland'], 'Portugal': ['PRT', 'Portugal'], 'Republic of Moldova': ['MDA', 'Moldova'],
  'Romania': ['ROU', 'Romania'], 'Russian Federation': ['RUS', 'Russia'], 'Saudi Arabia': ['SAU', 'Saudi Arabia'],
  'Serbia': ['SRB', 'Serbia'], 'Slovakia': ['SVK', 'Slovakia'], 'Spain': ['ESP', 'Spain'],
  'Sweden': ['SWE', 'Sweden'], 'Tajikistan': ['TJK', 'Tajikistan'], 'Thailand': ['THA', 'Thailand'],
  'Tunisia': ['TUN', 'Tunisia'], 'Türkiye': ['TUR', 'Türkiye'], 'Ukraine': ['UKR', 'Ukraine'],
  'United Kingdom': ['GBR', 'United Kingdom'], 'United States of America': ['USA', 'United States'],
  'Uruguay': ['URY', 'Uruguay'], 'Zambia': ['ZMB', 'Zambia'],
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const resolve = (typical, min, max) => {
  if (num(typical) !== null) return num(typical)
  if (num(min) !== null && num(max) !== null) return (num(min) + num(max)) / 2
  return null
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length

const wb = xlsx.readFile(xlsxPath)
const prices = xlsx.utils.sheet_to_json(wb.Sheets['Prices in USD'], { header: 1, defval: '' }).slice(2)
const purities = xlsx.utils.sheet_to_json(wb.Sheets['Purities'], { header: 1, defval: '' }).slice(2)

const purityByKey = new Map()
for (const r of purities) {
  const [, , country, level, , drug, , year, typical, min, max, measurement] = r
  if (level !== 'Retail' || !DRUG_MAP[drug] || !String(measurement).includes('percent')) continue
  const v = resolve(typical, min, max)
  if (v === null) continue
  const key = `${country}|${DRUG_MAP[drug]}|${year}`
  if (!purityByKey.has(key)) purityByKey.set(key, [])
  purityByKey.get(key).push(v)
}

const grouped = new Map()
let skipped = 0
const unknownCountries = new Set()
for (const r of prices) {
  const [region, , country, , drug, , level, year, typical, min, max, unit] = r
  if (level !== 'Retail' || unit !== 'Gram' || !DRUG_MAP[drug]) continue
  if (!ISO3[country]) { unknownCountries.add(country); continue }
  const price = resolve(typical, min, max)
  if (price === null) { skipped++; continue }
  const key = `${DRUG_MAP[drug]}|${country}|${year}`
  if (!grouped.has(key)) grouped.set(key, { prices: [], region })
  grouped.get(key).prices.push(price)
}

const records = []
for (const [key, { prices: ps, region }] of grouped) {
  const [drug, country, year] = key.split('|')
  const [iso3, label] = ISO3[country]
  const pur = purityByKey.get(`${country}|${drug}|${year}`)
  records.push({
    drug, country: label, iso3, region, year: Number(year),
    priceUsdPerGram: Math.round(mean(ps) * 100) / 100,
    purityPct: pur ? Math.round(mean(pur) * 10) / 10 : null,
  })
}
const drugOrder = { cocaine: 0, heroin: 1, cannabis: 2, methamphetamine: 3 }
records.sort((a, b) => drugOrder[a.drug] - drugOrder[b.drug] || a.country.localeCompare(b.country) || a.year - b.year)

if (unknownCountries.size) {
  console.error(`Countries missing from the ISO3 table (add them): ${[...unknownCountries].join('; ')}`)
  process.exit(1)
}

// ---- World Bank GDP per capita for every country in the dataset -----------
const isoList = [...new Set(records.map((r) => r.iso3))].sort()
const WB_URL = 'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?format=json&per_page=20000&date=2020:2024'
const res = await fetch(WB_URL)
if (!res.ok) { console.error(`World Bank API error: ${res.status}`); process.exit(1) }
const payload = await res.json()
const latest = new Map() // iso3 -> [year, value]
for (const row of (payload[1] ?? [])) {
  const iso3 = row?.countryiso3code
  if (!iso3 || row.value == null) continue
  const year = Number(row.date)
  const cur = latest.get(iso3)
  if (!cur || year > cur[0]) latest.set(iso3, [year, row.value])
}
const gdpMissing = isoList.filter((i) => !latest.has(i))
if (gdpMissing.length) console.error(`No World Bank GDP for: ${gdpMissing.join(', ')} (affordability shows n/a)`)

// ---- emit prices.ts ---------------------------------------------------------
const today = new Date().toISOString().slice(0, 10)
let recordLines = ''
let current = ''
for (const r of records) {
  if (r.drug !== current) {
    current = r.drug
    recordLines += `\n  // --- ${current.charAt(0).toUpperCase() + current.slice(1)} ---\n`
  }
  recordLines += `  { drug: '${r.drug}', country: '${r.country.replace(/'/g, "\\'")}', iso3: '${r.iso3}', region: '${r.region}', year: ${r.year}, priceUsdPerGram: ${r.priceUsdPerGram}, purityPct: ${r.purityPct} },\n`
}
const gdpLines = isoList
  .filter((i) => latest.has(i))
  .map((i) => `  ${i}: ${Math.round(latest.get(i)[1])}, // ${latest.get(i)[0]}`)
  .join('\n')

const out = `// =============================================================================
// RETAIL ("STREET") PRICE DATASET — OFFICIAL UNODC DATA
// =============================================================================
//
// GENERATED by scripts/convert/wdr-prices-to-ts.mjs on ${today} — edit the
// script, not this file, then regenerate (see scripts/pipeline/run.mjs).
//
// DATA PROVENANCE:
// UNODC World Drug Report 2025 Statistical Annex, table 8.1 "Prices and
// purities of drugs" (sheets "Prices in USD" + "Purities"):
//   https://www.unodc.org/documents/data-and-analysis/WDR_2025/Annex/8.1_Prices_and_purities_of_drugs.xlsx
//
// Extraction rules (deliberately conservative):
//   • Retail level of sale, per-GRAM unit rows only.
//   • Drug mapping: "Cocaine salts" → cocaine, "Heroin" → heroin,
//     "Marijuana (herb)" → cannabis, "Methamphetamine" → methamphetamine.
//   • Price = reported Typical_USD; if absent, midpoint of a complete
//     Minimum–Maximum range; rows with neither are skipped (${skipped} skipped).
//   • Multiple observations for one (drug, country, year) are averaged.
//   • purityPct = retail purity (percent) where UNODC reports it; else null.
//
// GRAIN (deliberate guardrail): country + year + annual average ONLY.
// Units: priceUsdPerGram = retail price per gram in nominal USD (year-of-record).
// =============================================================================

import type { DrugMeta, PriceRecord, Source } from '../types'

export const DRUGS: DrugMeta[] = [
  { id: 'cocaine', label: 'Cocaine', unit: 'gram' },
  { id: 'heroin', label: 'Heroin', unit: 'gram' },
  { id: 'cannabis', label: 'Cannabis (herbal)', unit: 'gram' },
  { id: 'methamphetamine', label: 'Methamphetamine', unit: 'gram' },
]

// ${records.length} records across ${isoList.length} countries — see provenance header.
export const PRICE_RECORDS: PriceRecord[] = [
${recordLines}]

// World Bank GDP per capita, current US$ (NY.GDP.PCAP.CD), latest available
// year per country, fetched ${today}. Rounded to whole dollars.
export const GDP_PER_CAPITA_USD: Record<string, number> = {
${gdpLines}
}

export const SOURCES: Source[] = [
  { name: 'UNODC World Drug Report 2025 — Statistical Annex 8.1: Prices and purities of drugs', url: 'https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report-2025-annex.html' },
  { name: 'UNODC — Drugs: prices (data portal)', url: 'https://dataunodc.un.org' },
  { name: 'EUDA (EMCDDA) — price & purity data', url: 'https://www.euda.europa.eu/data' },
  { name: 'World Bank — GDP per capita, NY.GDP.PCAP.CD', url: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD' },
]
`
fs.writeFileSync('src/data/prices.ts', out)
console.log(`records: ${records.length}, countries: ${isoList.length}, with purity: ${records.filter((r) => r.purityPct !== null).length}, skipped: ${skipped}`)
console.log('wrote src/data/prices.ts')
