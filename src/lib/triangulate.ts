// =============================================================================
// CROSS-MODALITY TRIANGULATION
// =============================================================================
//
// THE PROBLEM THIS MODULE EXISTS TO SOLVE
// ---------------------------------------
// Seizure volume is the number every drug-trade dashboard leads with, and on
// its own it cannot answer the question people ask of it. A country's seizures
// doubling is equally consistent with twice as many drugs moving and with twice
// as many customs officers looking — the series contains no information that
// separates trafficking volume from enforcement capacity. Adding more seizure
// sources does not fix this; every one of them is collected by the same kind of
// agency and inherits the same bias.
//
// The fix is to read seizures against modalities that are NOT collected by
// interdiction agencies:
//
//   seizures       interdiction agencies   supply pressure + enforcement effort
//   retail price   survey/enforcement      scarcity (falling price => more supply)
//   mortality      vital-statistics        consumption + toxicity of what is sold
//   wastewater     environmental chemists  consumption, directly
//
// When these agree, the reading is credible. When they diverge, the divergence
// is itself the finding — and which way it diverges changes the policy answer
// completely:
//
//   seizures up,   consumption flat  ->  enforcement got better, market didn't grow
//   seizures flat, consumption up    ->  supply grew and interdiction MISSED it
//
// Those two situations look identical in a seizure-only dashboard, and they
// call for opposite responses. Distinguishing them is the entire point.
//
// WHAT THIS MODULE WILL NOT DO
// ----------------------------
// It never fabricates a modality it does not have. A country with only supply
// data is reported as `untriangulated`, not given a confident single-modality
// verdict dressed up as fusion. Coverage is an output, not a footnote.

import type { Drug, OverdoseRecord, OverdoseSubstance, PriceRecord, WastewaterRecord } from '../types'
import { countryTrend, SEIZURE_GROUPS } from './seizures'

/** An independent way of observing the same market. */
export type Modality = 'seizures' | 'retail_price' | 'mortality' | 'wastewater'

export const MODALITY_LABEL: Record<Modality, string> = {
  seizures: 'Seizures',
  retail_price: 'Retail price',
  mortality: 'Overdose mortality',
  wastewater: 'Wastewater load',
}

/**
 * Who collects each modality. Two modalities collected by the same kind of
 * institution are not independent evidence, however different their units
 * look — the same reason `sourceReliability.canonicalSourceId` collapses name
 * variants of one organisation into a single source family.
 */
export const MODALITY_COLLECTOR: Record<Modality, string> = {
  seizures: 'Interdiction agencies (customs, police)',
  retail_price: 'Enforcement purchase data & user surveys',
  mortality: 'Vital-statistics registrars & medical examiners',
  wastewater: 'Environmental chemists (sewage treatment plants)',
}

/**
 * Which side of the market each modality speaks to. `supply` and `demand`
 * readings are what get compared; a verdict needs at least one of each,
 * because two supply modalities agreeing tells you nothing about whether
 * consumption moved.
 */
export const MODALITY_SIDE: Record<Modality, 'supply' | 'demand'> = {
  seizures: 'supply',
  retail_price: 'supply',
  mortality: 'demand',
  wastewater: 'demand',
}

/**
 * Bridges NarcoScope's `Drug` vocabulary to the vocabularies the other
 * datasets use. Every inexact join is stated here, in one place, rather than
 * being buried in a converter — a lossy mapping that nobody can find is how a
 * dashboard ends up quietly asserting something its data does not support.
 */
export interface DrugBridge {
  seizureGroup: string
  overdoseSubstance: OverdoseSubstance | null
  /** Stated caveat where the join is not exact; surfaced in the UI. */
  caveat: string | null
}

export const DRUG_BRIDGE: Record<Drug, DrugBridge> = {
  cocaine: {
    seizureGroup: 'Cocaine-type',
    overdoseSubstance: 'cocaine',
    caveat: null,
  },
  heroin: {
    seizureGroup: 'Opioids',
    overdoseSubstance: 'heroin',
    caveat:
      'UNODC reports heroin inside the broader "Opioids" seizure group, which also ' +
      'contains pharmaceutical opioids. Seizure movement here is opioid-wide, not heroin-specific.',
  },
  methamphetamine: {
    seizureGroup: 'Amphetamine-type stimulants (excluding “ecstasy”)',
    overdoseSubstance: 'psychostimulants',
    caveat:
      'Mortality uses ICD-10 T43.6 "psychostimulants with abuse potential", a class code ' +
      'methamphetamine dominates in the US but does not exhaust. Treat it as a proxy for ' +
      'meth-involved deaths, not a count of them.',
  },
  cannabis: {
    seizureGroup: 'Cannabis-type drugs (excluding synthetic cannabinoids)',
    // Cannabis has no comparable mortality series — overdose death is not a
    // meaningful outcome measure for it. Left null rather than substituting a
    // loosely-related indicator to make the table look complete.
    overdoseSubstance: null,
    caveat:
      'No mortality modality exists for cannabis: fatal overdose is not a meaningful ' +
      'outcome measure for it, so triangulation here rests on supply modalities alone.',
  },
}

export interface ModalityReading {
  modality: Modality
  available: boolean
  /** Signed change vs the baseline year as a proportion (0.22 = +22%). */
  changePct: number | null
  currentValue: number | null
  baselineValue: number | null
  unit: string
  /** Why the modality is missing, when it is. */
  absentReason: string | null
}

/**
 * What the modalities, read together, say about the market.
 *
 * `undetectedExpansion` is the finding a seizure-only dashboard structurally
 * cannot produce, and the one that matters most: consumption rose while
 * interdiction did not register it.
 */
export type TriangulationVerdict =
  | 'concordantExpansion'
  | 'concordantContraction'
  | 'enforcementArtifact'
  | 'undetectedExpansion'
  | 'mixedSignals'
  | 'untriangulated'

export const VERDICT_LABEL: Record<TriangulationVerdict, string> = {
  concordantExpansion: 'Concordant — market expanding',
  concordantContraction: 'Concordant — market contracting',
  enforcementArtifact: 'Divergent — likely enforcement effect',
  undetectedExpansion: 'Divergent — expansion not caught by interdiction',
  mixedSignals: 'Mixed — modalities disagree',
  untriangulated: 'Not triangulated — too few modalities',
}

export const VERDICT_PLAIN_ENGLISH: Record<TriangulationVerdict, string> = {
  concordantExpansion:
    'Supply and consumption indicators moved the same way, upward. Independent modalities ' +
    'agree the market grew, so the seizure rise is unlikely to be an enforcement artefact.',
  concordantContraction:
    'Supply and consumption indicators both fell. The decline shows up in data collected by ' +
    'different institutions, which makes it more credible than a seizure drop alone.',
  enforcementArtifact:
    'Seizures rose while consumption indicators did not. The most parsimonious reading is that ' +
    'interdiction improved rather than that the market grew — the classic way seizure-only ' +
    'figures overstate a trend.',
  undetectedExpansion:
    'Consumption indicators rose while seizures did not follow. This is the pattern that a ' +
    'seizure-only view misses entirely: supply appears to have grown without interdiction ' +
    'registering it.',
  mixedSignals:
    'The modalities point in different directions without a clean supply/demand split. Read the ' +
    'individual series before drawing a conclusion.',
  untriangulated:
    'Fewer than two independently-collected modalities have data here, so no cross-check is ' +
    'possible. The available figures may still be accurate; they simply cannot corroborate ' +
    'each other.',
}

// -----------------------------------------------------------------------------
// EDITORIAL POLICY — the thresholds below decide what NarcoScope tells people
// -----------------------------------------------------------------------------
// These are judgement calls, not derived constants, and they are collected
// here (rather than inlined) because changing them changes the tool's public
// claims. Same convention as `purityAdjustedPrice()` in metrics.ts: the policy
// is the maintainer's, and it should be visible enough to argue with.

/**
 * Below this relative change a modality is called flat rather than moving.
 * 15% matches the momentum threshold `intelligence.ts` already uses for
 * regional risk trajectories, so "rising" means the same thing across the app.
 * Raise it to be more conservative about declaring divergence; lower it to
 * catch smaller genuine moves at the cost of more noise.
 */
export const MATERIAL_CHANGE_THRESHOLD = 0.15

/**
 * Minimum independently-collected modalities before any verdict other than
 * `untriangulated` is issued. Two is the floor because one modality cannot
 * corroborate itself.
 */
export const MIN_MODALITIES_FOR_VERDICT = 2

/**
 * Retail price is treated as a SUPPLY signal with inverted sign: a falling
 * price means the drug got easier to obtain, i.e. supply expanded. This is
 * standard in supply-side drug economics but it is an assumption — price also
 * falls when demand collapses. Where price and seizures disagree, the code
 * below trusts seizures for the supply reading and records the price
 * disagreement rather than averaging the two into a number that reflects
 * neither.
 */
const PRICE_IS_INVERTED_SUPPLY_SIGNAL = true

const direction = (changePct: number | null): -1 | 0 | 1 => {
  if (changePct === null) return 0
  if (changePct > MATERIAL_CHANGE_THRESHOLD) return 1
  if (changePct < -MATERIAL_CHANGE_THRESHOLD) return -1
  return 0
}

const relativeChange = (current: number, baseline: number): number | null =>
  baseline > 0 ? (current - baseline) / baseline : null

export interface TriangulationResult {
  iso3: string
  country: string
  drug: Drug
  year: number
  baselineYear: number
  readings: ModalityReading[]
  /** Modalities with data for both the current and baseline year. */
  modalityCoverage: number
  /** Distinct collector institutions behind those modalities — the real independence count. */
  independentCollectors: number
  verdict: TriangulationVerdict
  /** Combined supply direction, from seizures (price disagreement is recorded, not averaged in). */
  supplyDirection: -1 | 0 | 1
  demandDirection: -1 | 0 | 1
  /**
   * True when dropping any single modality changes the verdict to a DIFFERENT
   * SUBSTANTIVE verdict.
   *
   * Implements the robustness warning in "Garbage in, Garbage out"
   * (arXiv:2501.01508): conclusions drawn from incomplete data are unstable in
   * ways the headline metric never reveals. A verdict that survives
   * leave-one-modality-out is worth acting on; one that flips is worth only
   * further collection. Mirrors the leave-one-source-family-out check in
   * `intelligence.ts`.
   *
   * Degrading to `untriangulated` deliberately does NOT count as a flip.
   * Losing the ability to judge is not the same as judging differently, and at
   * the two-modality minimum, dropping either one ALWAYS degrades — so
   * counting it would fire this flag on every minimum-coverage reading,
   * turning a real warning into noise analysts learn to ignore. That the
   * reading rests on the bare minimum is reported separately, by
   * `atMinimumCoverage`.
   */
  verdictFragile: boolean
  /** The modality whose removal flips the verdict; null unless fragile. */
  fragileModality: Modality | null
  /**
   * True when the verdict rests on exactly the minimum number of independent
   * collectors. Not a defect — it is the honest floor at which a cross-check is
   * possible at all — but it means there is no third modality to break a tie.
   */
  atMinimumCoverage: boolean
  /** Set when the price series contradicts the seizure series on supply direction. */
  supplySignalConflict: boolean
  caveats: string[]
}

function seizureReading(iso3: string, drug: Drug, year: number, baselineYear: number): ModalityReading {
  const groupIndex = SEIZURE_GROUPS.indexOf(DRUG_BRIDGE[drug].seizureGroup)
  const base: ModalityReading = {
    modality: 'seizures',
    available: false,
    changePct: null,
    currentValue: null,
    baselineValue: null,
    unit: 'kg',
    absentReason: null,
  }
  if (groupIndex === -1) {
    return { ...base, absentReason: 'No matching UNODC drug group' }
  }
  const trend = new Map(countryTrend(iso3, groupIndex))
  const current = trend.get(year) ?? 0
  const baseline = trend.get(baselineYear) ?? 0
  if (current === 0 && baseline === 0) {
    return { ...base, absentReason: `No seizures reported to UNODC for ${baselineYear}–${year}` }
  }
  return {
    ...base,
    available: true,
    currentValue: current,
    baselineValue: baseline,
    changePct: relativeChange(current, baseline),
  }
}

function priceReading(
  priceRecords: PriceRecord[],
  iso3: string,
  drug: Drug,
  year: number,
  baselineYear: number,
): ModalityReading {
  const base: ModalityReading = {
    modality: 'retail_price',
    available: false,
    changePct: null,
    currentValue: null,
    baselineValue: null,
    unit: 'USD/g',
    absentReason: null,
  }
  const forDrug = priceRecords.filter((r) => r.iso3 === iso3 && r.drug === drug)
  const current = forDrug.find((r) => r.year === year)?.priceUsdPerGram ?? null
  const baseline = forDrug.find((r) => r.year === baselineYear)?.priceUsdPerGram ?? null
  if (current === null || baseline === null) {
    return { ...base, absentReason: `UNODC reports no retail price for both ${baselineYear} and ${year}` }
  }
  return {
    ...base,
    available: true,
    currentValue: current,
    baselineValue: baseline,
    changePct: relativeChange(current, baseline),
  }
}

function mortalityReading(
  overdoseRecords: OverdoseRecord[],
  iso3: string,
  drug: Drug,
  year: number,
  baselineYear: number,
): ModalityReading {
  const substance = DRUG_BRIDGE[drug].overdoseSubstance
  const base: ModalityReading = {
    modality: 'mortality',
    available: false,
    changePct: null,
    currentValue: null,
    baselineValue: null,
    unit: 'deaths',
    absentReason: null,
  }
  if (substance === null) {
    return { ...base, absentReason: 'No comparable mortality series for this drug' }
  }
  // The bundled mortality dataset is US-only (CDC). Other countries do not
  // publish a comparable substance-specific series on a public API, and this
  // is stated plainly rather than left to look like missing data.
  if (iso3 !== 'USA') {
    return { ...base, absentReason: 'Bundled mortality data covers the United States only (CDC VSRR)' }
  }
  const national = overdoseRecords.filter(
    (r) => r.jurisdiction === 'US' && r.substance === substance && !r.partialYear,
  )
  const current = national.find((r) => r.year === year)?.deaths ?? null
  const baseline = national.find((r) => r.year === baselineYear)?.deaths ?? null
  if (current === null || baseline === null) {
    return { ...base, absentReason: `No complete-year CDC count for both ${baselineYear} and ${year}` }
  }
  return {
    ...base,
    available: true,
    currentValue: current,
    baselineValue: baseline,
    changePct: relativeChange(current, baseline),
  }
}

function wastewaterReading(
  wastewaterRecords: WastewaterRecord[],
  iso3: string,
  drug: Drug,
  year: number,
  baselineYear: number,
): ModalityReading {
  const base: ModalityReading = {
    modality: 'wastewater',
    available: false,
    changePct: null,
    currentValue: null,
    baselineValue: null,
    unit: 'mg/1000/day',
    absentReason: null,
  }
  // Three different ways this modality can be missing, and they mean very
  // different things to whoever is reading the tab. Collapsing them into one
  // "no data loaded" message (as an earlier version did) tells a user looking
  // at the United States that nothing is loaded, when in fact a full Canadian
  // series is loaded and simply does not cover their country.
  if (wastewaterRecords.length === 0) {
    return {
      ...base,
      absentReason:
        'No wastewater data loaded at all. Load a CSV export to enable this modality.',
    }
  }
  const forCountry = wastewaterRecords.filter((r) => r.iso3 === iso3)
  if (forCountry.length === 0) {
    const covered = [...new Set(wastewaterRecords.map((r) => r.country))].sort().join(', ')
    return {
      ...base,
      absentReason:
        `Loaded wastewater data covers ${covered} only. EUDA (Europe) and ACIC ` +
        '(Australia) publish comparable series but block automated collection — ' +
        'load a CSV export to cover this country.',
    }
  }
  const forDrug = forCountry.filter((r) => r.drug === drug)
  if (forDrug.length === 0) {
    return {
      ...base,
      absentReason: `No wastewater series for ${drug} in the loaded data`,
    }
  }
  // Mean across sites: catchments differ in size, and a national mean of
  // population-normalised loads is the comparison the publishers themselves make.
  const mean = (yr: number): number | null => {
    const vals = forDrug.filter((r) => r.year === yr).map((r) => r.mgPer1000PerDay)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }
  const current = mean(year)
  const baseline = mean(baselineYear)
  if (current === null || baseline === null) {
    return { ...base, absentReason: `No wastewater readings for both ${baselineYear} and ${year}` }
  }
  return {
    ...base,
    available: true,
    currentValue: current,
    baselineValue: baseline,
    changePct: relativeChange(current, baseline),
  }
}

/**
 * Classifies a supply/demand direction pair into a verdict. Split out so the
 * leave-one-modality-out robustness check can re-run exactly the same logic on
 * a reduced modality set rather than an approximation of it.
 */
function classify(
  supply: -1 | 0 | 1,
  demand: -1 | 0 | 1,
  supplyAvailable: boolean,
  demandAvailable: boolean,
  collectors: number,
): TriangulationVerdict {
  // A verdict needs both sides of the market AND genuinely independent
  // collectors. Two supply modalities agreeing says nothing about consumption.
  if (!supplyAvailable || !demandAvailable || collectors < MIN_MODALITIES_FOR_VERDICT) {
    return 'untriangulated'
  }
  if (supply === 1 && demand === 1) return 'concordantExpansion'
  if (supply === -1 && demand === -1) return 'concordantContraction'
  if (supply === 1 && demand <= 0) return 'enforcementArtifact'
  if (supply <= 0 && demand === 1) return 'undetectedExpansion'
  // Both flat is agreement on a stable market, not a disagreement.
  if (supply === 0 && demand === 0) return 'concordantContraction'
  return 'mixedSignals'
}

export function triangulate(input: {
  iso3: string
  country: string
  drug: Drug
  year: number
  baselineYear: number
  priceRecords: PriceRecord[]
  overdoseRecords: OverdoseRecord[]
  wastewaterRecords: WastewaterRecord[]
}): TriangulationResult {
  const { iso3, country, drug, year, baselineYear } = input

  const readings: ModalityReading[] = [
    seizureReading(iso3, drug, year, baselineYear),
    priceReading(input.priceRecords, iso3, drug, year, baselineYear),
    mortalityReading(input.overdoseRecords, iso3, drug, year, baselineYear),
    wastewaterReading(input.wastewaterRecords, iso3, drug, year, baselineYear),
  ]

  const byModality = new Map(readings.map((r) => [r.modality, r]))
  const available = readings.filter((r) => r.available)
  const independentCollectors = new Set(available.map((r) => MODALITY_COLLECTOR[r.modality])).size

  const verdictFor = (active: ModalityReading[]): TriangulationVerdict => {
    const seiz = active.find((r) => r.modality === 'seizures')
    const price = active.find((r) => r.modality === 'retail_price')
    const supplySide = active.filter((r) => MODALITY_SIDE[r.modality] === 'supply')
    const demandSide = active.filter((r) => MODALITY_SIDE[r.modality] === 'demand')

    // Supply direction: seizures lead. Price is the fallback when seizures are
    // absent, sign-inverted (cheaper => more available). They are deliberately
    // not averaged — see PRICE_IS_INVERTED_SUPPLY_SIGNAL.
    let supply: -1 | 0 | 1 = 0
    if (seiz) {
      supply = direction(seiz.changePct)
    } else if (price && PRICE_IS_INVERTED_SUPPLY_SIGNAL) {
      supply = (-direction(price.changePct) as -1 | 0 | 1)
    }

    // Demand direction: wastewater is the more direct consumption measure, so
    // it leads where present; mortality otherwise.
    const wastewater = demandSide.find((r) => r.modality === 'wastewater')
    const mortality = demandSide.find((r) => r.modality === 'mortality')
    const demand = direction((wastewater ?? mortality)?.changePct ?? null)

    return classify(
      supply,
      demand,
      supplySide.length > 0,
      demandSide.length > 0,
      new Set(active.map((r) => MODALITY_COLLECTOR[r.modality])).size,
    )
  }

  const verdict = verdictFor(available)

  // Leave-one-modality-out robustness (arXiv:2501.01508). Only meaningful once
  // a verdict actually exists; an `untriangulated` result is already the
  // maximally cautious answer and cannot become more fragile.
  let verdictFragile = false
  let fragileModality: Modality | null = null
  if (verdict !== 'untriangulated') {
    for (const dropped of available) {
      const reduced = available.filter((r) => r.modality !== dropped.modality)
      const reducedVerdict = verdictFor(reduced)
      // A drop to `untriangulated` is expected loss of coverage, not a
      // contradiction — see the doc comment on `verdictFragile`.
      if (reducedVerdict !== verdict && reducedVerdict !== 'untriangulated') {
        verdictFragile = true
        fragileModality = dropped.modality
        break
      }
    }
  }

  const seizures = byModality.get('seizures')
  const price = byModality.get('retail_price')
  const supplyDirection: -1 | 0 | 1 = seizures?.available
    ? direction(seizures.changePct)
    : price?.available
      ? (-direction(price.changePct) as -1 | 0 | 1)
      : 0
  const wastewater = byModality.get('wastewater')
  const mortality = byModality.get('mortality')
  const demandSource = wastewater?.available ? wastewater : mortality?.available ? mortality : null
  const demandDirection = direction(demandSource?.changePct ?? null)

  // Price contradicting seizures is not averaged away; it is reported. Both
  // are supply modalities, so when they disagree the supply reading itself is
  // in question regardless of what the demand side says. Price is inverted
  // first (cheaper => more supply) so the two are compared on the same axis.
  const seizureSupplyDir = seizures?.available ? direction(seizures.changePct) : 0
  const priceSupplyDir = price?.available ? ((-direction(price.changePct)) as -1 | 0 | 1) : 0
  const supplySignalConflict =
    !!seizures?.available &&
    !!price?.available &&
    seizureSupplyDir !== 0 &&
    priceSupplyDir !== 0 &&
    seizureSupplyDir !== priceSupplyDir

  const caveats: string[] = []
  const bridgeCaveat = DRUG_BRIDGE[drug].caveat
  if (bridgeCaveat) caveats.push(bridgeCaveat)
  if (supplySignalConflict) {
    caveats.push(
      'Seizures and retail price disagree on the direction of supply. Seizures are used for the ' +
      'verdict; the price series contradicts them.',
    )
  }
  if (verdictFragile && fragileModality) {
    caveats.push(
      `Verdict is not robust: removing ${MODALITY_LABEL[fragileModality].toLowerCase()} alone changes it. ` +
      'Treat this as a prompt for more data, not a finding.',
    )
  }
  if (independentCollectors === MIN_MODALITIES_FOR_VERDICT && verdict !== 'untriangulated') {
    caveats.push(
      'This reading rests on the minimum two independently-collected modalities. They corroborate ' +
      'each other, but there is no third to break a tie if one is later revised.',
    )
  }

  return {
    iso3,
    country,
    drug,
    year,
    baselineYear,
    readings,
    modalityCoverage: available.length,
    independentCollectors,
    verdict,
    supplyDirection,
    demandDirection,
    verdictFragile,
    fragileModality,
    atMinimumCoverage:
      verdict !== 'untriangulated' && independentCollectors === MIN_MODALITIES_FOR_VERDICT,
    supplySignalConflict,
    caveats,
  }
}

// =============================================================================
// TIME SERIES — making divergence visible instead of stating it
// =============================================================================
//
// The point-in-time `triangulate()` collapses a whole trend into two numbers
// (baseline year, current year) and a verdict word. That is enough to classify,
// but it hides the thing worth seeing: WHEN seizures and consumption parted
// ways, and how far. A seizure line falling while a mortality line climbs is a
// far more convincing account of "interdiction is missing this" than the
// sentence that says so.
//
// The series rebases every modality to an INDEX = 100 at its own first
// available year. That is the only honest way to draw seizures (kilograms),
// mortality (deaths) and wastewater (mg/1000/day) on one axis: the shapes are
// comparable even though the units are not, and the reader is comparing
// *trajectories*, never levels. Absolute values are kept per point so a tooltip
// can still show the real figure.

export interface SeriesPoint {
  year: number
  /** Rebased to 100 at the modality's first available year. Null where no reading exists. */
  index: number | null
  /** The real measurement in the modality's own unit, for tooltips. Null where absent. */
  value: number | null
}

export interface ModalitySeries {
  modality: Modality
  side: 'supply' | 'demand'
  unit: string
  /** The year the index is rebased to (first year with a value). Null if the series is empty. */
  baseYear: number | null
  points: SeriesPoint[]
}

/** Rebase a sparse per-year map to an index against its earliest value. */
function toIndexedSeries(
  modality: Modality,
  unit: string,
  byYear: Map<number, number>,
  years: number[],
): ModalitySeries {
  const present = [...byYear.keys()].sort((a, b) => a - b)
  const baseYear = present.length ? present[0] : null
  const baseValue = baseYear !== null ? byYear.get(baseYear)! : null
  const points: SeriesPoint[] = years.map((year) => {
    const value = byYear.get(year) ?? null
    // Index is only defined once we have a positive base to divide by. A zero
    // or absent base leaves the index null rather than producing Infinity.
    const index =
      value !== null && baseValue !== null && baseValue > 0
        ? Math.round((value / baseValue) * 1000) / 10
        : null
    return { year, index, value }
  })
  return { modality, side: MODALITY_SIDE[modality], unit, baseYear, points }
}

/** Per-year seizure kilograms for a country+drug. */
function seizureByYear(iso3: string, drug: Drug): Map<number, number> {
  const groupIndex = SEIZURE_GROUPS.indexOf(DRUG_BRIDGE[drug].seizureGroup)
  const out = new Map<number, number>()
  if (groupIndex === -1) return out
  for (const [year, kg] of countryTrend(iso3, groupIndex)) {
    if (kg > 0) out.set(year, kg)
  }
  return out
}

function priceByYear(priceRecords: PriceRecord[], iso3: string, drug: Drug): Map<number, number> {
  const out = new Map<number, number>()
  for (const r of priceRecords) {
    if (r.iso3 === iso3 && r.drug === drug) out.set(r.year, r.priceUsdPerGram)
  }
  return out
}

function mortalityByYear(overdoseRecords: OverdoseRecord[], iso3: string, drug: Drug): Map<number, number> {
  const substance = DRUG_BRIDGE[drug].overdoseSubstance
  const out = new Map<number, number>()
  if (substance === null || iso3 !== 'USA') return out
  for (const r of overdoseRecords) {
    if (r.jurisdiction === 'US' && r.substance === substance && !r.partialYear) {
      out.set(r.year, r.deaths)
    }
  }
  return out
}

function wastewaterByYear(wastewaterRecords: WastewaterRecord[], iso3: string, drug: Drug): Map<number, number> {
  const byYearVals = new Map<number, number[]>()
  for (const r of wastewaterRecords) {
    if (r.iso3 === iso3 && r.drug === drug) {
      const arr = byYearVals.get(r.year) ?? []
      arr.push(r.mgPer1000PerDay)
      byYearVals.set(r.year, arr)
    }
  }
  const out = new Map<number, number>()
  for (const [year, vals] of byYearVals) {
    out.set(year, vals.reduce((s, v) => s + v, 0) / vals.length)
  }
  return out
}

export interface TriangulationSeries {
  iso3: string
  country: string
  drug: Drug
  /** Every year that appears in ANY modality, ascending — the chart's x-axis. */
  years: number[]
  series: ModalitySeries[]
}

/**
 * Builds an indexed multi-year series for one country+drug across every
 * modality that has data. Only modalities with at least one reading are
 * returned, so the chart never draws an empty line. The union of all years
 * present becomes the shared x-axis.
 */
export function triangulateSeries(input: {
  iso3: string
  country: string
  drug: Drug
  priceRecords: PriceRecord[]
  overdoseRecords: OverdoseRecord[]
  wastewaterRecords: WastewaterRecord[]
}): TriangulationSeries {
  const { iso3, country, drug } = input
  const byModality: Array<[Modality, string, Map<number, number>]> = [
    ['seizures', 'kg', seizureByYear(iso3, drug)],
    ['retail_price', 'USD/g', priceByYear(input.priceRecords, iso3, drug)],
    ['mortality', 'deaths', mortalityByYear(input.overdoseRecords, iso3, drug)],
    ['wastewater', 'mg/1000/day', wastewaterByYear(input.wastewaterRecords, iso3, drug)],
  ]

  const yearSet = new Set<number>()
  for (const [, , m] of byModality) for (const y of m.keys()) yearSet.add(y)
  const years = [...yearSet].sort((a, b) => a - b)

  const series = byModality
    .filter(([, , m]) => m.size > 0)
    .map(([modality, unit, m]) => toIndexedSeries(modality, unit, m, years))

  return { iso3, country, drug, years, series }
}

// =============================================================================
// DIVERGENCE SCAN — surfacing the interesting cases instead of hiding them
// =============================================================================
//
// A user staring at a country picker has no way to know that US methamphetamine
// and Canadian cannabis are where the story is. The scan runs every
// country+drug pair that can be triangulated and ranks them, so the divergences
// rise to the top on their own. This is the difference between a tool that
// answers a question you already knew to ask and one that tells you which
// question to ask.

export interface DivergenceHit {
  iso3: string
  country: string
  drug: Drug
  verdict: TriangulationVerdict
  supplyDirection: -1 | 0 | 1
  demandDirection: -1 | 0 | 1
  /** Signed supply change over the window (proportion), for magnitude ranking. */
  supplyChangePct: number | null
  /** Signed demand change over the window (proportion). */
  demandChangePct: number | null
  /** How far apart the two sides moved — the headline magnitude of the divergence. */
  gap: number
  verdictFragile: boolean
}

/** Verdicts that represent an actual divergence worth surfacing first. */
const DIVERGENT_VERDICTS = new Set<TriangulationVerdict>(['enforcementArtifact', 'undetectedExpansion'])

/**
 * Runs `triangulate()` across the cartesian product of the supplied countries
 * and drugs and returns only the pairs that produced a real verdict, ranked so
 * the divergences (enforcement artefact / undetected expansion) come first,
 * then by the size of the supply/demand gap. `countries` is caller-supplied so
 * the scan doesn't reach into the seizure dataset itself — the component knows
 * which countries it wants to offer.
 */
export function scanDivergences(input: {
  countries: Array<{ iso3: string; name: string }>
  drugs: Drug[]
  year: number
  baselineYear: number
  priceRecords: PriceRecord[]
  overdoseRecords: OverdoseRecord[]
  wastewaterRecords: WastewaterRecord[]
}): DivergenceHit[] {
  const hits: DivergenceHit[] = []
  for (const country of input.countries) {
    for (const drug of input.drugs) {
      const r = triangulate({
        iso3: country.iso3,
        country: country.name,
        drug,
        year: input.year,
        baselineYear: input.baselineYear,
        priceRecords: input.priceRecords,
        overdoseRecords: input.overdoseRecords,
        wastewaterRecords: input.wastewaterRecords,
      })
      if (r.verdict === 'untriangulated') continue

      const supplyReading =
        r.readings.find((x) => x.modality === 'seizures' && x.available) ??
        r.readings.find((x) => x.modality === 'retail_price' && x.available)
      const demandReading =
        r.readings.find((x) => x.modality === 'wastewater' && x.available) ??
        r.readings.find((x) => x.modality === 'mortality' && x.available)
      const supplyChangePct = supplyReading?.changePct ?? null
      const demandChangePct = demandReading?.changePct ?? null
      const gap =
        supplyChangePct !== null && demandChangePct !== null
          ? Math.abs(supplyChangePct - demandChangePct)
          : 0

      hits.push({
        iso3: country.iso3,
        country: country.name,
        drug,
        verdict: r.verdict,
        supplyDirection: r.supplyDirection,
        demandDirection: r.demandDirection,
        supplyChangePct,
        demandChangePct,
        gap: Math.round(gap * 1000) / 1000,
        verdictFragile: r.verdictFragile,
      })
    }
  }

  return hits.sort((a, b) => {
    const aDiv = DIVERGENT_VERDICTS.has(a.verdict) ? 1 : 0
    const bDiv = DIVERGENT_VERDICTS.has(b.verdict) ? 1 : 0
    if (aDiv !== bDiv) return bDiv - aDiv
    return b.gap - a.gap
  })
}
