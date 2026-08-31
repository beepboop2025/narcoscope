#!/usr/bin/env node
/**
 * Global Organized Crime Index open-data workbook -> organizedCrime.json.
 *
 * Source: https://ocindex.net/assets/downloads/global_oc_index.xlsx
 * The workbook contains the 2021, 2023 and 2025 country editions. Scores are
 * expert-assessed index values on a 1-10 scale; they are not transaction,
 * incident, market-size or named-actor observations.
 *
 * Usage:
 *   node scripts/convert/ocindex-to-json.mjs data-raw/global_oc_index.xlsx
 *   node scripts/convert/ocindex-to-json.mjs <xlsx> --out <json> \
 *     --downloaded-at 2026-08-30T19:57:25.000Z
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCountryResolver } from './lib/country-iso3.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const OC_INDEX_URL = 'https://ocindex.net/assets/downloads/global_oc_index.xlsx'
export const OC_INDEX_YEARS = Object.freeze([2021, 2023, 2025])

const CORE_FIELDS = Object.freeze({
  criminality: ['Criminality avg.', 'Criminality avg,'],
  criminalMarkets: ['Criminal markets avg.', 'Criminal markets avg,'],
})

const MARKET_FIELDS = Object.freeze({
  humanTrafficking: ['Human trafficking'],
  humanSmuggling: ['Human smuggling'],
  extortion: ['Extortion and protection racketeering'],
  armsTrafficking: ['Arms trafficking'],
  counterfeitGoods: ['Trade in counterfeit goods'],
  illicitTradeExcisableGoods: ['Illicit trade in excisable goods'],
  floraCrimes: ['Flora crimes'],
  faunaCrimes: ['Fauna crimes'],
  nonRenewableResourceCrimes: ['Non-renewable resource crimes'],
  heroinTrade: ['Heroin trade'],
  cocaineTrade: ['Cocaine trade'],
  cannabisTrade: ['Cannabis trade'],
  syntheticDrugTrade: ['Synthetic drug trade'],
  cyberDependentCrimes: ['Cyber-dependent crimes'],
  financialCrimes: ['Financial crimes'],
})

const ACTOR_FIELDS = Object.freeze({
  average: ['Criminal actors avg.', 'Criminal actors avg,', 'Criminal actors'],
  mafiaStyleGroups: ['Mafia-style groups'],
  criminalNetworks: ['Criminal networks'],
  stateEmbeddedActors: ['State-embedded actors'],
  foreignActors: ['Foreign actors'],
  privateSectorActors: ['Private sector actors'],
})

const RESILIENCE_FIELDS = Object.freeze({
  average: ['Resilience avg.', 'Resilience avg,', 'Resilience'],
  politicalLeadershipAndGovernance: ['Political leadership and governance'],
  governmentTransparencyAndAccountability: ['Government transparency and accountability'],
  internationalCooperation: ['International cooperation'],
  nationalPoliciesAndLaws: ['National policies and laws'],
  judicialSystemAndDetention: ['Judicial system and detention'],
  lawEnforcement: ['Law enforcement'],
  territorialIntegrity: ['Territorial integrity'],
  antiMoneyLaundering: ['Anti-money laundering'],
  economicRegulatoryCapacity: ['Economic regulatory capacity'],
  victimAndWitnessSupport: ['Victim and witness support'],
  prevention: ['Prevention'],
  nonStateActors: ['Non-state actors'],
})

/** Fields introduced after the 2021 edition. Their absence is data, not zero. */
const OPTIONAL_BY_YEAR = Object.freeze({
  2021: new Set([
    'markets.extortion',
    'markets.counterfeitGoods',
    'markets.illicitTradeExcisableGoods',
    'markets.cyberDependentCrimes',
    'markets.financialCrimes',
    'actors.privateSectorActors',
  ]),
  2023: new Set(),
  2025: new Set(),
})

const requireText = (value, label) => {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${label} must be a non-empty string`)
  return text
}

const readCandidate = (row, candidates) => {
  for (const candidate of candidates) {
    if (Object.hasOwn(row, candidate)) return { found: true, value: row[candidate], header: candidate }
  }
  return { found: false, value: undefined, header: candidates[0] }
}

function readScore(row, candidates, label, optional = false) {
  const { found, value, header } = readCandidate(row, candidates)
  if (!found && optional) return null
  if (!found) throw new Error(`${label}: required workbook column is missing: ${header}`)
  if (value == null || String(value).trim() === '') {
    throw new Error(`${label}: ${header} is blank`)
  }
  const score = Number(value)
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error(`${label}: ${header} score ${JSON.stringify(value)} is outside 1-10`)
  }
  return score
}

function readScoreGroup(row, fields, group, year, label) {
  return Object.fromEntries(Object.entries(fields).map(([outputName, candidates]) => {
    const key = `${group}.${outputName}`
    return [outputName, readScore(
      row,
      candidates,
      `${label}.${key}`,
      OPTIONAL_BY_YEAR[year].has(key),
    )]
  }))
}

/**
 * Turn year-keyed worksheet objects into the public artifact.
 * Exported so schema drift and validation can be tested without xlsx/network.
 */
export function buildOrganizedCrimeArtifact(
  datasets,
  {
    downloadedAt,
    resolveCountry = createCountryResolver(),
  } = {},
) {
  const retrievalClock = requireText(downloadedAt, 'downloadedAt')
  if (Number.isNaN(Date.parse(retrievalClock))) {
    throw new Error(`downloadedAt is not an ISO date-time: ${retrievalClock}`)
  }

  for (const year of OC_INDEX_YEARS) {
    if (!Array.isArray(datasets?.[year]) || datasets[year].length === 0) {
      throw new Error(`OC Index ${year} dataset is missing or empty`)
    }
  }

  // The newest edition supplies one stable publisher label for the same ISO3
  // across all editions (the 2023 workbook contains several punctuation typos).
  const canonicalCountryByIso3 = new Map()
  for (const row of datasets[2025]) {
    const sourceCountry = requireText(row.Country, '2025.Country')
    const { iso3 } = resolveCountry(sourceCountry)
    if (canonicalCountryByIso3.has(iso3)) {
      throw new Error(`duplicate OC Index 2025 ISO3 ${iso3}`)
    }
    canonicalCountryByIso3.set(iso3, sourceCountry)
  }

  const records = []
  const seen = new Set()
  for (const year of OC_INDEX_YEARS) {
    for (const row of datasets[year]) {
      const sourceCountry = requireText(row.Country, `${year}.Country`)
      const { iso3 } = resolveCountry(sourceCountry)
      const key = `${year}|${iso3}`
      if (seen.has(key)) throw new Error(`duplicate OC Index country-year key: ${key}`)
      seen.add(key)

      const canonicalCountry = canonicalCountryByIso3.get(iso3)
      if (!canonicalCountry) {
        throw new Error(`${year} country ${sourceCountry} (${iso3}) is absent from the 2025 edition`)
      }
      const label = `${year}.${iso3}`
      records.push({
        iso3,
        country: canonicalCountry,
        continent: requireText(row.Continent, `${label}.Continent`),
        region: requireText(row.Region, `${label}.Region`),
        year,
        criminality: readScore(row, CORE_FIELDS.criminality, `${label}.criminality`),
        criminalMarkets: readScore(row, CORE_FIELDS.criminalMarkets, `${label}.criminalMarkets`),
        markets: readScoreGroup(row, MARKET_FIELDS, 'markets', year, label),
        actors: readScoreGroup(row, ACTOR_FIELDS, 'actors', year, label),
        resilience: readScoreGroup(row, RESILIENCE_FIELDS, 'resilience', year, label),
      })
    }
  }

  const newestIso3 = new Set(canonicalCountryByIso3.keys())
  for (const year of OC_INDEX_YEARS.slice(0, -1)) {
    const yearIso3 = new Set(records.filter((record) => record.year === year).map((record) => record.iso3))
    const missing = [...newestIso3].filter((iso3) => !yearIso3.has(iso3))
    const extra = [...yearIso3].filter((iso3) => !newestIso3.has(iso3))
    if (missing.length || extra.length) {
      throw new Error(`OC Index ${year}/2025 country coverage differs: missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`)
    }
  }

  records.sort((a, b) => a.year - b.year || a.iso3.localeCompare(b.iso3))

  return {
    meta: {
      schemaVersion: 'narcoscope.organized-crime.v1',
      source: 'Global Initiative Against Transnational Organized Crime — Global Organized Crime Index',
      url: OC_INDEX_URL,
      downloadedAt: new Date(retrievalClock).toISOString(),
      years: [...OC_INDEX_YEARS],
      scale: {
        minimum: 1,
        maximum: 10,
        direction: 'Higher criminality/market/actor scores indicate greater assessed criminality; higher resilience scores indicate greater assessed capacity to withstand organized crime.',
      },
      rights: 'GI-TOC open data; attribution required. Source rights remain with the Global Initiative Against Transnational Organized Crime.',
      caveats: [
        'Scores are expert-assessed index constructs, not counts, transaction values, illicit-market volumes, prevalence estimates or proof about a named person or organization.',
        'The 2021 edition predates six indicators added later; those cells are null rather than zero or backfilled.',
        'Edition-to-edition movement can reflect methodology and indicator changes as well as assessed country conditions; read the methodology before longitudinal comparison.',
        'Country identity is mapped exactly to the bundled Natural Earth atlas. No fuzzy entity resolution or inferred actor/link relationship is performed.',
      ],
    },
    records,
  }
}

export function workbookToDatasets(workbook, xlsx) {
  return Object.fromEntries(OC_INDEX_YEARS.map((year) => {
    const sheetName = `${year}_dataset`
    const sheet = workbook?.Sheets?.[sheetName]
    if (!sheet) throw new Error(`OC Index workbook is missing sheet ${sheetName}`)
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: true })
    return [year, rows]
  }))
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const sourcePath = args.find((arg) => !arg.startsWith('--'))
  if (!sourcePath) {
    console.error('Usage: ocindex-to-json.mjs <global_oc_index.xlsx> [--out <json>] [--downloaded-at <ISO>]')
    process.exit(1)
  }
  const outFlag = args.indexOf('--out')
  const clockFlag = args.indexOf('--downloaded-at')
  const outPath = path.resolve(
    ROOT,
    outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'src/data/organizedCrime.json',
  )
  const absoluteSource = path.resolve(sourcePath)
  if (!fs.existsSync(absoluteSource)) throw new Error(`OC Index workbook not found: ${absoluteSource}`)

  let xlsx
  try {
    xlsx = (await import('xlsx')).default
  } catch {
    console.error('The optional "xlsx" package is required: npm install --no-save xlsx')
    process.exit(1)
  }

  const downloadedAt = clockFlag >= 0 && args[clockFlag + 1]
    ? args[clockFlag + 1]
    : fs.statSync(absoluteSource).mtime.toISOString()
  const workbook = xlsx.readFile(absoluteSource)
  const artifact = buildOrganizedCrimeArtifact(workbookToDatasets(workbook, xlsx), { downloadedAt })
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(artifact)}\n`)
  console.log(`organized-crime records: ${artifact.records.length} (${artifact.meta.years.join(', ')})`)
  console.log(`wrote ${outPath}`)
}
