import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CURSOR_VERSION = 1
const ISO3_RE = /^[A-Z]{3}$/
const YEAR_RE = /^\d{4}$/
const ENTITY_TYPES = new Set(['aircraft', 'individual', 'organization', 'vessel'])
const PROGRAMS = new Set(['ILLICIT-DRUGS-EO14059', 'SDNT', 'SDNTK', 'TCO'])
const ATLAS_DOMAINS = new Set(['all', 'firearms_tracing', 'organized_crime'])

const DATA_FILES = Object.freeze({
  organized_crime: new URL('../../src/data/organizedCrime.json', import.meta.url),
  firearms_tracing: new URL('../../src/data/firearmsTracing.json', import.meta.url),
  entities: new URL('../../src/data/designations.json', import.meta.url),
})

const DATA_FILE_LABELS = Object.freeze({
  organized_crime: 'src/data/organizedCrime.json',
  firearms_tracing: 'src/data/firearmsTracing.json',
  entities: 'src/data/designations.json',
})

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function stringArray(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(nonEmpty)
}

function nullableScore(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  )
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalHash(value) {
  return sha256(JSON.stringify(canonicalize(value)))
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key))
}

function requireExactKeys(value, expected, label) {
  if (!exactKeys(value, expected)) throw new Error(`${label} fields do not match the admitted contract`)
}

function parseLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}`)
  }
  if (typeof value !== 'string' && (!Number.isInteger(value) || typeof value === 'boolean')) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_LIMIT}`)
  }
  return parsed
}

function parseIso3(value) {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim().toUpperCase()
  if (!ISO3_RE.test(normalized)) throw new TypeError('iso3 must be exactly three ASCII letters')
  return normalized
}

function parseYear(value) {
  if (value === undefined || value === null) return null
  const raw = String(value)
  if (!YEAR_RE.test(raw)) throw new TypeError('year must be a four-digit integer from 1900 to 2200')
  const year = Number(raw)
  if (year < 1900 || year > 2200) {
    throw new TypeError('year must be a four-digit integer from 1900 to 2200')
  }
  return year
}

function parseAtlasDomain(value) {
  if (value === undefined || value === null) return 'all'
  const domain = String(value)
  if (!ATLAS_DOMAINS.has(domain)) {
    throw new TypeError('domain must be all, firearms_tracing, or organized_crime')
  }
  return domain
}

function parseOptionalText(value, field, maxLength = 160) {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string no longer than ${maxLength} characters`)
  }
  return normalized
}

function parseEntityType(value) {
  const normalized = parseOptionalText(value, 'entity_type', 32)
  if (normalized === null) return null
  if (!ENTITY_TYPES.has(normalized)) {
    throw new TypeError('entity_type must be aircraft, individual, organization, or vessel')
  }
  return normalized
}

function parseProgram(value) {
  const normalized = parseOptionalText(value, 'program', 64)
  if (normalized === null) return null
  if (!PROGRAMS.has(normalized)) {
    throw new TypeError('program must be ILLICIT-DRUGS-EO14059, SDNT, SDNTK, or TCO')
  }
  return normalized
}

function filterFingerprint(resource, filters) {
  return sha256(JSON.stringify({ resource, ...filters }))
}

function encodeCursor(filters, after) {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, filters, after }), 'utf8').toString('base64url')
}

function decodeCursor(value, expectedFilters, keyValidator) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('cursor is malformed')
  }
  let decoded
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('non-canonical base64url')
    decoded = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new TypeError('cursor is malformed')
  }
  if (
    !exactKeys(decoded, ['v', 'filters', 'after'])
    || decoded.v !== CURSOR_VERSION
    || decoded.filters !== expectedFilters
    || !keyValidator(decoded.after)
  ) {
    throw new TypeError('cursor does not match this resource and filter set')
  }
  return decoded.after
}

function compareKeys(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue
    return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function pageByCursor(rows, limit, after, keyOf, filters) {
  const start = after === null
    ? 0
    : rows.findIndex((row) => compareKeys(keyOf(row), after) > 0)
  const normalizedStart = start === -1 ? rows.length : start
  const pageRows = rows.slice(normalizedStart, normalizedStart + limit)
  const hasMore = normalizedStart + pageRows.length < rows.length
  return {
    rows: pageRows,
    page: {
      limit,
      matched: rows.length,
      returned: pageRows.length,
      has_more: hasMore,
      next_cursor: hasMore
        ? encodeCursor(filters, keyOf(pageRows[pageRows.length - 1]))
        : null,
    },
  }
}

async function defaultReadData(domain) {
  const raw = await readFile(DATA_FILES[domain], 'utf8')
  return JSON.parse(raw)
}

function sourceUnavailable(domain, reasonCode) {
  return {
    domain,
    status: 'unavailable',
    record_count: null,
    metadata: null,
    error: {
      code: reasonCode,
      message: `${DATA_FILE_LABELS[domain]} is unavailable; absence is not zero coverage.`,
    },
  }
}

function requireIso3(value, label) {
  if (typeof value !== 'string' || !ISO3_RE.test(value)) throw new Error(`${label}.iso3 is invalid`)
}

function requireYear(value, label) {
  if (!Number.isInteger(value) || value < 1900 || value > 2200) throw new Error(`${label}.year is invalid`)
}

const ORGANIZED_MARKET_FIELDS = Object.freeze([
  'humanTrafficking',
  'humanSmuggling',
  'extortion',
  'armsTrafficking',
  'counterfeitGoods',
  'illicitTradeExcisableGoods',
  'floraCrimes',
  'faunaCrimes',
  'nonRenewableResourceCrimes',
  'heroinTrade',
  'cocaineTrade',
  'cannabisTrade',
  'syntheticDrugTrade',
  'cyberDependentCrimes',
  'financialCrimes',
])

const ORGANIZED_ACTOR_FIELDS = Object.freeze([
  'average',
  'mafiaStyleGroups',
  'criminalNetworks',
  'stateEmbeddedActors',
  'foreignActors',
  'privateSectorActors',
])

const ORGANIZED_RESILIENCE_FIELDS = Object.freeze([
  'average',
  'politicalLeadershipAndGovernance',
  'governmentTransparencyAndAccountability',
  'internationalCooperation',
  'nationalPoliciesAndLaws',
  'judicialSystemAndDetention',
  'lawEnforcement',
  'territorialIntegrity',
  'antiMoneyLaundering',
  'economicRegulatoryCapacity',
  'victimAndWitnessSupport',
  'prevention',
  'nonStateActors',
])

function validateScoreObject(value, fields, label) {
  requireExactKeys(value, fields, label)
  for (const field of fields) {
    if (!nullableScore(value[field])) throw new Error(`${label}.${field} is outside the admitted score scale`)
  }
}

function validateOrganizedCrime(payload) {
  requireExactKeys(payload, ['meta', 'records'], 'organized crime dataset')
  const { meta, records } = payload
  requireExactKeys(meta, [
    'schemaVersion', 'source', 'url', 'downloadedAt', 'years', 'scale', 'rights', 'caveats',
  ], 'organized crime metadata')
  if (
    meta.schemaVersion !== 'narcoscope.organized-crime.v1'
    || !nonEmpty(meta.source)
    || !nonEmpty(meta.url)
    || !nonEmpty(meta.downloadedAt)
    || !Array.isArray(meta.years)
    || !meta.years.every((year) => Number.isInteger(year) && year >= 1900 && year <= 2200)
    || !nonEmpty(meta.rights)
    || !stringArray(meta.caveats)
  ) throw new Error('organized crime metadata is invalid')
  requireExactKeys(meta.scale, ['minimum', 'maximum', 'direction'], 'organized crime scale')
  if (meta.scale.minimum !== 1 || meta.scale.maximum !== 10 || !nonEmpty(meta.scale.direction)) {
    throw new Error('organized crime score scale is invalid')
  }
  if (!Array.isArray(records)) throw new Error('organized crime records must be an array')
  const identities = new Set()
  for (const [index, record] of records.entries()) {
    const label = `organized crime record ${index}`
    requireExactKeys(record, [
      'iso3', 'country', 'continent', 'region', 'year', 'criminality', 'criminalMarkets',
      'markets', 'actors', 'resilience',
    ], label)
    requireIso3(record.iso3, label)
    requireYear(record.year, label)
    if (
      !nonEmpty(record.country)
      || !nonEmpty(record.continent)
      || !nonEmpty(record.region)
      || !nullableScore(record.criminality)
      || !nullableScore(record.criminalMarkets)
    ) throw new Error(`${label} identity or headline score is invalid`)
    validateScoreObject(record.markets, ORGANIZED_MARKET_FIELDS, `${label}.markets`)
    validateScoreObject(record.actors, ORGANIZED_ACTOR_FIELDS, `${label}.actors`)
    validateScoreObject(record.resilience, ORGANIZED_RESILIENCE_FIELDS, `${label}.resilience`)
    const identity = `${record.iso3}:${record.year}`
    if (identities.has(identity)) throw new Error(`organized crime dataset repeats ${identity}`)
    identities.add(identity)
  }
  return payload
}

function validateFirearmsTracing(payload) {
  requireExactKeys(payload, ['meta', 'records'], 'firearms tracing dataset')
  const { meta, records } = payload
  requireExactKeys(meta, [
    'schemaVersion', 'source', 'url', 'series', 'release', 'downloadedAt', 'unit', 'rights', 'caveats',
  ], 'firearms tracing metadata')
  if (
    meta.schemaVersion !== 'narcoscope.firearms-tracing.v1'
    || !nonEmpty(meta.source)
    || !nonEmpty(meta.url)
    || meta.series !== 'VC_ARM_SZTRACE'
    || !nonEmpty(meta.release)
    || !nonEmpty(meta.downloadedAt)
    || meta.unit !== 'percent'
    || !nonEmpty(meta.rights)
    || !stringArray(meta.caveats)
  ) throw new Error('firearms tracing metadata is invalid')
  if (!Array.isArray(records)) throw new Error('firearms tracing records must be an array')
  const identities = new Set()
  for (const [index, record] of records.entries()) {
    const label = `firearms tracing record ${index}`
    requireExactKeys(record, [
      'iso3', 'country', 'm49', 'year', 'valuePercent', 'nature', 'source', 'reportingType', 'footnotes',
    ], label)
    requireIso3(record.iso3, label)
    requireYear(record.year, label)
    if (
      !nonEmpty(record.country)
      || typeof record.m49 !== 'string'
      || !/^[0-9]{1,3}$/.test(record.m49)
      || (record.valuePercent !== null && (
        typeof record.valuePercent !== 'number'
        || !Number.isFinite(record.valuePercent)
        || record.valuePercent < 0
        || record.valuePercent > 100
      ))
      || !nonEmpty(record.nature)
      || !nonEmpty(record.source)
      || !nonEmpty(record.reportingType)
      || !stringArray(record.footnotes)
    ) throw new Error(`${label} contains an invalid value`)
    const identity = canonicalHash(record)
    if (identities.has(identity)) throw new Error('firearms tracing dataset contains a duplicate record')
    identities.add(identity)
  }
  return payload
}

function nullPaths(value, prefix = '') {
  if (value === null) return [prefix]
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, child]) => (
    nullPaths(child, prefix ? `${prefix}.${key}` : key)
  ))
}

function projectOrganizedSource(payload) {
  return {
    domain: 'organized_crime',
    status: 'available',
    record_count: payload.records.length,
    metadata: {
      schema_version: payload.meta.schemaVersion,
      source: payload.meta.source,
      source_url: payload.meta.url,
      downloaded_at: payload.meta.downloadedAt,
      years: payload.meta.years,
      unit: 'index_score',
      rights: payload.meta.rights,
      scale: payload.meta.scale,
      series: null,
      release: null,
      caveats: payload.meta.caveats,
    },
    error: null,
  }
}

function projectFirearmsSource(payload) {
  return {
    domain: 'firearms_tracing',
    status: 'available',
    record_count: payload.records.length,
    metadata: {
      schema_version: payload.meta.schemaVersion,
      source: payload.meta.source,
      source_url: payload.meta.url,
      downloaded_at: payload.meta.downloadedAt,
      years: [...new Set(payload.records.map((record) => record.year))].sort((a, b) => a - b),
      unit: payload.meta.unit,
      rights: payload.meta.rights,
      scale: null,
      series: payload.meta.series,
      release: payload.meta.release,
      caveats: payload.meta.caveats,
    },
    error: null,
  }
}

function recordMeta(source, record) {
  const unavailableFields = nullPaths(record)
  return {
    availability: unavailableFields.length ? 'partial' : 'observed',
    unavailable_fields: unavailableFields,
    source_schema: source.metadata.schema_version,
    source: source.metadata.source,
    source_url: source.metadata.source_url,
    downloaded_at: source.metadata.downloaded_at,
    rights: source.metadata.rights,
    caveats: source.metadata.caveats,
  }
}

function atlasKey(row) {
  return [row.domain, row.data.iso3, row.data.year, canonicalHash(row.data)]
}

function validAtlasKey(value) {
  return Array.isArray(value)
    && value.length === 4
    && ['firearms_tracing', 'organized_crime'].includes(value[0])
    && typeof value[1] === 'string'
    && ISO3_RE.test(value[1])
    && Number.isInteger(value[2])
    && value[2] >= 1900
    && value[2] <= 2200
    && typeof value[3] === 'string'
    && /^[0-9a-f]{64}$/.test(value[3])
}

async function loadAtlasSource(domain, readData) {
  try {
    const payload = await readData(domain)
    const validated = domain === 'organized_crime'
      ? validateOrganizedCrime(payload)
      : validateFirearmsTracing(payload)
    const source = domain === 'organized_crime'
      ? projectOrganizedSource(validated)
      : projectFirearmsSource(validated)
    return { source, records: validated.records }
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'source_file_missing' : 'source_contract_invalid'
    return { source: sourceUnavailable(domain, code), records: [] }
  }
}

export async function getAtlas(params = {}, { readData = defaultReadData } = {}) {
  const domain = parseAtlasDomain(params.domain)
  const iso3 = parseIso3(params.iso3)
  const year = parseYear(params.year)
  const limit = parseLimit(params.limit)
  const domains = domain === 'all' ? ['firearms_tracing', 'organized_crime'] : [domain]
  const filters = filterFingerprint('atlas', { domain, iso3, year })
  const after = decodeCursor(params.cursor, filters, validAtlasKey)
  const loaded = await Promise.all(domains.map((name) => loadAtlasSource(name, readData)))
  const sources = loaded.map(({ source }) => source)
  const rows = loaded.flatMap(({ source, records }) => records.map((record) => ({
    domain: source.domain,
    meta: recordMeta(source, record),
    data: record,
  }))).filter((row) => (
    (iso3 === null || row.data.iso3 === iso3)
    && (year === null || row.data.year === year)
  )).sort((left, right) => compareKeys(atlasKey(left), atlasKey(right)))
  const page = pageByCursor(rows, limit, after, atlasKey, filters)
  const available = sources.filter((source) => source.status === 'available').length
  const status = available === 0 ? 'unavailable' : available === sources.length ? 'available' : 'partial'
  return {
    schema: 'narcoscope.api.atlas.v1',
    status,
    query: { domain, iso3, year },
    sources,
    page: page.page,
    records: page.rows,
    limitations: [
      'Source scores and tracing percentages retain their native definitions; they are not combined into one illicit-economy score.',
      'A null value is unavailable for that source edition and is never converted to zero.',
      'Country-level and annual records do not identify a person, organization, operational route, or precise location.',
      'Administrative and index observations are descriptive context, not causal or culpability findings.',
    ],
  }
}

function validateDesignations(payload) {
  requireExactKeys(payload, ['meta', 'records'], 'designation dataset')
  const { meta, records } = payload
  if (
    !isRecord(meta)
    || !nonEmpty(meta.source)
    || !nonEmpty(meta.url)
    || !nonEmpty(meta.downloaded)
    || !nonEmpty(meta.license)
    || !nonEmpty(meta.grain)
    || !nonEmpty(meta.note)
    || !isRecord(meta.programs)
    || !Array.isArray(records)
  ) throw new Error('designation metadata is invalid')
  if (Object.keys(meta.programs).some((program) => !PROGRAMS.has(program))) {
    throw new Error('designation program registry is invalid')
  }
  const identities = new Set()
  for (const [index, record] of records.entries()) {
    const label = `designation record ${index}`
    requireExactKeys(record, ['entityNumber', 'name', 'entityType', 'programs', 'countries', 'aliases'], label)
    if (
      !Number.isSafeInteger(record.entityNumber)
      || record.entityNumber < 1
      || !nonEmpty(record.name)
      || !ENTITY_TYPES.has(record.entityType)
      || !stringArray(record.programs, { allowEmpty: false })
      || record.programs.some((program) => !PROGRAMS.has(program))
      || !stringArray(record.countries)
      || !stringArray(record.aliases)
    ) throw new Error(`${label} is invalid`)
    if (identities.has(record.entityNumber)) {
      throw new Error(`designation dataset repeats entity number ${record.entityNumber}`)
    }
    identities.add(record.entityNumber)
  }
  return payload
}

function entityKey(record) {
  return [record.name.toLocaleLowerCase('en-US'), record.entityNumber]
}

function validEntityKey(value) {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'string'
    && value[0].length > 0
    && Number.isSafeInteger(value[1])
    && value[1] > 0
}

function entityUnavailable(reasonCode) {
  return {
    schema: 'narcoscope.api.entities.v1',
    status: 'unavailable',
    query: {
      entity_type: null,
      program: null,
      country: null,
      query: null,
    },
    source: null,
    page: {
      limit: DEFAULT_LIMIT,
      matched: 0,
      returned: 0,
      has_more: false,
      next_cursor: null,
    },
    records: [],
    disclaimer: 'The public designation file is unavailable. Absence is not evidence that no designation exists; consult OFAC directly.',
    privacy: {
      returned_fields: ['ofac_entity_number', 'name', 'entity_type', 'programs', 'countries'],
      withheld_fields: ['aliases', 'addresses', 'dates_of_birth', 'identity_documents', 'free_text_allegations'],
      query_scope: 'canonical OFAC designation name only',
    },
    error: {
      code: reasonCode,
      message: `${DATA_FILE_LABELS.entities} is unavailable; no designation coverage is asserted.`,
    },
  }
}

export async function getEntities(params = {}, { readData = defaultReadData } = {}) {
  const entityType = parseEntityType(params.entity_type)
  const program = parseProgram(params.program)
  const country = parseOptionalText(params.country, 'country', 120)
  const query = parseOptionalText(params.query, 'query', 120)
  const limit = parseLimit(params.limit)
  const filters = filterFingerprint('entities', {
    entity_type: entityType,
    program,
    country: country?.toLocaleLowerCase('en-US') ?? null,
    query: query?.toLocaleLowerCase('en-US') ?? null,
  })
  const after = decodeCursor(params.cursor, filters, validEntityKey)
  let payload
  try {
    payload = validateDesignations(await readData('entities'))
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'source_file_missing' : 'source_contract_invalid'
    const unavailable = entityUnavailable(code)
    unavailable.query = { entity_type: entityType, program, country, query }
    unavailable.page.limit = limit
    return unavailable
  }
  const countryNeedle = country?.toLocaleLowerCase('en-US') ?? null
  const queryNeedle = query?.toLocaleLowerCase('en-US') ?? null
  const rows = payload.records.filter((record) => (
    (entityType === null || record.entityType === entityType)
    && (program === null || record.programs.includes(program))
    && (countryNeedle === null || record.countries.some(
      (value) => value.toLocaleLowerCase('en-US') === countryNeedle,
    ))
    && (queryNeedle === null || record.name.toLocaleLowerCase('en-US').includes(queryNeedle))
  )).sort((left, right) => compareKeys(entityKey(left), entityKey(right)))
  const page = pageByCursor(rows, limit, after, entityKey, filters)
  const records = page.rows.map((record) => ({
    ofac_entity_number: record.entityNumber,
    name: record.name,
    entity_type: record.entityType,
    programs: record.programs,
    countries: record.countries,
    meta: {
      evidence_class: 'administrative_action',
      adjudication: false,
      source: payload.meta.source,
      source_url: payload.meta.url,
      downloaded_at: payload.meta.downloaded,
    },
  }))
  return {
    schema: 'narcoscope.api.entities.v1',
    status: 'available',
    query: { entity_type: entityType, program, country, query },
    source: {
      source: payload.meta.source,
      source_url: payload.meta.url,
      downloaded_at: payload.meta.downloaded,
      license: payload.meta.license,
      grain: payload.meta.grain,
      programs: payload.meta.programs,
      note: payload.meta.note,
    },
    page: page.page,
    records,
    disclaimer: 'An OFAC designation is a published administrative action under a stated authority. It is not an adjudication or proof of guilt, and OFAC may delist an entry; check the live list before relying on a row.',
    privacy: {
      returned_fields: ['ofac_entity_number', 'name', 'entity_type', 'programs', 'countries'],
      withheld_fields: ['aliases', 'addresses', 'dates_of_birth', 'identity_documents', 'free_text_allegations'],
      query_scope: 'canonical OFAC designation name only',
    },
    error: null,
  }
}

export const __test = Object.freeze({
  decodeCursor,
  encodeCursor,
  validateDesignations,
  validateFirearmsTracing,
  validateOrganizedCrime,
})
