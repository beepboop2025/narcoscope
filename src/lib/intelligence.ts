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

/**
 * Momentum signal: whether a region's underlying pressure (cultivation +
 * synthetic-drug activity + outbound seizures) is climbing, easing, or flat
 * relative to the nearest earlier year with data. A static point-in-time
 * score can rank two regions equally while one is trending sharply upward —
 * analysts prioritising review time need the trend, not just the level.
 * 'insufficient-data' means no earlier year exists for comparison, which is
 * itself a signal (not silently defaulted to "stable").
 */
export type RiskTrajectory = 'rising' | 'falling' | 'stable' | 'insufficient-data'

const TRAJECTORY_RELATIVE_THRESHOLD = 0.15

/**
 * Evidence-recency signal: how old the most recent record for a region is,
 * relative to the requested reporting year. Follows temporal-credibility
 * practice from OSINT/threat-intel fusion research — corroboration from two
 * years-stale reports shouldn't carry the same weight as current-year
 * reporting, since it decays in relevance the longer it goes uncorroborated
 * by anything newer (arXiv:2506.05780 staleness-aware fusion; temporal
 * credibility decay modelling for OSINT entity correlation). Reporting
 * cadence here is annual (public surveys/seizure reports), not daily, so
 * decay is modelled in report-years rather than a continuous half-life.
 */
export type EvidenceStaleness = 'current' | 'aging' | 'stale' | 'no-data'

/** Age (in years) at/above which evidence is treated as stale rather than merely aging. */
const STALE_EVIDENCE_AGE_YEARS = 3
/** Age (in years) at/above which current-year evidence starts to be treated as aging. */
const AGING_EVIDENCE_AGE_YEARS = 1
const STALE_EVIDENCE_CONFIDENCE_PENALTY = 12
const AGING_EVIDENCE_CONFIDENCE_PENALTY = 4

/**
 * Corridor-concentration signal: how dependent a region's *inbound* precursor
 * supply is on a single origin/transit corridor, measured with the
 * Herfindahl-Hirschman Index (HHI) — the standard concentration metric from
 * antitrust/supply-chain-risk analysis (US DOJ/FTC Horizontal Merger
 * Guidelines thresholds: <1500 unconcentrated, 1500-2500 moderately
 * concentrated, >2500 highly concentrated on a 0-10000 scale). Applied here to
 * trafficking corridors rather than market share: a region sourcing
 * precursors from one corridor is both more fragile (a single seizure or
 * border closure can choke its supply) and a sharper interdiction target than
 * one with diversified sourcing. Deliberately computed on raw reported
 * quantities (not reliability- or confidence-weighted) since concentration is
 * a property of the reported trade pattern itself, not of how much we trust
 * any one report.
 */
export type CorridorConcentrationTier = 'diversified' | 'moderate' | 'concentrated' | 'insufficient-data'

const HHI_MODERATE_THRESHOLD = 1500
const HHI_CONCENTRATED_THRESHOLD = 2500

function corridorConcentrationTier(hhi: number | null): CorridorConcentrationTier {
  if (hhi === null) return 'insufficient-data'
  if (hhi > HHI_CONCENTRATED_THRESHOLD) return 'concentrated'
  if (hhi >= HHI_MODERATE_THRESHOLD) return 'moderate'
  return 'diversified'
}

/**
 * Computes inbound-precursor corridor concentration for one region: groups
 * this region's precursor-flow records by (originCountry, transitCountry)
 * corridor, sums raw quantityKg per corridor, and returns the HHI (0-10000)
 * plus the dominant corridor's label and share. Returns nulls when the region
 * has no precursor-flow records for the year (nothing to concentrate).
 */
function computeCorridorConcentration(
  region: string,
  precursorFlows: MmPrecursorFlowRecord[],
): { hhi: number | null; dominantCorridor: string | null; dominantSharePct: number | null } {
  const byCorridor = new Map<string, number>()
  for (const flow of precursorFlows) {
    if (flow.to !== region) continue
    const key = flow.transitCountry ? `${flow.originCountry} → ${flow.transitCountry}` : flow.originCountry
    byCorridor.set(key, (byCorridor.get(key) ?? 0) + flow.quantityKg)
  }
  const total = [...byCorridor.values()].reduce((sum, qty) => sum + qty, 0)
  if (total <= 0) return { hhi: null, dominantCorridor: null, dominantSharePct: null }

  let hhi = 0
  let dominantCorridor: string | null = null
  let dominantShare = 0
  for (const [corridor, qty] of byCorridor) {
    const share = qty / total
    hhi += share * share * 10_000
    if (share > dominantShare) {
      dominantShare = share
      dominantCorridor = corridor
    }
  }
  return {
    hhi: Math.round(hhi),
    dominantCorridor,
    dominantSharePct: Math.round(dominantShare * 1000) / 10,
  }
}

function evidenceStalenessTier(ageYears: number | null): EvidenceStaleness {
  if (ageYears === null) return 'no-data'
  if (ageYears >= STALE_EVIDENCE_AGE_YEARS) return 'stale'
  if (ageYears >= AGING_EVIDENCE_AGE_YEARS) return 'aging'
  return 'current'
}

/**
 * Finds the most recent year (at or before the requested reporting year)
 * with any evidence record for a region, across all evidence types. Looks at
 * full (unfiltered) history, since a region's freshest evidence may predate
 * the requested year by design (e.g. reviewing 2022 data for a 2024 report).
 */
function mostRecentEvidenceYear(
  region: string,
  year: number,
  allRegionRecords: MmRegionRecord[],
  allConflictEvents: MmConflictEventRecord[],
  allPrecursorFlows: MmPrecursorFlowRecord[],
  allOutflows: MmFlowRecord[],
): number | null {
  let latest: number | null = null
  const consider = (recordYear: number) => {
    if (recordYear > year) return
    if (latest === null || recordYear > latest) latest = recordYear
  }
  allRegionRecords.filter((r) => r.region === region).forEach((r) => consider(r.year))
  allConflictEvents.filter((r) => r.region === region).forEach((r) => consider(r.year))
  allPrecursorFlows.filter((r) => r.to === region).forEach((r) => consider(r.year))
  allOutflows.filter((r) => r.from === region).forEach((r) => consider(r.year))
  return latest
}

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
  /** Year-over-year momentum of underlying pressure, vs. the nearest earlier data year. */
  trajectory: RiskTrajectory
  /** Relative change (e.g. 0.22 = +22%) driving `trajectory`; null when insufficient-data. */
  trajectoryChangePct: number | null
  /** Nearest earlier year used for the trajectory comparison; null when none exists. */
  trajectoryBaselineYear: number | null
  /** Highest riskScore among administratively adjacent regions (0 if none/no adjacency data). */
  neighborRiskScore: number
  /** The adjacent region id driving `neighborRiskScore`; null when no neighbors have data. */
  neighborRegion: string | null
  /**
   * True when this region's own risk score is not yet "high" but a bordering
   * region is, per armed-conflict spatial-diffusion research (spillover/
   * contagion effects decay with distance but are strongest at shared
   * borders — arXiv:2504.03464, arXiv:2506.14817). An early-warning signal
   * distinct from the region's own evidence-driven riskScore.
   */
  spilloverWatch: boolean
  /** Most recent year (<= reporting year) with any evidence record for this region; null if none. */
  mostRecentEvidenceYear: number | null
  /** Years between `mostRecentEvidenceYear` and the reporting year; null when there's no evidence at all. */
  evidenceAgeYears: number | null
  /** Recency tier for the region's freshest evidence, driving a confidence penalty when stale. */
  evidenceStaleness: EvidenceStaleness
  /** Herfindahl-Hirschman Index (0-10000) of inbound precursor-corridor concentration; null when no corridor data. */
  precursorCorridorHHI: number | null
  /** Concentration tier derived from `precursorCorridorHHI` using DOJ/FTC-style thresholds. */
  precursorCorridorTier: CorridorConcentrationTier
  /** Label of the corridor carrying the largest share of this region's inbound precursor supply. */
  dominantPrecursorCorridor: string | null
  /** Share (percent) of inbound precursor supply carried by `dominantPrecursorCorridor`. */
  dominantPrecursorCorridorSharePct: number | null
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
    risingRegions: number
    spilloverWatchRegions: number
    staleRegions: number
    concentratedCorridorRegions: number
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

/** riskScore at/above this level counts as "high risk" for spillover comparison. */
const SPILLOVER_HIGH_RISK_THRESHOLD = 70
/** Minimum gap between a region's own score and its highest-risk neighbor to flag spillover watch. */
const SPILLOVER_GAP_THRESHOLD = 15

/**
 * Generic reliability-weighted disagreement check shared by precursor-flow
 * and conflict-event corroboration: groups records by key, computes a
 * source-reliability-weighted mean of `valueOf(record)`, and flags the group
 * when any record deviates from that mean by more than
 * `CONFLICT_RELATIVE_DEVIATION`. Kept generic (rather than duplicated per
 * evidence type) so new evidence types get the same trust-weighted
 * corroboration gate for free.
 */
function detectWeightedDisagreement<T>(
  records: T[],
  keyOf: (record: T) => string,
  valueOf: (record: T) => number,
  sourceNameOf: (record: T) => string,
  sourceUrlOf: (record: T) => string | undefined,
  noteFor: (key: string, distinctSources: number, maxDeviationPct: number) => { region: string; note: string },
): Map<string, string[]> {
  const notesByRegion = new Map<string, string[]>()
  const groups = new Map<string, T[]>()

  for (const record of records) {
    const key = keyOf(record)
    const bucket = groups.get(key) ?? []
    bucket.push(record)
    groups.set(key, bucket)
  }

  for (const [key, group] of groups) {
    const distinctSources = new Set(group.map(sourceNameOf))
    if (distinctSources.size < 2) continue

    // Reliability-weighted mean: a well-established intergovernmental source
    // (e.g. UNODC, INCB, ACLED) shouldn't be pulled 50/50 toward an
    // unweighted average with an unrecognised or low-tier source when they
    // disagree. This follows trust-weighted fusion practice from
    // source-reliability research (arXiv:2401.02379) rather than treating
    // every source name as equally authoritative.
    const weights = group.map((r) => sourceReliabilityWeight(sourceNameOf(r), sourceUrlOf(r)))
    const totalWeight = weights.reduce((sum, w) => sum + w, 0)
    if (totalWeight <= 0) continue
    const weightedMean = group.reduce((sum, r, i) => sum + valueOf(r) * weights[i], 0) / totalWeight
    if (weightedMean <= 0) continue
    const maxDeviation = Math.max(
      ...group.map((r) => Math.abs(valueOf(r) - weightedMean) / weightedMean),
    )

    if (maxDeviation > CONFLICT_RELATIVE_DEVIATION) {
      const { region, note } = noteFor(key, distinctSources.size, Math.round(maxDeviation * 100))
      const notes = notesByRegion.get(region) ?? []
      notes.push(note)
      notesByRegion.set(region, notes)
    }
  }

  return notesByRegion
}

function detectPrecursorConflicts(
  precursorFlows: MmPrecursorFlowRecord[],
): Map<string, string[]> {
  return detectWeightedDisagreement(
    precursorFlows,
    (f) => `${f.to}::${f.precursor}`,
    (f) => f.quantityKg,
    (f) => f.sourceName,
    (f) => f.sourceUrl,
    (key, distinctSources, maxDeviationPct) => {
      const [region, precursorId] = key.split('::')
      const precursor = precursorId.replace(/_/g, ' ')
      return {
        region,
        note: `${distinctSources} sources disagree on ${precursor} inflow (up to ${maxDeviationPct}% spread)`,
      }
    },
  )
}

/**
 * Cross-source disagreement check for conflict-pressure reporting: when two+
 * independent sources report materially different intensity for the same
 * region and event type, that disagreement is surfaced as an explicit note
 * (and confidence penalty) rather than silently averaged away — the same
 * multi-source verification gate already applied to precursor-flow evidence,
 * extended to the conflict-pressure layer.
 */
function detectConflictEventConflicts(
  conflictEvents: MmConflictEventRecord[],
): Map<string, string[]> {
  return detectWeightedDisagreement(
    conflictEvents,
    (e) => `${e.region}::${e.eventType}`,
    (e) => e.intensity,
    (e) => e.sourceName,
    (e) => e.sourceUrl,
    (key, distinctSources, maxDeviationPct) => {
      const [region, eventType] = key.split('::')
      return {
        region,
        note: `${distinctSources} sources disagree on ${eventType.replace(/_/g, ' ')} intensity (up to ${maxDeviationPct}% spread)`,
      }
    },
  )
}

function mergeNoteMaps(...maps: Array<Map<string, string[]>>): Map<string, string[]> {
  const merged = new Map<string, string[]>()
  for (const map of maps) {
    for (const [region, notes] of map) {
      const existing = merged.get(region) ?? []
      merged.set(region, [...existing, ...notes])
    }
  }
  return merged
}

/**
 * Per-region, per-year momentum index combining cultivation, synthetic-drug
 * activity, and outbound seized quantity. Deliberately additive on raw
 * (non-normalized) magnitudes so the comparison is a straightforward
 * "same yardstick, different year" — normalizing per-year would make the
 * index incomparable across years since the max used for normalization
 * would itself shift.
 */
function momentumIndex(
  region: string,
  year: number,
  regionRecords: MmRegionRecord[],
  outflows: MmFlowRecord[],
): number {
  const stat = regionRecords.find((r) => r.region === region && r.year === year)
  const outflowTotal = outflows
    .filter((f) => f.from === region && f.year === year)
    .reduce((sum, f) => sum + f.quantityKg, 0)
  return (stat?.opiumHa ?? 0) * 0.01 + (stat?.methIndex ?? 0) * 10 + outflowTotal * 0.1
}

/**
 * Finds the trajectory of a region's momentum index vs. the nearest earlier
 * year that has any data for that region, across the full (unfiltered by
 * requested year) history — not just year-1, since annual public reporting
 * frequently skips years.
 */
function computeTrajectory(
  region: string,
  year: number,
  allRegionRecords: MmRegionRecord[],
  allOutflows: MmFlowRecord[],
): { trajectory: RiskTrajectory; changePct: number | null; baselineYear: number | null } {
  const priorYears = new Set<number>()
  allRegionRecords.filter((r) => r.region === region && r.year < year).forEach((r) => priorYears.add(r.year))
  allOutflows.filter((f) => f.from === region && f.year < year).forEach((f) => priorYears.add(f.year))

  if (priorYears.size === 0) {
    return { trajectory: 'insufficient-data', changePct: null, baselineYear: null }
  }

  const baselineYear = Math.max(...priorYears)
  const current = momentumIndex(region, year, allRegionRecords, allOutflows)
  const baseline = momentumIndex(region, baselineYear, allRegionRecords, allOutflows)

  if (baseline <= 0) {
    return { trajectory: current > 0 ? 'rising' : 'insufficient-data', changePct: null, baselineYear }
  }

  const changePct = (current - baseline) / baseline
  const trajectory: RiskTrajectory =
    changePct > TRAJECTORY_RELATIVE_THRESHOLD
      ? 'rising'
      : changePct < -TRAJECTORY_RELATIVE_THRESHOLD
        ? 'falling'
        : 'stable'

  return { trajectory, changePct: Math.round(changePct * 1000) / 1000, baselineYear }
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
  /** Region-id -> bordering region-ids. Optional; spillover fields default to inert when omitted. */
  regionAdjacency?: Record<string, string[]>
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
  const conflictNotesByRegion = mergeNoteMaps(
    detectPrecursorConflicts(precursorFlows),
    detectConflictEventConflicts(conflictEvents),
  )

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

    const { trajectory, changePct: trajectoryChangePct, baselineYear: trajectoryBaselineYear } = computeTrajectory(
      region.id,
      year,
      input.regionRecords,
      input.outflows,
    )

    const evidenceYear = mostRecentEvidenceYear(
      region.id,
      year,
      input.regionRecords,
      input.conflictEvents,
      input.precursorFlows,
      input.outflows,
    )
    const evidenceAgeYears = evidenceYear === null ? null : year - evidenceYear
    const evidenceStaleness = evidenceStalenessTier(evidenceAgeYears)
    const stalenessPenalty =
      evidenceStaleness === 'stale'
        ? STALE_EVIDENCE_CONFIDENCE_PENALTY
        : evidenceStaleness === 'aging'
          ? AGING_EVIDENCE_CONFIDENCE_PENALTY
          : 0

    const confidenceScore = clamp(
      Math.min(100, evidenceCount * 16) * 0.45 +
      Math.min(100, regionSources.size * 34) * 0.35 * (0.5 + 0.5 * avgSourceReliability) +
      (stat ? 20 : 0) -
      (hasSourceConflict ? SOURCE_CONFLICT_PENALTY : 0) -
      stalenessPenalty,
    )

    const verificationTier: VerificationTier =
      regionSources.size >= 2 ? 'multi-source' : regionSources.size === 1 ? 'single-source' : 'unverified'

    const { hhi: precursorCorridorHHI, dominantCorridor: dominantPrecursorCorridor, dominantSharePct: dominantPrecursorCorridorSharePct } =
      computeCorridorConcentration(region.id, precursorFlows)
    const precursorCorridorTier = corridorConcentrationTier(precursorCorridorHHI)

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
      trajectory,
      trajectoryChangePct,
      trajectoryBaselineYear,
      mostRecentEvidenceYear: evidenceYear,
      evidenceAgeYears,
      evidenceStaleness,
      precursorCorridorHHI,
      precursorCorridorTier,
      dominantPrecursorCorridor,
      dominantPrecursorCorridorSharePct,
      // Filled in below, once every region's own riskScore is known.
      neighborRiskScore: 0,
      neighborRegion: null as string | null,
      spilloverWatch: false,
    }
  })

  // Spillover pass: a region's own evidence can look calm while a bordering
  // region is hot. Spatial-diffusion research on armed conflict finds spread
  // effects concentrated at shared borders and decaying with distance
  // (arXiv:2504.03464 spatiotemporal spillover/carryover causal inference;
  // arXiv:2506.14817 grid-resolution conflict forecasting that jointly learns
  // spatial contagion). This is a second pass over already-scored regions —
  // it never affects a region's own riskScore, only an explicit watch flag.
  const riskByRegion = new Map(profiles.map((p) => [p.region, p.riskScore]))
  const adjacency = input.regionAdjacency ?? {}
  for (const profile of profiles) {
    const neighbors = adjacency[profile.region] ?? []
    let neighborRiskScore = 0
    let neighborRegion: string | null = null
    for (const neighborId of neighbors) {
      const score = riskByRegion.get(neighborId)
      if (score !== undefined && score > neighborRiskScore) {
        neighborRiskScore = score
        neighborRegion = neighborId
      }
    }
    profile.neighborRiskScore = neighborRiskScore
    profile.neighborRegion = neighborRegion
    profile.spilloverWatch =
      neighborRiskScore >= SPILLOVER_HIGH_RISK_THRESHOLD &&
      profile.riskScore < SPILLOVER_HIGH_RISK_THRESHOLD &&
      neighborRiskScore - profile.riskScore >= SPILLOVER_GAP_THRESHOLD
  }

  profiles.sort((a, b) => b.riskScore - a.riskScore)

  const { nodes, edges } = buildEvidenceGraph({ regions, conflictEvents, precursorFlows, outflows })
  const regionsWithProvenance = profiles.filter((p) => p.evidenceCount > 1 && p.sourceDiversity > 0).length
  const conflictedRegions = profiles.filter((p) => p.hasSourceConflict).length
  const spilloverWatchRegions = profiles.filter((p) => p.spilloverWatch).length
  const staleRegions = profiles.filter((p) => p.evidenceStaleness === 'stale').length
  const concentratedCorridorRegions = profiles.filter((p) => p.precursorCorridorTier === 'concentrated').length

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
      risingRegions: profiles.filter((p) => p.trajectory === 'rising').length,
      spilloverWatchRegions,
      staleRegions,
      concentratedCorridorRegions,
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
