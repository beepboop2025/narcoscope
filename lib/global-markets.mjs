import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { isIP } from 'node:net'

export const MARKET_DATASET_IDS = Object.freeze(['global-drugs', 'global-arms-economy'])
export const MARKET_DATA_SCHEMA = 'narcoscope.global-markets.v1'
export const MARKET_CATALOG_SCHEMA = 'narcoscope.global-market-catalog.v1'
export const MARKET_QUERY_SCHEMA = 'narcoscope.market-observations.v1'
export const MAX_MARKET_LIMIT = 500
export const MAX_MARKET_DATASET_BYTES = 128 * 1024 * 1024
const dataDirectory = fileURLToPath(new URL('../public/data/', import.meta.url))
const cache = new Map()
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/
const PERIOD = /^(?:18|19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/
const DIGEST = /^[a-f0-9]{64}$/
const QUERY_KEYS = ['dataset', 'indicator', 'geo', 'category', 'subgroup', 'from', 'to', 'page', 'limit']
export const MARKET_LIMITATIONS = Object.freeze([
  'Native source measures remain separate. This API does not aggregate indicators into market size or convert their units.',
  'Seizures and recorded offences depend on reporting and enforcement; they do not measure all illicit activity.',
  'Modeled estimates and expert scores are distinct from reported administrative observations. Null values are unavailable, not zero.',
  'Country, category, subgroup and reference period remain attached to every observation. Geography does not establish an actor relationship or a trafficking route.',
  'Pagination follows stable dataset, indicator, geography, category, subgroup and period order within the returned dataset hashes. Retain those hashes when collecting multiple pages.',
])
const RELATED = Object.freeze([
  { id: 'existing-atlas', title: 'Organized-crime scores and firearms tracing', url: '/api/v1/atlas',
    description: 'Existing GI-TOC and SDG tracing observations remain in their established atlas contract; they are not recounted in this catalog.' },
  { id: 'existing-seizures', title: 'Existing UNODC seizure history', url: 'https://github.com/beepboop2025/narcoscope/blob/main/src/data/seizures.json',
    description: 'Legacy source-table history remains separately inspectable. It is not added to the new catalog observation totals.' },
  { id: 'existing-prices', title: 'Existing historical drug-price series', url: 'https://github.com/beepboop2025/narcoscope/blob/main/src/data/priceSeries.json',
    description: 'Legacy nominal retail price history remains separately inspectable. It is not added to the new catalog observation totals.' },
])

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== keys.split(' ').sort().join('|')) throw new Error(`Global market ${label} contains unexpected or missing fields`)
}
function text(value, label, max = 2000, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Global market ${label} is not bounded text`)
}
function strings(value, label, maxItems = 60) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Global market ${label} is not a bounded list`)
  value.forEach(item => text(item, label))
}
function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Global market ${label} identity is invalid`)
}
function clock(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Global market ${label} clock is invalid`)
}
function url(value) {
  text(value, 'source URL', 4096)
  let parsed
  try { parsed = new URL(value) } catch { throw new Error('Global market source URL is invalid') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || isIP(parsed.hostname.replace(/^\[|\]$/g, '')) || !parsed.hostname.includes('.') || /\.(?:localhost|local|internal)$/.test(parsed.hostname)) throw new Error('Global market source URL must be public HTTPS metadata')
}
function nullableNumber(value) { return value === null || (typeof value === 'number' && Number.isFinite(value)) }
function rowKey(row) { return JSON.stringify([row.indicatorId, row.geoLevel, row.geoCode, row.category, row.subgroup, row.period]) }

export function validateMarketDataset(dataset, expectedId = dataset?.id) {
  exact(dataset, 'schema id title generatedAt sources indicators observations limitations', 'dataset')
  if (dataset.schema !== MARKET_DATA_SCHEMA || dataset.id !== expectedId || !MARKET_DATASET_IDS.includes(dataset.id)) throw new Error('Global market dataset identity changed')
  text(dataset.title, 'title', 240); clock(dataset.generatedAt, 'generation'); strings(dataset.limitations, 'limitations')
  if (!Array.isArray(dataset.sources) || !dataset.sources.length || dataset.sources.length > 80) throw new Error('Global market sources missing or oversized')
  const sources = new Map()
  for (const source of dataset.sources) {
    exact(source, 'id name publisher url downloadUrl license licenseUrl retrievedAt sha256 bytes notes', 'source')
    identifier(source.id, 'source')
    if (sources.has(source.id)) throw new Error('Duplicate global market source identity')
    for (const key of ['name', 'publisher', 'license']) text(source[key], key, 1000)
    for (const key of ['url', 'downloadUrl', 'licenseUrl']) url(source[key])
    if (/^(?:unknown|unavailable|restricted|private|permission.required|not.established)$/i.test(source.license)) throw new Error('Global market source lacks publication permission')
    clock(source.retrievedAt, 'retrieval')
    if (Date.parse(source.retrievedAt) > Date.parse(dataset.generatedAt)) throw new Error('Global market source retrieval follows dataset generation')
    if (typeof source.sha256 !== 'string' || !DIGEST.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes <= 0) throw new Error('Global market source bytes or digest invalid')
    strings(source.notes, 'source notes'); sources.set(source.id, source)
  }
  if (!Array.isArray(dataset.indicators) || !dataset.indicators.length || dataset.indicators.length > 500) throw new Error('Global market indicators missing or oversized')
  const indicators = new Map()
  for (const indicator of dataset.indicators) {
    exact(indicator, 'id sourceId market label unit measureType description limitations', 'indicator')
    identifier(indicator.id, 'indicator')
    if (indicators.has(indicator.id) || !sources.has(indicator.sourceId)) throw new Error('Duplicate indicator or missing source binding')
    if (!['drugs', 'arms', 'economy'].includes(indicator.market)) throw new Error('Unknown market kind')
    for (const key of ['label', 'unit', 'measureType', 'description']) text(indicator[key], key, key === 'description' ? 2500 : 500)
    strings(indicator.limitations, 'indicator limitations'); indicators.set(indicator.id, indicator)
  }
  if (!Array.isArray(dataset.observations) || dataset.observations.length > 500000) throw new Error('Global market observations missing or oversized')
  const identities = new Set(), cells = new Set(), geographyNames = new Map()
  for (const row of dataset.observations) {
    exact(row, 'id indicatorId geoCode geoName geoLevel period category subgroup value lower upper status sourceLocator', 'observation')
    identifier(row.id, 'observation')
    if (identities.has(row.id)) throw new Error('Duplicate global market observation identity')
    identities.add(row.id)
    if (!indicators.has(row.indicatorId)) throw new Error('Global market observation lacks indicator/source binding')
    for (const key of ['geoCode', 'geoName']) text(row[key], key, 180)
    if (!['country', 'region', 'city', 'world'].includes(row.geoLevel)) throw new Error('Unknown geographic level')
    if (typeof row.period !== 'string' || !PERIOD.test(row.period)) throw new Error('Invalid annual or monthly reference period')
    text(row.category, 'category', 500, true); text(row.subgroup, 'subgroup', 500, true); text(row.sourceLocator, 'source locator', 2000)
    if (!['reported', 'estimated', 'unavailable'].includes(row.status) || ![row.value, row.lower, row.upper].every(nullableNumber)) throw new Error('Invalid observation status or numeric value')
    if ((row.value === null) !== (row.status === 'unavailable')) throw new Error('Missing values must be unavailable rather than reported or zero')
    if (row.value === null && (row.lower !== null || row.upper !== null)) throw new Error('Unavailable observations cannot carry numeric bounds')
    if ((row.lower !== null && row.value < row.lower) || (row.upper !== null && row.value > row.upper) || (row.lower !== null && row.upper !== null && row.lower > row.upper)) throw new Error('Observation uncertainty bounds do not contain its value')
    const key = rowKey(row)
    if (cells.has(key)) throw new Error('Duplicate indicator/geography/category/subgroup/period cell')
    cells.add(key)
    // Different source indicators may use different historical country labels.
    // Each indicator's dimension list must still identify a code consistently.
    const geoKey = `${row.indicatorId}:${row.geoLevel}:${row.geoCode}`
    if (geographyNames.has(geoKey) && geographyNames.get(geoKey) !== row.geoName) throw new Error('One geography code has conflicting names')
    geographyNames.set(geoKey, row.geoName)
  }
  return dataset
}

const digest = raw => createHash('sha256').update(raw).digest('hex')
function coverage(rows) {
  const periods = rows.map(row => row.period).sort()
  const numericPeriods = rows.filter(row => row.value !== null).map(row => row.period).sort()
  return { observations: rows.length, numericObservations: rows.filter(row => row.value !== null).length, reported: rows.filter(row => row.status === 'reported').length,
    estimated: rows.filter(row => row.status === 'estimated').length, unavailable: rows.filter(row => row.status === 'unavailable').length,
    firstPeriod: periods[0] ?? null, lastPeriod: periods.at(-1) ?? null,
    firstNumericPeriod: numericPeriods[0] ?? null, lastNumericPeriod: numericPeriods.at(-1) ?? null }
}
function compareRows(a, b) {
  for (const key of ['indicatorId', 'geoLevel', 'geoCode', 'category', 'subgroup', 'period', 'id']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  return 0
}
function summarize(dataset, sha256) {
  const counts = new Map(dataset.indicators.map(indicator => [indicator.id, []]))
  dataset.observations.forEach(row => counts.get(row.indicatorId).push(row))
  const featuredByMarket = new Map()
  const preferred = ['wdr2026-seizures-kg', 'wdi-arms-imports-tiv', 'wb-informal-dge-p']
  for (const indicator of [...preferred.map(id => dataset.indicators.find(item => item.id === id)).filter(Boolean), ...dataset.indicators]) {
    if (!featuredByMarket.has(indicator.market) && counts.get(indicator.id).some(row => row.value !== null)) featuredByMarket.set(indicator.market, indicator.id)
  }
  const indicators = dataset.indicators.map(indicator => {
    const rows = counts.get(indicator.id), geographies = new Map()
    rows.forEach(row => geographies.set(`${row.geoLevel}:${row.geoCode}`, { code: row.geoCode, name: row.geoName, level: row.geoLevel }))
    const featured = featuredByMarket.get(indicator.market) === indicator.id
    const groups = new Map()
    for (const row of rows) {
      const key = JSON.stringify([row.category, row.subgroup])
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    const selections = [...groups.values()].map(group => {
      const span = coverage(group)
      return { category: group[0].category, subgroup: group[0].subgroup,
        firstPeriod: span.firstPeriod, lastPeriod: span.lastPeriod,
        lastNumericPeriod: span.lastNumericPeriod,
        latestNumericObservations: group.filter(row => row.period === span.lastNumericPeriod && row.value !== null).length }
    }).sort((a, b) => (b.lastNumericPeriod ?? '').localeCompare(a.lastNumericPeriod ?? '') || b.latestNumericObservations - a.latestNumericObservations || a.category.localeCompare(b.category) || a.subgroup.localeCompare(b.subgroup))
    return { ...indicator, featured, coverage: coverage(rows), dimensions: {
      geographies: [...geographies.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      categories: [...new Set(rows.map(row => row.category))].sort(), subgroups: [...new Set(rows.map(row => row.subgroup))].sort(), selections,
    } }
  })
  return { id: dataset.id, title: dataset.title, generatedAt: dataset.generatedAt, sha256,
    sources: dataset.sources, indicators, coverage: coverage(dataset.observations), limitations: dataset.limitations }
}

async function loadOne(id, directory) {
  const path = join(directory, `${id}-v1.json`)
  let info
  try { info = await stat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (!info.isFile() || info.size > MAX_MARKET_DATASET_BYTES) throw new Error('Global market dataset exceeds its file boundary')
  const signature = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
  const prior = cache.get(path)
  if (prior?.signature === signature) return prior.promise
  const promise = (async () => {
    const raw = await readFile(path)
    if (raw.length > MAX_MARKET_DATASET_BYTES) throw new Error('Global market dataset grew beyond its file boundary')
    let dataset
    try { dataset = validateMarketDataset(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), id) }
    catch (cause) { throw new Error('Global market published artifact failed validation', { cause }) }
    const sha256 = digest(raw)
    const summary = summarize(dataset, sha256)
    return { dataset, sha256, summary, rows: [...dataset.observations].sort(compareRows) }
  })()
  cache.set(path, { signature, promise })
  try { return await promise } catch (error) { if (cache.get(path)?.promise === promise) cache.delete(path); throw error }
}

async function loadAll({ marketDataDir = dataDirectory } = {}) {
  const loaded = await Promise.all(MARKET_DATASET_IDS.map(id => loadOne(id, marketDataDir)))
  return { loaded: loaded.filter(Boolean), unavailable: MARKET_DATASET_IDS.filter((_, index) => loaded[index] === null) }
}

export async function getMarketCatalog(_params = {}, dependencies = {}) {
  const { loaded, unavailable } = await loadAll(dependencies)
  return structuredClone({ schema: MARKET_CATALOG_SCHEMA, status: !loaded.length ? 'unavailable' : unavailable.length ? 'partial' : 'available',
    generatedAt: latestClock(loaded),
    datasets: loaded.map(row => row.summary), unavailableDatasets: unavailable,
    relatedResources: RELATED, limitations: MARKET_LIMITATIONS })
}
const latestClock = items => items.map(item => item.dataset.generatedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null

function parseInteger(value, name, fallback, max) {
  if (value === undefined || value === null) return fallback
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new TypeError(`${name} must be an integer from 1 to ${max}`)
  return Number(value)
}
function parseFilters(params) {
  for (const key of Object.keys(params)) if (!QUERY_KEYS.includes(key) && params[key] !== undefined && params[key] !== null) throw new TypeError(`Unknown market query parameter: ${key}`)
  const filters = {}
  for (const key of QUERY_KEYS.filter(key => !['page', 'limit'].includes(key))) {
    const value = params[key]
    if (value === undefined || value === null) { filters[key] = null; continue }
    if (typeof value !== 'string' || value.length > (key === 'indicator' ? 160 : key === 'geo' ? 180 : 500) || /[\u0000-\u001f]/.test(value) || (!['category', 'subgroup'].includes(key) && !value.length)) throw new TypeError(`${key} must be bounded text`)
    filters[key] = value
  }
  if (filters.dataset !== null && !MARKET_DATASET_IDS.includes(filters.dataset)) throw new TypeError('Unknown market dataset')
  for (const key of ['from', 'to']) if (filters[key] !== null && !PERIOD.test(filters[key])) throw new TypeError(`${key} must be YYYY or YYYY-MM`)
  if (filters.from && filters.to && startPeriod(filters.from) > endPeriod(filters.to)) throw new TypeError('from must not follow to')
  return { filters, page: parseInteger(params.page, 'page', 1, 1000000), limit: parseInteger(params.limit, 'limit', 200, MAX_MARKET_LIMIT) }
}
const startPeriod = period => period.length === 4 ? `${period}-01` : period
const endPeriod = period => period.length === 4 ? `${period}-12` : period

export async function queryMarketObservations(params = {}, dependencies = {}) {
  const { filters, page, limit } = parseFilters(params)
  const { loaded, unavailable } = await loadAll(dependencies)
  const selected = loaded.filter(item => filters.dataset === null || item.dataset.id === filters.dataset)
  if (filters.indicator !== null && selected.length && !selected.some(item => item.dataset.indicators.some(indicator => indicator.id === filters.indicator))) throw new TypeError('Unknown indicator for the selected market dataset')
  const slice = []
  let total = 0
  const offset = (page - 1) * limit
  for (const item of selected) {
    for (const row of item.rows) {
      if (filters.indicator !== null && row.indicatorId !== filters.indicator) continue
      if (filters.geo !== null && row.geoCode !== filters.geo) continue
      if (filters.category !== null && row.category !== filters.category) continue
      if (filters.subgroup !== null && row.subgroup !== filters.subgroup) continue
      // A monthly filter does not disaggregate a wider annual observation.
      if (filters.from !== null && startPeriod(row.period) < startPeriod(filters.from)) continue
      if (filters.to !== null && endPeriod(row.period) > endPeriod(filters.to)) continue
      if (total >= offset && slice.length < limit) slice.push({ item, row })
      total += 1
    }
  }
  const indicatorRefs = new Map(), sourceRefs = new Map()
  const observations = slice.map(({ item, row }) => {
    const indicator = item.dataset.indicators.find(candidate => candidate.id === row.indicatorId)
    const source = item.dataset.sources.find(candidate => candidate.id === indicator.sourceId)
    indicatorRefs.set(`${item.dataset.id}:${indicator.id}`, { ...indicator, datasetId: item.dataset.id })
    sourceRefs.set(`${item.dataset.id}:${source.id}`, { ...source, datasetId: item.dataset.id })
    return { ...row, datasetId: item.dataset.id, sourceId: source.id, unit: indicator.unit, measureType: indicator.measureType }
  })
  const missing = unavailable.filter(id => filters.dataset === null || filters.dataset === id)
  return structuredClone({ schema: MARKET_QUERY_SCHEMA, status: !selected.length ? 'unavailable' : missing.length ? 'partial' : 'available',
    generatedAt: latestClock(selected), filters,
    pagination: { page, limit, total, pages: Math.ceil(total / limit), nextPage: page * limit < total ? page + 1 : null },
    datasets: selected.map(item => ({ id: item.dataset.id, sha256: item.sha256, generatedAt: item.dataset.generatedAt })),
    unavailableDatasets: missing, indicators: [...indicatorRefs.values()], sources: [...sourceRefs.values()], observations, limitations: MARKET_LIMITATIONS })
}

export const MARKET_QUERY_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    dataset: { type: 'string', enum: MARKET_DATASET_IDS }, indicator: { type: 'string', minLength: 1, maxLength: 160 },
    geo: { type: 'string', minLength: 1, maxLength: 180 }, category: { type: 'string', maxLength: 500 }, subgroup: { type: 'string', maxLength: 500 },
    from: { type: 'string', pattern: '^(18|19|20|21)[0-9]{2}(-(0[1-9]|1[0-2]))?$' }, to: { type: 'string', pattern: '^(18|19|20|21)[0-9]{2}(-(0[1-9]|1[0-2]))?$' },
    page: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: MAX_MARKET_LIMIT, default: 200 },
  },
}
