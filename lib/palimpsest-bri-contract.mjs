import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import packagedArtifactSchema from '../public/data/narcoscope-palimpsest-bri-v1.schema.json' with { type: 'json' }

export const BRI_SCHEMA_VERSION = 'narcoscope.palimpsest.bri-context.v1'
export const BRI_PIN_SCHEMA_VERSION = 'narcoscope.palimpsest.bri-source-pin.v1'
export const BRI_ENVELOPE_SCHEMA_VERSION = 'narcoscope.api.palimpsest-bri-envelope.v1'
export const BRI_SCHEMA_FILE = 'narcoscope-palimpsest-bri-v1.schema.json'
export const BRI_ARTIFACT_FILE = 'narcoscope-palimpsest-bri-v1.json'
export const BRI_HASH_FILE = `${BRI_ARTIFACT_FILE}.sha256`
export const BRI_SCHEMA_ID = `https://narcoscope.com/data/${BRI_SCHEMA_FILE}`
export const BRI_OUTPUT_SCHEMA_ID = 'https://narcoscope.com/schemas/narcoscope-palimpsest-bri-envelope-v1.schema.json'

export const IMPLEMENTATION_STATES = Object.freeze([
  'adapter_ready',
  'blocked',
  'link_only',
  'live',
  'planned',
])
export const BUILD_READY_STATES = new Set(['adapter_ready', 'live'])
export const COUNTRY_ORDER = Object.freeze(['CHN', 'MMR', 'PAK'])
export const COUNTRY_LABELS = Object.freeze({ CHN: 'China', MMR: 'Myanmar', PAK: 'Pakistan' })
export const TARGET_AREAS = Object.freeze([
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

export const REQUIRED_PROHIBITIONS = Object.freeze([
  'drugConflictInfrastructureCausalJoin',
  'actorClassification',
  'bilateralRouteInference',
  'guiltInference',
  'politicalMovementClassification',
  'projectAttributionFromNationalSeries',
  'tacticalOrNavigableUse',
])

const SHA256_RE = /^[0-9a-f]{64}$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const GIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SOURCE_CLASSES = Object.freeze([
  'civil_society', 'legal', 'multilateral', 'official_china', 'official_host', 'partner', 'research',
])
const AUTHORITY_ROLES = Object.freeze([
  'administrative_position', 'analytical_estimate', 'independent_observation',
  'legal_instrument', 'partner_aggregate', 'primary_record',
])
const RIGHTS_STATUSES = Object.freeze([
  'attribution', 'licensed_no_redistribution', 'link_only_pending_review',
  'official_publication_review_required', 'open_reuse', 'public_domain',
])
const CLAIM_CLASSES = Object.freeze([
  'administrative_action', 'allegation', 'analytical_estimate', 'humanitarian_observation',
  'legal_status', 'licensed_event', 'modeled_estimate', 'official_position',
  'official_statistic', 'partner_aggregate', 'project_register', 'reported_event',
])
const UNAVAILABLE_REASONS = Object.freeze(['source_value_null'])
const REQUIRED_TARGET_IDS = new Set(TARGET_AREAS.flatMap((area) => area.targetIds))
const FORBIDDEN_NORMALIZED_KEYS = new Set([
  'address', 'addresses', 'actor', 'actors', 'alias', 'aliases', 'coordinate', 'coordinates',
  'dateofbirth', 'entityrecord', 'entityrecords', 'eventnarrative', 'eventrecord', 'eventrecords',
  'geometry', 'identitynumber', 'latitude', 'longitude', 'observation', 'observations',
  'personrecord', 'personrecords', 'routegeometry', 'tacticaldetail', 'tacticaldetails',
  'tacticalvulnerability', 'value', 'values',
])

function labelPath(label, key) {
  return label ? `${label}.${key}` : key
}

export function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

export function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

export function requireInteger(value, label, { positive = false } = {}) {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'non-negative'} integer`)
  }
  return value
}

export function requireSha256(value, label) {
  if (!SHA256_RE.test(String(value ?? ''))) throw new Error(`${label} must be a lowercase SHA-256`)
  return value
}

export function requireCommit(value, label) {
  if (!COMMIT_RE.test(String(value ?? ''))) throw new Error(`${label} must be a lowercase 40-character Git commit`)
  return value
}

export function requireGitOid(value, label) {
  if (!GIT_OID_RE.test(String(value ?? ''))) throw new Error(`${label} must be a lowercase Git object id`)
  return value
}

function requireDateTime(value, label) {
  requireString(value, label)
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an RFC 3339 UTC timestamp`)
  }
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

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} has unsupported value ${String(value)}`)
  return value
}

function assertExactKeys(value, label, required, optional = []) {
  const object = requireObject(value, label)
  const allowed = new Set([...required, ...optional])
  const unknown = Object.keys(object).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.sort().join(', ')}`)
  const missing = required.filter((key) => !Object.hasOwn(object, key))
  if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`)
  return object
}

function assertStringArray(value, label, { minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minItems) {
    throw new Error(`${label} must be an array with at least ${minItems} items`)
  }
  const seen = new Set()
  for (const [index, item] of value.entries()) {
    requireString(item, `${label}[${index}]`)
    if (seen.has(item)) throw new Error(`${label} must not contain duplicates`)
    seen.add(item)
  }
  return value
}

function assertCountMap(value, label, allowedKeys, { requireAll = false, minProperties = 0 } = {}) {
  const object = requireObject(value, label)
  const keys = Object.keys(object)
  if (keys.length < minProperties) throw new Error(`${label} must not be empty`)
  const unknown = keys.filter((key) => !allowedKeys.includes(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.sort().join(', ')}`)
  if (requireAll) {
    const missing = allowedKeys.filter((key) => !Object.hasOwn(object, key))
    if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`)
  }
  for (const [key, count] of Object.entries(object)) requireInteger(count, labelPath(label, key))
  return object
}

function forbiddenPaths(value, parts = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenPaths(item, [...parts, String(index)]))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
    return [
      ...(FORBIDDEN_NORMALIZED_KEYS.has(normalized) ? [[...parts, key].join('.')] : []),
      ...forbiddenPaths(item, [...parts, key]),
    ]
  })
}

function assertSourceDescriptor(value, label, { railwayMirror = false } = {}) {
  const required = ['path', 'canonicalUrl', 'bytes', 'sha256', 'gitBlobOid']
  const optional = railwayMirror ? ['railwayMirrorUrl'] : []
  const descriptor = assertExactKeys(value, label, required, optional)
  requireString(descriptor.path, `${label}.path`)
  if (descriptor.path.startsWith('/') || descriptor.path.includes('..')) throw new Error(`${label}.path must be repository-relative`)
  requireHttpsUrl(descriptor.canonicalUrl, `${label}.canonicalUrl`)
  if (descriptor.railwayMirrorUrl !== undefined) requireHttpsUrl(descriptor.railwayMirrorUrl, `${label}.railwayMirrorUrl`)
  requireInteger(descriptor.bytes, `${label}.bytes`, { positive: true })
  requireSha256(descriptor.sha256, `${label}.sha256`)
  requireGitOid(descriptor.gitBlobOid, `${label}.gitBlobOid`)
  return descriptor
}

function assertPagesPublication(value, label) {
  const publication = assertExactKeys(value, label, [
    'verificationState', 'sourceRevision', 'sourceTreeOid', 'receiptBytes', 'receiptSha256',
    'verifiedAt', 'freshUntil', 'availabilitySemantics', 'servedResources',
  ])
  if (publication.verificationState !== 'served_resource_receipt_validated') {
    throw new Error(`${label}.verificationState must describe receipt validation without asserting continuous production state`)
  }
  requireCommit(publication.sourceRevision, `${label}.sourceRevision`)
  requireGitOid(publication.sourceTreeOid, `${label}.sourceTreeOid`)
  requireInteger(publication.receiptBytes, `${label}.receiptBytes`, { positive: true })
  requireSha256(publication.receiptSha256, `${label}.receiptSha256`)
  requireDateTime(publication.verifiedAt, `${label}.verifiedAt`)
  requireDateTime(publication.freshUntil, `${label}.freshUntil`)
  if (Date.parse(publication.freshUntil) <= Date.parse(publication.verifiedAt)) {
    throw new Error(`${label}.freshUntil must be later than verifiedAt`)
  }
  requireString(publication.availabilitySemantics, `${label}.availabilitySemantics`)
  if (!Array.isArray(publication.servedResources) || publication.servedResources.length !== 3) {
    throw new Error(`${label}.servedResources must contain all three verified Pages resources`)
  }
  const expectedPaths = [
    'config/bri_wdi_series.json',
    'protocol/bri-economic-observations-v1.schema.json',
    'readings/bri-economic-observations-latest.json',
  ]
  const paths = publication.servedResources.map((item, index) => (
    assertSourceDescriptor(item, `${label}.servedResources[${index}]`).path
  )).sort()
  if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) {
    throw new Error(`${label}.servedResources does not contain the exact required Pages resource set`)
  }
  return publication
}

function assertRelease(value, label) {
  const release = assertExactKeys(value, label, [
    'producer', 'verificationState', 'canonicalBaseUrl', 'railwayMirrorBaseUrl', 'deploymentId',
    'sourceRevision', 'sourceTreeOid', 'artifactTreeSha256', 'artifactManifest', 'receiptBytes', 'receiptSha256',
    'verifiedAt', 'verificationSemantics', 'pagesPublication',
  ])
  if (release.producer !== 'Palimpsest') throw new Error(`${label}.producer must be Palimpsest`)
  if (release.verificationState !== 'release_receipt_validated') {
    throw new Error(`${label}.verificationState must describe receipt validation without asserting continuous production state`)
  }
  if (release.canonicalBaseUrl !== 'https://palimpsest.info') throw new Error(`${label}.canonicalBaseUrl changed`)
  requireHttpsUrl(release.railwayMirrorBaseUrl, `${label}.railwayMirrorBaseUrl`)
  requireString(release.deploymentId, `${label}.deploymentId`)
  requireCommit(release.sourceRevision, `${label}.sourceRevision`)
  requireGitOid(release.sourceTreeOid, `${label}.sourceTreeOid`)
  requireSha256(release.artifactTreeSha256, `${label}.artifactTreeSha256`)
  const manifest = assertExactKeys(release.artifactManifest, `${label}.artifactManifest`, [
    'schemaVersion', 'bytes', 'sha256', 'fileCount', 'totalBytes',
  ])
  if (manifest.schemaVersion !== 'palimpsest.railway-static-release.v1') throw new Error(`${label}.artifactManifest.schemaVersion changed`)
  requireInteger(manifest.bytes, `${label}.artifactManifest.bytes`, { positive: true })
  requireSha256(manifest.sha256, `${label}.artifactManifest.sha256`)
  requireInteger(manifest.fileCount, `${label}.artifactManifest.fileCount`, { positive: true })
  requireInteger(manifest.totalBytes, `${label}.artifactManifest.totalBytes`, { positive: true })
  requireInteger(release.receiptBytes, `${label}.receiptBytes`, { positive: true })
  requireSha256(release.receiptSha256, `${label}.receiptSha256`)
  requireDateTime(release.verifiedAt, `${label}.verifiedAt`)
  requireString(release.verificationSemantics, `${label}.verificationSemantics`)
  assertPagesPublication(release.pagesPublication, `${label}.pagesPublication`)
  return release
}

function assertSourceReadiness(value, label) {
  const readiness = assertExactKeys(value, label, [
    'sourceCount', 'buildReadySourceCount', 'implementationStates', 'rightsStatusCounts', 'buildReadyGaps',
  ])
  requireInteger(readiness.sourceCount, `${label}.sourceCount`, { positive: true })
  requireInteger(readiness.buildReadySourceCount, `${label}.buildReadySourceCount`)
  assertCountMap(readiness.implementationStates, `${label}.implementationStates`, IMPLEMENTATION_STATES, { requireAll: true })
  assertCountMap(readiness.rightsStatusCounts, `${label}.rightsStatusCounts`, RIGHTS_STATUSES, { minProperties: 1 })
  assertStringArray(readiness.buildReadyGaps, `${label}.buildReadyGaps`)
  const stateTotal = Object.values(readiness.implementationStates).reduce((total, count) => total + count, 0)
  if (stateTotal !== readiness.sourceCount) throw new Error(`${label} state counts do not sum to sourceCount`)
  const ready = readiness.implementationStates.adapter_ready + readiness.implementationStates.live
  if (ready !== readiness.buildReadySourceCount) throw new Error(`${label} buildReadySourceCount does not match ready states`)
  const rightsTotal = Object.values(readiness.rightsStatusCounts).reduce((total, count) => total + count, 0)
  if (rightsTotal !== readiness.sourceCount) throw new Error(`${label} rights-status counts do not sum to sourceCount`)
  return readiness
}

function assertClaimSemantics(value, label) {
  const semantics = assertExactKeys(value, label, [
    'classificationRule', 'sourceClassCounts', 'authorityRoleCounts', 'claimClassCounts',
    'officialOrAdministrativeSourceIds', 'independentObservationSourceIds', 'modeledOrAnalyticalSourceIds',
  ])
  requireString(semantics.classificationRule, `${label}.classificationRule`)
  assertCountMap(semantics.sourceClassCounts, `${label}.sourceClassCounts`, SOURCE_CLASSES, { minProperties: 1 })
  assertCountMap(semantics.authorityRoleCounts, `${label}.authorityRoleCounts`, AUTHORITY_ROLES, { minProperties: 1 })
  assertCountMap(semantics.claimClassCounts, `${label}.claimClassCounts`, CLAIM_CLASSES, { minProperties: 1 })
  assertStringArray(semantics.officialOrAdministrativeSourceIds, `${label}.officialOrAdministrativeSourceIds`)
  assertStringArray(semantics.independentObservationSourceIds, `${label}.independentObservationSourceIds`)
  assertStringArray(semantics.modeledOrAnalyticalSourceIds, `${label}.modeledOrAnalyticalSourceIds`)
  const sourceClassTotal = Object.values(semantics.sourceClassCounts).reduce((total, count) => total + count, 0)
  const authorityRoleTotal = Object.values(semantics.authorityRoleCounts).reduce((total, count) => total + count, 0)
  if (sourceClassTotal !== authorityRoleTotal) {
    throw new Error(`${label} source-class and authority-role counts describe different source totals`)
  }
  return semantics
}

function assertClaimSemanticsSourceTotal(semantics, readiness, label) {
  const sourceClassTotal = Object.values(semantics.sourceClassCounts).reduce((total, count) => total + count, 0)
  if (sourceClassTotal !== readiness.sourceCount) {
    throw new Error(`${label} source-class counts do not sum to source readiness sourceCount`)
  }
}

function assertSourceSummary(value, label) {
  const source = assertExactKeys(value, label, [
    'sourceId', 'implementationState', 'sourceClass', 'authorityRole', 'rightsStatus', 'claimClasses',
  ])
  if (!/^[a-z0-9_]+$/.test(requireString(source.sourceId, `${label}.sourceId`))) throw new Error(`${label}.sourceId is invalid`)
  requireEnum(source.implementationState, IMPLEMENTATION_STATES, `${label}.implementationState`)
  requireEnum(source.sourceClass, SOURCE_CLASSES, `${label}.sourceClass`)
  requireEnum(source.authorityRole, AUTHORITY_ROLES, `${label}.authorityRole`)
  requireEnum(source.rightsStatus, RIGHTS_STATUSES, `${label}.rightsStatus`)
  assertStringArray(source.claimClasses, `${label}.claimClasses`)
  for (const item of source.claimClasses) requireEnum(item, CLAIM_CLASSES, `${label}.claimClasses`)
  return source
}

function assertTargetCoverage(value, label) {
  if (!Array.isArray(value) || value.length !== TARGET_AREAS.length) {
    throw new Error(`${label} must contain the five fixed target areas`)
  }
  const targetIds = new Set()
  for (const [areaIndex, area] of value.entries()) {
    const expectedArea = TARGET_AREAS[areaIndex]
    const areaLabel = `${label}[${areaIndex}]`
    assertExactKeys(area, areaLabel, ['areaId', 'label', 'targets'])
    if (area.areaId !== expectedArea.areaId || area.label !== expectedArea.label) throw new Error(`${areaLabel} identity or order changed`)
    if (!Array.isArray(area.targets) || area.targets.length !== expectedArea.targetIds.length) {
      throw new Error(`${areaLabel}.targets scope changed`)
    }
    for (const [targetIndex, target] of area.targets.entries()) {
      const targetLabel = `${areaLabel}.targets[${targetIndex}]`
      assertExactKeys(target, targetLabel, [
        'targetId', 'label', 'targetType', 'evidenceStatus', 'requiredCoverage', 'sourceReadiness', 'sources',
      ])
      if (target.targetId !== expectedArea.targetIds[targetIndex]) throw new Error(`${targetLabel}.targetId or order changed`)
      targetIds.add(target.targetId)
      requireString(target.label, `${targetLabel}.label`)
      requireString(target.targetType, `${targetLabel}.targetType`)
      requireString(target.evidenceStatus, `${targetLabel}.evidenceStatus`)
      assertStringArray(target.requiredCoverage, `${targetLabel}.requiredCoverage`)
      const readiness = assertExactKeys(target.sourceReadiness, `${targetLabel}.sourceReadiness`, [
        'sourceCount', 'buildReadySourceCount', 'implementationStates',
      ])
      requireInteger(readiness.sourceCount, `${targetLabel}.sourceReadiness.sourceCount`, { positive: true })
      requireInteger(readiness.buildReadySourceCount, `${targetLabel}.sourceReadiness.buildReadySourceCount`)
      assertCountMap(readiness.implementationStates, `${targetLabel}.sourceReadiness.implementationStates`, IMPLEMENTATION_STATES, { minProperties: 1 })
      if (!Array.isArray(target.sources) || target.sources.length === 0) throw new Error(`${targetLabel}.sources must not be empty`)
      target.sources.forEach((source, sourceIndex) => assertSourceSummary(source, `${targetLabel}.sources[${sourceIndex}]`))
      if (new Set(target.sources.map((source) => source.sourceId)).size !== target.sources.length) {
        throw new Error(`${targetLabel}.sources contains duplicate sourceId values`)
      }
      if (readiness.sourceCount !== target.sources.length) throw new Error(`${targetLabel} sourceCount does not match sources`)
      const calculatedStates = Object.fromEntries(IMPLEMENTATION_STATES.map((state) => [
        state, target.sources.filter((source) => source.implementationState === state).length,
      ]).filter(([, count]) => count > 0))
      if (JSON.stringify(readiness.implementationStates) !== JSON.stringify(calculatedStates)) {
        throw new Error(`${targetLabel} implementation-state counts do not match sources`)
      }
      const readyCount = target.sources.filter((source) => BUILD_READY_STATES.has(source.implementationState)).length
      if (readiness.buildReadySourceCount !== readyCount) throw new Error(`${targetLabel} buildReadySourceCount does not match sources`)
    }
  }
  if (targetIds.size !== REQUIRED_TARGET_IDS.size || [...REQUIRED_TARGET_IDS].some((id) => !targetIds.has(id))) {
    throw new Error(`${label} target scope changed`)
  }
  return value
}

function assertCoverageWindow(value, label, { unavailable = false } = {}) {
  const keys = unavailable ? ['fromYear', 'toYear', 'yearCount', 'reasonCounts'] : ['fromYear', 'toYear', 'yearCount']
  const window = assertExactKeys(value, label, keys)
  requireInteger(window.yearCount, `${label}.yearCount`)
  for (const key of ['fromYear', 'toYear']) {
    const year = window[key]
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) throw new Error(`${label}.${key} is invalid`)
  }
  if (window.yearCount === 0 && (window.fromYear !== null || window.toYear !== null)) {
    throw new Error(`${label} empty coverage must use null year bounds`)
  }
  if (window.yearCount > 0 && (window.fromYear === null || window.toYear === null)) {
    throw new Error(`${label} non-empty coverage must use integer year bounds`)
  }
  if (window.yearCount > 0 && window.fromYear > window.toYear) throw new Error(`${label} year bounds are reversed`)
  if (window.yearCount > 0 && window.yearCount > window.toYear - window.fromYear + 1) {
    throw new Error(`${label}.yearCount exceeds its inclusive year span`)
  }
  if (unavailable) {
    assertCountMap(window.reasonCounts, `${label}.reasonCounts`, UNAVAILABLE_REASONS)
    const reasonTotal = Object.values(window.reasonCounts).reduce((total, count) => total + count, 0)
    if (reasonTotal !== window.yearCount) throw new Error(`${label}.reasonCounts do not sum to yearCount`)
  }
  return window
}

function assertEconomicSnapshot(value, label) {
  const economic = assertExactKeys(value, label, [
    'schemaVersion', 'generatedAt', 'collectionId', 'source', 'rights', 'clocks',
    'hashPointers', 'contextPolicy', 'coverage',
  ])
  if (economic.schemaVersion !== 'palimpsest.bri-economic-observations.v1') throw new Error(`${label}.schemaVersion changed`)
  requireDateTime(economic.generatedAt, `${label}.generatedAt`)
  requireSha256(economic.collectionId, `${label}.collectionId`)
  const source = assertExactKeys(economic.source, `${label}.source`, ['sourceId', 'name', 'publisher', 'attribution', 'catalogUrl'])
  if (source.sourceId !== 'world_bank_wdi') throw new Error(`${label}.source.sourceId changed`)
  requireString(source.name, `${label}.source.name`)
  requireString(source.publisher, `${label}.source.publisher`)
  requireString(source.attribution, `${label}.source.attribution`)
  requireHttpsUrl(source.catalogUrl, `${label}.source.catalogUrl`)
  const rights = assertExactKeys(economic.rights, `${label}.rights`, [
    'license', 'licenseUrl', 'redistributionStatus', 'rightsEvidenceUrl', 'attribution',
  ])
  requireString(rights.license, `${label}.rights.license`)
  requireHttpsUrl(rights.licenseUrl, `${label}.rights.licenseUrl`)
  requireString(rights.redistributionStatus, `${label}.rights.redistributionStatus`)
  requireHttpsUrl(rights.rightsEvidenceUrl, `${label}.rights.rightsEvidenceUrl`)
  requireString(rights.attribution, `${label}.rights.attribution`)
  const clocks = assertExactKeys(economic.clocks, `${label}.clocks`, [
    'generatedAt', 'datasetLastUpdated', 'sourceReleaseUpperBound', 'retrievedAt',
  ])
  requireDateTime(clocks.generatedAt, `${label}.clocks.generatedAt`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clocks.datasetLastUpdated)) throw new Error(`${label}.clocks.datasetLastUpdated is invalid`)
  requireDateTime(clocks.sourceReleaseUpperBound, `${label}.clocks.sourceReleaseUpperBound`)
  requireDateTime(clocks.retrievedAt, `${label}.clocks.retrievedAt`)
  const hashes = assertExactKeys(economic.hashPointers, `${label}.hashPointers`, [
    'observationsSha256', 'registrySha256', 'rawResponseSha256s',
  ])
  requireSha256(hashes.observationsSha256, `${label}.hashPointers.observationsSha256`)
  requireSha256(hashes.registrySha256, `${label}.hashPointers.registrySha256`)
  if (!Array.isArray(hashes.rawResponseSha256s) || hashes.rawResponseSha256s.length === 0) {
    throw new Error(`${label}.hashPointers.rawResponseSha256s must not be empty`)
  }
  hashes.rawResponseSha256s.forEach((hash, index) => requireSha256(hash, `${label}.hashPointers.rawResponseSha256s[${index}]`))
  if (new Set(hashes.rawResponseSha256s).size !== hashes.rawResponseSha256s.length) {
    throw new Error(`${label}.hashPointers.rawResponseSha256s must be unique`)
  }
  const policy = assertExactKeys(economic.contextPolicy, `${label}.contextPolicy`, [
    'aggregateLevel', 'scope', 'causalityBoundary', 'missingValuePolicy', 'forecastPolicy', 'downstreamSemantics',
  ])
  if (policy.aggregateLevel !== 'country' || policy.scope !== 'national_economic_context'
    || policy.causalityBoundary !== 'not_evidence_of_bri_causality'
    || policy.missingValuePolicy !== 'source_null_remains_unavailable') {
    throw new Error(`${label}.contextPolicy crossed the aggregate non-causal boundary`)
  }
  requireString(policy.forecastPolicy, `${label}.contextPolicy.forecastPolicy`)
  const downstream = assertExactKeys(policy.downstreamSemantics, `${label}.contextPolicy.downstreamSemantics`, [
    'observed', 'forecast', 'unavailable', 'join_boundary',
  ])
  for (const key of Object.keys(downstream)) requireString(downstream[key], `${label}.contextPolicy.downstreamSemantics.${key}`)
  const coverage = assertExactKeys(economic.coverage, `${label}.coverage`, ['totals', 'countries'])
  const totals = assertExactKeys(coverage.totals, `${label}.coverage.totals`, [
    'countries', 'indicators', 'sourceRows', 'observedRows', 'forecastRows', 'unavailableRows',
  ])
  for (const key of Object.keys(totals)) requireInteger(totals[key], `${label}.coverage.totals.${key}`, { positive: key === 'countries' || key === 'indicators' || key === 'sourceRows' })
  if (totals.countries !== 3) throw new Error(`${label}.coverage.totals.countries changed`)
  if (totals.sourceRows !== totals.observedRows + totals.forecastRows + totals.unavailableRows) {
    throw new Error(`${label}.coverage evidence states do not partition sourceRows`)
  }
  if (!Array.isArray(coverage.countries) || coverage.countries.length !== COUNTRY_ORDER.length) {
    throw new Error(`${label}.coverage.countries scope changed`)
  }
  const allSeries = new Set()
  for (const [countryIndex, country] of coverage.countries.entries()) {
    const countryLabel = `${label}.coverage.countries[${countryIndex}]`
    assertExactKeys(country, countryLabel, [
      'countryCode', 'country', 'indicatorCount', 'sourceRowCount', 'observedRowCount',
      'forecastRowCount', 'unavailableRowCount', 'indicators',
    ])
    if (country.countryCode !== COUNTRY_ORDER[countryIndex]
      || country.country !== COUNTRY_LABELS[country.countryCode]) throw new Error(`${countryLabel} identity or order changed`)
    for (const key of ['indicatorCount', 'sourceRowCount', 'observedRowCount', 'forecastRowCount', 'unavailableRowCount']) {
      requireInteger(country[key], `${countryLabel}.${key}`, { positive: key === 'indicatorCount' || key === 'sourceRowCount' })
    }
    if (!Array.isArray(country.indicators) || country.indicators.length !== country.indicatorCount) {
      throw new Error(`${countryLabel}.indicatorCount does not match indicators`)
    }
    if (country.sourceRowCount !== country.observedRowCount + country.forecastRowCount + country.unavailableRowCount) {
      throw new Error(`${countryLabel} evidence states do not partition sourceRowCount`)
    }
    for (const [indicatorIndex, indicator] of country.indicators.entries()) {
      const indicatorLabel = `${countryLabel}.indicators[${indicatorIndex}]`
      assertExactKeys(indicator, indicatorLabel, [
        'seriesId', 'indicatorId', 'unit', 'annualCoverage', 'sourceRowCount', 'observed', 'forecast', 'unavailable',
      ])
      requireString(indicator.seriesId, `${indicatorLabel}.seriesId`)
      requireString(indicator.indicatorId, `${indicatorLabel}.indicatorId`)
      requireString(indicator.unit, `${indicatorLabel}.unit`)
      allSeries.add(indicator.seriesId)
      requireInteger(indicator.sourceRowCount, `${indicatorLabel}.sourceRowCount`, { positive: true })
      assertCoverageWindow(indicator.annualCoverage, `${indicatorLabel}.annualCoverage`)
      assertCoverageWindow(indicator.observed, `${indicatorLabel}.observed`)
      assertCoverageWindow(indicator.forecast, `${indicatorLabel}.forecast`)
      assertCoverageWindow(indicator.unavailable, `${indicatorLabel}.unavailable`, { unavailable: true })
      if (indicator.sourceRowCount !== indicator.observed.yearCount + indicator.forecast.yearCount + indicator.unavailable.yearCount) {
        throw new Error(`${indicatorLabel} evidence states do not partition sourceRowCount`)
      }
      if (indicator.annualCoverage.yearCount !== indicator.sourceRowCount) {
        throw new Error(`${indicatorLabel}.annualCoverage does not match sourceRowCount`)
      }
    }
    const rowSum = country.indicators.reduce((total, item) => total + item.sourceRowCount, 0)
    if (rowSum !== country.sourceRowCount) throw new Error(`${countryLabel}.sourceRowCount does not match indicators`)
    const stateSums = {
      observedRowCount: country.indicators.reduce((total, item) => total + item.observed.yearCount, 0),
      forecastRowCount: country.indicators.reduce((total, item) => total + item.forecast.yearCount, 0),
      unavailableRowCount: country.indicators.reduce((total, item) => total + item.unavailable.yearCount, 0),
    }
    for (const [key, count] of Object.entries(stateSums)) {
      if (country[key] !== count) throw new Error(`${countryLabel}.${key} does not match indicator windows`)
    }
  }
  if (allSeries.size !== totals.indicators) throw new Error(`${label}.coverage.totals.indicators does not match series`)
  const countrySums = {
    sourceRows: coverage.countries.reduce((total, item) => total + item.sourceRowCount, 0),
    observedRows: coverage.countries.reduce((total, item) => total + item.observedRowCount, 0),
    forecastRows: coverage.countries.reduce((total, item) => total + item.forecastRowCount, 0),
    unavailableRows: coverage.countries.reduce((total, item) => total + item.unavailableRowCount, 0),
  }
  for (const [key, count] of Object.entries(countrySums)) {
    if (totals[key] !== count) throw new Error(`${label}.coverage.totals.${key} does not match countries`)
  }
  return economic
}

export function assertPalimpsestBriPin(pin) {
  const value = assertExactKeys(pin, 'BRI source pin', [
    'schemaVersion', 'refreshedAt', 'release', 'sourceArtifacts', 'sourceSnapshot', 'economicSnapshot',
  ])
  if (value.schemaVersion !== BRI_PIN_SCHEMA_VERSION) throw new Error(`unexpected BRI pin schema ${value.schemaVersion}`)
  requireDateTime(value.refreshedAt, 'BRI source pin.refreshedAt')
  assertRelease(value.release, 'BRI source pin.release')
  const artifacts = assertExactKeys(value.sourceArtifacts, 'BRI source pin.sourceArtifacts', [
    'observatory', 'economics', 'pagesPublicationReceipt',
  ])
  assertSourceDescriptor(artifacts.observatory, 'BRI source pin.sourceArtifacts.observatory', { railwayMirror: true })
  assertSourceDescriptor(artifacts.economics, 'BRI source pin.sourceArtifacts.economics', { railwayMirror: true })
  assertSourceDescriptor(artifacts.pagesPublicationReceipt, 'BRI source pin.sourceArtifacts.pagesPublicationReceipt')
  const snapshot = assertExactKeys(value.sourceSnapshot, 'BRI source pin.sourceSnapshot', [
    'schemaVersion', 'asOf', 'scope', 'readiness', 'claimSemantics', 'targetCoverage',
  ])
  if (snapshot.schemaVersion !== 'palimpsest.belt-and-road-observatory.v2') throw new Error('BRI source pin.sourceSnapshot.schemaVersion changed')
  requireDateTime(snapshot.asOf, 'BRI source pin.sourceSnapshot.asOf')
  requireString(snapshot.scope, 'BRI source pin.sourceSnapshot.scope')
  const readiness = assertSourceReadiness(snapshot.readiness, 'BRI source pin.sourceSnapshot.readiness')
  const semantics = assertClaimSemantics(snapshot.claimSemantics, 'BRI source pin.sourceSnapshot.claimSemantics')
  assertClaimSemanticsSourceTotal(semantics, readiness, 'BRI source pin.sourceSnapshot.claimSemantics')
  assertTargetCoverage(snapshot.targetCoverage, 'BRI source pin.sourceSnapshot.targetCoverage')
  assertEconomicSnapshot(value.economicSnapshot, 'BRI source pin.economicSnapshot')
  const forbidden = forbiddenPaths(value)
  if (forbidden.length > 0) throw new Error(`BRI pin contains forbidden detail fields: ${forbidden.join(', ')}`)
  return value
}

function assertProvenance(value, label) {
  const provenance = assertExactKeys(value, label, ['producer', 'consumer', 'sourcePin', 'schema', 'release', 'sourceArtifacts'])
  if (provenance.producer !== 'Palimpsest' || provenance.consumer !== 'NarcoScope') throw new Error(`${label} producer/consumer changed`)
  const sourcePin = assertExactKeys(provenance.sourcePin, `${label}.sourcePin`, ['path', 'schemaVersion', 'bytes', 'sha256'])
  if (sourcePin.path !== 'scripts/bridge/palimpsest-bri-source-pin.json'
    || sourcePin.schemaVersion !== BRI_PIN_SCHEMA_VERSION) throw new Error(`${label}.sourcePin identity changed`)
  requireInteger(sourcePin.bytes, `${label}.sourcePin.bytes`, { positive: true })
  requireSha256(sourcePin.sha256, `${label}.sourcePin.sha256`)
  const schema = assertExactKeys(provenance.schema, `${label}.schema`, ['path', 'id', 'bytes', 'sha256'])
  if (schema.path !== `public/data/${BRI_SCHEMA_FILE}` || schema.id !== BRI_SCHEMA_ID) throw new Error(`${label}.schema identity changed`)
  requireInteger(schema.bytes, `${label}.schema.bytes`, { positive: true })
  requireSha256(schema.sha256, `${label}.schema.sha256`)
  assertRelease(provenance.release, `${label}.release`)
  const artifacts = assertExactKeys(provenance.sourceArtifacts, `${label}.sourceArtifacts`, [
    'observatory', 'economics', 'pagesPublicationReceipt',
  ])
  assertSourceDescriptor(artifacts.observatory, `${label}.sourceArtifacts.observatory`, { railwayMirror: true })
  assertSourceDescriptor(artifacts.economics, `${label}.sourceArtifacts.economics`, { railwayMirror: true })
  assertSourceDescriptor(artifacts.pagesPublicationReceipt, `${label}.sourceArtifacts.pagesPublicationReceipt`)
  return provenance
}

export function assertPalimpsestBriBoundary(artifact) {
  const value = assertExactKeys(artifact, 'Palimpsest BRI artifact', [
    '$schema', 'schemaVersion', 'artifactId', 'dataAsOf', 'scope', 'provenance',
    'sourceReadiness', 'claimSemantics', 'targetCoverage', 'economicContext', 'usePolicy', 'limitations',
  ])
  if (value.$schema !== `./${BRI_SCHEMA_FILE}` || value.schemaVersion !== BRI_SCHEMA_VERSION
    || value.artifactId !== 'narcoscope.palimpsest.bri-parallel-context') {
    throw new Error('unexpected Palimpsest BRI artifact identity')
  }
  requireDateTime(value.dataAsOf, 'Palimpsest BRI artifact.dataAsOf')
  requireString(value.scope, 'Palimpsest BRI artifact.scope')
  assertProvenance(value.provenance, 'Palimpsest BRI artifact.provenance')
  const readiness = assertSourceReadiness(value.sourceReadiness, 'Palimpsest BRI artifact.sourceReadiness')
  const semantics = assertClaimSemantics(value.claimSemantics, 'Palimpsest BRI artifact.claimSemantics')
  assertClaimSemanticsSourceTotal(semantics, readiness, 'Palimpsest BRI artifact.claimSemantics')
  assertTargetCoverage(value.targetCoverage, 'Palimpsest BRI artifact.targetCoverage')
  assertEconomicSnapshot(value.economicContext, 'Palimpsest BRI artifact.economicContext')
  const policy = assertExactKeys(value.usePolicy, 'Palimpsest BRI artifact.usePolicy', [
    'lane', 'allowedUse', 'crossLaneJoinPolicy', 'displayRelationship', 'prohibitions',
  ])
  if (policy.lane !== 'parallel_context_only' || policy.crossLaneJoinPolicy !== 'prohibited') {
    throw new Error('BRI context must remain a parallel lane with cross-lane joins prohibited')
  }
  requireString(policy.allowedUse, 'Palimpsest BRI artifact.usePolicy.allowedUse')
  requireString(policy.displayRelationship, 'Palimpsest BRI artifact.usePolicy.displayRelationship')
  const prohibitions = assertExactKeys(policy.prohibitions, 'Palimpsest BRI artifact.usePolicy.prohibitions', REQUIRED_PROHIBITIONS)
  if (REQUIRED_PROHIBITIONS.some((key) => prohibitions[key] !== 'prohibited')) {
    throw new Error('BRI context lost a required inference prohibition')
  }
  assertStringArray(value.limitations, 'Palimpsest BRI artifact.limitations', { minItems: 8 })
  const forbidden = forbiddenPaths(value)
  if (forbidden.length > 0) throw new Error(`BRI artifact contains forbidden detail fields: ${forbidden.join(', ')}`)
  return value
}

function formatAjvErrors(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')
}

export function compilePalimpsestBriSchema(schema) {
  requireObject(schema, 'Palimpsest BRI JSON Schema')
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error('Palimpsest BRI JSON Schema must declare draft 2020-12')
  }
  if (schema.$id !== BRI_SCHEMA_ID) throw new Error('Palimpsest BRI JSON Schema id changed')
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: true })
  addFormats(ajv)
  if (!ajv.validateSchema(schema)) {
    throw new Error(`Palimpsest BRI JSON Schema is not metaschema-valid: ${formatAjvErrors(ajv.errors)}`)
  }
  let validate
  try {
    validate = ajv.compile(schema)
  } catch (error) {
    throw new Error(`Palimpsest BRI JSON Schema cannot be compiled: ${error instanceof Error ? error.message : error}`)
  }
  return (artifact) => {
    if (!validate(artifact)) {
      throw new Error(`Palimpsest BRI artifact does not satisfy its JSON Schema: ${formatAjvErrors(validate.errors)}`)
    }
    return artifact
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

export function createPalimpsestBriOutputSchema(artifactSchema) {
  // Validate the embedded contract before exposing it to MCP or OpenAPI. Keeping
  // the artifact schema as its own nested resource preserves its canonical $id
  // while the local reference makes this envelope fully offline-compilable.
  compilePalimpsestBriSchema(artifactSchema)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: BRI_OUTPUT_SCHEMA_ID,
    $defs: { artifact: cloneJson(artifactSchema) },
    type: 'object',
    required: ['schema', 'data', 'links', 'interpretation'],
    properties: {
      schema: { const: BRI_ENVELOPE_SCHEMA_VERSION },
      data: { $ref: '#/$defs/artifact' },
      links: {
        type: 'object',
        required: ['canonical', 'sha256', 'schema'],
        properties: {
          canonical: { type: 'string', format: 'uri' },
          sha256: { type: 'string', format: 'uri' },
          schema: { const: BRI_SCHEMA_ID },
        },
        additionalProperties: false,
      },
      interpretation: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  }
}

export function createPalimpsestBriRestSchema(contextSchema) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://narcoscope.com/schemas/narcoscope-palimpsest-bri-rest-v1.schema.json',
    $defs: { context: cloneJson(contextSchema) },
    type: 'object',
    required: ['ok', 'resource', 'data'],
    properties: {
      ok: { const: true },
      resource: { const: 'palimpsest-bri' },
      data: { $ref: '#/$defs/context' },
    },
    additionalProperties: false,
  }
}

export const PALIMPSEST_BRI_OUTPUT_SCHEMA = Object.freeze(
  createPalimpsestBriOutputSchema(packagedArtifactSchema),
)
