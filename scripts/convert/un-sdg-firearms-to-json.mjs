#!/usr/bin/env node
/**
 * UN SDG series VC_ARM_SZTRACE -> firearmsTracing.json.
 *
 * This series is SDG indicator 16.4.2: the percentage of seized, found or
 * surrendered arms whose illicit origin or context was traced/established by
 * a competent authority. It measures tracing effectiveness. It does NOT
 * measure the number, value, direction or prevalence of illicit arms flows.
 *
 * Usage:
 *   node scripts/convert/un-sdg-firearms-to-json.mjs
 *   node scripts/convert/un-sdg-firearms-to-json.mjs --offline [--out <json>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { fetchJsonWithRetry } from '../lib/http.mjs'
import { createCountryResolver } from './lib/country-iso3.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW_DIR = path.join(ROOT, 'data-raw')
const CACHE_PATH = path.join(RAW_DIR, 'un-sdg-vc-arm-sztrace.json')

export const SERIES = 'VC_ARM_SZTRACE'
export const INDICATOR = '16.4.2'
export const SDG_DATA_URL = `https://unstats.un.org/SDGAPI/v1/sdg/Series/Data?seriesCode=${SERIES}`
export const SDG_SERIES_URL = `https://unstats.un.org/SDGAPI/v1/sdg/Indicator/${INDICATOR}/Series/List`

const NATURE_CODES = new Set(['C', 'CA', 'E', 'G', 'M', 'N', 'NA'])
const REPORTING_TYPE_CODES = new Set(['N', 'G', 'R'])

const requireText = (value, label) => {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${label} must be a non-empty string`)
  return text
}

export function extractRelease(indicatorPayload) {
  const indicators = Array.isArray(indicatorPayload) ? indicatorPayload : [indicatorPayload]
  const candidates = indicators.flatMap((entry) => Array.isArray(entry?.series) ? entry.series : [])
  const series = candidates.find((entry) => entry?.code === SERIES)
  if (!series) throw new Error(`${SERIES} is missing from UN SDG indicator metadata`)
  return requireText(series.release, `${SERIES} release`)
}

/** Build the public artifact from a complete, unpaginated API payload. */
export function buildFirearmsTracingArtifact(
  payload,
  {
    release,
    downloadedAt,
    resolveCountry = createCountryResolver(),
  } = {},
) {
  const retrievalClock = requireText(downloadedAt, 'downloadedAt')
  if (Number.isNaN(Date.parse(retrievalClock))) {
    throw new Error(`downloadedAt is not an ISO date-time: ${retrievalClock}`)
  }
  const releaseCode = requireText(release, 'release')
  if (!Array.isArray(payload?.data)) throw new Error('UN SDG payload.data must be an array')
  if (payload.data.length === 0) throw new Error(`UN SDG returned no ${SERIES} observations`)
  if (Number.isInteger(payload.totalElements) && payload.totalElements !== payload.data.length) {
    throw new Error(`UN SDG payload is incomplete: expected ${payload.totalElements}, received ${payload.data.length}`)
  }

  const records = []
  const seen = new Set()
  for (const [index, row] of payload.data.entries()) {
    const label = `UN SDG ${SERIES} row ${index + 1}`
    if (row?.series !== SERIES) throw new Error(`${label}: unexpected series ${row?.series}`)
    if (!Array.isArray(row.indicator) || !row.indicator.includes(INDICATOR)) {
      throw new Error(`${label}: missing indicator ${INDICATOR}`)
    }

    const country = requireText(row.geoAreaName, `${label}.geoAreaName`)
    const { iso3 } = resolveCountry(country)
    const m49 = requireText(row.geoAreaCode, `${label}.geoAreaCode`)
    if (!/^\d{1,3}$/.test(m49) || Number(m49) < 1 || Number(m49) > 999) {
      throw new Error(`${label}: invalid M49 ${m49}`)
    }
    const year = Number(row.timePeriodStart)
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new Error(`${label}: invalid year ${JSON.stringify(row.timePeriodStart)}`)
    }
    const valuePercent = Number(row.value)
    if (!Number.isFinite(valuePercent) || valuePercent < 0 || valuePercent > 100) {
      throw new Error(`${label}: value ${JSON.stringify(row.value)} is outside 0-100 percent`)
    }

    const unit = requireText(row.attributes?.Units, `${label}.attributes.Units`)
    if (unit !== 'PERCENT') throw new Error(`${label}: unsupported unit ${unit}`)
    const nature = requireText(row.attributes?.Nature, `${label}.attributes.Nature`)
    if (!NATURE_CODES.has(nature)) throw new Error(`${label}: unsupported nature ${nature}`)
    const source = requireText(row.source, `${label}.source`)
    const reportingType = requireText(
      row.dimensions?.['Reporting Type'],
      `${label}.dimensions.Reporting Type`,
    )
    if (!REPORTING_TYPE_CODES.has(reportingType)) {
      throw new Error(`${label}: unsupported reporting type ${reportingType}`)
    }
    const key = `${iso3}|${year}|${nature}|${source}|${reportingType}`
    if (seen.has(key)) throw new Error(`duplicate UN SDG firearms-tracing key: ${key}`)
    seen.add(key)

    if (row.footnotes != null && !Array.isArray(row.footnotes)) {
      throw new Error(`${label}.footnotes must be an array`)
    }
    const footnotes = (row.footnotes ?? [])
      .map((note) => String(note ?? ''))
      .filter((note) => note.trim().length > 0)

    records.push({
      iso3,
      country,
      m49,
      year,
      valuePercent,
      nature,
      source,
      reportingType,
      footnotes,
    })
  }

  records.sort((a, b) => a.iso3.localeCompare(b.iso3)
    || a.year - b.year
    || a.source.localeCompare(b.source)
    || a.reportingType.localeCompare(b.reportingType)
    || a.nature.localeCompare(b.nature))

  return {
    meta: {
      schemaVersion: 'narcoscope.firearms-tracing.v1',
      source: 'United Nations Statistics Division — Global SDG Indicators Database',
      url: SDG_DATA_URL,
      series: SERIES,
      release: releaseCode,
      downloadedAt: new Date(retrievalClock).toISOString(),
      unit: 'percent',
      rights: 'United Nations data; retain source attribution and observe the UN website Terms of Use and the contributing custodian-agency terms.',
      caveats: [
        'Tracing effectiveness is not arms-flow volume: this percentage does not measure the count, value, direction or prevalence of illicit arms flows.',
        'The denominator is seized, found or surrendered arms reported through the SDG process; it is not all arms present or trafficked in a country.',
        'Missing country-years are unavailable, never zero. Footnotes, source, nature and reporting type must be read with each value.',
        'Country identity is mapped exactly to the bundled Natural Earth atlas. No person-level data or inferred actor/link relationship is present.',
      ],
    },
    records,
  }
}

async function fetchCompletePayload() {
  const pageSize = 1000
  const first = await fetchJsonWithRetry(`${SDG_DATA_URL}&page=1&pageSize=${pageSize}`)
  if (!Array.isArray(first?.data)) throw new Error('UN SDG first page has no data array')
  const totalPages = Number(first.totalPages ?? 1)
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error(`UN SDG returned invalid totalPages ${first.totalPages}`)
  }
  const totalElements = Number(first.totalElements)
  if (!Number.isInteger(totalElements) || totalElements < 1) {
    throw new Error(`UN SDG returned invalid totalElements ${first.totalElements}`)
  }
  const data = [...first.data]
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchJsonWithRetry(`${SDG_DATA_URL}&page=${page}&pageSize=${pageSize}`)
    if (!Array.isArray(next?.data)) throw new Error(`UN SDG page ${page} has no data array`)
    data.push(...next.data)
  }
  if (data.length !== totalElements) {
    throw new Error(`UN SDG pagination is incomplete: expected ${totalElements}, received ${data.length}`)
  }
  return { ...first, size: data.length, totalElements, totalPages: 1, pageNumber: 1, data }
}

async function loadSource(offline) {
  if (offline) {
    if (!fs.existsSync(CACHE_PATH)) throw new Error(`--offline but ${CACHE_PATH} is missing`)
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    return {
      payload: cached.payload,
      release: cached.release,
      downloadedAt: cached.downloadedAt,
    }
  }

  const [payload, indicatorPayload] = await Promise.all([
    fetchCompletePayload(),
    fetchJsonWithRetry(SDG_SERIES_URL),
  ])
  const cached = {
    schemaVersion: 'narcoscope.raw.un-sdg-vc-arm-sztrace.v1',
    downloadedAt: new Date().toISOString(),
    release: extractRelease(indicatorPayload),
    payload,
  }
  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cached)}\n`)
  return cached
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const offline = args.includes('--offline')
  const outFlag = args.indexOf('--out')
  const clockFlag = args.indexOf('--downloaded-at')
  const outPath = path.resolve(
    ROOT,
    outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'src/data/firearmsTracing.json',
  )
  const source = await loadSource(offline)
  if (clockFlag >= 0 && args[clockFlag + 1]) source.downloadedAt = args[clockFlag + 1]
  const artifact = buildFirearmsTracingArtifact(source.payload, source)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(artifact)}\n`)
  console.log(`firearms-tracing observations: ${artifact.records.length} across ${new Set(artifact.records.map((record) => record.iso3)).size} countries`)
  console.log(`UN SDG release: ${artifact.meta.release}; retrieved: ${artifact.meta.downloadedAt}`)
  console.log(`wrote ${outPath}`)
}
