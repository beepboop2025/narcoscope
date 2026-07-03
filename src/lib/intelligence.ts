import type {
  MmConflictEventRecord,
  MmFlowRecord,
  MmNode,
  MmPrecursorFlowRecord,
  MmRegionRecord,
} from '../types'
import { canonicalSourceId, sourceReliabilityTier, sourceReliabilityWeight, type ReliabilityTier } from './sourceReliability'

export interface EvidenceNode {
  id: string
  label: string
  kind: 'region' | 'actor' | 'country' | 'precursor' | 'source' | 'corridor'
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

/**
 * Outbound-corridor concentration: the same HHI treatment as inbound
 * precursor corridors, applied to a region's *outbound* seized-drug
 * corridors (which border town/exit point carries its outflow). A region
 * whose entire outbound volume clears through one border town is a sharper,
 * higher-leverage interdiction target — and a single closure/crackdown there
 * would fully choke its export route — than one spread across several exits.
 */
function computeOutflowCorridorConcentration(
  region: string,
  outflows: MmFlowRecord[],
): { hhi: number | null; dominantCorridor: string | null; dominantSharePct: number | null } {
  const byCorridor = new Map<string, number>()
  for (const flow of outflows) {
    if (flow.from !== region) continue
    byCorridor.set(flow.to, (byCorridor.get(flow.to) ?? 0) + flow.quantityKg)
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

/**
 * A border/exit-corridor town whose disruption would affect the trafficking
 * network as a whole, not just one region's supply — distinct from
 * `outflowCorridorTier`'s region-scoped HHI. A region can have a diversified
 * outbound HHI (several exit towns) while still routing through a node that
 * *other* regions also depend on; conversely a region can be "concentrated"
 * on a corridor town that, network-wide, carries only a small share of total
 * volume. Modelled on graph centrality / chokepoint-detection practice for
 * supply-chain risk (arXiv:2510.01115 exploits network centrality over a
 * supply-chain knowledge graph to surface economically salient bottleneck
 * nodes) applied here to seizure-reported drug-outflow corridors: a node is
 * flagged systemic when it serves 2+ distinct source regions or carries an
 * outsized share of total network-wide outbound volume.
 */
export interface CorridorChokepoint {
  corridor: string
  label: string
  totalQuantityKg: number
  regionsServed: number
  sharePctOfTotalOutflow: number
  systemicChokepoint: boolean
}

/** Regions served by a corridor at/above this count already indicates network-wide dependency. */
const CHOKEPOINT_MIN_REGIONS_SERVED = 2
/** Share of total network outbound volume at/above which a single-region corridor still counts as systemic. */
const CHOKEPOINT_SHARE_THRESHOLD_PCT = 40

/**
 * Computes systemic chokepoint risk across all outbound corridors (border/
 * exit towns), independent of any single region's own corridor-concentration
 * score. Groups outflow records by `to` (the corridor town), sums raw
 * quantityKg, counts distinct source regions per corridor, and flags a
 * corridor as a systemic chokepoint when either (a) it serves multiple
 * regions — so one closure/crackdown there degrades several regions' export
 * capacity at once — or (b) it alone carries an outsized share of total
 * network-wide outbound volume, even if only one region uses it.
 */
function computeCorridorChokepoints(
  outflows: MmFlowRecord[],
  labelByRegion: Map<string, string>,
): CorridorChokepoint[] {
  const byCorridor = new Map<string, { totalQuantityKg: number; regions: Set<string> }>()
  for (const flow of outflows) {
    const entry = byCorridor.get(flow.to) ?? { totalQuantityKg: 0, regions: new Set<string>() }
    entry.totalQuantityKg += flow.quantityKg
    entry.regions.add(flow.from)
    byCorridor.set(flow.to, entry)
  }
  const totalNetworkOutflow = [...byCorridor.values()].reduce((sum, e) => sum + e.totalQuantityKg, 0)
  if (totalNetworkOutflow <= 0) return []

  const chokepoints: CorridorChokepoint[] = [...byCorridor.entries()].map(([corridor, entry]) => {
    const sharePctOfTotalOutflow = Math.round((entry.totalQuantityKg / totalNetworkOutflow) * 1000) / 10
    return {
      corridor,
      label: labelByRegion.get(corridor) ?? corridor,
      totalQuantityKg: entry.totalQuantityKg,
      regionsServed: entry.regions.size,
      sharePctOfTotalOutflow,
      systemicChokepoint:
        entry.regions.size >= CHOKEPOINT_MIN_REGIONS_SERVED || sharePctOfTotalOutflow >= CHOKEPOINT_SHARE_THRESHOLD_PCT,
    }
  })
  chokepoints.sort((a, b) => b.totalQuantityKg - a.totalQuantityKg)
  return chokepoints
}

/** riskScore at/above this level is "high risk" for the single-source-fragility check. */
const FRAGILITY_HIGH_RISK_THRESHOLD = 70

export interface SingleSourceFragility {
  fragile: boolean
  /** Independent source family whose removal alone would flip the region below high-risk; null unless fragile. */
  family: string | null
  /** riskScore points that would be lost if `family` were removed; null unless fragile. */
  scoreDrop: number | null
}

/**
 * Leave-one-source-family-out sensitivity check: even a "multi-source"
 * region (per `verificationTier`) can have its numeric risk score
 * effectively carried by one dominant reporter if that source's reported
 * volume dwarfs the others'. This recomputes the region's inbound-precursor
 * and outbound-seizure pressure with each independent source family's
 * contribution removed in turn, holding conflict/synthetic/opium pressure
 * fixed, and flags the region when losing its single largest contributor
 * alone would drop it out of the high-risk tier — a fragility signal that
 * `verificationTier`'s source *count* can miss entirely. Standard
 * leave-one-out robustness practice applied to multi-source evidence fusion
 * instead of statistical model validation.
 */
function computeSingleSourceFragility(input: {
  /** The rounded, displayed risk score (`profile.riskScore`), so the high-risk gate here matches the tiering used everywhere else. */
  riskScore: number
  conflictPressure: number
  syntheticActivity: number
  opiumPressure: number
  maxPrecursor: number
  maxOutflow: number
  regionPrecursorFlows: MmPrecursorFlowRecord[]
  regionOutflows: MmFlowRecord[]
}): SingleSourceFragility {
  const {
    riskScore,
    conflictPressure,
    syntheticActivity,
    opiumPressure,
    maxPrecursor,
    maxOutflow,
    regionPrecursorFlows,
    regionOutflows,
  } = input

  if (riskScore < FRAGILITY_HIGH_RISK_THRESHOLD) {
    return { fragile: false, family: null, scoreDrop: null }
  }

  const totalPrecursorWeighted = regionPrecursorFlows.reduce(
    (sum, f) => sum + f.quantityKg * confidenceWeight(f.confidence) * sourceReliabilityWeight(f.sourceName, f.sourceUrl),
    0,
  )
  const totalOutflowQty = regionOutflows.reduce((sum, f) => sum + f.quantityKg, 0)

  const precursorByFamily = new Map<string, number>()
  for (const flow of regionPrecursorFlows) {
    const family = canonicalSourceId(flow.sourceName, flow.sourceUrl)
    const weighted = flow.quantityKg * confidenceWeight(flow.confidence) * sourceReliabilityWeight(flow.sourceName, flow.sourceUrl)
    precursorByFamily.set(family, (precursorByFamily.get(family) ?? 0) + weighted)
  }
  // Un-attributed outflow rows (legacy CSVs without provenance) are not a
  // source family — the rest of the module never counts them toward source
  // diversity or disagreement checks, so they must not become a removable
  // pseudo-family here either. They stay in `totalOutflowQty` (the evidence
  // exists) but can never be named as the fragile reporter.
  const outflowByFamily = new Map<string, number>()
  for (const flow of regionOutflows) {
    if (!flow.sourceName) continue
    const family = canonicalSourceId(flow.sourceName, flow.sourceUrl)
    outflowByFamily.set(family, (outflowByFamily.get(family) ?? 0) + flow.quantityKg)
  }

  const families = new Set([...precursorByFamily.keys(), ...outflowByFamily.keys()])
  let worstScore = riskScore
  let worstFamily: string | null = null
  for (const family of families) {
    const counterfactualPrecursorWeighted = totalPrecursorWeighted - (precursorByFamily.get(family) ?? 0)
    const counterfactualOutflowQty = totalOutflowQty - (outflowByFamily.get(family) ?? 0)
    const counterfactualPrecursorPressure = normalizedShare(counterfactualPrecursorWeighted, maxPrecursor)
    const counterfactualOutflowPressure = normalizedShare(counterfactualOutflowQty, maxOutflow)
    const counterfactualScore = clamp(
      conflictPressure * 0.25 +
      counterfactualPrecursorPressure * 0.25 +
      counterfactualOutflowPressure * 0.2 +
      syntheticActivity * 0.2 +
      opiumPressure * 0.1,
    )
    if (counterfactualScore < worstScore) {
      worstScore = counterfactualScore
      worstFamily = family
    }
  }

  // Compare rounded scores: `riskScore` arrives as the rounded, displayed
  // value, and the counterfactual must cross the threshold in the same
  // rounded terms the rest of the module (highRiskRegions, UI tiers) uses.
  const fragile = worstFamily !== null && Math.round(worstScore) < FRAGILITY_HIGH_RISK_THRESHOLD
  return {
    fragile,
    family: fragile ? worstFamily : null,
    scoreDrop: fragile ? riskScore - Math.round(worstScore) : null,
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

/**
 * Maps each region id to the set of conflict-actor names reported active in
 * it. Used to find regions linked by a shared armed actor even when they
 * don't border each other — per bipartite armed-actor/territory network
 * research (arXiv:2508.09051), shared combatants/administered zones can
 * transmit risk across non-adjacent ground that a purely geographic
 * adjacency map would miss.
 */
function actorsByRegion(conflictEvents: MmConflictEventRecord[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const event of conflictEvents) {
    if (!map.has(event.region)) map.set(event.region, new Set())
    map.get(event.region)!.add(event.actor)
  }
  return map
}

export interface RegionRiskProfile {
  region: string
  label: string
  year: number
  riskScore: number
  confidenceScore: number
  /**
   * Count of distinct *independent source families* (see
   * `canonicalSourceId`) reporting on this region — not raw source-name
   * strings. Two records attributed to name-string variants of the same
   * organisation collapse to one family, so this doesn't overstate
   * corroboration when a scraper or analyst enters the same reporter under
   * slightly different names across years/records.
   */
  sourceDiversity: number
  /**
   * Raw distinct `sourceName` string count for this region, before family
   * collapsing. Exposed alongside `sourceDiversity` so analysts/audits can
   * see when the independence discount actually changed the count (e.g.
   * `rawSourceNameCount: 2, sourceDiversity: 1` flags a scraper/entry
   * inconsistency worth cleaning up at the source, not just at fusion time).
   */
  rawSourceNameCount: number
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
  /**
   * Highest riskScore among regions that share a conflict actor with this
   * region (per `MM_CONFLICT_EVENTS.actor`), excluding this region itself.
   * 0 when this region has no actor overlap with any other region.
   */
  actorNetworkRiskScore: number
  /** The linked region id driving `actorNetworkRiskScore`; null when none. */
  actorNetworkRegion: string | null
  /** The shared actor name driving the `actorNetworkRegion` link; null when none. */
  actorNetworkActor: string | null
  /**
   * True when this region's own risk score is not yet "high" but a region
   * sharing one of its conflict actors is — a network-contagion signal
   * distinct from `spilloverWatch` (geographic adjacency): armed-actor
   * network studies find shared combatants/administered zones link risk
   * across non-adjacent territory (bipartite actor-municipality network
   * analysis, arXiv:2508.09051). Never affects the region's own riskScore.
   */
  actorNetworkWatch: boolean
  /**
   * True when both `spilloverWatch` (geographic adjacency) and
   * `actorNetworkWatch` (shared conflict actor) fire for this region at
   * once. The two signals are derived from independent evidence — one from
   * administrative-border geometry, the other from actor-attribution
   * records — so agreement between them is a stronger, corroborated
   * early-warning than either alone, following the same logic that makes
   * ensembles of independently-derived conflict-forecast models
   * (e.g. ViEWS-style ensembling) more reliable than any single model.
   * Never affects the region's own `riskScore`.
   */
  compoundEarlyWarning: boolean
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
  /** Herfindahl-Hirschman Index (0-10000) of outbound seized-drug corridor concentration; null when no outflow data. */
  outflowCorridorHHI: number | null
  /** Concentration tier derived from `outflowCorridorHHI` using DOJ/FTC-style thresholds. */
  outflowCorridorTier: CorridorConcentrationTier
  /** Border-town id carrying the largest share of this region's outbound seized volume. */
  dominantOutflowCorridor: string | null
  /** Share (percent) of outbound seized volume carried by `dominantOutflowCorridor`. */
  dominantOutflowCorridorSharePct: number | null
  /**
   * True when this region is high-risk (`riskScore >= 70`) but a
   * leave-one-source-family-out check finds that removing its single
   * largest-contributing independent source alone would drop it back below
   * the high-risk threshold. Distinct from `verificationTier`: a region can
   * have 2+ independent source families (`multi-source`) while one of them
   * still numerically dominates the risk score, so source *count* alone
   * doesn't guarantee the score is robust to any one source being wrong,
   * revised, or retracted.
   */
  singleSourceFragile: boolean
  /** Independent source family whose removal alone triggers `singleSourceFragile`; null unless fragile. */
  fragileSourceFamily: string | null
  /** riskScore points that would be lost if `fragileSourceFamily` were removed; null unless fragile. */
  fragileScoreDrop: number | null
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
    concentratedOutflowCorridorRegions: number
    /** Regions flagged via `actorNetworkWatch` (shared-actor network contagion, not geographic adjacency). */
    actorNetworkWatchRegions: number
    /** Regions flagged `singleSourceFragile` — high-risk classification carried by one dominant source family. */
    singleSourceFragileRegions: number
    /**
     * Regions where `rawSourceNameCount` exceeds `sourceDiversity` — i.e.
     * the fusion engine's source-family collapsing actually changed the
     * count (see `canonicalSourceId`). A non-zero value flags upstream
     * data-entry/scraper inconsistency (the same organisation entered under
     * multiple name-string variants) worth cleaning up at the source,
     * distinct from genuine multi-source corroboration.
     */
    duplicateSourceNameRegions: number
    /** Regions where both independent early-warning signals (spillover + actor-network) agree. */
    compoundEarlyWarningRegions: number
    /**
     * Outbound corridor towns ranked by systemic (network-wide) chokepoint
     * risk — distinct from any single region's `outflowCorridorTier`. See
     * `computeCorridorChokepoints`.
     */
    chokepoints: CorridorChokepoint[]
    /** Count of `chokepoints` entries flagged `systemicChokepoint`. */
    systemicChokepointCount: number
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

/** riskScore at/above this level counts as "high risk" for actor-network comparison. */
const ACTOR_NETWORK_HIGH_RISK_THRESHOLD = 70
/** Minimum gap between a region's own score and its highest-risk actor-linked region to flag actor-network watch. */
const ACTOR_NETWORK_GAP_THRESHOLD = 15

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
    // Count distinct *source families*, not raw name strings — two records
    // attributed to name-string variants of the same organisation (see
    // `canonicalSourceId`) are one source, not independent corroboration,
    // and shouldn't trip the 2+-source disagreement gate on their own.
    const distinctSources = new Set(group.map((r) => canonicalSourceId(sourceNameOf(r), sourceUrlOf(r))))
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

/**
 * Cross-source disagreement check for outbound seized-drug volumes. Only
 * meaningful once outflow records carry `sourceName`/`sourceUrl` (optional,
 * for backward compatibility with pre-provenance flow CSVs) — records
 * missing attribution are excluded from `distinctSources` entirely, so a
 * region with un-attributed flows never gets a spurious "sources disagree"
 * note.
 */
function detectOutflowConflicts(
  outflows: MmFlowRecord[],
): Map<string, string[]> {
  const attributed = outflows.filter((f) => f.sourceName)
  return detectWeightedDisagreement(
    attributed,
    (f) => `${f.from}::${f.drug}`,
    (f) => f.quantityKg,
    (f) => f.sourceName ?? '',
    (f) => f.sourceUrl,
    (key, distinctSources, maxDeviationPct) => {
      const [region, drug] = key.split('::')
      return {
        region,
        note: `${distinctSources} sources disagree on outbound ${drug} volume (up to ${maxDeviationPct}% spread)`,
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
  /** Cross-border corridor towns, for labelling `dominantOutflowCorridor`. Optional; falls back to raw ids when omitted. */
  borderNodes?: MmNode[]
}): IntelligenceBriefing {
  const { year, regions } = input
  const regionRecords = input.regionRecords.filter((r) => r.year === year)
  const conflictEvents = input.conflictEvents.filter((r) => r.year === year)
  const precursorFlows = input.precursorFlows.filter((r) => r.year === year)
  const outflows = input.outflows.filter((r) => r.year === year)
  const labelByRegion = new Map([...regions, ...(input.borderNodes ?? [])].map((r) => [r.id, r.label]))

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
    detectOutflowConflicts(outflows),
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
    outflows.filter((r) => r.from === region.id && r.sourceName).forEach((r) => regionSources.add(r.sourceName as string))
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
    outflows.filter((r) => r.from === region.id && r.sourceName).forEach((r) => regionSourceUrlByName.set(r.sourceName as string, r.sourceUrl))
    // Source *diversity* is measured on independent source families (see
    // `canonicalSourceId`), not raw name strings: two records attributed to
    // name-string variants of the same organisation are one corroborating
    // source, not two, so they shouldn't inflate `sourceDiversity`,
    // `verificationTier`, or the confidence score's source-count term.
    const regionSourceFamilies = new Set(
      [...regionSources].map((name) => canonicalSourceId(name, regionSourceUrlByName.get(name))),
    )
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
      Math.min(100, regionSourceFamilies.size * 34) * 0.35 * (0.5 + 0.5 * avgSourceReliability) +
      (stat ? 20 : 0) -
      (hasSourceConflict ? SOURCE_CONFLICT_PENALTY : 0) -
      stalenessPenalty,
    )

    const verificationTier: VerificationTier =
      regionSourceFamilies.size >= 2 ? 'multi-source' : regionSourceFamilies.size === 1 ? 'single-source' : 'unverified'

    const { hhi: precursorCorridorHHI, dominantCorridor: dominantPrecursorCorridor, dominantSharePct: dominantPrecursorCorridorSharePct } =
      computeCorridorConcentration(region.id, precursorFlows)
    const precursorCorridorTier = corridorConcentrationTier(precursorCorridorHHI)

    const { hhi: outflowCorridorHHI, dominantCorridor: dominantOutflowCorridorId, dominantSharePct: dominantOutflowCorridorSharePct } =
      computeOutflowCorridorConcentration(region.id, outflows)
    const outflowCorridorTier = corridorConcentrationTier(outflowCorridorHHI)
    const dominantOutflowCorridor = dominantOutflowCorridorId ? (labelByRegion.get(dominantOutflowCorridorId) ?? dominantOutflowCorridorId) : null

    const { fragile: singleSourceFragile, family: fragileSourceFamily, scoreDrop: fragileScoreDrop } = computeSingleSourceFragility({
      // Rounded, matching the exposed `profile.riskScore`: a region displayed
      // as high-risk (e.g. 69.5 → 70) must also be eligible for the
      // fragility check, or the two definitions of "high-risk" drift apart.
      riskScore: Math.round(riskScore),
      conflictPressure,
      syntheticActivity,
      opiumPressure,
      maxPrecursor,
      maxOutflow,
      regionPrecursorFlows: precursorFlows.filter((f) => f.to === region.id),
      regionOutflows: outflows.filter((f) => f.from === region.id),
    })

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
      sourceDiversity: regionSourceFamilies.size,
      rawSourceNameCount: regionSources.size,
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
      outflowCorridorHHI,
      outflowCorridorTier,
      dominantOutflowCorridor,
      dominantOutflowCorridorSharePct,
      singleSourceFragile,
      fragileSourceFamily,
      fragileScoreDrop,
      // Filled in below, once every region's own riskScore is known.
      neighborRiskScore: 0,
      neighborRegion: null as string | null,
      spilloverWatch: false,
      actorNetworkRiskScore: 0,
      actorNetworkRegion: null as string | null,
      actorNetworkActor: null as string | null,
      actorNetworkWatch: false,
      compoundEarlyWarning: false,
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

  // Actor-network pass: two regions can share risk exposure via a common
  // armed actor even when they don't border each other (see `actorsByRegion`
  // doc comment). This is a separate pass from geographic spillover above —
  // it never affects a region's own riskScore, only an explicit watch flag.
  const actorsForRegion = actorsByRegion(conflictEvents)
  for (const profile of profiles) {
    const myActors = actorsForRegion.get(profile.region) ?? new Set<string>()
    let actorNetworkRiskScore = 0
    let actorNetworkRegion: string | null = null
    let actorNetworkActor: string | null = null
    for (const other of profiles) {
      if (other.region === profile.region) continue
      const otherActors = actorsForRegion.get(other.region) ?? new Set<string>()
      const sharedActor = [...myActors].find((actor) => otherActors.has(actor))
      if (sharedActor && other.riskScore > actorNetworkRiskScore) {
        actorNetworkRiskScore = other.riskScore
        actorNetworkRegion = other.region
        actorNetworkActor = sharedActor
      }
    }
    profile.actorNetworkRiskScore = actorNetworkRiskScore
    profile.actorNetworkRegion = actorNetworkRegion
    profile.actorNetworkActor = actorNetworkActor
    profile.actorNetworkWatch =
      actorNetworkRiskScore >= ACTOR_NETWORK_HIGH_RISK_THRESHOLD &&
      profile.riskScore < ACTOR_NETWORK_HIGH_RISK_THRESHOLD &&
      actorNetworkRiskScore - profile.riskScore >= ACTOR_NETWORK_GAP_THRESHOLD
    // Compound pass: both independent early-warning signals firing on the
    // same region is a corroborated ensemble result, not just two separate
    // low-confidence hints — see doc comment on `compoundEarlyWarning`.
    profile.compoundEarlyWarning = profile.spilloverWatch && profile.actorNetworkWatch
  }

  profiles.sort((a, b) => b.riskScore - a.riskScore)

  const { nodes, edges } = buildEvidenceGraph({ regions, conflictEvents, precursorFlows, outflows, borderNodes: input.borderNodes })
  const chokepoints = computeCorridorChokepoints(outflows, labelByRegion)
  const regionsWithProvenance = profiles.filter((p) => p.evidenceCount > 1 && p.sourceDiversity > 0).length
  const conflictedRegions = profiles.filter((p) => p.hasSourceConflict).length
  const spilloverWatchRegions = profiles.filter((p) => p.spilloverWatch).length
  const staleRegions = profiles.filter((p) => p.evidenceStaleness === 'stale').length
  const concentratedCorridorRegions = profiles.filter((p) => p.precursorCorridorTier === 'concentrated').length
  const concentratedOutflowCorridorRegions = profiles.filter((p) => p.outflowCorridorTier === 'concentrated').length
  const duplicateSourceNameRegions = profiles.filter((p) => p.rawSourceNameCount > p.sourceDiversity).length
  const actorNetworkWatchRegions = profiles.filter((p) => p.actorNetworkWatch).length
  const singleSourceFragileRegions = profiles.filter((p) => p.singleSourceFragile).length
  const compoundEarlyWarningRegions = profiles.filter((p) => p.compoundEarlyWarning).length

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
      concentratedOutflowCorridorRegions,
      duplicateSourceNameRegions,
      actorNetworkWatchRegions,
      singleSourceFragileRegions,
      compoundEarlyWarningRegions,
      chokepoints,
      systemicChokepointCount: chokepoints.filter((c) => c.systemicChokepoint).length,
    },
  }
}

function buildEvidenceGraph(input: {
  regions: MmNode[]
  conflictEvents: MmConflictEventRecord[]
  precursorFlows: MmPrecursorFlowRecord[]
  outflows: MmFlowRecord[]
  borderNodes?: MmNode[]
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
  // Border/exit-corridor towns are a distinct node kind (not production
  // regions) so outbound-flow edges resolve to a real node instead of a
  // dangling `region:<border-town-id>` id that was never upserted.
  for (const node of input.borderNodes ?? []) {
    upsert({ id: `corridor:${node.id}`, label: node.label, kind: 'corridor', weight: 1 })
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
    // `to` is a border/exit-corridor town id, not a production region — point
    // the edge at its `corridor:` node (falling back to `region:` only if the
    // caller didn't supply border nodes, so the id still resolves to *some*
    // node rather than silently dangling).
    const toId = nodeMap.has(`corridor:${flow.to}`) ? `corridor:${flow.to}` : `region:${flow.to}`
    edges.push({
      from: `region:${flow.from}`,
      to: toId,
      relation: 'drug_outflow',
      weight: flow.quantityKg,
      sourceName: flow.sourceName,
      sourceUrl: flow.sourceUrl,
    })
    if (flow.sourceName) {
      upsert({
        id: `source:${flow.sourceName}`,
        label: flow.sourceName,
        kind: 'source',
        weight: 1,
        reliability: sourceReliabilityTier(flow.sourceName, flow.sourceUrl),
      })
      edges.push({
        from: `source:${flow.sourceName}`,
        to: `region:${flow.from}`,
        relation: 'reports',
        weight: 1,
        sourceName: flow.sourceName,
        sourceUrl: flow.sourceUrl,
      })
    }
  }

  return { nodes: [...nodeMap.values()], edges }
}
