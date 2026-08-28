export type BriDossierScope = 'bri' | 'balochistan' | 'pakistan-gwadar' | 'myanmar'

export type BriTargetSource = {
  sourceId: string
  implementationState: string
  sourceClass: string
  authorityRole: string
  rightsStatus: string
  claimClasses: string[]
}

export type BriTarget = {
  targetId: string
  label: string
  targetType: string
  evidenceStatus: string
  requiredCoverage: string[]
  sourceReadiness: {
    sourceCount: number
    buildReadySourceCount: number
    implementationStates: Record<string, number>
  }
  sources: BriTargetSource[]
}

export type BriArea = {
  areaId: string
  label: string
  targets: BriTarget[]
}

export type BriEconomicCountry = {
  countryCode: string
  country: string
  indicatorCount: number
  sourceRowCount: number
  observedRowCount: number
  forecastRowCount: number
  unavailableRowCount: number
}

export type BriContext = {
  schemaVersion: 'narcoscope.palimpsest.bri-context.v1'
  artifactId: string
  dataAsOf: string
  scope: string
  sourceReadiness: {
    sourceCount: number
    buildReadySourceCount: number
    implementationStates: Record<string, number>
    rightsStatusCounts: Record<string, number>
    buildReadyGaps: string[]
  }
  targetCoverage: BriArea[]
  economicContext: {
    source: {
      name: string
      publisher: string
      attribution: string
      catalogUrl: string
    }
    rights: {
      license: string
      licenseUrl: string
      redistributionStatus: string
      attribution: string
    }
    clocks: {
      generatedAt: string
      datasetLastUpdated: string
      retrievedAt: string
    }
    contextPolicy: {
      aggregateLevel: string
      scope: string
      causalityBoundary: string
      missingValuePolicy: string
    }
    coverage: {
      totals: {
        countries: number
        indicators: number
        sourceRows: number
        observedRows: number
        forecastRows: number
        unavailableRows: number
      }
      countries: BriEconomicCountry[]
    }
  }
  limitations: string[]
  usePolicy: {
    lane: string
    allowedUse: string
    crossLaneJoinPolicy: 'prohibited'
    displayRelationship: string
    prohibitions: Record<string, 'prohibited'>
  }
  provenance: {
    producer: string
    release: {
      verificationState: string
      railwayMirrorBaseUrl: string
      deploymentId: string
      sourceRevision: string
      verifiedAt: string
      verificationSemantics: string
    }
    sourceArtifacts: {
      observatory: { railwayMirrorUrl: string; sha256: string }
      economics: { railwayMirrorUrl: string; sha256: string }
      pagesPublicationReceipt: { railwayMirrorUrl?: string; canonicalUrl: string; sha256: string }
    }
  }
}

type ScopeContract = {
  title: string
  eyebrow: string
  lede: string
  areaIds: readonly string[] | null
  countryCodes: readonly string[]
  economicBoundary: string
}

export const BRI_SCOPE_CONTRACTS: Record<BriDossierScope, ScopeContract> = {
  bri: {
    title: 'Belt and Road, corridor by corridor',
    eyebrow: 'Five evidence areas · one non-joinable context lane',
    lede: 'Read source readiness for CPEC, Gwadar, CMEC, Kyaukpyu and Balochistan without turning announcements, national statistics or shared geography into project effects.',
    areaIds: null,
    countryCodes: ['CHN', 'PAK', 'MMR'],
    economicBoundary: 'National China, Pakistan and Myanmar context only—not a measure of Belt and Road causality.',
  },
  balochistan: {
    title: 'Balochistan is a plural record',
    eyebrow: 'Political economy · civic life · history · rights',
    lede: 'Resource governance and movement history remain separate evidence targets. No party, community, civic campaign, armed organization, allegation or legal designation inherits another category.',
    areaIds: ['balochistan'],
    countryCodes: ['PAK'],
    economicBoundary: 'Pakistan national context only. These rows are not Balochistan-specific and cannot establish a local project, movement or conflict effect.',
  },
  'pakistan-gwadar': {
    title: 'Pakistan and Gwadar, from portfolio to local services',
    eyebrow: 'CPEC · port and free zone · connectivity · public services',
    lede: 'Follow each target through its missing contracts, finance, ownership, employment, land, livelihood, environment and operating-status evidence.',
    areaIds: ['cpec', 'gwadar'],
    countryCodes: ['PAK'],
    economicBoundary: 'Pakistan national context only—not evidence that CPEC or Gwadar caused a national change.',
  },
  myanmar: {
    title: 'Myanmar corridor context',
    eyebrow: 'CMEC · Kyaukpyu · national economics',
    lede: 'Inspect the CMEC and Kyaukpyu source ledger before entering NarcoScope’s separate drug, cultivation and conflict view below.',
    areaIds: ['cmec', 'kyaukpyu'],
    countryCodes: ['MMR'],
    economicBoundary: 'Myanmar national context only—not evidence of a CMEC or Kyaukpyu project effect.',
  },
}

export type BriDossierSelection = {
  contract: ScopeContract
  areas: BriArea[]
  countries: BriEconomicCountry[]
  sources: BriTargetSource[]
  targetCount: number
  sourceCount: number
  buildReadySourceCount: number
  economicTotals: {
    sourceRows: number
    observedRows: number
    forecastRows: number
    unavailableRows: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`BRI context ${label} must be an object`)
  return value
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`BRI context ${label} must be a non-empty string`)
  }
}

function requireCount(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`BRI context ${label} must be a non-negative integer`)
  }
}

function requireStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new Error(`BRI context ${label} must be a string array`)
  }
}

function requireHttpsUrl(value: unknown, label: string): asserts value is string {
  requireString(value, label)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`BRI context ${label} must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`BRI context ${label} must be an HTTPS URL`)
}

/**
 * The API verifies the complete JSON Schema and artifact hash. This second,
 * browser-side boundary validates every nested field the dossier renders so a
 * damaged response becomes the explicit unavailable state rather than a
 * partial card, an invented zero, or a render-time exception.
 */
function assertRenderedBriContract(context: Record<string, unknown>): void {
  requireString(context.dataAsOf, 'dataAsOf')

  const readiness = requireRecord(context.sourceReadiness, 'sourceReadiness')
  requireCount(readiness.sourceCount, 'sourceReadiness.sourceCount')
  requireCount(readiness.buildReadySourceCount, 'sourceReadiness.buildReadySourceCount')

  if (!Array.isArray(context.targetCoverage)) throw new Error('BRI context targetCoverage must be an array')
  const areaIds = new Set<string>()
  context.targetCoverage.forEach((candidate, areaIndex) => {
    const area = requireRecord(candidate, `targetCoverage[${areaIndex}]`)
    requireString(area.areaId, `targetCoverage[${areaIndex}].areaId`)
    requireString(area.label, `targetCoverage[${areaIndex}].label`)
    if (!Array.isArray(area.targets)) throw new Error(`BRI context targetCoverage[${areaIndex}].targets must be an array`)
    if (areaIds.has(area.areaId)) throw new Error(`BRI context repeats target area ${area.areaId}`)
    areaIds.add(area.areaId)

    area.targets.forEach((candidateTarget, targetIndex) => {
      const prefix = `targetCoverage[${areaIndex}].targets[${targetIndex}]`
      const target = requireRecord(candidateTarget, prefix)
      for (const field of ['targetId', 'label', 'targetType', 'evidenceStatus']) {
        requireString(target[field], `${prefix}.${field}`)
      }
      requireStringArray(target.requiredCoverage, `${prefix}.requiredCoverage`)
      const targetReadiness = requireRecord(target.sourceReadiness, `${prefix}.sourceReadiness`)
      requireCount(targetReadiness.sourceCount, `${prefix}.sourceReadiness.sourceCount`)
      requireCount(targetReadiness.buildReadySourceCount, `${prefix}.sourceReadiness.buildReadySourceCount`)
      requireRecord(targetReadiness.implementationStates, `${prefix}.sourceReadiness.implementationStates`)
      if (!Array.isArray(target.sources)) throw new Error(`BRI context ${prefix}.sources must be an array`)
      if (target.sources.length !== targetReadiness.sourceCount) {
        throw new Error(`BRI context ${prefix} source count does not match its ledger`)
      }

      target.sources.forEach((candidateSource, sourceIndex) => {
        const sourcePrefix = `${prefix}.sources[${sourceIndex}]`
        const source = requireRecord(candidateSource, sourcePrefix)
        for (const field of ['sourceId', 'implementationState', 'sourceClass', 'authorityRole', 'rightsStatus']) {
          requireString(source[field], `${sourcePrefix}.${field}`)
        }
        requireStringArray(source.claimClasses, `${sourcePrefix}.claimClasses`)
      })
    })
  })
  for (const areaId of ['cpec', 'gwadar', 'cmec', 'kyaukpyu', 'balochistan']) {
    if (!areaIds.has(areaId)) throw new Error(`BRI context is missing target area ${areaId}`)
  }

  const economics = requireRecord(context.economicContext, 'economicContext')
  const economicSource = requireRecord(economics.source, 'economicContext.source')
  for (const field of ['name', 'publisher', 'attribution']) requireString(economicSource[field], `economicContext.source.${field}`)
  requireHttpsUrl(economicSource.catalogUrl, 'economicContext.source.catalogUrl')
  const economicRights = requireRecord(economics.rights, 'economicContext.rights')
  for (const field of ['license', 'redistributionStatus', 'attribution']) requireString(economicRights[field], `economicContext.rights.${field}`)
  requireHttpsUrl(economicRights.licenseUrl, 'economicContext.rights.licenseUrl')
  const economicClocks = requireRecord(economics.clocks, 'economicContext.clocks')
  for (const field of ['generatedAt', 'datasetLastUpdated', 'retrievedAt']) requireString(economicClocks[field], `economicContext.clocks.${field}`)
  const contextPolicy = requireRecord(economics.contextPolicy, 'economicContext.contextPolicy')
  for (const field of ['aggregateLevel', 'scope', 'causalityBoundary', 'missingValuePolicy']) requireString(contextPolicy[field], `economicContext.contextPolicy.${field}`)
  const coverage = requireRecord(economics.coverage, 'economicContext.coverage')
  if (!Array.isArray(coverage.countries)) throw new Error('BRI context economicContext.coverage.countries must be an array')
  const countryCodes = new Set<string>()
  coverage.countries.forEach((candidate, countryIndex) => {
    const prefix = `economicContext.coverage.countries[${countryIndex}]`
    const country = requireRecord(candidate, prefix)
    requireString(country.countryCode, `${prefix}.countryCode`)
    requireString(country.country, `${prefix}.country`)
    for (const field of ['indicatorCount', 'sourceRowCount', 'observedRowCount', 'forecastRowCount', 'unavailableRowCount']) {
      requireCount(country[field], `${prefix}.${field}`)
    }
    if (Number(country.observedRowCount) + Number(country.forecastRowCount) + Number(country.unavailableRowCount) !== Number(country.sourceRowCount)) {
      throw new Error(`BRI context ${prefix} row states do not reconcile`)
    }
    if (countryCodes.has(country.countryCode)) throw new Error(`BRI context repeats country ${country.countryCode}`)
    countryCodes.add(country.countryCode)
  })
  for (const countryCode of ['CHN', 'PAK', 'MMR']) {
    if (!countryCodes.has(countryCode)) throw new Error(`BRI context is missing country ${countryCode}`)
  }

  requireStringArray(context.limitations, 'limitations')
  const policy = requireRecord(context.usePolicy, 'usePolicy')
  requireString(policy.lane, 'usePolicy.lane')
  requireString(policy.allowedUse, 'usePolicy.allowedUse')
  requireString(policy.displayRelationship, 'usePolicy.displayRelationship')
  const prohibitions = requireRecord(policy.prohibitions, 'usePolicy.prohibitions')
  if (!Object.keys(prohibitions).length || Object.values(prohibitions).some((state) => state !== 'prohibited')) {
    throw new Error('BRI context usePolicy.prohibitions must remain prohibited')
  }

  const provenance = requireRecord(context.provenance, 'provenance')
  requireString(provenance.producer, 'provenance.producer')
  const release = requireRecord(provenance.release, 'provenance.release')
  for (const field of ['verificationState', 'deploymentId', 'sourceRevision', 'verifiedAt', 'verificationSemantics']) {
    requireString(release[field], `provenance.release.${field}`)
  }
  requireHttpsUrl(release.railwayMirrorBaseUrl, 'provenance.release.railwayMirrorBaseUrl')
  const sourceArtifacts = requireRecord(provenance.sourceArtifacts, 'provenance.sourceArtifacts')
  for (const artifactName of ['observatory', 'economics']) {
    const sourceArtifact = requireRecord(sourceArtifacts[artifactName], `provenance.sourceArtifacts.${artifactName}`)
    requireHttpsUrl(sourceArtifact.railwayMirrorUrl, `provenance.sourceArtifacts.${artifactName}.railwayMirrorUrl`)
    requireString(sourceArtifact.sha256, `provenance.sourceArtifacts.${artifactName}.sha256`)
  }
}

export function parseBriEnvelope(value: unknown): BriContext {
  if (!isRecord(value) || value.ok !== true || value.resource !== 'palimpsest-bri') {
    throw new Error('BRI response envelope is unavailable or invalid')
  }
  const outerData = value.data
  if (!isRecord(outerData) || outerData.schema !== 'narcoscope.api.palimpsest-bri-envelope.v1') {
    throw new Error('BRI response envelope schema is not supported')
  }
  const context = outerData.data
  if (!isRecord(context) || context.schemaVersion !== 'narcoscope.palimpsest.bri-context.v1') {
    throw new Error('BRI context artifact schema is not supported')
  }
  assertRenderedBriContract(context)
  const policy = context.usePolicy
  if (!isRecord(policy) || policy.crossLaneJoinPolicy !== 'prohibited') {
    throw new Error('BRI context did not preserve the prohibited cross-lane join')
  }
  if (!Array.isArray(context.targetCoverage) || !Array.isArray(context.limitations)) {
    throw new Error('BRI context is missing its coverage or limitation ledger')
  }
  return context as BriContext
}

let sharedRequest: Promise<BriContext> | null = null

async function requestBriContext(fetcher: typeof fetch): Promise<BriContext> {
  const response = await fetcher('/api/v1/palimpsest-bri', {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`BRI context request failed with HTTP ${response.status}`)
  return parseBriEnvelope(await response.json())
}

export function loadBriContext(fetcher: typeof fetch = globalThis.fetch): Promise<BriContext> {
  if (fetcher !== globalThis.fetch) return requestBriContext(fetcher)
  if (!sharedRequest) {
    sharedRequest = requestBriContext(fetcher).catch((error) => {
      sharedRequest = null
      throw error
    })
  }
  return sharedRequest
}

export function resetBriContextCacheForTests(): void {
  sharedRequest = null
}

export function selectBriDossier(context: BriContext, scope: BriDossierScope): BriDossierSelection {
  const contract = BRI_SCOPE_CONTRACTS[scope]
  const areaIds = contract.areaIds ? new Set(contract.areaIds) : null
  const countryCodes = new Set(contract.countryCodes)
  const areas = context.targetCoverage.filter((area) => !areaIds || areaIds.has(area.areaId))
  const countries = context.economicContext.coverage.countries.filter((country) => countryCodes.has(country.countryCode))
  const sourcesById = new Map<string, BriTargetSource>()

  for (const area of areas) {
    for (const target of area.targets) {
      for (const source of target.sources) sourcesById.set(source.sourceId, source)
    }
  }

  const sources = [...sourcesById.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  return {
    contract,
    areas,
    countries,
    sources,
    targetCount: areas.reduce((total, area) => total + area.targets.length, 0),
    sourceCount: scope === 'bri' ? context.sourceReadiness.sourceCount : sources.length,
    buildReadySourceCount: scope === 'bri'
      ? context.sourceReadiness.buildReadySourceCount
      : sources.filter((source) => ['live', 'adapter_ready'].includes(source.implementationState)).length,
    economicTotals: countries.reduce((totals, country) => ({
      sourceRows: totals.sourceRows + country.sourceRowCount,
      observedRows: totals.observedRows + country.observedRowCount,
      forecastRows: totals.forecastRows + country.forecastRowCount,
      unavailableRows: totals.unavailableRows + country.unavailableRowCount,
    }), { sourceRows: 0, observedRows: 0, forecastRows: 0, unavailableRows: 0 }),
  }
}

export function humanizeBriField(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
