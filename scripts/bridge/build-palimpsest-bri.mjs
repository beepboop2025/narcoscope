#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  BRI_ARTIFACT_FILE,
  BRI_HASH_FILE,
  BRI_PIN_SCHEMA_VERSION,
  BRI_SCHEMA_FILE,
  BRI_SCHEMA_ID,
  BRI_SCHEMA_VERSION,
  BUILD_READY_STATES,
  COUNTRY_LABELS,
  COUNTRY_ORDER,
  IMPLEMENTATION_STATES,
  TARGET_AREAS,
  assertPalimpsestBriBoundary,
  assertPalimpsestBriPin,
  compilePalimpsestBriSchema,
  requireCommit,
  requireGitOid,
  requireInteger,
  requireObject,
  requireSha256,
  requireString,
} from '../../lib/palimpsest-bri-contract.mjs'

export {
  BRI_ARTIFACT_FILE,
  BRI_HASH_FILE,
  BRI_PIN_SCHEMA_VERSION,
  BRI_SCHEMA_FILE,
  BRI_SCHEMA_VERSION,
  assertPalimpsestBriBoundary,
  assertPalimpsestBriPin,
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '../..')
export const DEFAULT_BRI_PIN = path.join(scriptDir, 'palimpsest-bri-source-pin.json')
export const DEFAULT_BRI_OUTPUT = path.join(defaultRoot, 'public/data', BRI_ARTIFACT_FILE)
export const DEFAULT_BRI_HASH_OUTPUT = path.join(defaultRoot, 'public/data', BRI_HASH_FILE)
export const DEFAULT_BRI_SCHEMA = path.join(defaultRoot, 'public/data', BRI_SCHEMA_FILE)

const execFile = promisify(execFileCallback)
const GIT_MAX_BUFFER = 16 * 1024 * 1024
const RAILWAY_CRITICAL_PATHS = Object.freeze([
  '.well-known/ai-catalog.json',
  'belt-and-road/index.html',
  'index.html',
  'openapi.json',
  'protocol/bri-economic-observations-v1.schema.json',
  'protocol/bri-wdi-pages-publication-v1.schema.json',
  'readings/belt-and-road-observatory-latest.json',
  'readings/bri-economic-observations-latest.json',
  'server.json',
])
// Palimpsest's rights stage replaces openapi.json with a fail-closed status
// document before sealing the Railway tree. It remains manifest/tree-bound,
// while the other bridge-critical inputs must also match their exact Git blobs.
const RAILWAY_GIT_BOUND_CRITICAL_PATHS = Object.freeze(
  RAILWAY_CRITICAL_PATHS.filter((criticalPath) => criticalPath !== 'openapi.json'),
)
const ECONOMICS_SCHEMA_ID = 'https://palimpsest.info/protocol/bri-economic-observations-v1.schema.json'
const WDI_REGISTRY_PATH = 'config/bri_wdi_series.json'
const ECONOMICS_SCHEMA_PATH = 'protocol/bri-economic-observations-v1.schema.json'
const ECONOMICS_PATH = 'readings/bri-economic-observations-latest.json'
const CHINA_PUBLICATION_RIGHTS_PATH = 'readings/china-publication-rights-latest.json'
const COUNTRY_API_IDS = Object.freeze({ CHN: 'CN', MMR: 'MM', PAK: 'PK' })

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`
const uniqueSorted = (values) => [...new Set(values)].sort(compareText)

function countBy(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => compareText(a, b)))
}

function implementationStateCounts(sources) {
  return Object.fromEntries(IMPLEMENTATION_STATES.map((state) => [
    state,
    sources.filter((source) => source.implementationState === state).length,
  ]))
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }
}

function rawDescriptor(raw, extra = {}) {
  return { bytes: raw.length, sha256: sha256(raw), ...extra }
}

function validateUpstreamJsonSchema(schema, data, label, expectedId) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true })
  addFormats(ajv)
  if (schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema'
    || schema?.$id !== expectedId
    || !ajv.validateSchema(schema)) {
    throw new Error(`${label} schema is not the expected metaschema-valid draft 2020-12 contract`)
  }
  const validate = ajv.compile(schema)
  if (!validate(data)) {
    const errors = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    throw new Error(`${label} does not satisfy its upstream JSON Schema: ${errors}`)
  }
  return data
}

function exactKeys(value, label, required, optional = []) {
  const object = requireObject(value, label)
  const allowed = new Set([...required, ...optional])
  const unknown = Object.keys(object).filter((key) => !allowed.has(key)).sort()
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`)
  const missing = required.filter((key) => !Object.hasOwn(object, key))
  if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`)
  return object
}

function requiredKeys(value, label, required) {
  const object = requireObject(value, label)
  const missing = required.filter((key) => !Object.hasOwn(object, key))
  if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`)
  return object
}

async function git(repo, args, { buffer = false } = {}) {
  try {
    const { stdout } = await execFile('git', ['-C', repo, ...args], {
      encoding: buffer ? null : 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    })
    return stdout
  } catch (error) {
    const message = error?.stderr?.toString?.().trim() || error?.message || String(error)
    throw new Error(`Git object verification failed: ${message}`)
  }
}

export async function resolveGitRevision(sourceDir, revision) {
  requireCommit(revision, 'source revision')
  const repository = String(await git(sourceDir, ['rev-parse', '--show-toplevel'])).trim()
  const commit = String(await git(repository, ['rev-parse', '--verify', `${revision}^{commit}`])).trim()
  if (commit !== revision) throw new Error('release source revision did not resolve to the exact commit')
  const type = String(await git(repository, ['cat-file', '-t', commit])).trim()
  if (type !== 'commit') throw new Error('release source revision is not a Git commit')
  const treeOid = String(await git(repository, ['rev-parse', '--verify', `${commit}^{tree}`])).trim()
  requireGitOid(treeOid, 'release source tree object id')
  return { repository, commit, treeOid }
}

export async function readTrackedBytesAtCommit(sourceDir, revision, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.includes('..')) {
    throw new Error('tracked JSON path must be a safe repository-relative path')
  }
  const resolved = await resolveGitRevision(sourceDir, revision)
  const listing = await git(resolved.repository, ['ls-tree', '--full-tree', '-z', resolved.commit, '--', relativePath], { buffer: true })
  const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)\0$/u.exec(listing.toString('utf8'))
  if (!match || match[3] !== relativePath) throw new Error(`${relativePath} is not one exact tracked regular-file blob at ${resolved.commit}`)
  const gitBlobOid = match[2]
  const raw = await git(resolved.repository, ['cat-file', 'blob', gitBlobOid], { buffer: true })
  return {
    raw,
    descriptor: rawDescriptor(raw, { gitBlobOid }),
    repository: resolved.repository,
    sourceRevision: resolved.commit,
    sourceTreeOid: resolved.treeOid,
  }
}

export async function readTrackedJsonAtCommit(sourceDir, revision, relativePath) {
  const input = await readTrackedBytesAtCommit(sourceDir, revision, relativePath)
  return { ...input, data: parseJson(input.raw, `${relativePath} at ${input.sourceRevision}`) }
}

function sourceSummary(source) {
  const implementationState = requireString(source.implementation, `source ${source.source_id} implementation`)
  if (!IMPLEMENTATION_STATES.includes(implementationState)) {
    throw new Error(`source ${source.source_id} has unsupported implementation state ${implementationState}`)
  }
  return {
    sourceId: requireString(source.source_id, 'source id'),
    implementationState,
    sourceClass: requireString(source.source_class, `source ${source.source_id} class`),
    authorityRole: requireString(source.authority_role, `source ${source.source_id} authority role`),
    rightsStatus: requireString(source.rights_status, `source ${source.source_id} rights status`),
    claimClasses: uniqueSorted(source.claim_classes ?? []),
  }
}

function sourceSemantics(sources) {
  const officialOrAdministrative = sources
    .filter((source) => (
      source.sourceClass === 'official_china'
      || source.sourceClass === 'official_host'
      || source.sourceClass === 'legal'
    ))
    .map((source) => source.sourceId)
  const independent = sources
    .filter((source) => source.authorityRole === 'independent_observation')
    .map((source) => source.sourceId)
  const modeled = sources
    .filter((source) => source.claimClasses.some((item) => (
      item === 'modeled_estimate' || item === 'analytical_estimate'
    )))
    .map((source) => source.sourceId)
  return {
    classificationRule: 'Source class, authority role and claim class are separate, non-exclusive fields. Official publication is not independent corroboration, and a modeled or analytical estimate is not an observed project fact.',
    sourceClassCounts: countBy(sources.map((source) => source.sourceClass)),
    authorityRoleCounts: countBy(sources.map((source) => source.authorityRole)),
    claimClassCounts: countBy(sources.flatMap((source) => source.claimClasses)),
    officialOrAdministrativeSourceIds: uniqueSorted(officialOrAdministrative),
    independentObservationSourceIds: uniqueSorted(independent),
    modeledOrAnalyticalSourceIds: uniqueSorted(modeled),
  }
}

function targetSummary(target, sourceIndex) {
  const sources = uniqueSorted(target.source_ids ?? []).map((sourceId) => {
    const source = sourceIndex.get(sourceId)
    if (!source) throw new Error(`target ${target.target_id} references unknown source ${sourceId}`)
    return source
  })
  return {
    targetId: requireString(target.target_id, 'target id'),
    label: requireString(target.label, `target ${target.target_id} label`),
    targetType: requireString(target.target_type, `target ${target.target_id} type`),
    evidenceStatus: requireString(target.evidence_status, `target ${target.target_id} evidence status`),
    requiredCoverage: uniqueSorted(target.required_coverage ?? []),
    sourceReadiness: {
      sourceCount: sources.length,
      buildReadySourceCount: sources.filter((source) => BUILD_READY_STATES.has(source.implementationState)).length,
      implementationStates: countBy(sources.map((source) => source.implementationState)),
    },
    sources,
  }
}

function buildTargetCoverage(observatory, sources) {
  const sourceIndex = new Map(sources.map((source) => [source.sourceId, source]))
  const targetIndex = new Map((observatory.watch_targets ?? []).map((target) => [target.target_id, target]))
  return TARGET_AREAS.map((area) => ({
    areaId: area.areaId,
    label: area.label,
    targets: area.targetIds.map((targetId) => {
      const target = targetIndex.get(targetId)
      if (!target) throw new Error(`Palimpsest observatory is missing required target ${targetId}`)
      return targetSummary(target, sourceIndex)
    }),
  }))
}

function yearFromPeriod(period, label) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(String(period ?? ''))
  if (!match) throw new Error(`${label} is not an ISO calendar date`)
  return Number.parseInt(match[1], 10)
}

function coverageWindow(years) {
  const sorted = uniqueSorted(years).map(Number).sort((a, b) => a - b)
  return {
    fromYear: sorted[0] ?? null,
    toYear: sorted.at(-1) ?? null,
    yearCount: sorted.length,
  }
}

function summarizeIndicator(rows) {
  const first = rows[0]
  const seriesIds = uniqueSorted(rows.map((row) => row.series_id))
  const indicatorIds = uniqueSorted(rows.map((row) => row.indicator_id))
  const units = uniqueSorted(rows.map((row) => row.unit))
  if (seriesIds.length !== 1 || indicatorIds.length !== 1 || units.length !== 1) {
    throw new Error(`indicator identity drifted for ${first.country_code}/${first.series_id}`)
  }
  const allYears = []
  const observedYears = []
  const forecastYears = []
  const unavailableYears = []
  const unavailableReasons = []
  for (const row of rows) {
    if (row.aggregate_level !== 'country'
      || row.context_scope !== 'national_economic_context'
      || row.causality_boundary !== 'not_evidence_of_bri_causality') {
      throw new Error(`economic row ${row.observation_id ?? ''} crossed the national non-causal context boundary`)
    }
    const year = yearFromPeriod(row.period_start, 'period_start')
    const endYear = yearFromPeriod(row.period_end, 'period_end')
    if (year !== endYear) throw new Error(`${first.country_code}/${first.series_id} contains a multi-year row`)
    allYears.push(year)
    if (row.evidence_state === 'unavailable') {
      if (row.value !== null) throw new Error('unavailable economic evidence must retain a null value upstream')
      unavailableYears.push(year)
      unavailableReasons.push(requireString(row.unavailability_reason, 'unavailability reason'))
    } else if (row.obs_status === 'F') {
      forecastYears.push(year)
    } else if (row.evidence_state === 'observed') {
      observedYears.push(year)
    } else {
      throw new Error(`unsupported economic evidence state ${row.evidence_state}`)
    }
  }
  if (new Set(allYears).size !== allYears.length) {
    throw new Error(`${first.country_code}/${first.series_id} contains duplicate annual rows`)
  }
  return {
    seriesId: seriesIds[0],
    indicatorId: indicatorIds[0],
    unit: units[0],
    annualCoverage: coverageWindow(allYears),
    sourceRowCount: rows.length,
    observed: coverageWindow(observedYears),
    forecast: coverageWindow(forecastYears),
    unavailable: {
      ...coverageWindow(unavailableYears),
      reasonCounts: countBy(unavailableReasons),
    },
  }
}

function assertWdiSeriesRegistry(registry) {
  const root = exactKeys(registry, 'served WDI series registry', [
    'schema_version', 'dataset', 'countries', 'series',
  ])
  if (root.schema_version !== 'palimpsest.bri-wdi-series.v1') {
    throw new Error('served WDI series registry has an unsupported schema')
  }
  const dataset = exactKeys(root.dataset, 'served WDI series registry.dataset', [
    'source_id', 'source_number', 'name', 'publisher', 'api_base', 'catalog_url', 'license',
    'license_url', 'rights_evidence_url', 'redistribution_status', 'attribution',
    'release_time_semantics', 'context_scope', 'causality_boundary', 'indicator_provenance_boundary',
  ])
  const expectedDataset = {
    source_id: 'world_bank_wdi',
    source_number: '2',
    name: 'World Development Indicators',
    publisher: 'World Bank',
    api_base: 'https://api.worldbank.org/v2',
    catalog_url: 'https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators',
    license: 'CC-BY-4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    rights_evidence_url: 'https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators',
    redistribution_status: 'allowed_with_attribution',
    attribution: 'World Bank, World Development Indicators',
    release_time_semantics: 'dataset_lastupdated_upper_bound',
    context_scope: 'national_economic_context',
    causality_boundary: 'not_evidence_of_bri_causality',
  }
  for (const [key, expected] of Object.entries(expectedDataset)) {
    if (dataset[key] !== expected) throw new Error(`served WDI series registry.dataset.${key} changed`)
  }
  requireString(dataset.indicator_provenance_boundary, 'served WDI series registry.dataset.indicator_provenance_boundary')

  if (!Array.isArray(root.countries) || root.countries.length !== COUNTRY_ORDER.length) {
    throw new Error('served WDI series registry must contain the exact three countries')
  }
  root.countries.forEach((country, index) => {
    const label = `served WDI series registry.countries[${index}]`
    const value = exactKeys(country, label, ['country_code', 'api_country_id', 'name'])
    const countryCode = COUNTRY_ORDER[index]
    if (value.country_code !== countryCode
      || value.api_country_id !== COUNTRY_API_IDS[countryCode]
      || value.name !== COUNTRY_LABELS[countryCode]) {
      throw new Error(`${label} identity or order changed`)
    }
  })

  if (!Array.isArray(root.series) || root.series.length === 0 || root.series.length > 24) {
    throw new Error('served WDI series registry must contain between 1 and 24 series')
  }
  const seriesById = new Map()
  const indicatorIds = new Set()
  root.series.forEach((series, index) => {
    const label = `served WDI series registry.series[${index}]`
    const value = exactKeys(series, label, [
      'indicator_id', 'series_id', 'source_title', 'name', 'unit', 'topic',
    ])
    if (!/^bri\.context\.wdi\.[a-z0-9][a-z0-9_]{1,119}$/.test(requireString(value.series_id, `${label}.series_id`))) {
      throw new Error(`${label}.series_id is invalid`)
    }
    if (!/^[A-Z0-9][A-Z0-9._-]{1,79}$/.test(requireString(value.indicator_id, `${label}.indicator_id`))) {
      throw new Error(`${label}.indicator_id is invalid`)
    }
    for (const key of ['source_title', 'name', 'unit', 'topic']) requireString(value[key], `${label}.${key}`)
    if (seriesById.has(value.series_id)) throw new Error('served WDI series registry contains duplicate series_id values')
    if (indicatorIds.has(value.indicator_id)) throw new Error('served WDI series registry contains duplicate indicator_id values')
    seriesById.set(value.series_id, value)
    indicatorIds.add(value.indicator_id)
  })
  return {
    seriesById,
    seriesIds: [...seriesById.keys()].sort(compareText),
  }
}

export function validateEconomicInputs(economics, economicsSchema, registryInput) {
  validateUpstreamJsonSchema(
    economicsSchema,
    economics,
    'Palimpsest BRI economic observations',
    ECONOMICS_SCHEMA_ID,
  )
  const registry = assertWdiSeriesRegistry(registryInput?.data)
  requireSha256(registryInput?.descriptor?.sha256, 'served WDI series registry blob hash')
  requireSha256(economics.registry_sha256, 'Palimpsest BRI economics registry_sha256')
  if (economics.registry_sha256 !== registryInput.descriptor.sha256) {
    throw new Error('Palimpsest BRI economics registry_sha256 does not match exact served registry bytes')
  }
  return registry
}

export function buildEconomicCoverage(economics, expectedRegistry) {
  if (!expectedRegistry?.seriesById || !Array.isArray(expectedRegistry.seriesIds)) {
    throw new Error('exact served WDI series registry is required before economic projection')
  }
  const groups = new Map()
  for (const row of economics.observations ?? []) {
    if (!COUNTRY_ORDER.includes(row.country_code)) {
      throw new Error(`unexpected economic country ${row.country_code}`)
    }
    const expectedSeries = expectedRegistry.seriesById.get(row.series_id)
    if (!expectedSeries) throw new Error(`economic row uses unregistered series ${row.series_id}`)
    if (row.indicator_id !== expectedSeries.indicator_id || row.unit !== expectedSeries.unit) {
      throw new Error(`economic row identity differs from the served registry for ${row.series_id}`)
    }
    const key = `${row.country_code}\0${row.series_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const countries = COUNTRY_ORDER.map((countryCode) => {
    const indicators = [...groups.entries()]
      .filter(([key]) => key.startsWith(`${countryCode}\0`))
      .map(([, rows]) => summarizeIndicator(rows))
      .sort((a, b) => compareText(a.seriesId, b.seriesId))
    const observedRows = indicators.reduce((total, item) => total + item.observed.yearCount, 0)
    const forecastRows = indicators.reduce((total, item) => total + item.forecast.yearCount, 0)
    const unavailableRows = indicators.reduce((total, item) => total + item.unavailable.yearCount, 0)
    return {
      countryCode,
      country: COUNTRY_LABELS[countryCode],
      indicatorCount: indicators.length,
      sourceRowCount: indicators.reduce((total, item) => total + item.sourceRowCount, 0),
      observedRowCount: observedRows,
      forecastRowCount: forecastRows,
      unavailableRowCount: unavailableRows,
      indicators,
    }
  })
  for (const country of countries) {
    const seriesIds = country.indicators.map((item) => item.seriesId)
    if (new Set(seriesIds).size !== seriesIds.length) {
      throw new Error(`${country.countryCode} economic projection contains duplicate series IDs`)
    }
    if (JSON.stringify(seriesIds) !== JSON.stringify(expectedRegistry.seriesIds)) {
      throw new Error(`${country.countryCode} economic projection does not contain the exact served registry series set`)
    }
  }
  const totals = {
    countries: countries.length,
    indicators: expectedRegistry.seriesIds.length,
    sourceRows: countries.reduce((total, country) => total + country.sourceRowCount, 0),
    observedRows: countries.reduce((total, country) => total + country.observedRowCount, 0),
    forecastRows: countries.reduce((total, country) => total + country.forecastRowCount, 0),
    unavailableRows: countries.reduce((total, country) => total + country.unavailableRowCount, 0),
  }
  return { totals, countries }
}

function assertCoverageMatches(sourceCoverage, calculated) {
  const pairs = [
    ['countries', 'countries'],
    ['indicators', 'indicators'],
    ['source_rows', 'sourceRows'],
    ['observed_rows', 'observedRows'],
    ['forecast_rows', 'forecastRows'],
    ['unavailable_rows', 'unavailableRows'],
  ]
  for (const [sourceKey, calculatedKey] of pairs) {
    if (sourceCoverage[sourceKey] !== calculated[calculatedKey]) {
      throw new Error(`economic coverage ${sourceKey} does not match summarized rows`)
    }
  }
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function requireHttpsUrl(value, label) {
  requireString(value, label)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must be an absolute HTTPS URL`)
  return value
}

function requireDateTime(value, label) {
  requireString(value, label)
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an RFC 3339 UTC timestamp`)
  return value
}

function assertRightsSuppressedWireArchive(value, label) {
  const wireArchive = exactKeys(value, label, [
    'availability', 'publication_status', 'reason', 'rights_status_json',
  ])
  if (wireArchive.availability !== 'unavailable'
    || wireArchive.publication_status !== 'rights_suppressed') {
    throw new Error(`${label} must record unavailable rights_suppressed publication state`)
  }
  const reason = requireString(wireArchive.reason, `${label}.reason`)
  const rightsStatus = exactKeys(wireArchive.rights_status_json, `${label}.rights_status_json`, [
    'path', 'bytes', 'sha256',
  ])
  if (rightsStatus.path !== CHINA_PUBLICATION_RIGHTS_PATH) {
    throw new Error(`${label}.rights_status_json.path must identify the published China rights-status JSON`)
  }
  requireInteger(rightsStatus.bytes, `${label}.rights_status_json.bytes`, { positive: true })
  requireSha256(rightsStatus.sha256, `${label}.rights_status_json.sha256`)
  return {
    verificationState: 'rights_suppressed_status_validated',
    availability: wireArchive.availability,
    publicationStatus: wireArchive.publication_status,
    reason,
    rightsStatusJson: {
      path: rightsStatus.path,
      bytes: rightsStatus.bytes,
      sha256: rightsStatus.sha256,
    },
  }
}

function wireArchiveProvenanceSemantics(wireArchive) {
  if (wireArchive.verificationState === 'legacy_archive_hash_validated') {
    return `The legacy v1 receipt binds the wire archive by SHA-256 ${wireArchive.sha256}; it does not carry v2 rights-suppression semantics.`
  }
  const rights = wireArchive.rightsStatusJson
  return `Wire archive availability is unavailable and publication status is rights_suppressed: ${wireArchive.reason} Exact published rights-status bytes are ${rights.path} (${rights.bytes} bytes, SHA-256 ${rights.sha256}).`
}

export function assertRailwayFleetReleaseReceipt(receipt) {
  const root = requiredKeys(receipt, 'Railway fleet release receipt', [
    'schema_version', 'generated_at', 'deployment_transport', 'github_required', 'workspace',
    'services', 'dns_cutover', 'stateful_migration', 'operations',
  ])
  if (![
    'palimpsest.railway-fleet-deployment-receipt.v1',
    'palimpsest.railway-fleet-deployment-receipt.v2',
  ].includes(root.schema_version)) {
    throw new Error(`unsupported Railway receipt schema ${root.schema_version}`)
  }
  requireDateTime(root.generated_at, 'Railway fleet release receipt.generated_at')
  if (root.deployment_transport !== 'railway-cli-local-upload' || root.github_required !== false) {
    throw new Error('Railway fleet release receipt has an unsupported deployment transport')
  }
  requireObject(root.workspace, 'Railway fleet release receipt.workspace')
  requireObject(root.dns_cutover, 'Railway fleet release receipt.dns_cutover')
  requireObject(root.stateful_migration, 'Railway fleet release receipt.stateful_migration')
  requireObject(root.operations, 'Railway fleet release receipt.operations')
  const services = requiredKeys(root.services, 'Railway fleet release receipt.services', ['palimpsest'])
  const isV2 = root.schema_version === 'palimpsest.railway-fleet-deployment-receipt.v2'
  const wireArchiveFields = !isV2
    ? ['wire_archive_sha256']
    : ['wire_archive', 'manifest_sha256']
  const release = requiredKeys(services.palimpsest, 'Railway fleet release receipt.services.palimpsest', [
    'project_id', 'service_id', 'environment_id', 'deployment_id', 'deployment_status', 'image_digest',
    'source_commit', 'artifact_tree_sha256', ...wireArchiveFields, 'artifact_file_count',
    'artifact_total_bytes', 'railway_url', 'health_status', 'verification', 'custom_domains',
  ])
  for (const key of ['project_id', 'service_id', 'environment_id', 'deployment_id']) {
    requireString(release[key], `Railway fleet release receipt.services.palimpsest.${key}`)
  }
  if (release.deployment_status !== 'SUCCESS' || release.health_status !== 'ready') {
    throw new Error('Palimpsest Railway release is not recorded as successful and ready')
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(String(release.image_digest ?? ''))) {
    throw new Error('Palimpsest Railway image digest is invalid')
  }
  requireCommit(release.source_commit, 'Palimpsest Railway source commit')
  requireSha256(release.artifact_tree_sha256, 'Palimpsest Railway artifact tree hash')
  let wireArchive
  if (!isV2) {
    wireArchive = {
      verificationState: 'legacy_archive_hash_validated',
      sha256: requireSha256(release.wire_archive_sha256, 'Palimpsest Railway wire archive hash'),
    }
    if (Object.hasOwn(release, 'manifest_sha256')) {
      requireSha256(release.manifest_sha256, 'Palimpsest Railway release manifest hash')
    }
  } else {
    requireSha256(release.manifest_sha256, 'Palimpsest Railway release manifest hash')
    if (Object.hasOwn(release, 'wire_archive_sha256')) {
      throw new Error('Palimpsest Railway v2 release must not mix a wire_archive_sha256 with an unavailable wire_archive state')
    }
    wireArchive = assertRightsSuppressedWireArchive(
      release.wire_archive,
      'Railway fleet release receipt.services.palimpsest.wire_archive',
    )
  }
  requireInteger(release.artifact_file_count, 'Palimpsest Railway artifact file count', { positive: true })
  requireInteger(release.artifact_total_bytes, 'Palimpsest Railway artifact byte count', { positive: true })
  requireHttpsUrl(release.railway_url, 'Palimpsest Railway URL')
  if (!new URL(release.railway_url).hostname.endsWith('.railway.app')) throw new Error('Palimpsest Railway URL is not a Railway hostname')
  const verification = requiredKeys(release.verification, 'Palimpsest Railway release.verification', [
    'test_count', 'critical_files_byte_identical', 'release_manifest_byte_identical', 'key_routes_http_200',
    'hidden_source_http_404', 'successful_access_log_level', 'successful_access_log_error_match_count',
    'wdi_bundle_sha256',
  ])
  requireInteger(verification.test_count, 'Palimpsest Railway verification.test_count', { positive: true })
  requireInteger(verification.critical_files_byte_identical, 'Palimpsest Railway verification.critical_files_byte_identical', { positive: true })
  requireInteger(verification.key_routes_http_200, 'Palimpsest Railway verification.key_routes_http_200', { positive: true })
  requireInteger(verification.successful_access_log_error_match_count, 'Palimpsest Railway verification.successful_access_log_error_match_count')
  requireBoolean(verification.release_manifest_byte_identical, 'Palimpsest Railway verification.release_manifest_byte_identical')
  requireBoolean(verification.hidden_source_http_404, 'Palimpsest Railway verification.hidden_source_http_404')
  requireString(verification.successful_access_log_level, 'Palimpsest Railway verification.successful_access_log_level')
  requireSha256(verification.wdi_bundle_sha256, 'Palimpsest Railway verification.wdi_bundle_sha256')
  if (verification.release_manifest_byte_identical !== true
    || verification.hidden_source_http_404 !== true
    || verification.successful_access_log_error_match_count !== 0
    || verification.successful_access_log_level !== 'info'
    || verification.critical_files_byte_identical < 9) {
    throw new Error('Palimpsest Railway release receipt does not retain every release-verification gate')
  }
  requiredKeys(release.custom_domains, 'Palimpsest Railway release.custom_domains', ['palimpsest.info', 'www.palimpsest.info'])
  return { root, release, wireArchive }
}

export function assertRailwayReleaseManifest(manifest, release, manifestDescriptor) {
  const isV2 = Object.hasOwn(release, 'wire_archive')
  if (isV2) {
    const descriptor = exactKeys(manifestDescriptor, 'Palimpsest Railway release manifest descriptor', [
      'bytes', 'sha256',
    ])
    requireInteger(descriptor.bytes, 'Palimpsest Railway release manifest descriptor.bytes', { positive: true })
    requireSha256(descriptor.sha256, 'Palimpsest Railway release manifest descriptor.sha256')
    if (release.manifest_sha256 !== descriptor.sha256) {
      throw new Error('Railway v2 receipt does not bind the exact release manifest bytes')
    }
  }
  const value = exactKeys(manifest, 'Palimpsest Railway release manifest', [
    'built_at', 'critical_files', 'deployment_source', 'file_count', 'github_required',
    'schema_version', 'source_commit', 'state', 'total_bytes', 'tree_sha256',
  ])
  if (value.schema_version !== 'palimpsest.railway-static-release.v1'
    || value.deployment_source !== 'local-git-archive'
    || value.github_required !== false
    || value.state !== 'artifact_ready') {
    throw new Error('Palimpsest Railway release manifest identity or artifact state is invalid')
  }
  requireDateTime(value.built_at, 'Palimpsest Railway release manifest.built_at')
  requireCommit(value.source_commit, 'Palimpsest Railway release manifest.source_commit')
  requireInteger(value.file_count, 'Palimpsest Railway release manifest.file_count', { positive: true })
  requireInteger(value.total_bytes, 'Palimpsest Railway release manifest.total_bytes', { positive: true })
  requireSha256(value.tree_sha256, 'Palimpsest Railway release manifest.tree_sha256')
  if (value.source_commit !== release.source_commit
    || value.tree_sha256 !== release.artifact_tree_sha256
    || value.file_count !== release.artifact_file_count
    || value.total_bytes !== release.artifact_total_bytes) {
    throw new Error('Railway receipt and release manifest do not bind the same commit and artifact tree')
  }
  const criticalFiles = requiredKeys(
    value.critical_files,
    'Palimpsest Railway release manifest.critical_files',
    RAILWAY_CRITICAL_PATHS,
  )
  for (const criticalPath of Object.keys(criticalFiles)) {
    const descriptor = exactKeys(
      criticalFiles[criticalPath],
      `Palimpsest Railway release manifest.critical_files.${criticalPath}`,
      ['bytes', 'sha256'],
    )
    requireInteger(descriptor.bytes, `Palimpsest Railway release manifest ${criticalPath}.bytes`, { positive: true })
    requireSha256(descriptor.sha256, `Palimpsest Railway release manifest ${criticalPath}.sha256`)
  }
  if (Object.hasOwn(release, 'wire_archive')) {
    const wireArchive = assertRightsSuppressedWireArchive(
      release.wire_archive,
      'Railway fleet release receipt.services.palimpsest.wire_archive',
    )
    const rightsStatus = criticalFiles[wireArchive.rightsStatusJson.path]
    if (!rightsStatus
      || rightsStatus.bytes !== wireArchive.rightsStatusJson.bytes
      || rightsStatus.sha256 !== wireArchive.rightsStatusJson.sha256) {
      throw new Error('Railway v2 wire archive rights-status descriptor does not match the release manifest')
    }
  }
  if (isV2
    && release.verification.critical_files_byte_identical !== Object.keys(criticalFiles).length) {
    throw new Error('Railway v2 receipt critical-files verification count does not match the release manifest')
  }
  return value
}

function assertPagesWorkflowJob(job, label, expectedSha, expectedRunId) {
  const value = exactKeys(job, label, [
    'api_url', 'conclusion', 'head_sha', 'html_url', 'id', 'name', 'run_attempt', 'run_id',
  ])
  requireHttpsUrl(value.api_url, `${label}.api_url`)
  requireHttpsUrl(value.html_url, `${label}.html_url`)
  if (value.conclusion !== 'success' || value.head_sha !== expectedSha || value.run_id !== expectedRunId) {
    throw new Error(`${label} is not a successful job for the exact Pages revision and run`)
  }
  for (const key of ['id', 'run_attempt', 'run_id']) requireInteger(value[key], `${label}.${key}`, { positive: true })
  requireString(value.name, `${label}.name`)
  return value
}

export function assertPagesPublicationReceipt(receipt) {
  const root = exactKeys(receipt, 'Pages publication receipt', [
    'archived_size_receipt', 'collection_id', 'dataset_id', 'deployment', 'pages_artifact',
    'schema_version', 'served_verification', 'source_id', 'status', 'workflow',
  ])
  if (root.schema_version !== 'palimpsest.bri-wdi-pages-publication.v1'
    || root.dataset_id !== 'bri-economic-context-world-bank-wdi'
    || root.source_id !== 'world_bank_wdi'
    || root.status !== 'production_verified') {
    throw new Error('Pages publication receipt identity or upstream state is invalid')
  }
  requireSha256(root.collection_id, 'Pages publication receipt.collection_id')
  const workflow = exactKeys(root.workflow, 'Pages publication receipt.workflow', [
    'branch', 'conclusion', 'event', 'pages_deploy_job', 'pages_deploy_job_id', 'pages_package_job',
    'pages_package_job_id', 'publication_sha', 'repository', 'run_api_url', 'run_attempt', 'run_id',
    'run_url', 'workflow_path',
  ])
  const publicationSha = requireCommit(workflow.publication_sha, 'Pages publication receipt.workflow.publication_sha')
  if (workflow.branch !== 'main' || workflow.conclusion !== 'success'
    || workflow.event !== 'repository_dispatch' || workflow.repository !== 'beepboop2025/palimpsest'
    || workflow.workflow_path !== '.github/workflows/tests.yml') {
    throw new Error('Pages publication receipt workflow identity is invalid')
  }
  for (const key of ['pages_deploy_job_id', 'pages_package_job_id', 'run_attempt', 'run_id']) {
    requireInteger(workflow[key], `Pages publication receipt.workflow.${key}`, { positive: true })
  }
  requireHttpsUrl(workflow.run_api_url, 'Pages publication receipt.workflow.run_api_url')
  requireHttpsUrl(workflow.run_url, 'Pages publication receipt.workflow.run_url')
  const deployJob = assertPagesWorkflowJob(
    workflow.pages_deploy_job,
    'Pages publication receipt.workflow.pages_deploy_job',
    publicationSha,
    workflow.run_id,
  )
  const packageJob = assertPagesWorkflowJob(
    workflow.pages_package_job,
    'Pages publication receipt.workflow.pages_package_job',
    publicationSha,
    workflow.run_id,
  )
  if (deployJob.id !== workflow.pages_deploy_job_id || packageJob.id !== workflow.pages_package_job_id) {
    throw new Error('Pages publication receipt job ids are inconsistent')
  }
  const deployment = exactKeys(root.deployment, 'Pages publication receipt.deployment', [
    'deployed_at', 'deployment_api_url', 'deployment_id', 'environment', 'environment_url', 'log_url',
    'ref', 'sha', 'state_at_verification', 'success_status_api_url', 'success_status_deployment_url',
    'success_status_id',
  ])
  if (deployment.environment !== 'github-pages' || deployment.environment_url !== 'https://palimpsest.info/'
    || deployment.ref !== 'main' || deployment.sha !== publicationSha || deployment.state_at_verification !== 'success') {
    throw new Error('Pages deployment is not the successful exact publication revision')
  }
  requireDateTime(deployment.deployed_at, 'Pages publication receipt.deployment.deployed_at')
  for (const key of ['deployment_id', 'success_status_id']) requireInteger(deployment[key], `Pages publication receipt.deployment.${key}`, { positive: true })
  for (const key of ['deployment_api_url', 'log_url', 'success_status_api_url', 'success_status_deployment_url']) {
    requireHttpsUrl(deployment[key], `Pages publication receipt.deployment.${key}`)
  }
  const pagesArtifact = exactKeys(root.pages_artifact, 'Pages publication receipt.pages_artifact', [
    'api_url', 'archive_bytes', 'captured_at', 'created_at', 'digest_sha256', 'expires_at', 'id',
    'name', 'workflow_run_head_sha', 'workflow_run_id',
  ])
  if (pagesArtifact.name !== 'github-pages' || pagesArtifact.workflow_run_head_sha !== publicationSha
    || pagesArtifact.workflow_run_id !== workflow.run_id) throw new Error('Pages artifact is not bound to the exact publication run')
  requireHttpsUrl(pagesArtifact.api_url, 'Pages publication receipt.pages_artifact.api_url')
  requireSha256(pagesArtifact.digest_sha256, 'Pages publication receipt.pages_artifact.digest_sha256')
  for (const key of ['archive_bytes', 'id', 'workflow_run_id']) requireInteger(pagesArtifact[key], `Pages publication receipt.pages_artifact.${key}`, { positive: true })
  for (const key of ['captured_at', 'created_at', 'expires_at']) requireDateTime(pagesArtifact[key], `Pages publication receipt.pages_artifact.${key}`)
  const archived = exactKeys(root.archived_size_receipt, 'Pages publication receipt.archived_size_receipt', [
    'archive_bytes', 'artifact_api_url', 'artifact_id', 'artifact_name', 'bytes', 'checked_in_path',
    'digest_sha256', 'parsed', 'public_url', 'sha256', 'workflow_run_head_sha', 'workflow_run_id',
  ])
  if (archived.workflow_run_head_sha !== publicationSha || archived.workflow_run_id !== workflow.run_id
    || archived.artifact_name !== `pages-artifact-size-${publicationSha}`
    || archived.checked_in_path !== `.well-known/receipts/pages-artifact-size-${publicationSha}.json`) {
    throw new Error('archived Pages size receipt is not bound to the exact publication run')
  }
  for (const key of ['archive_bytes', 'artifact_id', 'bytes', 'workflow_run_id']) requireInteger(archived[key], `Pages publication receipt.archived_size_receipt.${key}`, { positive: true })
  for (const key of ['digest_sha256', 'sha256']) requireSha256(archived[key], `Pages publication receipt.archived_size_receipt.${key}`)
  for (const key of ['artifact_api_url', 'public_url']) requireHttpsUrl(archived[key], `Pages publication receipt.archived_size_receipt.${key}`)
  const size = exactKeys(archived.parsed, 'Pages publication receipt.archived_size_receipt.parsed', [
    'artifact_bytes', 'artifact_name', 'artifact_sha256', 'headroom_bytes', 'limit_bytes',
    'publication_sha', 'schema_version', 'status',
  ])
  if (size.schema_version !== 'palimpsest.pages-artifact-size.v1' || size.status !== 'within-limit'
    || size.publication_sha !== publicationSha || size.artifact_name !== 'github-pages/artifact.tar') {
    throw new Error('Pages artifact-size receipt is invalid')
  }
  for (const key of ['artifact_bytes', 'headroom_bytes', 'limit_bytes']) requireInteger(size[key], `Pages publication receipt.archived_size_receipt.parsed.${key}`, { positive: true })
  requireSha256(size.artifact_sha256, 'Pages publication receipt.archived_size_receipt.parsed.artifact_sha256')
  if (size.artifact_bytes + size.headroom_bytes !== size.limit_bytes) throw new Error('Pages size receipt byte accounting is inconsistent')
  const served = exactKeys(root.served_verification, 'Pages publication receipt.served_verification', ['method', 'resources', 'verified_at'])
  if (served.method !== 'cache_busted_https_get') throw new Error('Pages served verification method is unsupported')
  requireDateTime(served.verified_at, 'Pages publication receipt.served_verification.verified_at')
  if (served.verified_at !== pagesArtifact.captured_at) throw new Error('Pages served verification and artifact capture clocks differ')
  if (!Array.isArray(served.resources) || served.resources.length !== 3) {
    throw new Error('Pages receipt must contain exactly three served-resource entries')
  }
  const expectedPaths = [
    'config/bri_wdi_series.json',
    'protocol/bri-economic-observations-v1.schema.json',
    'readings/bri-economic-observations-latest.json',
  ]
  const resources = served.resources.map((resource, index) => {
    const value = exactKeys(resource, `Pages publication receipt.served_verification.resources[${index}]`, [
      'bytes', 'http_status', 'path', 'sha256', 'url',
    ])
    requireInteger(value.bytes, `Pages served resource ${value.path}.bytes`, { positive: true })
    if (value.http_status !== 200) throw new Error(`Pages served resource ${value.path} was not HTTP 200`)
    requireSha256(value.sha256, `Pages served resource ${value.path}.sha256`)
    requireHttpsUrl(value.url, `Pages served resource ${value.path}.url`)
    const expectedUrl = `https://palimpsest.info/${value.path}?sha256=${value.sha256}`
    if (value.url !== expectedUrl) throw new Error(`Pages served resource ${value.path} URL is not exact and cache-busted`)
    return value
  }).sort((a, b) => compareText(a.path, b.path))
  if (JSON.stringify(resources.map((item) => item.path)) !== JSON.stringify(expectedPaths)) {
    throw new Error('Pages receipt served-resource set is incomplete or ambiguous')
  }
  return {
    root,
    publicationSha,
    resources,
    verifiedAt: served.verified_at,
    archivedSizeReceipt: archived,
  }
}

function assertObservatoryDatasetBinding(observatory, economicsInput, pagesInput, pagesValidation) {
  if (!Array.isArray(observatory.observation_datasets) || observatory.observation_datasets.length !== 1) {
    throw new Error('Palimpsest observatory must expose one unambiguous observation dataset')
  }
  const dataset = exactKeys(observatory.observation_datasets[0], 'Palimpsest observatory observation dataset', [
    'dataset_id', 'source_id', 'implementation_state', 'publication_state', 'artifact', 'observation_schema',
    'series_registry', 'collection_id', 'generated_at', 'coverage', 'clocks', 'rights', 'context_boundary',
    'publication_receipt',
  ])
  if (dataset.dataset_id !== 'bri-economic-context-world-bank-wdi' || dataset.source_id !== 'world_bank_wdi'
    || dataset.implementation_state !== 'live' || dataset.publication_state !== 'production_verified') {
    throw new Error('Palimpsest observatory WDI dataset identity or upstream state is invalid')
  }
  const artifact = exactKeys(dataset.artifact, 'Palimpsest observatory WDI artifact', ['path', 'url', 'media_type', 'bytes', 'sha256'])
  if (artifact.path !== 'readings/bri-economic-observations-latest.json'
    || artifact.url !== 'https://palimpsest.info/readings/bri-economic-observations-latest.json'
    || artifact.media_type !== 'application/json'
    || artifact.bytes !== economicsInput.descriptor.bytes
    || artifact.sha256 !== economicsInput.descriptor.sha256) {
    throw new Error('observatory does not bind the exact selected WDI economic artifact bytes')
  }
  const locator = exactKeys(dataset.publication_receipt, 'Palimpsest observatory Pages receipt locator', [
    'schema_version', 'status', 'repository_path', 'public_url', 'receipt_sha256', 'release_a_sha',
    'verified_at', 'fresh_until', 'availability_semantics',
  ])
  if (locator.schema_version !== 'palimpsest.bri-wdi-pages-publication-locator.v1'
    || locator.status !== 'production_verified'
    || locator.repository_path !== '.well-known/receipts/bri-wdi-pages-publication-v1.json'
    || locator.public_url !== 'https://palimpsest.info/.well-known/receipts/bri-wdi-pages-publication-v1.json'
    || locator.receipt_sha256 !== pagesInput.descriptor.sha256
    || locator.release_a_sha !== pagesValidation.publicationSha
    || locator.verified_at !== pagesValidation.verifiedAt
    || locator.availability_semantics !== 'verified_at_release_not_continuous_monitoring') {
    throw new Error('observatory does not bind the exact selected Pages publication receipt')
  }
  requireDateTime(locator.fresh_until, 'Palimpsest observatory Pages receipt locator.fresh_until')
  if (Date.parse(locator.fresh_until) <= Date.parse(locator.verified_at)) throw new Error('Pages receipt freshness interval is invalid')
  const schema = exactKeys(dataset.observation_schema, 'Palimpsest observatory observation schema', ['path', 'url', 'sha256'])
  const registry = exactKeys(dataset.series_registry, 'Palimpsest observatory series registry', ['path', 'url', 'sha256'])
  const resourceIndex = new Map(pagesValidation.resources.map((item) => [item.path, item]))
  for (const descriptor of [schema, registry]) {
    const resource = resourceIndex.get(descriptor.path)
    if (!resource || descriptor.sha256 !== resource.sha256
      || descriptor.url !== `https://palimpsest.info/${descriptor.path}`) {
      throw new Error(`observatory descriptor ${descriptor.path} is not bound to the Pages served-resource receipt`)
    }
  }
  if (dataset.collection_id !== economicsInput.data.collection_id
    || dataset.collection_id !== pagesValidation.root.collection_id) {
    throw new Error('Palimpsest WDI collection id differs across observatory, economics, and Pages receipt')
  }
  return { dataset, locator }
}

export async function buildPalimpsestBriSourcePin({ sourceDir, releaseReceiptPath, releaseManifestPath } = {}) {
  if (!sourceDir) throw new Error('--source-dir is required when refreshing the BRI pin')
  if (!releaseReceiptPath) throw new Error('--release-receipt is required when refreshing the BRI pin')
  if (!releaseManifestPath) throw new Error('--release-manifest is required when refreshing the BRI pin')
  const [railwayRaw, manifestRaw] = await Promise.all([
    fs.readFile(releaseReceiptPath),
    fs.readFile(releaseManifestPath),
  ])
  const railwayInput = { data: parseJson(railwayRaw, 'Railway fleet release receipt'), raw: railwayRaw, descriptor: rawDescriptor(railwayRaw) }
  const manifestInput = { data: parseJson(manifestRaw, 'Palimpsest Railway release manifest'), raw: manifestRaw, descriptor: rawDescriptor(manifestRaw) }
  const railwayValidation = assertRailwayFleetReleaseReceipt(railwayInput.data)
  const release = railwayValidation.release
  const wireArchive = railwayValidation.wireArchive
  const releaseManifest = assertRailwayReleaseManifest(
    manifestInput.data,
    release,
    manifestInput.descriptor,
  )
  const [criticalEntries, pagesInput] = await Promise.all([
    Promise.all(RAILWAY_GIT_BOUND_CRITICAL_PATHS.map(async (criticalPath) => [
      criticalPath,
      await readTrackedBytesAtCommit(sourceDir, release.source_commit, criticalPath),
    ])),
    readTrackedJsonAtCommit(sourceDir, release.source_commit, '.well-known/receipts/bri-wdi-pages-publication-v1.json'),
  ])
  const criticalInputs = new Map(criticalEntries)
  for (const criticalPath of RAILWAY_GIT_BOUND_CRITICAL_PATHS) {
    const tracked = criticalInputs.get(criticalPath)
    const described = releaseManifest.critical_files[criticalPath]
    if (tracked.descriptor.bytes !== described.bytes || tracked.descriptor.sha256 !== described.sha256) {
      throw new Error(`Railway release manifest does not match exact source-commit bytes for ${criticalPath}`)
    }
  }
  const observatoryBytes = criticalInputs.get('readings/belt-and-road-observatory-latest.json')
  const economicsBytes = criticalInputs.get(ECONOMICS_PATH)
  const observatoryInput = {
    ...observatoryBytes,
    data: parseJson(observatoryBytes.raw, 'tracked Palimpsest BRI observatory'),
  }
  const economicsInput = {
    ...economicsBytes,
    data: parseJson(economicsBytes.raw, 'tracked Palimpsest BRI economics'),
  }
  const observatory = observatoryInput.data
  const economics = economicsInput.data
  const pagesReceipt = pagesInput.data
  const railwayReceipt = railwayInput.data
  if (observatory.schema_version !== 'palimpsest.belt-and-road-observatory.v2') {
    throw new Error(`unsupported Palimpsest observatory schema ${observatory.schema_version}`)
  }
  if (economics.schema_version !== 'palimpsest.bri-economic-observations.v1') {
    throw new Error(`unsupported Palimpsest economic schema ${economics.schema_version}`)
  }
  const pagesValidation = assertPagesPublicationReceipt(pagesReceipt)
  const pagesReceiptSchema = parseJson(
    criticalInputs.get('protocol/bri-wdi-pages-publication-v1.schema.json').raw,
    'Palimpsest Pages publication receipt schema',
  )
  validateUpstreamJsonSchema(
    pagesReceiptSchema,
    pagesReceipt,
    'Palimpsest Pages publication receipt',
    'https://palimpsest.info/protocol/bri-wdi-pages-publication-v1.schema.json',
  )
  const [pagesRevision, servedInputs, archivedSizeInput] = await Promise.all([
    resolveGitRevision(sourceDir, pagesValidation.publicationSha),
    Promise.all(pagesValidation.resources.map(async (resource) => {
      const input = await readTrackedJsonAtCommit(sourceDir, pagesValidation.publicationSha, resource.path)
      if (input.descriptor.bytes !== resource.bytes || input.descriptor.sha256 !== resource.sha256) {
        throw new Error(`Pages served-resource receipt does not match exact Git bytes for ${resource.path}`)
      }
      return [resource.path, input]
    })),
    readTrackedJsonAtCommit(
      sourceDir,
      release.source_commit,
      pagesValidation.archivedSizeReceipt.checked_in_path,
    ),
  ])
  if (archivedSizeInput.descriptor.bytes !== pagesValidation.archivedSizeReceipt.bytes
    || archivedSizeInput.descriptor.sha256 !== pagesValidation.archivedSizeReceipt.sha256
    || JSON.stringify(archivedSizeInput.data) !== JSON.stringify(pagesValidation.archivedSizeReceipt.parsed)) {
    throw new Error('Pages archived size receipt does not match its exact tracked bytes and parsed payload')
  }
  const servedIndex = new Map(servedInputs)
  if (servedIndex.get(ECONOMICS_PATH).descriptor.sha256
    !== economicsInput.descriptor.sha256) {
    throw new Error('Railway release and Pages publication do not share the selected WDI artifact bytes')
  }
  if (servedIndex.get(ECONOMICS_SCHEMA_PATH).descriptor.sha256
    !== criticalInputs.get(ECONOMICS_SCHEMA_PATH).descriptor.sha256) {
    throw new Error('Railway release and Pages publication do not share the selected economics schema bytes')
  }
  if (release.verification?.wdi_bundle_sha256 !== economicsInput.descriptor.sha256) {
    throw new Error('Railway receipt does not bind the selected WDI economic artifact')
  }
  const { locator: publication } = assertObservatoryDatasetBinding(
    observatory,
    economicsInput,
    pagesInput,
    pagesValidation,
  )
  const sources = (observatory.sources ?? []).map(sourceSummary).sort((a, b) => compareText(a.sourceId, b.sourceId))
  const calculatedImplementationStates = implementationStateCounts(sources)
  const reportedStates = Object.fromEntries(IMPLEMENTATION_STATES.map((state) => [
    state,
    observatory.coverage_report?.implementation_states?.[state] ?? 0,
  ]))
  if (JSON.stringify(calculatedImplementationStates) !== JSON.stringify(reportedStates)) {
    throw new Error('observatory implementation-state counts do not match its source registry')
  }
  const buildReadySourceCount = sources.filter((source) => BUILD_READY_STATES.has(source.implementationState)).length
  if (buildReadySourceCount !== observatory.coverage_report?.build_ready_source_count) {
    throw new Error('observatory build-ready count does not match live and adapter-ready sources')
  }
  const expectedRegistry = validateEconomicInputs(
    economics,
    servedIndex.get(ECONOMICS_SCHEMA_PATH).data,
    servedIndex.get(WDI_REGISTRY_PATH),
  )
  const economicCoverage = buildEconomicCoverage(economics, expectedRegistry)
  assertCoverageMatches(economics.coverage, economicCoverage.totals)
  const requestReceipts = economics.request_receipts ?? []
  const datasetLastUpdated = uniqueSorted(requestReceipts.map((item) => item.dataset_last_updated))
  const sourceReleaseUpperBounds = uniqueSorted(requestReceipts.map((item) => item.source_release_upper_bound))
  const retrievedAt = uniqueSorted(requestReceipts.map((item) => item.retrieved_at))
  if (datasetLastUpdated.length !== 1 || sourceReleaseUpperBounds.length !== 1 || retrievedAt.length !== 1) {
    throw new Error('economic collection must expose one unambiguous set of source and retrieval clocks')
  }
  const servedResources = pagesValidation.resources.map((resource) => {
    const input = servedIndex.get(resource.path)
    return {
      path: resource.path,
      canonicalUrl: `https://palimpsest.info/${resource.path}`,
      ...input.descriptor,
    }
  })
  const pin = {
    schemaVersion: BRI_PIN_SCHEMA_VERSION,
    refreshedAt: railwayReceipt.generated_at,
    release: {
      producer: 'Palimpsest',
      verificationState: 'release_receipt_validated',
      canonicalBaseUrl: 'https://palimpsest.info',
      railwayMirrorBaseUrl: requireString(release.railway_url, 'Palimpsest Railway URL'),
      deploymentId: requireString(release.deployment_id, 'Palimpsest Railway deployment id'),
      sourceRevision: requireCommit(release.source_commit, 'Palimpsest Railway source commit'),
      sourceTreeOid: observatoryInput.sourceTreeOid,
      artifactTreeSha256: requireSha256(release.artifact_tree_sha256, 'Palimpsest Railway artifact tree hash'),
      artifactManifest: {
        schemaVersion: releaseManifest.schema_version,
        bytes: manifestInput.descriptor.bytes,
        sha256: manifestInput.descriptor.sha256,
        fileCount: releaseManifest.file_count,
        totalBytes: releaseManifest.total_bytes,
      },
      receiptBytes: railwayInput.descriptor.bytes,
      receiptSha256: railwayInput.descriptor.sha256,
      verifiedAt: railwayReceipt.generated_at,
      verificationSemantics: `The exact release receipt, source commit and Git tree were validated when this pin was refreshed. This is not continuous production availability or freshness monitoring. ${wireArchiveProvenanceSemantics(wireArchive)}`,
      pagesPublication: {
        verificationState: 'served_resource_receipt_validated',
        sourceRevision: requireCommit(publication.release_a_sha, 'Pages publication source revision'),
        sourceTreeOid: pagesRevision.treeOid,
        receiptBytes: pagesInput.descriptor.bytes,
        receiptSha256: pagesInput.descriptor.sha256,
        verifiedAt: publication.verified_at,
        freshUntil: publication.fresh_until,
        availabilitySemantics: publication.availability_semantics,
        servedResources,
      },
    },
    sourceArtifacts: {
      observatory: {
        path: 'readings/belt-and-road-observatory-latest.json',
        canonicalUrl: 'https://palimpsest.info/readings/belt-and-road-observatory-latest.json',
        railwayMirrorUrl: `${release.railway_url}/readings/belt-and-road-observatory-latest.json`,
        ...observatoryInput.descriptor,
      },
      economics: {
        path: 'readings/bri-economic-observations-latest.json',
        canonicalUrl: 'https://palimpsest.info/readings/bri-economic-observations-latest.json',
        railwayMirrorUrl: `${release.railway_url}/readings/bri-economic-observations-latest.json`,
        ...economicsInput.descriptor,
      },
      pagesPublicationReceipt: {
        path: '.well-known/receipts/bri-wdi-pages-publication-v1.json',
        canonicalUrl: publication.public_url,
        ...pagesInput.descriptor,
      },
    },
    sourceSnapshot: {
      schemaVersion: observatory.schema_version,
      asOf: observatory.as_of,
      scope: observatory.scope,
      readiness: {
        sourceCount: sources.length,
        buildReadySourceCount,
        implementationStates: calculatedImplementationStates,
        rightsStatusCounts: countBy(sources.map((source) => source.rightsStatus)),
        buildReadyGaps: [...(observatory.coverage_report?.build_ready_gaps ?? [])],
      },
      claimSemantics: sourceSemantics(sources),
      targetCoverage: buildTargetCoverage(observatory, sources),
    },
    economicSnapshot: {
      schemaVersion: economics.schema_version,
      generatedAt: economics.generated_at,
      collectionId: economics.collection_id,
      source: {
        sourceId: economics.source.source_id,
        name: economics.source.name,
        publisher: economics.source.publisher,
        attribution: economics.source.attribution,
        catalogUrl: economics.source.catalog_url,
      },
      rights: {
        license: economics.source.license,
        licenseUrl: economics.source.license_url,
        redistributionStatus: economics.source.redistribution_status,
        rightsEvidenceUrl: economics.source.rights_evidence_url,
        attribution: economics.source.attribution,
      },
      clocks: {
        generatedAt: economics.generated_at,
        datasetLastUpdated: datasetLastUpdated[0],
        sourceReleaseUpperBound: sourceReleaseUpperBounds[0],
        retrievedAt: retrievedAt[0],
      },
      hashPointers: {
        observationsSha256: requireSha256(economics.observations_sha256, 'observations hash'),
        registrySha256: requireSha256(economics.registry_sha256, 'registry hash'),
        rawResponseSha256s: uniqueSorted(requestReceipts.map((item) => requireSha256(item.raw_response_sha256, 'raw response hash'))),
      },
      contextPolicy: {
        aggregateLevel: economics.context_policy.aggregate_level,
        scope: economics.context_policy.scope,
        causalityBoundary: economics.context_policy.causality_boundary,
        missingValuePolicy: economics.context_policy.missing_value_policy,
        forecastPolicy: economics.context_policy.forecast_policy,
        downstreamSemantics: {
          observed: economics.context_policy.downstream_semantics.observed,
          forecast: economics.context_policy.downstream_semantics.forecast,
          unavailable: economics.context_policy.downstream_semantics.unavailable,
          join_boundary: economics.context_policy.downstream_semantics.join_boundary,
        },
      },
      coverage: economicCoverage,
    },
  }
  return assertPalimpsestBriPin(pin)
}

export function buildPalimpsestBriArtifact(pin, { pinRaw, schemaRaw } = {}) {
  assertPalimpsestBriPin(pin)
  if (!Buffer.isBuffer(pinRaw) && typeof pinRaw !== 'string') throw new Error('raw BRI pin bytes are required')
  if (!Buffer.isBuffer(schemaRaw) && typeof schemaRaw !== 'string') throw new Error('raw BRI schema bytes are required')
  const pinBytes = Buffer.isBuffer(pinRaw) ? pinRaw : Buffer.from(pinRaw, 'utf8')
  const schemaBytes = Buffer.isBuffer(schemaRaw) ? schemaRaw : Buffer.from(schemaRaw, 'utf8')
  const rawPin = parseJson(pinBytes, 'raw BRI source pin')
  if (JSON.stringify(rawPin) !== JSON.stringify(pin)) throw new Error('parsed BRI pin does not match its supplied raw bytes')
  const schema = parseJson(schemaBytes, 'raw BRI JSON Schema')
  const validateSchema = compilePalimpsestBriSchema(schema)
  const artifact = assertPalimpsestBriBoundary({
    $schema: `./${BRI_SCHEMA_FILE}`,
    schemaVersion: BRI_SCHEMA_VERSION,
    artifactId: 'narcoscope.palimpsest.bri-parallel-context',
    dataAsOf: pin.sourceSnapshot.asOf,
    scope: 'Bounded Palimpsest Belt and Road readiness and national economic context for China, Pakistan and Myanmar, published beside but never merged into NarcoScope drug-market inference.',
    provenance: {
      producer: 'Palimpsest',
      consumer: 'NarcoScope',
      sourcePin: {
        path: 'scripts/bridge/palimpsest-bri-source-pin.json',
        schemaVersion: pin.schemaVersion,
        bytes: pinBytes.length,
        sha256: sha256(pinBytes),
      },
      schema: {
        path: `public/data/${BRI_SCHEMA_FILE}`,
        id: BRI_SCHEMA_ID,
        bytes: schemaBytes.length,
        sha256: sha256(schemaBytes),
      },
      release: pin.release,
      sourceArtifacts: pin.sourceArtifacts,
    },
    sourceReadiness: pin.sourceSnapshot.readiness,
    claimSemantics: pin.sourceSnapshot.claimSemantics,
    targetCoverage: pin.sourceSnapshot.targetCoverage,
    economicContext: pin.economicSnapshot,
    usePolicy: {
      lane: 'parallel_context_only',
      allowedUse: 'Source discovery, coverage-gap review and national economic context with original claim class, implementation state, rights, clocks and limitations retained.',
      crossLaneJoinPolicy: 'prohibited',
      displayRelationship: 'May be displayed beside NarcoScope evidence only when each lane remains separately attributed and no shared model, score, record linkage or corroboration claim is created.',
      prohibitions: {
        drugConflictInfrastructureCausalJoin: 'prohibited',
        actorClassification: 'prohibited',
        bilateralRouteInference: 'prohibited',
        guiltInference: 'prohibited',
        politicalMovementClassification: 'prohibited',
        projectAttributionFromNationalSeries: 'prohibited',
        tacticalOrNavigableUse: 'prohibited',
      },
    },
    limitations: [
      'Source discovery, link-only, planned and adapter-ready records describe implementation readiness; they are not live observations or proof that a target is covered.',
      'Official or administrative publication identifies the publisher and claim type; it does not provide independent corroboration or convert an allegation into a finding.',
      'Modeled and analytical estimates remain estimates and cannot be relabeled as observed project, finance, employment, environmental or conflict facts.',
      'World Development Indicators are national annual context. They do not establish Belt and Road, CPEC, Gwadar, CMEC, Kyaukpyu or Balochistan project effects or causality.',
      'Unavailable World Bank rows remain unavailable counts, never zeroes, neutral readings or imputed observations.',
      'Balochistan movement history is represented only as target-level readiness for a plural historical claim ledger. No person, organization, community, party, movement or armed actor is classified here.',
      'The artifact contains no observation values, person records, event narratives, precise coordinates, tactical vulnerabilities, bilateral route claims or relationship graph.',
      'Release and freshness receipts are point-in-time evidence. Consumers must re-check source hashes and availability before relying on a later deployment.',
    ],
  })
  validateSchema(artifact)
  return artifact
}

export function serializePalimpsestBriArtifact(artifact) {
  return serialize(artifact)
}

export async function generatePalimpsestBriArtifact({
  pinPath = DEFAULT_BRI_PIN,
  schemaPath = DEFAULT_BRI_SCHEMA,
  output = DEFAULT_BRI_OUTPUT,
  hashOutput = DEFAULT_BRI_HASH_OUTPUT,
  check = false,
} = {}) {
  const [pinRaw, schemaRaw] = await Promise.all([fs.readFile(pinPath), fs.readFile(schemaPath)])
  const pin = parseJson(pinRaw, 'BRI source pin')
  const artifact = buildPalimpsestBriArtifact(pin, { pinRaw, schemaRaw })
  const serialized = serializePalimpsestBriArtifact(artifact)
  const artifactSha256 = sha256(serialized)
  const hashLine = `${artifactSha256}  ${BRI_ARTIFACT_FILE}\n`
  if (check) {
    const [checkedInArtifact, checkedInHash] = await Promise.all([
      fs.readFile(output, 'utf8'),
      fs.readFile(hashOutput, 'utf8'),
    ])
    if (checkedInArtifact !== serialized) throw new Error(`${BRI_ARTIFACT_FILE} is stale; regenerate the pinned bridge`)
    if (checkedInHash !== hashLine) throw new Error(`${BRI_HASH_FILE} is stale; regenerate the pinned bridge`)
  } else {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await Promise.all([
      fs.writeFile(output, serialized, 'utf8'),
      fs.writeFile(hashOutput, hashLine, 'utf8'),
    ])
  }
  return { artifact, output, bytes: Buffer.byteLength(serialized), sha256: artifactSha256 }
}

function option(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return path.resolve(value)
}

async function main() {
  const args = process.argv.slice(2)
  const pinPath = option(args, '--pin-output') ?? DEFAULT_BRI_PIN
  const schemaPath = option(args, '--schema') ?? DEFAULT_BRI_SCHEMA
  const output = option(args, '--output') ?? DEFAULT_BRI_OUTPUT
  const hashOutput = option(args, '--hash-output') ?? (
    output === DEFAULT_BRI_OUTPUT ? DEFAULT_BRI_HASH_OUTPUT : `${output}.sha256`
  )
  if (args.includes('--refresh-pin')) {
    const pin = await buildPalimpsestBriSourcePin({
      sourceDir: option(args, '--source-dir'),
      releaseReceiptPath: option(args, '--release-receipt'),
      releaseManifestPath: option(args, '--release-manifest'),
    })
    await fs.mkdir(path.dirname(pinPath), { recursive: true })
    await fs.writeFile(pinPath, serialize(pin), 'utf8')
  }
  const result = await generatePalimpsestBriArtifact({
    pinPath,
    schemaPath,
    output,
    hashOutput,
    check: args.includes('--check'),
  })
  const action = args.includes('--check') ? 'verified' : 'wrote'
  console.log(`${action} ${path.relative(defaultRoot, result.output)} (${result.bytes} bytes, sha256 ${result.sha256})`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
