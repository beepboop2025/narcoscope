import type {
  MmConflictEventRecord,
  MmFlowRecord,
  MmNode,
  MmPrecursorFlowRecord,
  MmRegionRecord,
} from '../types'
import { sourceReliabilityTier, sourceReliabilityWeight, type ReliabilityTier } from './sourceReliability'

export interface EvidenceNode {
  id: string
  label: string
  kind: 'region' | 'actor' | 'country' | 'precursor' | 'source'
  weight: number
  /** Only populated for `kind: 'source'` nodes. */
  reliability?: ReliabilityTier
}

export interface EvidenceEdge {
  from: string
  to: string
  relation: 'reports' | 'conflict_pressure' | 'precursor_inflow' | 'drug_outflow'
  weight: number
  sourceName?: string
  sourceUrl?: string
}

export type { ReliabilityTier }

/**
 * Verification tier follows the multi-source verification gate pattern used by
 * open OSINT pipelines (e.g. Splink-based cross-source entity resolution and
 * "at least two independent sources" claim gates): a region's fused evidence
 * is only as trustworthy as the number of independent source families behind it.
 */
export type VerificationTier = 'multi-source' | 'single-source' | 'unverified'

export interface RegionRiskProfile {
  region: string
  label: string
  year: number
  riskScore: number
  confidenceScore: number
  sourceDiversity: number
  evidenceCount: number
  conflictPressure: number
  precursorPressure: number
  outflowPressure: number
  syntheticActivity: number
  opiumHa: number
  drivers: string[]
  verificationTier: VerificationTier
  hasSourceConflict: boolean
  conflictNotes: string[]
  /** Mean reliability weight (0-1) of the distinct sources reporting on this region. */
  avgSourceReliability: number
}

export interface IntelligenceBriefing {
  year: number
  profiles: RegionRiskProfile[]
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
  enterpriseReadiness: {
    provenanceCoveragePct: number
    multiSourceRegions: number
    highRiskRegions: number
    evidenceRecords: number
    conflictedRegions: number
  }
}

/**
 * Threshold beyond which two independent-source quantity reports for the same
 * region/precursor/year are treated as disagreeing rather than as normal
 * reporting-window variance. Modelled after conflict-driven RAG summarization
 * (CARE-RAG): flag disagreement instead of silently averaging it away.
 */
const CONFLICT_RELATIVE_DEVIATION = 0.5
const SOURCE_CONFLICT_PENALTY = 15

function detectPrecursorConflicts(
  precursorFlows: MmPrecursorFlowRecord[],
): Map<string, string[]> {
  const notesByRegion = new Map<string, string[]>()
  const groups = new Map<string, MmPrecursorFlowRecord[]>()

  for (const flow of precursorFlows) {
    const key = `${flow.to}::${flow.precursor}`
    const bucket = groups.get(key) ?? []
    bucket.push(flow)
    groups.set(key, bucket)
  }

  for (const [key, flows] of groups) {
    const distinctSources = new Set(flows.map((f) => f.sourceName))
    if (distinctSources.size < 2) continue

    // Reliability-weighted mean: a well-established intergovernmental source
    // (e.g. UNODC, INCB) shouldn't be pulled 50/50 toward an unweighted
    // average with an unrecognised or low-tier source when they disagree.
    // This follows trust-weighted fusion practice from source-reliability
    // research (arXiv:2401.02379) rather than treating every source name as
    // equally authoritative.
    const weights = flows.map((f) => sourceReliabilityWeight(f.sourceName, f.sourceUrl))
    const totalWeight = weights.reduce((sum, w) => sum + w, 0)
    if (totalWeight <= 0) continue
    const weightedMean = flows.reduce((sum, f, i) => sum + f.quantityKg * weights[i], 0) / totalWeight
    if (weightedMean <= 0) continue
    const maxDeviation = Math.max(
      ...flows.map((f) => Math.abs(f.quantityKg - weightedMean) / weightedMean),
    )

    if (maxDeviation > CONFLICT_RELATIVE_DEVIATION) {
      const region = key.split('::')[0]
      const precursor = flows[0].precursor.replace(/_/g, ' ')
      const note = `${distinctSources.size} sources disagree on ${precursor} inflow (up to ${Math.round(maxDeviation * 100)}% spread)`
      const notes = notesByRegion.get(region) ?? []
      notes.push(note)
      notesByRegion.set(region, notes)
    }
  }

  return notesByRegion
}

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value))

const confidenceWeight = (confidence: MmPrecursorFlowRecord['confidence']): number => {
  if (confidence === 'official') return 1
  if (confidence === 'reported') return 0.78
  return 0.55
}

const normalizedShare = (value: number, max: number): number => (max > 0 ? (value / max) * 100 : 0)

export function buildMyanmarIntelligenceBriefing(input: {
  year: number
  regions: MmNode[]
  regionRecords: MmRegionRecord[]
  conflictEvents: MmConflictEventRecord[]
  precursorFlows: MmPrecursorFlowRecord[]
  outflows: MmFlowRecord[]
}): IntelligenceBriefing {
  const { year, regions } = input
  const regionRecords = input.regionRecords.filter((r) => r.year === year)
  const conflictEvents = input.conflictEvents.filter((r) => r.year === year)
  const precursorFlows = input.precursorFlows.filter((r) => r.year === year)
  const outflows = input.outflows.filter((r) => r.year === year)
  const labelByRegion = new Map(regions.map((r) => [r.id, r.label]))

  const precursorByRegion = new Map<string, number>()
  for (const flow of precursorFlows) {
    const weighted = flow.quantityKg * confidenceWeight(flow.confidence) * sourceReliabilityWeight(flow.sourceName, flow.sourceUrl)
    precursorByRegion.set(flow.to, (precursorByRegion.get(flow.to) ?? 0) + weighted)
  }

  const outflowByRegion = new Map<string, number>()
  for (const flow of outflows) {
    outflowByRegion.set(flow.from, (outflowByRegion.get(flow.from) ?? 0) + flow.quantityKg)
  }

  const conflictByRegion = new Map<string, number>()
  for (const event of conflictEvents) {
    conflictByRegion.set(event.region, Math.max(conflictByRegion.get(event.region) ?? 0, event.intensity))
  }

  const maxPrecursor = Math.max(0, ...precursorByRegion.values())
  const maxOutflow = Math.max(0, ...outflowByRegion.values())
  const maxOpium = Math.max(0, ...regionRecords.map((r) => r.opiumHa))
  const conflictNotesByRegion = detectPrecursorConflicts(precursorFlows)

  const profiles = regions.map((region) => {
    const stat = regionRecords.find((r) => r.region === region.id)
    const conflictPressure = conflictByRegion.get(region.id) ?? 0
    const precursorPressure = normalizedShare(precursorByRegion.get(region.id) ?? 0, maxPrecursor)
    const outflowPressure = normalizedShare(outflowByRegion.get(region.id) ?? 0, maxOutflow)
    const syntheticActivity = stat?.methIndex ?? 0
    const opiumHa = stat?.opiumHa ?? 0
    const opiumPressure = normalizedShare(opiumHa, maxOpium)

    const regionSources = new Set<string>()
    conflictEvents.filter((r) => r.region === region.id).forEach((r) => regionSources.add(r.sourceName))
    precursorFlows.filter((r) => r.to === region.id).forEach((r) => regionSources.add(r.sourceName))
    const evidenceCount =
      conflictEvents.filter((r) => r.region === region.id).length +
      precursorFlows.filter((r) => r.to === region.id).length +
      outflows.filter((r) => r.from === region.id).length +
      (stat ? 1 : 0)

    // Average reliability of the distinct source families backing this
    // region's evidence — corroboration from two high-reliability sources
    // should raise confidence more than corroboration from two low-tier ones.
    const regionSourceUrlByName = new Map<string, string | undefined>()
    conflictEvents.filter((r) => r.region === region.id).forEach((r) => regionSourceUrlByName.set(r.sourceName, r.sourceUrl))
    precursorFlows.filter((r) => r.to === region.id).forEach((r) => regionSourceUrlByName.set(r.sourceName, r.sourceUrl))
    const sourceReliabilityWeights = [...regionSources].map((name) =>
      sourceReliabilityWeight(name, regionSourceUrlByName.get(name)),
    )
    const avgSourceReliability = sourceReliabilityWeights.length
      ? sourceReliabilityWeights.reduce((sum, w) => sum + w, 0) / sourceReliabilityWeights.length
      : 0

    const riskScore = clamp(
      conflictPressure * 0.25 +
      precursorPressure * 0.25 +
      outflowPressure * 0.2 +
      syntheticActivity * 0.2 +
      opiumPressure * 0.1,
    )
    const conflictNotes = conflictNotesByRegion.get(region.id) ?? []
    const hasSourceConflict = conflictNotes.length > 0

    const confidenceScore = clamp(
      Math.min(100, evidenceCount * 16) * 0.45 +
      Math.min(100, regionSources.size * 34) * 0.35 * (0.5 + 0.5 * avgSourceReliability) +
      (stat ? 20 : 0) -
      (hasSourceConflict ? SOURCE_CONFLICT_PENALTY : 0),
    )

    const verificationTier: VerificationTier =
      regionSources.size >= 2 ? 'multi-source' : regionSources.size === 1 ? 'single-source' : 'unverified'

    const drivers = [
      [conflictPressure, 'conflict pressure'],
      [precursorPressure, 'inbound precursor pressure'],
      [outflowPressure, 'seized outbound flow'],
      [syntheticActivity, 'synthetic-drug activity'],
      [opiumPressure, 'opium cultivation'],
    ]
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .slice(0, 3)
      .map(([, label]) => String(label))

    return {
      region: region.id,
      label: labelByRegion.get(region.id) ?? region.id,
      year,
      riskScore: Math.round(riskScore),
      confidenceScore: Math.round(confidenceScore),
      sourceDiversity: regionSources.size,
      evidenceCount,
      conflictPressure: Math.round(conflictPressure),
      precursorPressure: Math.round(precursorPressure),
      outflowPressure: Math.round(outflowPressure),
      syntheticActivity: Math.round(syntheticActivity),
      opiumHa,
      drivers,
      verificationTier,
      hasSourceConflict,
      conflictNotes,
      avgSourceReliability: Math.round(avgSourceReliability * 100) / 100,
    }
  }).sort((a, b) => b.riskScore - a.riskScore)

  const { nodes, edges } = buildEvidenceGraph({ regions, conflictEvents, precursorFlows, outflows })
  const regionsWithProvenance = profiles.filter((p) => p.evidenceCount > 1 && p.sourceDiversity > 0).length
  const conflictedRegions = profiles.filter((p) => p.hasSourceConflict).length

  return {
    year,
    profiles,
    nodes,
    edges,
    enterpriseReadiness: {
      provenanceCoveragePct: regions.length ? Math.round((regionsWithProvenance / regions.length) * 100) : 0,
      multiSourceRegions: profiles.filter((p) => p.sourceDiversity >= 2).length,
      highRiskRegions: profiles.filter((p) => p.riskScore >= 70).length,
      evidenceRecords: conflictEvents.length + precursorFlows.length + outflows.length + regionRecords.length,
      conflictedRegions,
    },
  }
}

function buildEvidenceGraph(input: {
  regions: MmNode[]
  conflictEvents: MmConflictEventRecord[]
  precursorFlows: MmPrecursorFlowRecord[]
  outflows: MmFlowRecord[]
}): { nodes: EvidenceNode[]; edges: EvidenceEdge[] } {
  const nodeMap = new Map<string, EvidenceNode>()
  const edges: EvidenceEdge[] = []
  const upsert = (node: EvidenceNode) => {
    const existing = nodeMap.get(node.id)
    nodeMap.set(node.id, existing ? { ...existing, ...node, weight: Math.max(existing.weight, node.weight) } : node)
  }

  for (const region of input.regions) {
    upsert({ id: `region:${region.id}`, label: region.label, kind: 'region', weight: 1 })
  }

  for (const event of input.conflictEvents) {
    upsert({ id: `actor:${event.actor}`, label: event.actor, kind: 'actor', weight: event.intensity })
    upsert({
      id: `source:${event.sourceName}`,
      label: event.sourceName,
      kind: 'source',
      weight: 1,
      reliability: sourceReliabilityTier(event.sourceName, event.sourceUrl),
    })
    edges.push({
      from: `actor:${event.actor}`,
      to: `region:${event.region}`,
      relation: 'conflict_pressure',
      weight: event.intensity,
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
    })
    edges.push({
      from: `source:${event.sourceName}`,
      to: `actor:${event.actor}`,
      relation: 'reports',
      weight: 1,
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
    })
  }

  for (const flow of input.precursorFlows) {
    upsert({ id: `country:${flow.originCountry}`, label: flow.originCountry, kind: 'country', weight: flow.quantityKg })
    upsert({ id: `precursor:${flow.precursor}`, label: flow.precursor.replace(/_/g, ' '), kind: 'precursor', weight: flow.quantityKg })
    upsert({
      id: `source:${flow.sourceName}`,
      label: flow.sourceName,
      kind: 'source',
      weight: 1,
      reliability: sourceReliabilityTier(flow.sourceName, flow.sourceUrl),
    })
    const reliabilityWeight = sourceReliabilityWeight(flow.sourceName, flow.sourceUrl)
    edges.push({
      from: `country:${flow.originCountry}`,
      to: `region:${flow.to}`,
      relation: 'precursor_inflow',
      weight: flow.quantityKg * confidenceWeight(flow.confidence) * reliabilityWeight,
      sourceName: flow.sourceName,
      sourceUrl: flow.sourceUrl,
    })
    edges.push({
      from: `source:${flow.sourceName}`,
      to: `country:${flow.originCountry}`,
      relation: 'reports',
      weight: confidenceWeight(flow.confidence) * reliabilityWeight,
      sourceName: flow.sourceName,
      sourceUrl: flow.sourceUrl,
    })
  }

  for (const flow of input.outflows) {
    edges.push({
      from: `region:${flow.from}`,
      to: `region:${flow.to}`,
      relation: 'drug_outflow',
      weight: flow.quantityKg,
    })
  }

  return { nodes: [...nodeMap.values()], edges }
}
