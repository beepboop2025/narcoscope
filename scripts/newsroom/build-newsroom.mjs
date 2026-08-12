#!/usr/bin/env node

/**
 * NarcoScope deterministic evidence newsroom.
 *
 * Offline inputs:
 *   - the checked-in public China aggregate bridge;
 *   - the checked-in CDC VSRR snapshot; and
 *   - the checked-in official-source capability registry.
 *
 * The pipeline deliberately has two gates. A machine brief is a typed set of
 * bounded facts. An automated evidence analysis is a separately gated,
 * sentence-cited rendering of those facts with countercases and limitations.
 * Passing the machine-brief gate does not by itself make prose publishable.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const NEWSROOM_PIPELINE_VERSION = 'narcoscope.newsroom.pipeline.v2'
export const MACHINE_BRIEF_SCHEMA_VERSION = 'narcoscope.newsroom.machine-brief.v1'
export const DOSSIER_SCHEMA_VERSION = 'narcoscope.newsroom.evidence-analysis.v1'
export const ARTICLE_SLUG = 'china-linked-precursor-incidents-official-record'
export const MAX_INPUT_BYTES = 2 * 1024 * 1024

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '../..')
export const DEFAULT_NEWS_OUTPUT = path.join(defaultRoot, 'public/news')

const INPUT_PATHS = Object.freeze({
  bridge: 'public/data/narcoscope-palimpsest-v1.json',
  overdose: 'src/data/overdose.json',
  capabilities: 'scripts/newsroom/source-capabilities.json',
  previousDossier: `public/news/${ARTICLE_SLUG}.dossier.json`,
})

const FILES = Object.freeze({
  machineBrief: `${ARTICLE_SLUG}.machine-brief.json`,
  dossier: `${ARTICLE_SLUG}.dossier.json`,
  html: `${ARTICLE_SLUG}.html`,
  index: 'index.json',
  jsonFeed: 'feed.json',
  atomFeed: 'feed.xml',
  manifest: 'manifest.json',
})

const SITE_ORIGIN = 'https://narcoscope.com'
const ARTICLE_ID = `narcoscope.newsroom.${ARTICLE_SLUG}`

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const sum = (values) => values.reduce((total, value) => total + value, 0)
const round = (value, places = 2) => {
  const factor = 10 ** places
  return Math.round((value + Number.EPSILON) * factor) / factor
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value))
export const serializeJson = (value) => `${JSON.stringify(value, null, 2)}\n`

function hashContent(base) {
  return { ...base, contentHash: sha256(canonicalJson(base)) }
}

function verifyContentHash(value) {
  const { contentHash, ...base } = value
  return typeof contentHash === 'string' && contentHash === sha256(canonicalJson(base))
}

function inputDescriptor(relativePath, raw) {
  return { path: relativePath, bytes: Buffer.byteLength(raw), sha256: sha256(raw) }
}

function nonFiniteNumberPaths(value) {
  const failures = []
  const stack = [{ value, path: '$' }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) {
      failures.push(current.path)
      continue
    }
    if (!current.value || typeof current.value !== 'object') continue
    for (const [key, item] of Object.entries(current.value)) {
      stack.push({ value: item, path: `${current.path}.${key}` })
    }
  }
  return failures.sort(compareText)
}

async function readBoundedUtf8(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r')
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new Error(`${filePath}: expected a regular file`)
    if (stats.size > maxBytes) throw new Error(`${filePath}: input exceeds ${maxBytes} byte limit`)

    // Read at most the configured ceiling plus one byte from the same open file
    // descriptor. The extra byte catches growth between stat and read.
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > maxBytes) throw new Error(`${filePath}: input exceeds ${maxBytes} byte limit`)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset))
  } finally {
    await handle.close()
  }
}

export async function readJsonInput(root, relativePath, maxBytes = MAX_INPUT_BYTES) {
  const filePath = path.join(root, relativePath)
  const raw = await readBoundedUtf8(filePath, maxBytes)
  let data
  try {
    data = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${relativePath}: invalid JSON (${error instanceof Error ? error.message : error})`)
  }
  const nonFinite = nonFiniteNumberPaths(data)
  if (nonFinite.length > 0) {
    throw new Error(`${relativePath}: non-finite JSON number at ${nonFinite.join(', ')}`)
  }
  return { raw, data, descriptor: inputDescriptor(relativePath, raw) }
}

async function readOptionalJsonInput(root, relativePath, maxBytes = MAX_INPUT_BYTES) {
  try {
    return await readJsonInput(root, relativePath, maxBytes)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function loadNewsroomInputs(root = defaultRoot) {
  const [bridge, overdose, capabilities, previousDossier] = await Promise.all([
    readJsonInput(root, INPUT_PATHS.bridge),
    readJsonInput(root, INPUT_PATHS.overdose),
    readJsonInput(root, INPUT_PATHS.capabilities),
    readOptionalJsonInput(root, INPUT_PATHS.previousDossier),
  ])
  return { bridge, overdose, capabilities, previousDossier }
}

function gateFailure(gateId, errors) {
  const error = new Error(`${gateId} failed:\n- ${errors.join('\n- ')}`)
  error.name = 'NewsroomGateError'
  error.gateId = gateId
  error.failures = errors
  return error
}

const gateAssertionCounts = new WeakMap()

function requireGate(errors, condition, message) {
  gateAssertionCounts.set(errors, (gateAssertionCounts.get(errors) ?? 0) + 1)
  if (!condition) errors.push(message)
}

function gateAssertionCount(errors) {
  return gateAssertionCounts.get(errors) ?? 0
}

function requireExactKeys(errors, value, expectedKeys, pathLabel) {
  const actual = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort(compareText)
    : []
  const expected = [...expectedKeys].sort(compareText)
  requireGate(
    errors,
    canonicalJson(actual) === canonicalJson(expected),
    `${pathLabel} must have exactly these fields: ${expected.join(', ')}`,
  )
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function findForbiddenKeys(value, pathParts = []) {
  const forbidden = new Set([
    'address', 'addresses', 'alias', 'aliases', 'coordinates', 'dateofbirth',
    'dob', 'email', 'emailaddress', 'entitynumber', 'fullname', 'identitynumber',
    'name', 'passport', 'phone', 'phonenumber', 'subject', 'subjects', 'telephone',
    'wallet', 'walletaddress',
  ])
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenKeys(item, [...pathParts, String(index)]))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(forbidden.has(key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')) ? [[...pathParts, key].join('.')] : []),
    ...findForbiddenKeys(item, [...pathParts, key]),
  ])
}

function publicStrings(value, pathParts = []) {
  if (typeof value === 'string') return [{ path: pathParts.join('.') || '$', value }]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => publicStrings(item, [...pathParts, String(index)]))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => publicStrings(item, [...pathParts, key]))
}

export function assertCapabilityRegistry(registry) {
  const gateId = 'source-capability-registry-gate.v1'
  const errors = []
  const capabilities = registry?.capabilities ?? []
  const byId = Object.fromEntries(capabilities.map((item) => [item.id, item]))
  const required = [
    'gacc-customs-statistics',
    'un-comtrade',
    'incb-precursors-public-report',
    'incb-pics',
    'incb-pen-online',
    'cdc-vsrr-overdose',
    'ofac-sdn',
    'uscourts-pacer',
  ]

  requireGate(errors, registry?.schemaVersion === 'narcoscope.newsroom.source-capabilities.v1', 'unexpected registry schema')
  requireGate(errors, /^\d{4}-\d{2}-\d{2}$/.test(registry?.asOf ?? ''), 'registry asOf must be an ISO calendar date')
  requireGate(errors, duplicateValues(capabilities.map((item) => item.id)).length === 0, 'capability ids must be unique')
  for (const id of required) requireGate(errors, Boolean(byId[id]), `required capability is absent: ${id}`)
  for (const item of capabilities) {
    requireGate(errors, item?.publisher?.length > 0, `${item.id}: publisher is required`)
    requireGate(errors, /^https:\/\//.test(item?.url ?? ''), `${item.id}: an HTTPS official URL is required`)
    requireGate(errors, item?.availability?.status?.length > 0, `${item.id}: availability status is required`)
    requireGate(errors, item?.availability?.access?.length > 0, `${item.id}: access limitations are required`)
    requireGate(errors, item?.availability?.automation?.length > 0, `${item.id}: automation status is required`)
    requireGate(errors, item?.licensing?.status?.length > 0, `${item.id}: licensing status is required`)
    requireGate(errors, item?.licensing?.statement?.length > 0, `${item.id}: licensing statement is required`)
    requireGate(errors, item?.upstreamGroup?.length > 0, `${item.id}: upstream independence group is required`)
    requireGate(errors, ['active_evidence', 'capability_only', 'unavailable'].includes(item?.newsroomRole), `${item.id}: newsroom role is invalid`)
    requireGate(errors, item?.newsroomUse?.status?.length > 0, `${item.id}: newsroom-use status is required`)
    requireGate(errors, (item?.newsroomUse?.prohibitedClaims?.length ?? 0) > 0, `${item.id}: prohibited claims are required`)
  }
  for (const id of ['incb-pics', 'incb-pen-online']) {
    requireGate(errors, byId[id]?.availability?.status === 'restricted_non_public', `${id} must remain explicitly non-public`)
    requireGate(errors, byId[id]?.availability?.automation === 'unavailable', `${id} must remain unavailable to automation`)
    requireGate(errors, byId[id]?.newsroomRole === 'unavailable', `${id} must count as zero corroboration`)
    requireGate(errors, byId[id]?.newsroomUse?.status === 'unavailable', `${id} cannot be promoted as newsroom evidence`)
  }
  for (const id of ['gacc-customs-statistics', 'un-comtrade']) {
    requireGate(errors, byId[id]?.newsroomRole === 'capability_only', `${id} must count as zero corroboration until ingested`)
  }
  for (const id of ['incb-precursors-public-report', 'cdc-vsrr-overdose', 'ofac-sdn']) {
    requireGate(errors, byId[id]?.newsroomRole === 'active_evidence', `${id} must be an active checked-in input`)
  }
  requireGate(errors, byId['uscourts-pacer']?.newsroomUse?.status === 'unavailable', 'PACER cannot be represented as an automated input')
  requireGate(errors, byId['gacc-customs-statistics']?.availability?.publicRecordLevelShipments === false, 'GACC capability must not imply a public shipment ledger')
  requireGate(errors, byId['un-comtrade']?.availability?.publicRecordLevelShipments === false, 'Comtrade capability must stay aggregate')

  if (errors.length > 0) throw gateFailure(gateId, errors)
  return { gateId, status: 'passed', assertionCount: gateAssertionCount(errors) }
}

function capabilityMap(inputs) {
  return Object.fromEntries(inputs.capabilities.data.capabilities.map((item) => [item.id, item]))
}

function latestIsoDate(values) {
  return values.filter(Boolean).sort(compareText).at(-1) ?? null
}

function byEntityType(dataset) {
  return Object.fromEntries(dataset.data.byEntityType.map((item) => [item.entityType, item.count]))
}

function nationalSyntheticOpioidPoints(overdose) {
  return overdose.records
    .filter((record) => record.jurisdiction === 'US'
      && record.substance === 'synthetic_opioids'
      && record.periodEndMonth === 12
      && record.partialYear === false)
    .map((record) => ({
      year: record.year,
      periodEndMonth: record.periodEndMonth,
      provisionalDeaths: record.deaths,
      predictedDeaths: record.predictedDeaths,
      percentComplete: record.percentComplete,
    }))
    .sort((a, b) => a.year - b.year)
}

export function buildMachineBrief(inputs) {
  assertCapabilityRegistry(inputs.capabilities.data)
  const bridge = inputs.bridge.data
  const overdose = inputs.overdose.data
  const incidentDataset = bridge.datasets.precursorCorridorIncidents
  const corridors = incidentDataset.data.corridors
  const chinaEuAggregate = corridors.find((record) => (
    record.originAttribution === 'china_only'
      && record.reportedOrigin === 'China'
      && record.destination === 'European Union'
      && record.recordKind === 'multi_incident_aggregate'
  ))
  const operationPseudonymContext = incidentDataset.data.contextRecords.find((record) => (
    record.contextId === 'operation-pseudonym-australia-new-zealand-origins-2024'
  ))
  if (!chinaEuAggregate || !operationPseudonymContext) {
    throw gateFailure('machine-brief-gate.v1', [
      'the audited INCB quantitative aggregate or Operation Pseudonym context is unavailable',
    ])
  }
  const harmPoints = nationalSyntheticOpioidPoints(overdose)
  if (harmPoints.length < 2) {
    throw gateFailure('machine-brief-gate.v1', [
      'the full annual December CDC series requires at least two observations',
    ])
  }
  const inputArtifacts = [
    { id: 'china-public-aggregate-bridge', ...inputs.bridge.descriptor },
    { id: 'cdc-vsrr-offline-snapshot', ...inputs.overdose.descriptor },
    { id: 'official-source-capabilities', ...inputs.capabilities.descriptor },
  ]
  const revisionHash = sha256(canonicalJson({
    pipelineVersion: NEWSROOM_PIPELINE_VERSION,
    editorialPolicyVersion: 'bounded-official-record.v2',
    inputs: inputArtifacts,
  }))
  const dataAsOf = latestIsoDate([
    bridge.dataAsOf,
    overdose.meta.downloaded,
    inputs.capabilities.data.asOf,
  ])

  const base = {
    schemaVersion: MACHINE_BRIEF_SCHEMA_VERSION,
    artifactId: `${ARTICLE_ID}.machine-brief`,
    articleId: ARTICLE_ID,
    slug: ARTICLE_SLUG,
    contentClass: 'machine_brief',
    publishability: 'not_publishable_as_analysis_without_second_gate',
    dataAsOf,
    generatedAt: `${dataAsOf}T00:00:00.000Z`,
    revisionHash,
    inputArtifacts,
    evidenceLanes: {
      lawfulIndustrialTrade: {
        evidenceStatus: 'not_measured_in_current_inputs',
        registeredCapabilities: ['gacc-customs-statistics', 'un-comtrade'],
        publicRecordLevelShipmentJoinAvailable: false,
        denominatorAvailable: false,
        interpretation: 'Aggregate trade capabilities exist, but this build contains no product-level lawful-trade denominator and no end-use field.',
      },
      officialEnforcementIncidents: {
        sourceCapability: 'incb-precursors-public-report',
        document: {
          url: incidentDataset.provenance.url,
          sha256: incidentDataset.provenance.documentSha256,
          retrievedAt: incidentDataset.provenance.retrievedAt,
        },
        retainedQuantitativeRecordCount: incidentDataset.data.includedQuantitativeRecordCount,
        retainedContextRecordCount: incidentDataset.data.includedContextRecordCount,
        chinaEuAggregate: {
          reportedOrigin: chinaEuAggregate.reportedOrigin,
          transit: chinaEuAggregate.transit,
          destination: chinaEuAggregate.destination,
          seizureLocation: chinaEuAggregate.seizureLocation,
          year: chinaEuAggregate.year,
          precursorClass: chinaEuAggregate.precursor,
          reportedQuantityKg: chinaEuAggregate.quantityKg,
          quantityRelation: chinaEuAggregate.quantityRelation,
          quantityBasis: chinaEuAggregate.quantityBasis,
          recordKind: chinaEuAggregate.recordKind,
          aggregationEligibility: chinaEuAggregate.aggregationEligibility,
          aggregationGroup: chinaEuAggregate.aggregationGroup,
          incidentCount: chinaEuAggregate.incidentCount,
          sourceLocator: chinaEuAggregate.sourceLocator,
        },
        operationPseudonymContext: {
          contextId: operationPseudonymContext.contextId,
          origins: operationPseudonymContext.origins,
          destinations: operationPseudonymContext.destinations,
          year: operationPseudonymContext.year,
          allocationStatus: operationPseudonymContext.allocationStatus,
          operationReportedSeizureCount: operationPseudonymContext.operationReportedSeizureCount,
          countScope: operationPseudonymContext.countScope,
          summary: operationPseudonymContext.summary,
          sourceLocator: operationPseudonymContext.sourceLocator,
          quantityKg: null,
          incidentCountByOriginDestinationPair: null,
        },
        quantityAggregation: incidentDataset.data.quantityAggregation,
        bilateralSubtotalComputed: false,
        completeFlowSeries: false,
        successfulMovementMeasure: false,
      },
      harmTrend: {
        sourceCapability: 'cdc-vsrr-overdose',
        geography: 'United States',
        measure: 'provisional deaths involving synthetic opioids excluding methadone (T40.4) in 12-month-ending December windows',
        observations: harmPoints,
        provisional: true,
        revisionsExpected: true,
        selectionRule: 'Every available United States row for a 12-month-ending December period, partialYear=false, and substance=synthetic_opioids.',
        containsOriginOrShipmentFields: false,
        causalAttributionAvailable: false,
      },
    },
    missingRecordLevelJoins: [
      { from: 'lawfulIndustrialTrade', to: 'officialEnforcementIncidents', available: false },
      { from: 'officialEnforcementIncidents', to: 'harmTrend', available: false },
    ],
    adjudicationCoverage: {
      dojCaseAnnouncements: 'not_in_current_capability_contract',
      federalCourtDockets: 'registered_capability_unavailable_to_automation',
      adjudicatedFindingsInBrief: false,
    },
    safety: {
      retainedGrain: 'country, broad precursor class, reporting period, aggregate quantity relation, incident count and printed source locator',
      excludedDetails: [
        'subject identities',
        'addresses and identifiers',
        'live or subnational shipment routing',
        'synthesis routes',
        'conversion ratios',
        'yields',
      ],
      chemistryInstructionsIncluded: false,
      navigableOperationalDetailsIncluded: false,
    },
    limitations: [
      'The selected INCB aggregate is not a census of precursor movements or lawful trade.',
      'Nearly five tonnes is a source-qualified upper bound across nine incidents, not one exact shipment.',
      `Operation Pseudonym does not allocate the ${operationPseudonymContext.operationReportedSeizureCount} seizures or any mass by China/India and Australia/New Zealand origin-destination pair.`,
      'CDC mortality is a separate provisional, revisable harm series with no shipment or origin fields.',
      'PICS, PEN Online and automated PACER review are unavailable to this public offline build.',
    ],
    gate: {
      gateId: 'machine-brief-gate.v1',
      status: 'passed',
    },
  }
  return hashContent(base)
}

export function assertMachineBrief(brief) {
  const gateId = 'machine-brief-gate.v1'
  const errors = []
  const lanes = brief?.evidenceLanes ?? {}
  const incidents = lanes.officialEnforcementIncidents ?? {}
  const harm = lanes.harmTrend ?? {}
  const forbiddenBriefKeys = findForbiddenKeys(brief)

  requireExactKeys(errors, brief, [
    'schemaVersion', 'artifactId', 'articleId', 'slug', 'contentClass',
    'publishability', 'dataAsOf', 'generatedAt', 'revisionHash', 'inputArtifacts',
    'evidenceLanes', 'missingRecordLevelJoins', 'adjudicationCoverage', 'safety',
    'limitations', 'gate', 'contentHash',
  ], 'machine brief')
  requireExactKeys(errors, lanes, [
    'lawfulIndustrialTrade', 'officialEnforcementIncidents', 'harmTrend',
  ], 'machine brief evidence lanes')
  requireExactKeys(errors, incidents, [
    'sourceCapability', 'document', 'retainedQuantitativeRecordCount',
    'retainedContextRecordCount', 'chinaEuAggregate',
    'operationPseudonymContext', 'quantityAggregation',
    'bilateralSubtotalComputed', 'completeFlowSeries', 'successfulMovementMeasure',
  ], 'official enforcement incident lane')
  requireExactKeys(errors, lanes.lawfulIndustrialTrade, [
    'evidenceStatus', 'registeredCapabilities', 'publicRecordLevelShipmentJoinAvailable',
    'denominatorAvailable', 'interpretation',
  ], 'lawful industrial trade lane')
  requireExactKeys(errors, incidents.document, [
    'url', 'sha256', 'retrievedAt',
  ], 'official source document')
  requireExactKeys(errors, incidents.chinaEuAggregate, [
    'reportedOrigin', 'transit', 'destination', 'seizureLocation', 'year',
    'precursorClass', 'reportedQuantityKg', 'quantityRelation', 'quantityBasis',
    'recordKind', 'aggregationEligibility', 'aggregationGroup', 'incidentCount',
    'sourceLocator',
  ], 'China-to-EU aggregate')
  requireExactKeys(errors, incidents.chinaEuAggregate?.sourceLocator, [
    'pdfPage', 'printedPage', 'paragraph',
  ], 'China-to-EU source locator')
  requireExactKeys(errors, incidents.operationPseudonymContext, [
    'contextId', 'origins', 'destinations', 'year', 'allocationStatus',
    'operationReportedSeizureCount', 'countScope', 'summary', 'sourceLocator',
    'quantityKg', 'incidentCountByOriginDestinationPair',
  ], 'Operation Pseudonym context')
  requireExactKeys(errors, incidents.operationPseudonymContext?.sourceLocator, [
    'pdfPage', 'printedPage', 'paragraph',
  ], 'Operation Pseudonym source locator')
  requireExactKeys(errors, incidents.quantityAggregation, [
    'status', 'exactRecordCount', 'nonExactRecordCount', 'eligibleRecordCount',
    'excludedRecordCount', 'aggregationGroup', 'summedQuantityKg',
  ], 'qualified quantity aggregation')
  requireExactKeys(errors, harm, [
    'sourceCapability', 'geography', 'measure', 'observations', 'provisional',
    'revisionsExpected', 'selectionRule', 'containsOriginOrShipmentFields',
    'causalAttributionAvailable',
  ], 'harm trend lane')
  for (const [index, observation] of (harm.observations ?? []).entries()) {
    requireExactKeys(errors, observation, [
      'year', 'periodEndMonth', 'provisionalDeaths', 'predictedDeaths', 'percentComplete',
    ], `harm trend observation ${index}`)
  }

  requireGate(errors, brief?.schemaVersion === MACHINE_BRIEF_SCHEMA_VERSION, 'unexpected machine-brief schema')
  requireGate(errors, brief?.contentClass === 'machine_brief', 'machine brief must identify its content class')
  requireGate(errors, brief?.publishability === 'not_publishable_as_analysis_without_second_gate', 'machine brief cannot self-promote to analysis')
  requireGate(errors, verifyContentHash(brief), 'machine-brief content hash is invalid')
  requireGate(errors, /^[a-f0-9]{64}$/.test(brief?.revisionHash ?? ''), 'revision hash is required')
  requireGate(errors, brief?.inputArtifacts?.every((item) => Number.isInteger(item.bytes) && item.bytes > 0 && item.bytes <= MAX_INPUT_BYTES), 'every machine-brief input must record a bounded byte size')
  requireGate(errors, /^https:\/\/www\.incb\.org\/.+\.pdf$/.test(incidents?.document?.url ?? ''), 'exact public INCB PDF URL is required')
  requireGate(errors, /^[a-f0-9]{64}$/.test(incidents?.document?.sha256 ?? ''), 'INCB PDF content hash is required')
  requireGate(errors, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(incidents?.document?.retrievedAt ?? ''), 'INCB PDF retrieval time is required')
  requireGate(errors, incidents?.chinaEuAggregate?.quantityRelation === 'less_than', 'INCB aggregate must retain the source\'s less-than quantity relation')
  requireGate(errors, incidents?.chinaEuAggregate?.recordKind === 'multi_incident_aggregate', 'INCB quantity must remain a multi-incident aggregate')
  requireGate(errors, incidents?.chinaEuAggregate?.transit === null, 'the China-to-EU aggregate cannot acquire an unstated transit country')
  requireGate(errors, incidents?.chinaEuAggregate?.seizureLocation === null, 'the China-to-EU aggregate cannot acquire an unstated seizure location')
  requireGate(errors, incidents?.chinaEuAggregate?.aggregationEligibility === 'ineligible_non_exact', 'the less-than China-to-EU aggregate must remain ineligible for additive aggregation')
  requireGate(errors, incidents?.chinaEuAggregate?.aggregationGroup === 'meth_pre_precursor_substance_mass', 'the China-to-EU aggregate must retain its canonical comparison group')
  requireGate(errors, Number.isInteger(incidents?.chinaEuAggregate?.incidentCount) && incidents.chinaEuAggregate.incidentCount > 1, 'INCB aggregate must retain its incident count')
  requireGate(errors, Number.isFinite(incidents?.chinaEuAggregate?.reportedQuantityKg) && incidents.chinaEuAggregate.reportedQuantityKg > 0, 'INCB aggregate must retain a positive reported comparison value')
  requireGate(errors, incidents?.chinaEuAggregate?.sourceLocator?.paragraph === 94, 'INCB aggregate must retain paragraph 94 locator')
  requireGate(errors, incidents?.operationPseudonymContext?.allocationStatus === 'not_reported_by_origin_destination_pair', 'Operation Pseudonym must stay unallocated')
  requireGate(errors, Number.isInteger(incidents?.operationPseudonymContext?.operationReportedSeizureCount) && incidents.operationPseudonymContext.operationReportedSeizureCount > 0, 'Operation Pseudonym must retain its operation-wide seizure count')
  requireGate(errors, incidents?.operationPseudonymContext?.countScope === 'four_reporting_countries_operation_total', 'Operation Pseudonym count scope must remain operation-wide')
  requireGate(errors, incidents?.operationPseudonymContext?.quantityKg === null, 'Operation Pseudonym context cannot acquire a quantity')
  requireGate(errors, incidents?.operationPseudonymContext?.incidentCountByOriginDestinationPair === null, 'Operation Pseudonym context cannot acquire a bilateral incident count')
  requireGate(errors, incidents?.operationPseudonymContext?.sourceLocator?.paragraph === 46, 'Operation Pseudonym must retain paragraph 46 locator')
  requireGate(
    errors,
    incidents?.quantityAggregation?.status === 'not_computed_non_exact_inputs'
      && incidents?.quantityAggregation?.eligibleRecordCount === 0
      && incidents?.quantityAggregation?.excludedRecordCount === incidents?.retainedQuantitativeRecordCount
      && incidents?.quantityAggregation?.aggregationGroup === null
      && incidents?.quantityAggregation?.summedQuantityKg === null,
    'non-exact precursor quantities must remain excluded from additive aggregation',
  )
  requireGate(errors, incidents?.bilateralSubtotalComputed === false, 'a bilateral subtotal must not be computed')
  requireGate(errors, incidents?.completeFlowSeries === false, 'selected incidents cannot become a complete flow series')
  requireGate(errors, lanes?.lawfulIndustrialTrade?.evidenceStatus === 'not_measured_in_current_inputs', 'lawful-trade lane must stay explicitly unmeasured')
  requireGate(errors, lanes?.lawfulIndustrialTrade?.denominatorAvailable === false, 'lawful-trade denominator must not be invented')
  requireGate(errors, harm?.measure?.includes('excluding methadone (T40.4)'), 'CDC category must retain the T40.4 excluding-methadone qualifier')
  requireGate(errors, (harm?.observations?.length ?? 0) >= 2, 'CDC full annual December series requires at least two observations')
  requireGate(errors, harm?.observations?.every((item, index, rows) => index === 0 || item.year > rows[index - 1].year), 'CDC observations must be unique and chronologically ordered')
  requireGate(errors, harm?.revisionsExpected === true && harm?.selectionRule?.length > 0, 'CDC revision and row-selection rules are required')
  requireGate(errors, harm?.containsOriginOrShipmentFields === false && harm?.causalAttributionAvailable === false, 'harm data must stay separate from attribution')
  requireGate(errors, brief?.missingRecordLevelJoins?.every((item) => item.available === false), 'missing joins must not be inferred')
  requireGate(errors, brief?.adjudicationCoverage?.adjudicatedFindingsInBrief === false, 'no adjudication is present in this brief')
  requireGate(errors, brief?.safety?.chemistryInstructionsIncluded === false, 'chemistry instructions are forbidden')
  requireGate(errors, brief?.safety?.navigableOperationalDetailsIncluded === false, 'navigable operational detail is forbidden')
  requireGate(errors, forbiddenBriefKeys.length === 0, `forbidden subject/location keys found: ${forbiddenBriefKeys.join(', ')}`)
  requireGate(errors, brief?.gate?.gateId === gateId && brief?.gate?.status === 'passed', 'machine-brief gate marker is absent')

  if (errors.length > 0) throw gateFailure(gateId, errors)
  return { gateId, status: 'passed', assertionCount: gateAssertionCount(errors) }
}

const SOURCE_IDS = Object.freeze({
  'gacc-customs-statistics': 'SRC-GACC-STATS',
  'un-comtrade': 'SRC-UN-COMTRADE',
  'incb-precursors-public-report': 'SRC-INCB-PRECURSORS-2025',
  'incb-pics': 'SRC-INCB-PICS-CAPABILITY',
  'incb-pen-online': 'SRC-INCB-PEN-CAPABILITY',
  'cdc-vsrr-overdose': 'SRC-CDC-VSRR',
  'ofac-sdn': 'SRC-OFAC-SDN',
  'uscourts-pacer': 'SRC-USCOURTS-PACER',
})

function articleSource(capability) {
  return {
    id: SOURCE_IDS[capability.id],
    registryId: capability.id,
    publisher: capability.publisher,
    title: capability.title,
    url: capability.url,
    evidenceClass: capability.evidenceClass,
    upstreamGroup: capability.upstreamGroup,
    newsroomRole: capability.newsroomRole,
    availabilityStatus: capability.availability.status,
    newsroomUseStatus: capability.newsroomUse.status,
    accessNote: capability.availability.access,
    licensingNote: capability.licensing.statement,
    documentSha256: null,
    retrievedAt: null,
  }
}

const SUPPORT_PROFILES = Object.freeze({
  attributed_observation: {
    findingStatus: 'attributed_official_record',
    minimumIndependentActiveGroups: 1,
    corroborationClaimed: false,
  },
  multi_source_methodological_context: {
    findingStatus: 'multi_source_methodological_context',
    minimumIndependentActiveGroups: 2,
    corroborationClaimed: false,
  },
  capability_boundary: {
    findingStatus: 'capability_or_access_boundary',
    minimumIndependentActiveGroups: 0,
    corroborationClaimed: false,
  },
})

const SUPPORT_PROFILE_BY_CLAIM_TYPE = Object.freeze({
  scope: 'multi_source_methodological_context',
  missing_join: 'multi_source_methodological_context',
  definition: 'attributed_observation',
  source_capability: 'capability_boundary',
  coverage_gap: 'capability_boundary',
  interpretive_limit: 'capability_boundary',
  reported_measurement: 'attributed_observation',
  attribution_boundary: 'attributed_observation',
  subtotal_boundary: 'attributed_observation',
  coverage_limit: 'attributed_observation',
  administrative_count: 'attributed_observation',
  adjudication_boundary: 'attributed_observation',
  privacy_boundary: 'multi_source_methodological_context',
  trend: 'attributed_observation',
  separation: 'multi_source_methodological_context',
  conclusion: 'multi_source_methodological_context',
  causal_boundary: 'multi_source_methodological_context',
  alternative_explanation: 'multi_source_methodological_context',
  missing_evidence: 'capability_boundary',
  access_limit: 'capability_boundary',
  selection: 'attributed_observation',
  origin: 'attributed_observation',
  trade_denominator: 'capability_boundary',
  administrative_action: 'attributed_observation',
  harm_join: 'multi_source_methodological_context',
  restricted_sources: 'capability_boundary',
})

function sentence(id, evidenceLane, claimType, text, citations) {
  const profile = SUPPORT_PROFILE_BY_CLAIM_TYPE[claimType]
  if (!profile) throw new Error(`no evidence-support profile for claim type ${claimType}`)
  const causalPredicate = new Set([
    'causal_boundary', 'conclusion', 'harm_join', 'missing_join', 'separation',
  ]).has(claimType) ? 'explicit_non_attribution' : 'none'
  const normalizedCitations = citations.map((item) => typeof item === 'string'
    ? { sourceId: item, locator: 'registered source capability' }
    : item)
  return {
    id,
    evidenceLane,
    claimType,
    templateId: `narcoscope.claim.${claimType}.v1`,
    causalPredicate,
    corroborationKey: null,
    support: {
      profile,
      ...SUPPORT_PROFILES[profile],
    },
    text,
    citationIds: normalizedCitations.map((item) => item.sourceId),
    citationLocators: normalizedCitations,
  }
}

function formatNumber(value) {
  const [integer, decimal] = String(value).split('.')
  const sign = integer.startsWith('-') ? '-' : ''
  const digits = sign ? integer.slice(1) : integer
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}${decimal ? `.${decimal}` : ''}`
}

const INITIAL_PUBLICATION_SUMMARY = 'Initial deterministic publication from the cited checked-in official-source snapshots.'
const DATA_REFRESH_SUMMARY = 'Deterministic source refresh; evidence, qualification and publication receipts were recomputed.'

function publicationHistoryFailures(dossier) {
  const failures = []
  const history = dossier?.publicationRecord?.updateHistory
  if (!Array.isArray(history) || history.length === 0) return ['publication history must contain at least one event']
  if (history[0]?.eventType !== 'initial_publication') failures.push('first publication-history event must be initial_publication')
  if (history[0]?.summary !== INITIAL_PUBLICATION_SUMMARY) failures.push('initial publication summary is invalid')
  if (history.at(-1)?.revisionHash !== dossier?.revisionHash) failures.push('latest publication-history event must pin the current revision')
  const revisionHashes = history.map((event) => event?.revisionHash)
  if (duplicateValues(revisionHashes).length > 0) failures.push('publication-history revision hashes must be unique')
  for (const [index, event] of history.entries()) {
    const keys = event && typeof event === 'object' && !Array.isArray(event)
      ? Object.keys(event).sort(compareText)
      : []
    if (canonicalJson(keys) !== canonicalJson(['date', 'eventType', 'revisionHash', 'summary'].sort(compareText))) {
      failures.push(`publication-history event ${index} has unknown or missing fields`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event?.date ?? '')) failures.push(`publication-history event ${index} has an invalid date`)
    if (!/^[a-f0-9]{64}$/.test(event?.revisionHash ?? '')) failures.push(`publication-history event ${index} has an invalid revision hash`)
    if (index > 0 && event?.eventType !== 'data_refresh') failures.push(`publication-history event ${index} must be a data_refresh`)
    if (index > 0 && event?.summary !== DATA_REFRESH_SUMMARY) failures.push(`publication-history event ${index} has an invalid data-refresh summary`)
    if (index > 0 && event?.date < history[index - 1]?.date) failures.push('publication-history dates must not move backwards')
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(dossier?.publishedAt ?? '')) failures.push('publishedAt must be a UTC timestamp')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(dossier?.updatedAt ?? '')) failures.push('updatedAt must be a UTC timestamp')
  if (dossier?.publishedAt?.slice(0, 10) !== history[0]?.date) failures.push('publishedAt must match the initial publication date')
  if (dossier?.updatedAt?.slice(0, 10) !== history.at(-1)?.date) failures.push('updatedAt must match the latest history date')
  if ((dossier?.updatedAt ?? '') < (dossier?.publishedAt ?? '')) failures.push('updatedAt cannot precede publishedAt')
  return failures
}

function publicationState(brief, previousDossier) {
  const timestamp = brief.generatedAt
  const priorIsValid = previousDossier?.schemaVersion === DOSSIER_SCHEMA_VERSION
    && previousDossier?.articleId === ARTICLE_ID
    && previousDossier?.publicationRecord?.historyContract === 'append-only.v1'
    && verifyContentHash(previousDossier)
    && publicationHistoryFailures(previousDossier).length === 0
  if (previousDossier && !priorIsValid) {
    throw gateFailure('publication-history-gate.v1', [
      'the checked-in prior dossier is invalid; refusing to reset publication history',
      ...publicationHistoryFailures(previousDossier),
    ])
  }
  const prior = priorIsValid ? previousDossier : null
  if (!prior) {
    return {
      publishedAt: timestamp,
      updatedAt: timestamp,
      updateHistory: [{
        eventType: 'initial_publication',
        date: brief.dataAsOf,
        summary: INITIAL_PUBLICATION_SUMMARY,
        revisionHash: brief.revisionHash,
      }],
    }
  }
  if (prior.revisionHash === brief.revisionHash) {
    return {
      publishedAt: prior.publishedAt,
      updatedAt: prior.updatedAt,
      updateHistory: prior.publicationRecord.updateHistory,
    }
  }
  if (prior.publicationRecord.updateHistory.some((event) => event.revisionHash === brief.revisionHash)) {
    throw gateFailure('publication-history-gate.v1', ['a prior revision hash cannot be replayed as a new head'])
  }
  if (timestamp < prior.updatedAt) {
    throw gateFailure('publication-history-gate.v1', ['a publication refresh cannot move updatedAt backwards'])
  }
  return {
    publishedAt: prior.publishedAt,
    updatedAt: timestamp,
    updateHistory: [...prior.publicationRecord.updateHistory, {
      eventType: 'data_refresh',
      date: brief.dataAsOf,
      summary: DATA_REFRESH_SUMMARY,
      revisionHash: brief.revisionHash,
    }],
  }
}

export function buildEvidenceAnalysis(brief, inputs) {
  assertMachineBrief(brief)
  const capabilities = capabilityMap(inputs)
  const incidents = brief.evidenceLanes.officialEnforcementIncidents
  const incident = incidents.chinaEuAggregate
  const operation = incidents.operationPseudonymContext
  const harm = brief.evidenceLanes.harmTrend
  const firstHarm = harm.observations[0]
  const peakHarm = [...harm.observations].sort((a, b) => b.provisionalDeaths - a.provisionalDeaths)[0]
  const latestHarm = harm.observations.at(-1)
  const decline = Math.abs(round(((latestHarm.provisionalDeaths / peakHarm.provisionalDeaths) - 1) * 100))
  const publication = publicationState(brief, inputs.previousDossier?.data)
  const capabilityAsOf = inputs.capabilities.data.asOf
  const sourceCapabilities = [
    'gacc-customs-statistics', 'un-comtrade', 'incb-precursors-public-report',
    'incb-pics', 'incb-pen-online', 'cdc-vsrr-overdose', 'uscourts-pacer',
  ]
  const sources = sourceCapabilities.map((id) => {
    const source = articleSource(capabilities[id])
    return id === 'incb-precursors-public-report'
      ? { ...source, url: incidents.document.url, documentSha256: incidents.document.sha256, retrievedAt: incidents.document.retrievedAt }
      : source
  })
  const INCB_94 = { sourceId: 'SRC-INCB-PRECURSORS-2025', locator: 'paragraph 94; PDF page 44; printed page 26' }
  const INCB_46 = { sourceId: 'SRC-INCB-PRECURSORS-2025', locator: 'paragraph 46; PDF page 31; printed page 13' }
  const INCB_ANNUAL = { sourceId: 'SRC-INCB-PRECURSORS-2025', locator: 'paragraphs 67 and 71–72; printed pages 19–20' }
  const CDC_SERIES = { sourceId: 'SRC-CDC-VSRR', locator: `United States; 12 month-ending December; synthetic_opioids (T40.4 excluding methadone); ${firstHarm.year}–${latestHarm.year}` }
  const GACC_CAP = { sourceId: 'SRC-GACC-STATS', locator: `registered capability and access boundary; as of ${capabilityAsOf}` }
  const COMTRADE_CAP = { sourceId: 'SRC-UN-COMTRADE', locator: `registered capability and access boundary; as of ${capabilityAsOf}` }
  const PICS_CAP = { sourceId: 'SRC-INCB-PICS-CAPABILITY', locator: `registered restricted-system capability; as of ${capabilityAsOf}` }
  const PEN_CAP = { sourceId: 'SRC-INCB-PEN-CAPABILITY', locator: `registered restricted-system capability; as of ${capabilityAsOf}` }
  const PACER_CAP = { sourceId: 'SRC-USCOURTS-PACER', locator: `registered account-and-fee access boundary; as of ${capabilityAsOf}` }

  const base = {
    schemaVersion: DOSSIER_SCHEMA_VERSION,
    artifactId: `${ARTICLE_ID}.dossier`,
    articleId: ARTICLE_ID,
    slug: ARTICLE_SLUG,
    contentClass: 'automated_evidence_analysis',
    editorialStatus: {
      automationDisclosure: 'Written by deterministic typed templates from checked-in official-source aggregates; no generative model is used at build time.',
      humanReviewStatus: 'not_recorded',
      evidenceStandard: 'bounded_official_record',
      causalAttribution: 'not_established',
      adjudicatedGuilt: 'not_assessed',
      gateStatus: 'passed',
      independentlyCorroboratedEventClaimCount: 0,
    },
    publicationRecord: {
      historyContract: 'append-only.v1',
      corrections: {
        status: 'none_recorded',
        policy: 'Corrections and material updates append to this history; revision and content hashes identify each deterministic build.',
      },
      rightToReply: {
        status: 'not_required',
        rationale: 'This aggregate analysis makes no named allegation about a person or organization.',
        outreachPerformed: false,
      },
      testimony: {
        expertTestimonyIncluded: false,
        affectedPersonTestimonyIncluded: false,
        simulatedHumanVoicesIncluded: false,
        disclosure: 'No expert or affected-person testimony is included, and the automated newsroom does not simulate those voices.',
      },
      updateHistory: publication.updateHistory,
    },
    promotion: {
      fromContentClass: 'machine_brief',
      machineBriefUrl: `/news/${FILES.machineBrief}`,
      machineBriefContentHash: brief.contentHash,
      requiredGate: 'automated-evidence-analysis-gate.v1',
    },
    title: 'What the 2025 INCB precursor report says about China-linked incidents—and what it does not prove',
    dek: 'Nine reported incidents, nearly five tonnes, and one crucial missing join: the official record identifies an origin, but it does not establish a causal chain to US deaths or measure lawful industrial trade.',
    byline: 'NarcoScope automated evidence desk',
    publishedAt: publication.publishedAt,
    updatedAt: publication.updatedAt,
    dataAsOf: brief.dataAsOf,
    revisionHash: brief.revisionHash,
    keyFigures: [
      { id: 'china-eu-upper-bound-mass', value: incident.reportedQuantityKg / 1000, unit: 'tonnes, nearly', label: 'combined across nine PICS incidents', attributionBoundary: 'reported_origin_not_causal_attribution', citationIds: [INCB_94.sourceId], citationLocators: [INCB_94] },
      { id: 'china-eu-incident-count', value: incident.incidentCount, unit: 'incidents', label: 'reported in the first ten months of 2025', attributionBoundary: 'multi_incident_aggregate', citationIds: [INCB_94.sourceId], citationLocators: [INCB_94] },
      { id: 'operation-pseudonym-count', value: operation.operationReportedSeizureCount, unit: 'seizures', label: 'four-country operation total; not a China-to-Oceania count', attributionBoundary: 'origin_destination_unallocated', citationIds: [INCB_46.sourceId], citationLocators: [INCB_46] },
      { id: 'us-t40-4-deaths-latest', value: latestHarm.provisionalDeaths, unit: 'provisional deaths', label: `US T40.4 excluding methadone, 12 months ending December ${latestHarm.year}`, attributionBoundary: 'harm_context_not_origin_evidence', citationIds: [CDC_SERIES.sourceId], citationLocators: [CDC_SERIES] },
    ],
    visuals: [
      {
        id: 'china-eu-aggregate', kind: 'single_record', title: 'China-to-EU aggregate retained at source precision',
        description: 'One multi-incident aggregate. The comparison value is displayed as nearly five tonnes, never as one exact shipment.',
        unit: 'tonnes, upper bound', causalJoinToHarm: false,
        items: [{ id: 'incb-94', year: incident.year, category: 'multi_incident_aggregate', label: `${incident.incidentCount} incidents; ${incident.reportedOrigin} → ${incident.destination}`, value: incident.reportedQuantityKg / 1000, citationIds: [INCB_94.sourceId], citationLocators: [INCB_94] }],
        note: 'The report says “nearly 5 tons” across nine incidents. The bar retains that less-than upper bound and is not an exact shipment mass.',
      },
      {
        id: 'operation-pseudonym-context', kind: 'single_record', title: 'Operation Pseudonym: the allocation gap',
        description: 'The operation-wide count is retained separately because the report does not allocate it by China/India origin and Australia/New Zealand destination pair.',
        unit: 'operation-wide seizures', causalJoinToHarm: false,
        items: [{ id: 'incb-46', year: operation.year, category: 'unallocated_context', label: 'Four participating countries; majority reported by Australia and New Zealand', value: operation.operationReportedSeizureCount, citationIds: [INCB_46.sourceId], citationLocators: [INCB_46] }],
        note: 'Australia’s and New Zealand’s annual seizure totals are excluded from bilateral arithmetic; they are different aggregates.',
      },
      {
        id: 'cdc-harm-trend', kind: 'bar_timeline', title: 'US T40.4 mortality: every available December checkpoint',
        description: `CDC provisional 12-month-ending December counts for synthetic opioids excluding methadone, ${firstHarm.year}–${latestHarm.year}.`,
        unit: 'provisional deaths', causalJoinToIncidents: false,
        items: harm.observations.map((observation) => ({ id: `cdc-${observation.year}`, year: observation.year, category: 'harm_context_only', label: `12 months ending December ${observation.year}`, value: observation.provisionalDeaths, citationIds: [CDC_SERIES.sourceId], citationLocators: [CDC_SERIES] })),
        note: 'This revisable mortality series has no exporter, shipment, precursor or origin field and is not joined to either INCB record.',
      },
    ],
    sections: [
      {
        id: 'method-and-boundary', evidenceLane: 'methodology', heading: 'The join the evidence does not permit',
        sentences: [
          sentence('S001', 'methodology', 'scope', 'This analysis keeps an INCB precursor report and a CDC mortality series in separate evidence lanes because they describe different populations, units and events.', [INCB_94, CDC_SERIES]),
          sentence('S002', 'methodology', 'missing_join', 'The checked inputs share no incident, shipment, exporter or case identifier that could connect the precursor aggregate to a lawful trade record or a death.', [INCB_94, CDC_SERIES, GACC_CAP, COMTRADE_CAP]),
          sentence('S003', 'methodology', 'definition', 'Here, “China-linked” means only that the INCB report says substances reportedly originated in China; it is not a finding about a country, industry, company or person.', [INCB_94]),
        ],
      },
      {
        id: 'lawful-industrial-trade', evidenceLane: 'lawful_trade', heading: 'Lawful industrial trade: the missing denominator',
        sentences: [
          sentence('S004', 'lawful_trade', 'source_capability', 'GACC publishes official merchandise-trade statistics, while UN Comtrade exposes aggregate trade by reporter, partner, product and period.', [GACC_CAP, COMTRADE_CAP]),
          sentence('S005', 'lawful_trade', 'coverage_gap', 'NarcoScope has not admitted a chemical-product series from either capability into this dossier, so lawful trade is not quantified here.', [GACC_CAP, COMTRADE_CAP]),
          sentence('S006', 'lawful_trade', 'interpretive_limit', 'Those registered aggregate capabilities do not provide a public shipment-level end-use ledger, so they cannot classify an export as licit or diverted in this build.', [GACC_CAP, COMTRADE_CAP]),
        ],
      },
      {
        id: 'official-enforcement-incidents', evidenceLane: 'official_incidents', heading: 'What the INCB report actually says',
        sentences: [
          sentence('S007', 'official_incidents', 'reported_measurement', `INCB reported that, during the first ten months of 2025, ${formatNumber(incident.incidentCount)} incidents involving nearly ${formatNumber(incident.reportedQuantityKg / 1000)} tonnes of two related methamphetamine pre-precursors were communicated through PICS.`, [INCB_94]),
          sentence('S008', 'official_incidents', 'attribution_boundary', 'The report said those substances were mislabelled, reportedly originated in China and were destined for countries in the European Union.', [INCB_94]),
          sentence('S009', 'official_incidents', 'subtotal_boundary', 'That figure is a less-than multi-incident aggregate, not an exact 5,000 kg shipment, and NarcoScope does not add it to other qualified quantities.', [INCB_94]),
          sentence('S010', 'official_incidents', 'reported_measurement', `For Operation Pseudonym, INCB said four participating countries reported ${operation.operationReportedSeizureCount} seizures, most in Australia and New Zealand, and reported China and India as origins in those two countries.`, [INCB_46]),
          sentence('S011', 'official_incidents', 'coverage_limit', 'The public report does not allocate those seizures or their mass by origin-and-destination pair; Australia’s and New Zealand’s annual totals are separate aggregates and are excluded here.', [INCB_46, INCB_ANNUAL]),
        ],
      },
      {
        id: 'harm-data', evidenceLane: 'harm', heading: 'The US harm trend is real—and separate',
        sentences: [
          sentence('S012', 'harm', 'trend', `Across every retained December checkpoint, CDC’s provisional US count involving synthetic opioids excluding methadone rose from ${formatNumber(firstHarm.provisionalDeaths)} in ${firstHarm.year} to a peak of ${formatNumber(peakHarm.provisionalDeaths)} in ${peakHarm.year}, then fell ${decline.toFixed(1)}% to ${formatNumber(latestHarm.provisionalDeaths)} in ${latestHarm.year}.`, [CDC_SERIES]),
          sentence('S013', 'harm', 'definition', 'The category is “synthetic opioids excluding methadone (T40.4),” not all synthetic opioids and not a measure of precursor supply.', [CDC_SERIES]),
          sentence('S014', 'harm', 'separation', 'The CDC rows contain no exporter, shipment, precursor or country-of-origin field, so the series is harm context rather than corroboration of the INCB incidents.', [CDC_SERIES, INCB_94]),
          sentence('S015', 'harm', 'coverage_limit', 'The counts are provisional and can be revised; the chart shows every available national December checkpoint instead of selecting only three years.', [CDC_SERIES]),
        ],
      },
      {
        id: 'bounded-conclusion', evidenceLane: 'what_cannot_show', heading: 'The evidence gap is the finding',
        sentences: [
          sentence('S016', 'what_cannot_show', 'reported_measurement', 'The official record supports one attributed finding: INCB reported a China-origin aggregate of nearly five tonnes across nine incidents bound for European Union countries.', [INCB_94]),
          sentence('S017', 'what_cannot_show', 'causal_boundary', 'It supports zero independently corroborated event claims because no second admitted source confirms the same incident set at compatible grain.', [INCB_94, CDC_SERIES]),
          sentence('S018', 'what_cannot_show', 'causal_boundary', 'The available sources do not establish a record-level causal chain from lawful production or export to an incident, an organization or a death.', [GACC_CAP, COMTRADE_CAP, INCB_94, CDC_SERIES]),
          sentence('S019', 'what_cannot_show', 'conclusion', 'The defensible automated conclusion is therefore narrower than a national accusation: the report identifies a pattern worth investigating and the public data needed to test its consequences are missing.', [INCB_94, CDC_SERIES]),
        ],
      },
    ],
    countercase: {
      id: 'countercase', evidenceLane: 'countercase', heading: 'Countercase and evidence still needed',
      sentences: [
        sentence('C001', 'countercase', 'alternative_explanation', 'The INCB aggregate and the separately declining CDC series are compatible with many explanations, including enforcement, reporting, market and treatment changes; this build cannot choose among them.', [INCB_94, CDC_SERIES]),
        sentence('C002', 'countercase', 'missing_evidence', 'A stronger test would require a lawful-trade denominator, shipment-level regulatory notifications, incident identifiers and adjudicated outcomes with defensible shared keys.', [GACC_CAP, COMTRADE_CAP, PICS_CAP, PEN_CAP, PACER_CAP]),
        sentence('C003', 'countercase', 'access_limit', 'PICS and PEN Online are restricted to registered authorities, while PACER requires account-based access and can impose fees; none is represented as an available public record-level join.', [PICS_CAP, PEN_CAP, PACER_CAP]),
      ],
    },
    limitations: [
      sentence('L001', 'limitations', 'selection', 'The INCB extract covers selected reported incidents and cannot estimate all precursor trade, diversion or successful movement.', [INCB_94]),
      sentence('L002', 'limitations', 'origin', 'Nearly five tonnes preserves the report’s less-than precision and must not be represented as one exact shipment.', [INCB_94]),
      sentence('L003', 'limitations', 'trade_denominator', 'No admitted GACC or UN Comtrade chemical-product series supplies a lawful industrial-trade denominator.', [GACC_CAP, COMTRADE_CAP]),
      sentence('L004', 'limitations', 'attribution_boundary', 'Operation Pseudonym names China and India as reported origins but does not publish bilateral count or mass allocations in paragraph 46.', [INCB_46]),
      sentence('L005', 'limitations', 'harm_join', 'CDC T40.4 mortality is provisional and has no record-level join to the INCB incidents.', [CDC_SERIES, INCB_94]),
      sentence('L006', 'limitations', 'restricted_sources', 'Restricted PICS and PEN Online data and automated federal docket review are outside this public offline build.', [PICS_CAP, PEN_CAP, PACER_CAP]),
    ],
    safety: brief.safety,
    sources,
    gate: { gateId: 'automated-evidence-analysis-gate.v1', status: 'passed', machineBriefGate: brief.gate.gateId },
  }
  const verificationReceipt = buildVerificationReceipt(base, inputs.capabilities.data)
  if (!verificationReceipt.passed) throw gateFailure('automated-evidence-analysis-gate.v1', verificationReceipt.failures)
  return hashContent({ ...base, verificationReceipt })
}

function publishedSentences(dossier) {
  return [
    ...dossier.sections.flatMap((section) => section.sentences),
    ...dossier.countercase.sentences,
    ...dossier.limitations,
  ]
}

const BANNED_CLAIM_RULES = Object.freeze([
  {
    id: 'culpability-country-caused-harm',
    category: 'unsupported_culpability',
    pattern: /\b(?:China|Chinese|these incidents?|these shipments?)\s+(?:caused|causes|is responsible for|are responsible for)\b/i,
  },
  {
    id: 'unadjudicated-guilt',
    category: 'unsupported_culpability',
    pattern: /\b(?:is|are|was|were)\s+guilty\b/i,
  },
  {
    id: 'claim-proves-culpability',
    category: 'unsupported_culpability',
    pattern: /\bproves?\s+(?:that\s+)?(?:China|Chinese|an?\s+(?:entity|company|person))\b/i,
  },
  {
    id: 'causal-chain-established',
    category: 'unsupported_causality',
    pattern: /\bcausal\s+(?:link|chain)\s+(?:is|was|has been)\s+established\b/i,
  },
  {
    id: 'country-or-supply-chain-caused-harm',
    category: 'unsupported_causality',
    pattern: /\b(?:china(?:-linked)?|chinese|these)\s+(?:supply\s+chains?|incidents?|shipments?|exports?)\s+(?:caused|drove|enabled|fueled|fuelled|contributed\s+to|produced|triggered|worsened)\b/i,
  },
  {
    id: 'country-blame',
    category: 'unsupported_culpability',
    pattern: /\b(?:blame|fault|culpability|responsibility)\s+(?:lies\s+with|belongs\s+to|rests\s+with)\s+(?:china|chinese)\b/i,
  },
  {
    id: 'operational-chemistry-detail',
    category: 'unsafe_operational_detail',
    pattern: /\b(?:step-by-step\s+laboratory\s+protocol|(?:recipe|reaction conditions?|conversion ratios?|yield percentages?|laboratory protocol).{0,40}(?:is|are|was|were)?\s*(?:included|provided|published|shown|described))\b/i,
  },
  {
    id: 'synthesis-instruction',
    category: 'unsafe_operational_detail',
    pattern: /\bhow to (?:make|synthesize|manufacture)\b/i,
  },
])

function registryCapabilityMap(registry) {
  return Object.fromEntries((registry?.capabilities ?? []).map((item) => [item.id, item]))
}

function evaluateClaimSupport(sentenceValue, sourcesById, registryById) {
  const resolved = (sentenceValue.citationIds ?? [])
    .map((citationId) => ({ citationId, source: sourcesById[citationId] }))
    .filter((item) => item.source)
    .map((item) => ({
      ...item,
      capability: registryById[item.source.registryId],
    }))
  const active = resolved.filter((item) => item.capability?.newsroomRole === 'active_evidence')
  const activeSourceIds = [...new Set(active.map((item) => item.citationId))].sort(compareText)
  const activeIndependenceGroups = [...new Set(active.map((item) => item.capability.upstreamGroup))].sort(compareText)
  const capabilityOnlySourceIds = [...new Set(resolved
    .filter((item) => item.capability?.newsroomRole === 'capability_only')
    .map((item) => item.citationId))].sort(compareText)
  const unavailableSourceIds = [...new Set(resolved
    .filter((item) => item.capability?.newsroomRole === 'unavailable')
    .map((item) => item.citationId))].sort(compareText)
  const minimum = sentenceValue.support?.minimumIndependentActiveGroups ?? null
  const profile = sentenceValue.support?.profile ?? null
  const supportProfileExists = Boolean(SUPPORT_PROFILES[profile])
  const supportMetadataMatches = supportProfileExists
    && canonicalJson(sentenceValue.support) === canonicalJson({ profile, ...SUPPORT_PROFILES[profile] })
  const meetsActiveGroupMinimum = typeof minimum === 'number'
    && activeIndependenceGroups.length >= minimum
  const capabilitySourcesCountTowardCorroboration = false
  const unavailableSourcesCountTowardCorroboration = false
  return {
    sentenceId: sentenceValue.id,
    claimType: sentenceValue.claimType,
    supportProfile: profile,
    findingStatus: sentenceValue.support?.findingStatus ?? null,
    corroborationClaimed: sentenceValue.support?.corroborationClaimed ?? null,
    minimumIndependentActiveGroups: minimum,
    activeSourceIds,
    activeIndependenceGroups,
    activeGroupCount: activeIndependenceGroups.length,
    capabilityOnlySourceIds,
    unavailableSourceIds,
    capabilitySourcesCountTowardCorroboration,
    unavailableSourcesCountTowardCorroboration,
    supportMetadataMatches,
    passed: supportMetadataMatches && meetsActiveGroupMinimum,
  }
}

export function buildVerificationReceipt(dossier, registry) {
  const sources = dossier?.sources ?? []
  const sourcesById = Object.fromEntries(sources.map((source) => [source.id, source]))
  const registryById = registryCapabilityMap(registry)
  const sentences = dossier?.sections && dossier?.countercase && dossier?.limitations
    ? publishedSentences(dossier)
    : []
  const visualItems = (dossier?.visuals ?? []).flatMap((visual) => visual.items ?? [])
  const claimSupport = sentences.map((item) => evaluateClaimSupport(item, sourcesById, registryById))
  const citedSentenceCount = sentences.filter((item) => (item.citationIds?.length ?? 0) > 0).length
  const activeSources = sources.filter((source) => registryById[source.registryId]?.newsroomRole === 'active_evidence')
  const capabilitySources = sources.filter((source) => registryById[source.registryId]?.newsroomRole === 'capability_only')
  const unavailableSources = sources.filter((source) => registryById[source.registryId]?.newsroomRole === 'unavailable')
  const activeGroups = [...new Set(activeSources.map((source) => registryById[source.registryId].upstreamGroup))].sort(compareText)
  const scannedText = publicStrings(dossier).map((item) => item.value).join(' ')
  const bannedMatches = BANNED_CLAIM_RULES
    .filter((rule) => rule.pattern.test(scannedText))
    .map((rule) => ({ ruleId: rule.id, category: rule.category }))
  const synthesis = claimSupport.filter((item) => item.supportProfile === 'multi_source_methodological_context')
  const publicationRecord = dossier?.publicationRecord
  const historyFailures = publicationHistoryFailures(dossier)
  const editorialCompletenessPassed = publicationRecord?.corrections?.status === 'none_recorded'
    && publicationRecord?.rightToReply?.status === 'not_required'
    && publicationRecord?.rightToReply?.outreachPerformed === false
    && publicationRecord?.testimony?.expertTestimonyIncluded === false
    && publicationRecord?.testimony?.affectedPersonTestimonyIncluded === false
    && publicationRecord?.testimony?.simulatedHumanVoicesIncluded === false
    && historyFailures.length === 0
  const failures = []

  for (const item of claimSupport) {
    if (!item.supportMetadataMatches) failures.push(`${item.sentenceId}: support metadata does not match the deterministic claim profile`)
    if (!item.passed) failures.push(`${item.sentenceId}: ${item.supportProfile ?? 'unknown'} requires ${item.minimumIndependentActiveGroups ?? '?'} independent active group(s), found ${item.activeGroupCount}`)
  }
  if (citedSentenceCount !== sentences.length) failures.push('not every published sentence has a citation')
  if (!visualItems.every((item) => (item.citationIds?.length ?? 0) > 0)) failures.push('not every visual data row has a citation')
  if (synthesis.length === 0) failures.push('an automated evidence analysis requires at least one multi-source bounded synthesis')
  if (bannedMatches.length > 0) failures.push(`banned-claim scan matched: ${bannedMatches.map((item) => item.ruleId).join(', ')}`)
  if ((dossier?.countercase?.sentences?.length ?? 0) < 2) failures.push('countercase requires at least two sentences')
  failures.push(...historyFailures)
  if (!editorialCompletenessPassed) failures.push('corrections, right-to-reply, testimony and initial-publication records are incomplete')

  return {
    receiptVersion: 'narcoscope.newsroom.verification-receipt.v1',
    evaluationProfile: {
      id: 'bounded-official-record-analysis.v1',
      activeEvidenceDefinition: 'A checked-in official input used to derive a claim in this build.',
      independenceDefinition: 'Distinct upstream issuing or statistical authority group.',
      methodologicalContextMinimumIndependentActiveGroups: 2,
      attributedObservationMinimumIndependentActiveGroups: 1,
      capabilityOnlyAndUnavailableContribution: 0,
    },
    citationCoverage: {
      totalSentenceCount: sentences.length,
      citedSentenceCount,
      percent: sentences.length === 0 ? 0 : round((citedSentenceCount / sentences.length) * 100),
    },
    visualCitationCoverage: {
      totalDataRowCount: visualItems.length,
      citedDataRowCount: visualItems.filter((item) => (item.citationIds?.length ?? 0) > 0).length,
      percent: visualItems.length === 0
        ? 0
        : round((visualItems.filter((item) => (item.citationIds?.length ?? 0) > 0).length / visualItems.length) * 100),
    },
    sourceInventory: {
      activeEvidenceSourceCount: activeSources.length,
      capabilityOnlySourceCount: capabilitySources.length,
      unavailableSourceCount: unavailableSources.length,
      activeIndependenceGroups: activeGroups,
      activeIndependenceGroupCount: activeGroups.length,
      independentlyCorroboratedEventClaimCount: 0,
    },
    synthesisEvaluation: {
      synthesisSentenceCount: synthesis.length,
      passedSentenceCount: synthesis.filter((item) => item.passed).length,
      minimumObservedActiveGroupCount: synthesis.length > 0
        ? Math.min(...synthesis.map((item) => item.activeGroupCount))
        : 0,
    },
    claimSupport,
    countercase: {
      present: Boolean(dossier?.countercase),
      sentenceCount: dossier?.countercase?.sentences?.length ?? 0,
      citedSentenceCount: dossier?.countercase?.sentences?.filter((item) => (item.citationIds?.length ?? 0) > 0).length ?? 0,
    },
    editorialCompleteness: {
      correctionsStatus: publicationRecord?.corrections?.status ?? null,
      updateHistoryEventCount: publicationRecord?.updateHistory?.length ?? 0,
      initialPublicationRecorded: publicationRecord?.updateHistory?.[0]?.eventType === 'initial_publication',
      rightToReplyStatus: publicationRecord?.rightToReply?.status ?? null,
      outreachPerformed: publicationRecord?.rightToReply?.outreachPerformed ?? null,
      expertTestimonyIncluded: publicationRecord?.testimony?.expertTestimonyIncluded ?? null,
      affectedPersonTestimonyIncluded: publicationRecord?.testimony?.affectedPersonTestimonyIncluded ?? null,
      simulatedHumanVoicesIncluded: publicationRecord?.testimony?.simulatedHumanVoicesIncluded ?? null,
      passed: editorialCompletenessPassed,
    },
    bannedClaimScan: {
      rulesetVersion: 'bounded-claims-and-safe-grain.v1',
      ruleCount: BANNED_CLAIM_RULES.length,
      matches: bannedMatches,
      passed: bannedMatches.length === 0,
    },
    safetyEvaluation: {
      chemistryInstructionsIncluded: dossier?.safety?.chemistryInstructionsIncluded ?? null,
      navigableOperationalDetailsIncluded: dossier?.safety?.navigableOperationalDetailsIncluded ?? null,
      passed: dossier?.safety?.chemistryInstructionsIncluded === false
        && dossier?.safety?.navigableOperationalDetailsIncluded === false,
    },
    deterministicHashes: {
      algorithm: 'sha256',
      revisionHash: dossier?.revisionHash ?? null,
      machineBriefContentHash: dossier?.promotion?.machineBriefContentHash ?? null,
      dossierContentHashScope: 'canonical JSON of the dossier including this receipt and excluding the top-level contentHash field',
    },
    failures,
    passed: failures.length === 0,
  }
}

export function assertAutomatedEvidenceAnalysis(dossier, brief, registry, previousDossier = null) {
  const gateId = 'automated-evidence-analysis-gate.v1'
  assertCapabilityRegistry(registry)
  const errors = []
  const sources = dossier?.sources ?? []
  const sourceIds = new Set(sources.map((source) => source.id))
  const sentences = dossier?.sections && dossier?.countercase && dossier?.limitations
    ? publishedSentences(dossier)
    : []
  const text = sentences.map((item) => item.text).join(' ')
  const lanes = new Set((dossier?.sections ?? []).map((section) => section.evidenceLane))
  const requiredLanes = ['methodology', 'lawful_trade', 'official_incidents', 'harm', 'what_cannot_show']
  const historyFailures = publicationHistoryFailures(dossier)
  const forbiddenDossierKeys = findForbiddenKeys(dossier)

  requireGate(errors, dossier?.schemaVersion === DOSSIER_SCHEMA_VERSION, 'unexpected dossier schema')
  requireGate(errors, dossier?.contentClass === 'automated_evidence_analysis', 'analysis content class is required')
  requireGate(errors, dossier?.editorialStatus?.automationDisclosure?.length > 0, 'automation disclosure is required')
  requireGate(errors, dossier?.editorialStatus?.humanReviewStatus === 'not_recorded', 'build must not invent human review')
  requireGate(errors, dossier?.editorialStatus?.causalAttribution === 'not_established', 'causal attribution boundary is required')
  requireGate(errors, dossier?.editorialStatus?.independentlyCorroboratedEventClaimCount === 0, 'event-level corroboration count must remain zero')
  requireGate(errors, dossier?.editorialStatus?.adjudicatedGuilt === 'not_assessed', 'guilt cannot be assessed without adjudication coverage')
  requireGate(errors, dossier?.publicationRecord?.corrections?.status === 'none_recorded', 'corrections status is required')
  requireGate(errors, dossier?.publicationRecord?.historyContract === 'append-only.v1', 'append-only publication history contract is required')
  requireGate(errors, dossier?.publicationRecord?.corrections?.policy?.length > 0, 'corrections policy is required')
  requireGate(errors, dossier?.publicationRecord?.rightToReply?.status === 'not_required', 'right-to-reply status must reflect the absence of named allegations')
  requireGate(errors, /no named allegation/i.test(dossier?.publicationRecord?.rightToReply?.rationale ?? ''), 'right-to-reply rationale must be explicit')
  requireGate(errors, dossier?.publicationRecord?.rightToReply?.outreachPerformed === false, 'the build must not invent outreach')
  requireGate(errors, dossier?.publicationRecord?.testimony?.expertTestimonyIncluded === false, 'expert testimony must not be invented')
  requireGate(errors, dossier?.publicationRecord?.testimony?.affectedPersonTestimonyIncluded === false, 'affected-person testimony must not be invented')
  requireGate(errors, dossier?.publicationRecord?.testimony?.simulatedHumanVoicesIncluded === false, 'human voices must never be simulated')
  requireGate(errors, /does not simulate those voices/i.test(dossier?.publicationRecord?.testimony?.disclosure ?? ''), 'testimony disclosure is required')
  requireGate(errors, dossier?.publicationRecord?.updateHistory?.[0]?.eventType === 'initial_publication', 'initial publication history is required')
  requireGate(errors, dossier?.publicationRecord?.updateHistory?.at(-1)?.revisionHash === dossier?.revisionHash, 'latest publication history event must pin the revision hash')
  requireGate(errors, historyFailures.length === 0, `publication history is invalid: ${historyFailures.join('; ')}`)
  requireGate(errors, dossier?.promotion?.fromContentClass === 'machine_brief', 'analysis must record machine-brief promotion')
  requireGate(errors, dossier?.promotion?.machineBriefContentHash === brief?.contentHash, 'analysis must pin the gated machine brief')
  requireGate(errors, dossier?.revisionHash === brief?.revisionHash, 'analysis and machine brief revision hashes must match')
  requireGate(errors, verifyContentHash(dossier), 'dossier content hash is invalid')
  requireGate(errors, registry?.schemaVersion === 'narcoscope.newsroom.source-capabilities.v1', 'capability registry is required to evaluate source independence')
  requireGate(errors, duplicateValues(sources.map((source) => source.id)).length === 0, 'source citation ids must be unique')
  requireGate(errors, duplicateValues(sentences.map((item) => item.id)).length === 0, 'sentence ids must be unique')
  requireGate(errors, sentences.length >= 25, 'analysis must contain a substantial cited sentence ledger')
  for (const lane of requiredLanes) requireGate(errors, lanes.has(lane), `required evidence lane is absent: ${lane}`)
  for (const item of sentences) {
    requireGate(errors, /^[SCL]\d{3}$/.test(item.id), `${item.id}: sentence id is invalid`)
    requireGate(errors, item.text?.trim().length > 0, `${item.id}: sentence text is required`)
    requireGate(errors, item.templateId === `narcoscope.claim.${item.claimType}.v1`, `${item.id}: typed claim template id is invalid`)
    requireGate(errors, ['none', 'explicit_non_attribution'].includes(item.causalPredicate), `${item.id}: causal predicate is invalid`)
    requireGate(errors, item.corroborationKey === null, `${item.id}: no event corroboration key is available in this dossier`)
    requireGate(errors, (item.citationIds?.length ?? 0) > 0, `${item.id}: sentence-level citations are required`)
    requireGate(errors, item.citationLocators?.length === item.citationIds?.length, `${item.id}: every citation requires a source locator`)
    requireGate(errors, item.citationLocators?.every((citation, index) => citation.sourceId === item.citationIds[index] && citation.locator?.length > 0), `${item.id}: citation locator order or value is invalid`)
    requireGate(errors, Boolean(SUPPORT_PROFILES[item.support?.profile]), `${item.id}: evidence-support profile is required`)
    for (const id of item.citationIds ?? []) requireGate(errors, sourceIds.has(id), `${item.id}: unknown citation ${id}`)
  }
  for (const visual of dossier?.visuals ?? []) {
    requireGate(errors, visual?.title?.length > 0 && visual?.description?.length > 0, `${visual?.id ?? 'visual'}: accessible title and description are required`)
    requireGate(errors, (visual?.items?.length ?? 0) > 0, `${visual?.id ?? 'visual'}: at least one data row is required`)
    for (const item of visual?.items ?? []) {
      requireGate(errors, (item.citationIds?.length ?? 0) > 0, `${visual.id}/${item.id}: visual data citation is required`)
      requireGate(errors, item.citationLocators?.length === item.citationIds?.length, `${visual.id}/${item.id}: every visual citation requires a source locator`)
      for (const id of item.citationIds ?? []) requireGate(errors, sourceIds.has(id), `${visual.id}/${item.id}: unknown citation ${id}`)
    }
  }
  const registryById = registryCapabilityMap(registry)
  for (const source of sources) {
    const registered = registryById[source.registryId]
    requireGate(errors, Boolean(registered), `${source.id}: registry capability is absent`)
    requireGate(errors, source.upstreamGroup === registered?.upstreamGroup, `${source.id}: independence group differs from the registry`)
    requireGate(errors, source.newsroomRole === registered?.newsroomRole, `${source.id}: newsroom role differs from the registry`)
  }
  requireGate(errors, dossier?.countercase?.sentences?.length >= 2, 'countercase is required')
  requireGate(errors, dossier?.limitations?.length >= 5, 'at least five limitations are required')
  requireGate(errors, dossier?.keyFigures?.find((item) => item.id === 'china-eu-upper-bound-mass')?.value === brief.evidenceLanes.officialEnforcementIncidents.chinaEuAggregate.reportedQuantityKg / 1000, 'INCB upper-bound tonnage figure must derive from the brief')
  requireGate(errors, dossier?.keyFigures?.find((item) => item.id === 'china-eu-incident-count')?.value === brief.evidenceLanes.officialEnforcementIncidents.chinaEuAggregate.incidentCount, 'INCB incident count must derive from the brief')
  requireGate(errors, dossier?.keyFigures?.find((item) => item.id === 'operation-pseudonym-count')?.value === brief.evidenceLanes.officialEnforcementIncidents.operationPseudonymContext.operationReportedSeizureCount, 'Operation Pseudonym count must derive from the brief')
  requireGate(errors, /does not allocate those seizures or their mass/i.test(text), 'Operation Pseudonym allocation boundary is required')
  requireGate(errors, /zero independently corroborated event claims/i.test(text), 'event-level corroboration gap must be explicit')
  requireGate(errors, /do not establish a record-level causal chain/i.test(text), 'missing causal join must be explicit')
  requireGate(errors, /harm context rather than corroboration/i.test(text), 'harm data must remain separate')
  requireGate(errors, dossier?.sources?.find((item) => item.registryId === 'incb-pics')?.newsroomUseStatus === 'unavailable', 'PICS must be cited only as unavailable capability')
  requireGate(errors, dossier?.sources?.find((item) => item.registryId === 'incb-pen-online')?.newsroomUseStatus === 'unavailable', 'PEN Online must be cited only as unavailable capability')
  requireGate(errors, dossier?.safety?.chemistryInstructionsIncluded === false, 'chemistry instructions are forbidden')
  requireGate(errors, dossier?.safety?.navigableOperationalDetailsIncluded === false, 'navigable operational details are forbidden')
  requireGate(errors, forbiddenDossierKeys.length === 0, `forbidden subject/location keys found: ${forbiddenDossierKeys.join(', ')}`)

  const receipt = buildVerificationReceipt(dossier, registry)
  requireGate(errors, receipt.passed, `verification receipt failed: ${receipt.failures.join('; ')}`)
  requireGate(errors, receipt.citationCoverage.percent === 100, 'sentence citation coverage must be 100%')
  requireGate(errors, receipt.visualCitationCoverage.percent === 100, 'visual data citation coverage must be 100%')
  requireGate(errors, receipt.editorialCompleteness.passed, 'editorial completeness receipt must pass')
  requireGate(errors, receipt.synthesisEvaluation.synthesisSentenceCount > 0, 'analysis must contain multi-source synthesis')
  requireGate(errors, receipt.synthesisEvaluation.minimumObservedActiveGroupCount >= 2, 'every synthesis requires two independent active source groups')
  requireGate(errors, receipt.sourceInventory.independentlyCorroboratedEventClaimCount === 0, 'receipt must disclose zero independently corroborated event claims')
  requireGate(errors, receipt.claimSupport.every((item) => item.corroborationClaimed === false), 'no claim may be labelled corroborated without a compatible event key')
  requireGate(errors, receipt.claimSupport.every((item) => item.capabilitySourcesCountTowardCorroboration === false), 'capability-only sources must count as zero')
  requireGate(errors, receipt.claimSupport.every((item) => item.unavailableSourcesCountTowardCorroboration === false), 'unavailable sources must count as zero')
  requireGate(errors, canonicalJson(dossier?.verificationReceipt) === canonicalJson(receipt), 'stored verification receipt does not match a fresh evaluation')
  requireGate(errors, dossier?.visuals?.some((visual) => visual.id === 'china-eu-aggregate' && visual.causalJoinToHarm === false), 'separate INCB aggregate visual is required')
  requireGate(errors, dossier?.visuals?.some((visual) => visual.id === 'operation-pseudonym-context' && visual.causalJoinToHarm === false), 'separate Operation Pseudonym context visual is required')
  requireGate(errors, dossier?.visuals?.some((visual) => visual.id === 'cdc-harm-trend' && visual.causalJoinToIncidents === false), 'separate CDC harm visual is required')
  requireGate(errors, dossier?.visuals?.find((visual) => visual.id === 'china-eu-aggregate')?.items?.[0]?.value === brief.evidenceLanes.officialEnforcementIncidents.chinaEuAggregate.reportedQuantityKg / 1000, 'incident visual must preserve the qualified comparison value')
  requireGate(errors, dossier?.gate?.gateId === gateId && dossier?.gate?.status === 'passed', 'analysis gate marker is absent')

  // The public dossier is a closed deterministic contract. Recompose it from
  // the already-gated brief and capability registry, then require exact byte-
  // semantic equality. This rejects unknown fields and altered prose even if
  // a caller recomputes both the receipt and the top-level content hash.
  const expected = buildEvidenceAnalysis(brief, {
    capabilities: { data: registry },
    previousDossier: previousDossier ? { data: previousDossier } : undefined,
  })
  requireGate(
    errors,
    canonicalJson(dossier) === canonicalJson(expected),
    'dossier differs from the typed deterministic claim templates',
  )

  if (errors.length > 0) throw gateFailure(gateId, errors)
  return {
    gateId,
    status: 'passed',
    assertionCount: gateAssertionCount(errors),
    citationCoveragePct: receipt.citationCoverage.percent,
    synthesisSentenceCount: receipt.synthesisEvaluation.synthesisSentenceCount,
    minimumActiveIndependenceGroups: receipt.synthesisEvaluation.minimumObservedActiveGroupCount,
    bannedClaimMatches: receipt.bannedClaimScan.matches.length,
  }
}

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const escapeXml = escapeHtml

function citationLinks(sentenceValue, sourceNumbers) {
  return sentenceValue.citationLocators
    .map(({ sourceId, locator }) => `<a class="citation" href="#${escapeHtml(sourceId)}" aria-label="Source ${sourceNumbers.get(sourceId)}" title="${escapeHtml(locator)}">[${sourceNumbers.get(sourceId)}]</a><span class="citation-locator">${escapeHtml(locator)}</span>`)
    .join('')
}

function renderSentence(sentenceValue, sourceNumbers) {
  return `<p id="${escapeHtml(sentenceValue.id)}">${escapeHtml(sentenceValue.text)} <span class="citations">${citationLinks(sentenceValue, sourceNumbers)}</span></p>`
}

function renderEvidenceVisual(visual, sourceNumbers) {
  const maxValue = Math.max(1, ...visual.items.map((item) => item.value))
  const rows = visual.items.map((item) => {
    const width = round((item.value / maxValue) * 100, 1)
    const citations = item.citationLocators
      .map(({ sourceId, locator }) => `<a class="citation" href="#${escapeHtml(sourceId)}" aria-label="Source ${sourceNumbers.get(sourceId)}" title="${escapeHtml(locator)}">[${sourceNumbers.get(sourceId)}]</a><span class="citation-locator">${escapeHtml(locator)}</span>`)
      .join('')
    return `
          <tr>
            <th scope="row">${escapeHtml(item.year)}</th>
            <td><span class="visual-category">${escapeHtml(item.category.replaceAll('_', ' '))}</span>${escapeHtml(item.label)}</td>
            <td class="visual-value">${escapeHtml(formatNumber(item.value))}</td>
            <td class="visual-bar-cell"><span class="visual-bar" aria-hidden="true"><i style="width:${width}%"></i></span></td>
            <td><span class="citations">${citations}</span></td>
          </tr>`
  }).join('')
  return `
      <figure class="evidence-visual" aria-labelledby="${escapeHtml(visual.id)}-title" aria-describedby="${escapeHtml(visual.id)}-description">
        <figcaption>
          <strong id="${escapeHtml(visual.id)}-title">${escapeHtml(visual.title)}</strong>
          <span id="${escapeHtml(visual.id)}-description">${escapeHtml(visual.description)}</span>
        </figcaption>
        <div class="visual-table-scroll">
          <table>
            <caption>${escapeHtml(visual.title)} in ${escapeHtml(visual.unit)}</caption>
            <thead><tr><th scope="col">Year</th><th scope="col">Record</th><th scope="col">${escapeHtml(visual.unit)}</th><th scope="col">Relative scale</th><th scope="col">Source</th></tr></thead>
            <tbody>${rows}
            </tbody>
          </table>
        </div>
        <p class="visual-note"><strong>Boundary:</strong> ${escapeHtml(visual.note)}</p>
      </figure>`
}

export function renderArticleBody(dossier) {
  const sourceNumbers = new Map(dossier.sources.map((source, index) => [source.id, index + 1]))
  const figures = dossier.keyFigures.map((figure) => `
    <li>
      <strong>${escapeHtml(formatNumber(figure.value))}</strong>
      <span>${escapeHtml(figure.unit)}</span>
      <small>${escapeHtml(figure.label)}</small>
    </li>`).join('')
  const visuals = dossier.visuals.map((visual) => renderEvidenceVisual(visual, sourceNumbers)).join('')
  const sections = dossier.sections.map((section) => `
    <section id="${escapeHtml(section.id)}">
      <p class="lane">${escapeHtml(section.evidenceLane.replaceAll('_', ' '))}</p>
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.sentences.map((item) => renderSentence(item, sourceNumbers)).join('\n      ')}
    </section>`).join('')
  const countercase = dossier.countercase.sentences.map((item) => renderSentence(item, sourceNumbers)).join('\n      ')
  const limitations = dossier.limitations.map((item) => `<li id="${escapeHtml(item.id)}">${escapeHtml(item.text)} <span class="citations">${citationLinks(item, sourceNumbers)}</span></li>`).join('\n      ')
  const sources = dossier.sources.map((source, index) => {
    const documentReceipt = source.documentSha256
      ? `\n        <small>Document SHA-256: <code>${escapeHtml(source.documentSha256)}</code> · retrieved ${escapeHtml(source.retrievedAt)}</small>`
      : ''
    return `
      <li id="${escapeHtml(source.id)}">
        <a href="${escapeHtml(source.url)}" rel="noreferrer">[${index + 1}] ${escapeHtml(source.publisher)} — ${escapeHtml(source.title)}</a>
        <span>${escapeHtml(source.newsroomRole)} · ${escapeHtml(source.upstreamGroup)} · ${escapeHtml(source.availabilityStatus)}</span>
        <small>${escapeHtml(source.accessNote)}</small>${documentReceipt}
      </li>`
  }).join('')
  const updateHistory = dossier.publicationRecord.updateHistory.map((event) => `
      <li>
        <time datetime="${escapeHtml(event.date)}">${escapeHtml(event.date)}</time>
        <strong>${escapeHtml(event.eventType.replaceAll('_', ' '))}</strong>
        <span>${escapeHtml(event.summary)}</span>
        <code>${escapeHtml(event.revisionHash)}</code>
      </li>`).join('')

  return `
  <article class="evidence-article">
    <header>
      <p class="kicker">Automated evidence analysis · official sources only</p>
      <h1>${escapeHtml(dossier.title)}</h1>
      <p class="dek">${escapeHtml(dossier.dek)}</p>
      <p class="meta">${escapeHtml(dossier.byline)} · data as of ${escapeHtml(dossier.dataAsOf)} · no human review recorded</p>
      <aside class="disclosure"><strong>Automation disclosure.</strong> ${escapeHtml(dossier.editorialStatus.automationDisclosure)} Machine brief and analysis pass separate gates; a pass does not imply causal attribution or adjudicated guilt.</aside>
      <aside class="publication-status" aria-label="Right to reply and testimony status">
        <p><strong>Right to reply: not required.</strong> ${escapeHtml(dossier.publicationRecord.rightToReply.rationale)} No outreach was performed or implied.</p>
        <p><strong>Testimony disclosure.</strong> ${escapeHtml(dossier.publicationRecord.testimony.disclosure)}</p>
      </aside>
      <ul class="verification-strip" aria-label="Verification receipt summary">
        <li><strong>${escapeHtml(dossier.verificationReceipt.citationCoverage.percent)}%</strong><span>sentence citation coverage</span></li>
        <li><strong>${escapeHtml(dossier.verificationReceipt.sourceInventory.activeIndependenceGroupCount)}</strong><span>independent active groups</span></li>
        <li><strong>${escapeHtml(dossier.verificationReceipt.synthesisEvaluation.synthesisSentenceCount)}</strong><span>gated synthesis sentences</span></li>
        <li><strong>${escapeHtml(dossier.verificationReceipt.bannedClaimScan.matches.length)}</strong><span>banned-claim matches</span></li>
      </ul>
    </header>
    <ul class="key-figures">${figures}
    </ul>
    <div class="visual-grid">${visuals}
    </div>${sections}
    <section id="countercase" class="countercase">
      <p class="lane">countercase</p>
      <h2>${escapeHtml(dossier.countercase.heading)}</h2>
      ${countercase}
    </section>
    <section id="limitations">
      <p class="lane">limitations</p>
      <h2>Limitations</h2>
      <ul class="limitations">${limitations}</ul>
    </section>
    <section id="sources">
      <p class="lane">citation ledger</p>
      <h2>Sources and capability boundaries</h2>
      <ol class="source-list">${sources}
      </ol>
    </section>
    <section id="corrections">
      <p class="lane">publication record</p>
      <h2>Corrections and update history</h2>
      <p><strong>Current status:</strong> ${escapeHtml(dossier.publicationRecord.corrections.status.replaceAll('_', ' '))}. ${escapeHtml(dossier.publicationRecord.corrections.policy)}</p>
      <ol class="update-history">${updateHistory}
      </ol>
    </section>
    <footer class="hashes">
      <span>Revision <code>${escapeHtml(dossier.revisionHash)}</code></span>
      <span>Content <code>${escapeHtml(dossier.contentHash)}</code></span>
      <a href="/news/${FILES.machineBrief}">Machine brief</a>
      <a href="/news/${FILES.dossier}">Dossier JSON</a>
      <a href="/news/feed.json">JSON feed</a>
      <a href="/news/feed.xml">Atom feed</a>
    </footer>
  </article>`
}

export function renderArticleHtml(dossier) {
  const canonicalUrl = `${SITE_ORIGIN}/news/${FILES.html}`
  const body = renderArticleBody(dossier)
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'AnalysisNewsArticle',
    headline: dossier.title,
    description: dossier.dek,
    datePublished: dossier.publishedAt,
    dateModified: dossier.updatedAt,
    author: { '@type': 'Organization', name: 'NarcoScope automated evidence desk' },
    isAccessibleForFree: true,
    url: canonicalUrl,
  }).replaceAll('</script', '<\\/script')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(dossier.title)} · NarcoScope</title>
  <meta name="description" content="${escapeHtml(dossier.dek)}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" type="application/feed+json" href="${SITE_ORIGIN}/news/feed.json" title="NarcoScope evidence newsroom">
  <link rel="alternate" type="application/atom+xml" href="${SITE_ORIGIN}/news/feed.xml" title="NarcoScope evidence newsroom">
  <script type="application/ld+json">${structuredData}</script>
  <style>
    :root { color-scheme: dark; --bg:#050505; --panel:#0d0d0d; --line:#292929; --text:#e2e8f0; --muted:#94a3b8; --live:#06d6e0; --warn:#ffb020; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:16px/1.7 system-ui,-apple-system,sans-serif; }
    a { color:var(--live); }
    .evidence-article { width:min(860px,calc(100% - 32px)); margin:0 auto; padding:64px 0 80px; }
    h1 { max-width:18ch; margin:.2rem 0 1rem; color:#fff; font-size:clamp(2.4rem,7vw,5.6rem); line-height:.98; font-weight:500; letter-spacing:-.035em; }
    h2 { color:#fff; font-size:1.65rem; line-height:1.2; }
    .kicker,.lane { color:var(--live); text-transform:uppercase; letter-spacing:.12em; font-size:.72rem; font-weight:700; }
    .dek { color:var(--muted); font-size:1.2rem; max-width:68ch; }
    .meta { color:var(--muted); font-size:.82rem; }
    .disclosure,.countercase { border:1px solid rgba(255,176,32,.45); border-left:4px solid var(--warn); background:rgba(255,176,32,.07); padding:1rem 1.2rem; border-radius:.7rem; }
    .publication-status { margin-top:.7rem; border:1px solid var(--line); background:var(--panel); padding:.75rem 1rem; border-radius:.7rem; color:var(--muted); font-size:.82rem; }
    .publication-status p { margin:.3rem 0; }
    .verification-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:.55rem; padding:0; margin:1rem 0 0; list-style:none; }
    .verification-strip li { padding:.7rem; border:1px solid var(--line); border-radius:.6rem; background:var(--panel); }
    .verification-strip strong,.verification-strip span { display:block; }
    .verification-strip strong { color:var(--live); font-size:1.15rem; }
    .verification-strip span { color:var(--muted); font-size:.72rem; }
    section { margin-top:3.5rem; }
    section p { max-width:74ch; }
    .key-figures { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:.8rem; margin:2.5rem 0; padding:0; list-style:none; }
    .key-figures li { display:grid; gap:.2rem; padding:1rem; border:1px solid var(--line); border-radius:.7rem; background:var(--panel); }
    .key-figures strong { color:#fff; font-size:2rem; line-height:1; }
    .key-figures span,.key-figures small,.source-list span,.source-list small { color:var(--muted); display:block; }
    .visual-grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr)); margin:2rem 0 3.5rem; }
    .evidence-visual { min-width:0; margin:0; padding:1rem; border:1px solid var(--line); border-radius:.8rem; background:var(--panel); }
    .evidence-visual figcaption strong,.evidence-visual figcaption span { display:block; }
    .evidence-visual figcaption strong { color:#fff; font-size:1.05rem; }
    .evidence-visual figcaption span,.visual-note { color:var(--muted); font-size:.78rem; }
    .visual-table-scroll { overflow-x:auto; margin-top:.8rem; }
    .evidence-visual table { width:100%; border-collapse:collapse; font-size:.74rem; }
    .evidence-visual caption { text-align:left; color:var(--muted); padding-bottom:.35rem; }
    .evidence-visual th,.evidence-visual td { padding:.45rem .3rem; border-bottom:1px solid var(--line); text-align:left; vertical-align:middle; }
    .evidence-visual thead th { color:var(--muted); font-weight:500; }
    .visual-category { display:block; color:var(--warn); font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; }
    .visual-value { color:#fff; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .visual-bar-cell { min-width:72px; }
    .visual-bar { display:block; width:100%; height:.45rem; border-radius:999px; background:#1b1b1b; overflow:hidden; }
    .visual-bar i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--live),var(--warn)); }
    .visual-note { margin:.75rem 0 0; }
    .citation { margin-left:.18rem; font-size:.75rem; text-decoration:none; }
    .citation-locator { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .limitations { padding-left:1.25rem; }
    .limitations li { margin:.65rem 0; }
    .source-list { padding-left:1.25rem; }
    .source-list li { margin:1rem 0; }
    .source-list small { font-size:.78rem; }
    .update-history { padding-left:1.25rem; }
    .update-history li { display:grid; gap:.2rem; margin:.8rem 0; }
    .update-history time,.update-history span,.update-history code { color:var(--muted); font-size:.78rem; }
    .update-history code { overflow-wrap:anywhere; }
    .hashes { margin-top:4rem; padding-top:1rem; border-top:1px solid var(--line); display:flex; flex-wrap:wrap; gap:.8rem 1.2rem; color:var(--muted); font-size:.72rem; }
    .hashes code { overflow-wrap:anywhere; }
  </style>
</head>
<body>${body}
</body>
</html>
`
}

export function renderJsonFeed(dossier) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'NarcoScope evidence newsroom',
    home_page_url: `${SITE_ORIGIN}/#newsroom`,
    feed_url: `${SITE_ORIGIN}/news/feed.json`,
    description: 'Deterministic, source-bounded analyses of official public records.',
    items: [
      {
        id: dossier.articleId,
        url: `${SITE_ORIGIN}/news/${FILES.html}`,
        title: dossier.title,
        summary: dossier.dek,
        content_html: renderArticleBody(dossier),
        date_published: dossier.publishedAt,
        date_modified: dossier.updatedAt,
        tags: ['official records', 'precursors', 'China', 'evidence analysis'],
        _narcoscope: {
          contentClass: dossier.contentClass,
          revisionHash: dossier.revisionHash,
          contentHash: dossier.contentHash,
          machineBriefContentHash: dossier.promotion.machineBriefContentHash,
          correctionsStatus: dossier.publicationRecord.corrections.status,
          rightToReplyStatus: dossier.publicationRecord.rightToReply.status,
          testimonyIncluded: false,
          simulatedHumanVoicesIncluded: dossier.publicationRecord.testimony.simulatedHumanVoicesIncluded,
        },
      },
    ],
  }
}

export function renderAtomFeed(dossier) {
  const articleUrl = `${SITE_ORIGIN}/news/${FILES.html}`
  const feedUrl = `${SITE_ORIGIN}/news/feed.xml`
  const content = renderArticleBody(dossier)
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(`${SITE_ORIGIN}/news/`)}</id>
  <title>NarcoScope evidence newsroom</title>
  <author><name>NarcoScope automated evidence desk</name></author>
  <updated>${escapeXml(dossier.updatedAt)}</updated>
  <link rel="self" href="${escapeXml(feedUrl)}" />
  <link rel="alternate" href="${escapeXml(`${SITE_ORIGIN}/#newsroom`)}" />
  <entry>
    <id>${escapeXml(articleUrl)}</id>
    <title>${escapeXml(dossier.title)}</title>
    <link href="${escapeXml(articleUrl)}" />
    <published>${escapeXml(dossier.publishedAt)}</published>
    <updated>${escapeXml(dossier.updatedAt)}</updated>
    <summary>${escapeXml(dossier.dek)}</summary>
    <content type="html">${escapeXml(content)}</content>
  </entry>
</feed>
`
}

function renderIndex(dossier) {
  return {
    schemaVersion: 'narcoscope.newsroom.index.v1',
    title: 'NarcoScope evidence newsroom',
    generatedAt: dossier.updatedAt,
    feeds: {
      json: '/news/feed.json',
      atom: '/news/feed.xml',
    },
    articles: [
      {
        id: dossier.articleId,
        slug: dossier.slug,
        title: dossier.title,
        dek: dossier.dek,
        contentClass: dossier.contentClass,
        dataAsOf: dossier.dataAsOf,
        publishedAt: dossier.publishedAt,
        updatedAt: dossier.updatedAt,
        htmlUrl: `/news/${FILES.html}`,
        dossierUrl: `/news/${FILES.dossier}`,
        machineBriefUrl: `/news/${FILES.machineBrief}`,
        revisionHash: dossier.revisionHash,
        contentHash: dossier.contentHash,
        automationDisclosure: dossier.editorialStatus.automationDisclosure,
        humanReviewStatus: dossier.editorialStatus.humanReviewStatus,
        correctionsStatus: dossier.publicationRecord.corrections.status,
        rightToReplyStatus: dossier.publicationRecord.rightToReply.status,
        testimonyIncluded: false,
        simulatedHumanVoicesIncluded: dossier.publicationRecord.testimony.simulatedHumanVoicesIncluded,
      },
    ],
  }
}

export function buildNewsroomArtifacts(inputs) {
  const capabilityGate = assertCapabilityRegistry(inputs.capabilities.data)
  const machineBrief = buildMachineBrief(inputs)
  const machineBriefGate = assertMachineBrief(machineBrief)
  const dossier = buildEvidenceAnalysis(machineBrief, inputs)
  const analysisGate = assertAutomatedEvidenceAnalysis(
    dossier,
    machineBrief,
    inputs.capabilities.data,
    inputs.previousDossier?.data ?? null,
  )
  const jsonFeed = renderJsonFeed(dossier)
  const index = renderIndex(dossier)
  const files = {
    [FILES.machineBrief]: serializeJson(machineBrief),
    [FILES.dossier]: serializeJson(dossier),
    [FILES.html]: renderArticleHtml(dossier),
    [FILES.index]: serializeJson(index),
    [FILES.jsonFeed]: serializeJson(jsonFeed),
    [FILES.atomFeed]: renderAtomFeed(dossier),
  }
  const artifactEntries = Object.entries(files)
    .sort(([a], [b]) => compareText(a, b))
    .map(([file, contents]) => ({
      file,
      bytes: Buffer.byteLength(contents),
      sha256: sha256(contents),
    }))
  const manifest = {
    schemaVersion: 'narcoscope.newsroom.manifest.v1',
    pipelineVersion: NEWSROOM_PIPELINE_VERSION,
    generatedAt: dossier.updatedAt,
    articleId: dossier.articleId,
    revisionHash: dossier.revisionHash,
    contentHash: dossier.contentHash,
    verificationReceipt: {
      ...dossier.verificationReceipt,
      deterministicHashes: {
        ...dossier.verificationReceipt.deterministicHashes,
        dossierContentHash: dossier.contentHash,
      },
    },
    inputs: machineBrief.inputArtifacts,
    gates: [capabilityGate, machineBriefGate, analysisGate],
    artifacts: artifactEntries,
  }
  files[FILES.manifest] = serializeJson(manifest)
  return { machineBrief, dossier, manifest, files }
}

export async function generateNewsroomArtifacts({
  root = defaultRoot,
  outputDir = DEFAULT_NEWS_OUTPUT,
  check = false,
} = {}) {
  const inputs = await loadNewsroomInputs(root)
  const built = buildNewsroomArtifacts(inputs)
  const entries = Object.entries(built.files).sort(([a], [b]) => compareText(a, b))

  if (check) {
    const mismatches = []
    let actualFiles = []
    try {
      actualFiles = (await fs.readdir(outputDir)).sort(compareText)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const expectedFiles = entries.map(([file]) => file).sort(compareText)
    for (const file of actualFiles) {
      if (!expectedFiles.includes(file)) mismatches.push(`${file} is an unexpected generated artifact`)
    }
    for (const [file, expected] of entries) {
      try {
        const actual = await fs.readFile(path.join(outputDir, file), 'utf8')
        if (actual !== expected) mismatches.push(`${file} is stale`)
      } catch (error) {
        if (error?.code === 'ENOENT') mismatches.push(`${file} is missing`)
        else throw error
      }
    }
    if (mismatches.length > 0) throw gateFailure('checked-artifact-gate.v1', mismatches)
    return { ...built, outputDir, checked: true }
  }

  const parentDir = path.dirname(outputDir)
  const outputName = path.basename(outputDir)
  await fs.mkdir(parentDir, { recursive: true })
  const stageDir = await fs.mkdtemp(path.join(parentDir, `.${outputName}.stage-`))
  const backupDir = path.join(parentDir, `.${outputName}.backup-${process.pid}-${Date.now()}`)
  let movedExisting = false
  try {
    await Promise.all(entries.map(([file, contents]) => fs.writeFile(path.join(stageDir, file), contents, 'utf8')))
    try {
      await fs.rename(outputDir, backupDir)
      movedExisting = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      await fs.rename(stageDir, outputDir)
    } catch (error) {
      if (movedExisting) await fs.rename(backupDir, outputDir)
      throw error
    }
    if (movedExisting) await fs.rm(backupDir, { recursive: true, force: true })
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true })
    throw error
  }
  return { ...built, outputDir, checked: false }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  generateNewsroomArtifacts({ check })
    .then(({ manifest, outputDir }) => {
      const verb = check ? 'verified' : 'wrote'
      console.log(`${verb} ${manifest.artifacts.length + 1} deterministic newsroom artifacts in ${path.relative(defaultRoot, outputDir)}`)
      console.log(`revision ${manifest.revisionHash}`)
      console.log(`content  ${manifest.contentHash}`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
