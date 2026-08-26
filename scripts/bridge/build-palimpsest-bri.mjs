#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BRI_SCHEMA_VERSION = 'narcoscope.palimpsest.bri-context.v1'
export const BRI_PIN_SCHEMA_VERSION = 'narcoscope.palimpsest.bri-source-pin.v1'
export const BRI_SCHEMA_FILE = 'narcoscope-palimpsest-bri-v1.schema.json'
export const BRI_ARTIFACT_FILE = 'narcoscope-palimpsest-bri-v1.json'
export const BRI_HASH_FILE = `${BRI_ARTIFACT_FILE}.sha256`

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '../..')
export const DEFAULT_BRI_PIN = path.join(scriptDir, 'palimpsest-bri-source-pin.json')
export const DEFAULT_BRI_OUTPUT = path.join(defaultRoot, 'public/data', BRI_ARTIFACT_FILE)
export const DEFAULT_BRI_HASH_OUTPUT = path.join(defaultRoot, 'public/data', BRI_HASH_FILE)

const SHA256_RE = /^[0-9a-f]{64}$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const IMPLEMENTATION_STATES = Object.freeze([
  'adapter_ready',
  'blocked',
  'link_only',
  'live',
  'planned',
])
const BUILD_READY_STATES = new Set(['adapter_ready', 'live'])
const COUNTRY_ORDER = Object.freeze(['CHN', 'MMR', 'PAK'])
const COUNTRY_LABELS = Object.freeze({ CHN: 'China', MMR: 'Myanmar', PAK: 'Pakistan' })
const TARGET_AREAS = Object.freeze([
  Object.freeze({ areaId: 'cpec', label: 'China-Pakistan Economic Corridor', targetIds: ['cpec_portfolio'] }),
  Object.freeze({
    areaId: 'gwadar',
    label: 'Gwadar infrastructure and local political economy',
    targetIds: ['gwadar_port_free_zone', 'gwadar_connectivity', 'gwadar_public_services'],
  }),
  Object.freeze({ areaId: 'cmec', label: 'China-Myanmar Economic Corridor', targetIds: ['cmec_portfolio'] }),
  Object.freeze({ areaId: 'kyaukpyu', label: 'Kyaukpyu port and special economic zone', targetIds: ['kyaukpyu_port_sez'] }),
  Object.freeze({
    areaId: 'balochistan',
    label: 'Balochistan political economy and plural movement history',
    targetIds: ['balochistan_resources_revenue', 'balochistan_movement_history'],
  }),
])
const REQUIRED_TARGET_IDS = new Set(TARGET_AREAS.flatMap((area) => area.targetIds))
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'addresses',
  'aliases',
  'coordinates',
  'dateOfBirth',
  'entityRecords',
  'eventNarrative',
  'eventRecords',
  'identityNumber',
  'latitude',
  'longitude',
  'observations',
  'personRecords',
  'routeGeometry',
  'tacticalVulnerability',
  'value',
])

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

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

function requireSha256(value, label) {
  if (!SHA256_RE.test(String(value ?? ''))) throw new Error(`${label} must be a lowercase SHA-256`)
  return value
}

function requireCommit(value, label) {
  if (!COMMIT_RE.test(String(value ?? ''))) throw new Error(`${label} must be a lowercase 40-character Git commit`)
  return value
}

async function readJsonWithDescriptor(filePath) {
  const raw = await fs.readFile(filePath)
  return {
    data: JSON.parse(raw.toString('utf8')),
    descriptor: { bytes: raw.length, sha256: sha256(raw) },
  }
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

function buildEconomicCoverage(economics) {
  const groups = new Map()
  for (const row of economics.observations ?? []) {
    if (!COUNTRY_ORDER.includes(row.country_code)) {
      throw new Error(`unexpected economic country ${row.country_code}`)
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
  const totals = {
    countries: countries.length,
    indicators: new Set(countries.flatMap((country) => country.indicators.map((item) => item.seriesId))).size,
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

function forbiddenPaths(value, parts = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenPaths(item, [...parts, String(index)]))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(FORBIDDEN_PAYLOAD_KEYS.has(key) ? [[...parts, key].join('.')] : []),
    ...forbiddenPaths(item, [...parts, key]),
  ])
}

export function assertPalimpsestBriPin(pin) {
  requireObject(pin, 'BRI source pin')
  if (pin.schemaVersion !== BRI_PIN_SCHEMA_VERSION) throw new Error(`unexpected BRI pin schema ${pin.schemaVersion}`)
  requireCommit(pin.release?.sourceRevision, 'Palimpsest release source revision')
  requireSha256(pin.release?.artifactTreeSha256, 'Palimpsest Railway artifact tree hash')
  requireSha256(pin.release?.receiptSha256, 'Palimpsest Railway receipt hash')
  requireSha256(pin.sourceArtifacts?.observatory?.sha256, 'observatory artifact hash')
  requireSha256(pin.sourceArtifacts?.economics?.sha256, 'economics artifact hash')
  requireSha256(pin.sourceArtifacts?.pagesPublicationReceipt?.sha256, 'Pages receipt hash')
  const states = pin.sourceSnapshot?.readiness?.implementationStates ?? {}
  if (IMPLEMENTATION_STATES.some((state) => !Number.isInteger(states[state]))) {
    throw new Error('source pin must retain every Palimpsest implementation state')
  }
  const stateTotal = Object.values(states).reduce((total, value) => total + value, 0)
  if (stateTotal !== pin.sourceSnapshot.readiness.sourceCount) {
    throw new Error('source readiness state counts do not sum to source count')
  }
  const pinnedTargets = new Set(pin.sourceSnapshot.targetCoverage.flatMap((area) => (
    area.targets.map((target) => target.targetId)
  )))
  if (pinnedTargets.size !== REQUIRED_TARGET_IDS.size
    || [...REQUIRED_TARGET_IDS].some((targetId) => !pinnedTargets.has(targetId))) {
    throw new Error('BRI pin target coverage changed')
  }
  const totals = pin.economicSnapshot?.coverage?.totals
  requireInteger(totals?.sourceRows, 'economic source-row count')
  requireInteger(totals?.unavailableRows, 'economic unavailable-row count')
  if (totals.sourceRows !== totals.observedRows + totals.forecastRows + totals.unavailableRows) {
    throw new Error('economic evidence states do not partition the pinned source rows')
  }
  const forbidden = forbiddenPaths(pin)
  if (forbidden.length > 0) throw new Error(`BRI pin contains forbidden detail fields: ${forbidden.join(', ')}`)
  return pin
}

export async function buildPalimpsestBriSourcePin({ sourceDir, releaseReceiptPath } = {}) {
  if (!sourceDir) throw new Error('--source-dir is required when refreshing the BRI pin')
  if (!releaseReceiptPath) throw new Error('--release-receipt is required when refreshing the BRI pin')
  const observatoryPath = path.join(sourceDir, 'readings/belt-and-road-observatory-latest.json')
  const economicsPath = path.join(sourceDir, 'readings/bri-economic-observations-latest.json')
  const pagesReceiptPath = path.join(sourceDir, '.well-known/receipts/bri-wdi-pages-publication-v1.json')
  const [observatoryInput, economicsInput, pagesInput, railwayInput] = await Promise.all([
    readJsonWithDescriptor(observatoryPath),
    readJsonWithDescriptor(economicsPath),
    readJsonWithDescriptor(pagesReceiptPath),
    readJsonWithDescriptor(releaseReceiptPath),
  ])
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
  if (railwayReceipt.schema_version !== 'palimpsest.railway-fleet-deployment-receipt.v1') {
    throw new Error(`unsupported Railway receipt schema ${railwayReceipt.schema_version}`)
  }
  const release = requireObject(railwayReceipt.services?.palimpsest, 'Palimpsest Railway release')
  if (release.deployment_status !== 'SUCCESS' || release.health_status !== 'ready') {
    throw new Error('Palimpsest Railway release is not a verified successful ready release')
  }
  if (release.verification?.wdi_bundle_sha256 !== economicsInput.descriptor.sha256) {
    throw new Error('Railway receipt does not bind the selected WDI economic artifact')
  }
  if (observatory.observation_datasets?.[0]?.artifact?.sha256 !== economicsInput.descriptor.sha256) {
    throw new Error('observatory does not bind the selected WDI economic artifact')
  }
  if (observatory.observation_datasets?.[0]?.publication_receipt?.receipt_sha256 !== pagesInput.descriptor.sha256) {
    throw new Error('observatory does not bind the selected Pages publication receipt')
  }
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
  const economicCoverage = buildEconomicCoverage(economics)
  assertCoverageMatches(economics.coverage, economicCoverage.totals)
  const requestReceipts = economics.request_receipts ?? []
  const datasetLastUpdated = uniqueSorted(requestReceipts.map((item) => item.dataset_last_updated))
  const sourceReleaseUpperBounds = uniqueSorted(requestReceipts.map((item) => item.source_release_upper_bound))
  const retrievedAt = uniqueSorted(requestReceipts.map((item) => item.retrieved_at))
  if (datasetLastUpdated.length !== 1 || sourceReleaseUpperBounds.length !== 1 || retrievedAt.length !== 1) {
    throw new Error('economic collection must expose one unambiguous set of source and retrieval clocks')
  }
  const publication = observatory.observation_datasets[0].publication_receipt
  const pin = {
    schemaVersion: BRI_PIN_SCHEMA_VERSION,
    refreshedAt: railwayReceipt.generated_at,
    release: {
      producer: 'Palimpsest',
      status: 'production_verified_at_release',
      canonicalBaseUrl: 'https://palimpsest.info',
      railwayMirrorBaseUrl: requireString(release.railway_url, 'Palimpsest Railway URL'),
      deploymentId: requireString(release.deployment_id, 'Palimpsest Railway deployment id'),
      sourceRevision: requireCommit(release.source_commit, 'Palimpsest Railway source commit'),
      artifactTreeSha256: requireSha256(release.artifact_tree_sha256, 'Palimpsest Railway artifact tree hash'),
      receiptSha256: railwayInput.descriptor.sha256,
      verifiedAt: railwayReceipt.generated_at,
      verificationSemantics: 'Point-in-time exact-release verification; not continuous availability or freshness monitoring.',
      pagesPublication: {
        status: publication.status,
        sourceRevision: requireCommit(publication.release_a_sha, 'Pages publication source revision'),
        receiptSha256: pagesInput.descriptor.sha256,
        verifiedAt: publication.verified_at,
        freshUntil: publication.fresh_until,
        availabilitySemantics: publication.availability_semantics,
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
        downstreamSemantics: economics.context_policy.downstream_semantics,
      },
      coverage: economicCoverage,
    },
  }
  return assertPalimpsestBriPin(pin)
}

export function assertPalimpsestBriBoundary(artifact) {
  requireObject(artifact, 'Palimpsest BRI artifact')
  if (artifact.schemaVersion !== BRI_SCHEMA_VERSION) throw new Error(`unexpected BRI artifact schema ${artifact.schemaVersion}`)
  const policy = artifact.usePolicy ?? {}
  if (policy.lane !== 'parallel_context_only' || policy.crossLaneJoinPolicy !== 'prohibited') {
    throw new Error('BRI context must remain a parallel lane with cross-lane joins prohibited')
  }
  const requiredProhibitions = [
    'drugConflictInfrastructureCausalJoin',
    'actorClassification',
    'bilateralRouteInference',
    'guiltInference',
    'politicalMovementClassification',
  ]
  if (requiredProhibitions.some((key) => policy.prohibitions?.[key] !== 'prohibited')) {
    throw new Error('BRI context lost a required inference prohibition')
  }
  if (artifact.economicContext?.coverage?.totals?.sourceRows
    !== artifact.economicContext.coverage.totals.observedRows
      + artifact.economicContext.coverage.totals.forecastRows
      + artifact.economicContext.coverage.totals.unavailableRows) {
    throw new Error('published economic states do not partition source rows')
  }
  const countryCodes = artifact.economicContext?.coverage?.countries?.map((country) => country.countryCode)
  if (JSON.stringify(countryCodes) !== JSON.stringify(COUNTRY_ORDER)) {
    throw new Error('published economic country scope changed')
  }
  const targetIds = new Set(artifact.targetCoverage.flatMap((area) => area.targets.map((target) => target.targetId)))
  if ([...REQUIRED_TARGET_IDS].some((targetId) => !targetIds.has(targetId))) {
    throw new Error('published BRI target scope changed')
  }
  const forbidden = forbiddenPaths(artifact)
  if (forbidden.length > 0) throw new Error(`BRI artifact contains forbidden detail fields: ${forbidden.join(', ')}`)
  return artifact
}

export function buildPalimpsestBriArtifact(pin) {
  assertPalimpsestBriPin(pin)
  const pinSha256 = sha256(serialize(pin))
  return assertPalimpsestBriBoundary({
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
        sha256: pinSha256,
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
}

export function serializePalimpsestBriArtifact(artifact) {
  return serialize(artifact)
}

export async function generatePalimpsestBriArtifact({
  pinPath = DEFAULT_BRI_PIN,
  output = DEFAULT_BRI_OUTPUT,
  hashOutput = DEFAULT_BRI_HASH_OUTPUT,
  check = false,
} = {}) {
  const pin = JSON.parse(await fs.readFile(pinPath, 'utf8'))
  const artifact = buildPalimpsestBriArtifact(pin)
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
  const output = option(args, '--output') ?? DEFAULT_BRI_OUTPUT
  const hashOutput = option(args, '--hash-output') ?? (
    output === DEFAULT_BRI_OUTPUT ? DEFAULT_BRI_HASH_OUTPUT : `${output}.sha256`
  )
  if (args.includes('--refresh-pin')) {
    const pin = await buildPalimpsestBriSourcePin({
      sourceDir: option(args, '--source-dir'),
      releaseReceiptPath: option(args, '--release-receipt'),
    })
    await fs.mkdir(path.dirname(pinPath), { recursive: true })
    await fs.writeFile(pinPath, serialize(pin), 'utf8')
  }
  const result = await generatePalimpsestBriArtifact({
    pinPath,
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
