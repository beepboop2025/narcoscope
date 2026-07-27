// =============================================================================
// US STATE OVERDOSE SELECTORS
// =============================================================================
// Turns the CDC VSRR state-level records (54 jurisdictions, 6 substance classes,
// 2015-2025) into the shapes the State Overdose tab renders: per-state metrics
// for a choropleth, a state's multi-year trend, national context, and movers.
//
// The central editorial choice is the metric. Raw death counts across states
// mostly measure population — California always "leads" because it is largest.
// The honest cross-state comparison is the RATE per 100,000 residents, so that
// is the default, computed against 2023 Census population (src/data/usStates.ts).
// Raw counts are still offered, clearly labelled, for absolute scale.

import type { OverdoseRecord, OverdoseSubstance } from '../types'
import { US_STATES, US_JURISDICTION_POP } from '../data/usStates'

export interface SubstanceOption { id: OverdoseSubstance; label: string }

/** The six substance classes CDC publishes at state level, most-specific first. */
export const STATE_SUBSTANCES: SubstanceOption[] = [
  { id: 'all_drugs', label: 'All drug overdoses' },
  { id: 'synthetic_opioids', label: 'Synthetic opioids (fentanyl)' },
  { id: 'psychostimulants', label: 'Psychostimulants (meth)' },
  { id: 'opioids_all', label: 'All opioids' },
  { id: 'cocaine', label: 'Cocaine' },
  { id: 'heroin', label: 'Heroin' },
]

const POP_BY_ABBR: Record<string, number> = {
  ...Object.fromEntries(US_STATES.map((s) => [s.abbr, s.population])),
  ...US_JURISDICTION_POP,
}

export interface StateMetric {
  abbr: string
  name: string
  deaths: number
  /** Deaths per 100,000 residents — the comparable metric. Null if no population. */
  ratePer100k: number | null
}

/** Full-year (non-partial) death count for a jurisdiction/substance/year. */
function annualDeaths(
  records: OverdoseRecord[], jurisdiction: string, substance: OverdoseSubstance, year: number,
): number | null {
  const r = records.find(
    (x) => x.jurisdiction === jurisdiction && x.substance === substance
      && x.year === year && !x.partialYear,
  )
  return r ? r.deaths : null
}

/**
 * Per-state metrics for one substance and year, keyed by abbreviation. Only
 * states that actually reported are included — a state absent from CDC for this
 * substance/year is omitted, not zero-filled (zero deaths and no report are
 * different, and the choropleth greys the latter).
 */
export function stateMetrics(
  records: OverdoseRecord[], substance: OverdoseSubstance, year: number,
): Map<string, StateMetric> {
  const out = new Map<string, StateMetric>()
  for (const s of US_STATES) {
    const deaths = annualDeaths(records, s.abbr, substance, year)
    if (deaths == null) continue
    out.set(s.abbr, {
      abbr: s.abbr, name: s.name, deaths,
      ratePer100k: s.population ? Math.round((deaths / s.population) * 100_000 * 10) / 10 : null,
    })
  }
  return out
}

/** A jurisdiction's multi-year trend for a substance (full-year points only). */
export interface TrendPoint { year: number; deaths: number; ratePer100k: number | null }

export function stateTrend(
  records: OverdoseRecord[], abbr: string, substance: OverdoseSubstance,
): TrendPoint[] {
  const pop = POP_BY_ABBR[abbr] ?? null
  return records
    .filter((r) => r.jurisdiction === abbr && r.substance === substance && !r.partialYear)
    .map((r) => ({
      year: r.year,
      deaths: r.deaths,
      ratePer100k: pop ? Math.round((r.deaths / pop) * 100_000 * 10) / 10 : null,
    }))
    .sort((a, b) => a.year - b.year)
}

/** National totals for context beneath the state view. */
export function nationalMetric(
  records: OverdoseRecord[], substance: OverdoseSubstance, year: number,
): StateMetric | null {
  const deaths = annualDeaths(records, 'US', substance, year)
  if (deaths == null) return null
  const pop = US_JURISDICTION_POP.US
  return {
    abbr: 'US', name: 'United States', deaths,
    ratePer100k: Math.round((deaths / pop) * 100_000 * 10) / 10,
  }
}

export interface Mover { abbr: string; name: string; fromRate: number; toRate: number; changePct: number | null }

/**
 * States ranked by change in rate between two years — where the epidemic is
 * moving. Rate change (not count change) so a small high-rate state is not
 * buried under a large one. Only states reporting in both years qualify.
 */
export function stateMovers(
  records: OverdoseRecord[], substance: OverdoseSubstance, fromYear: number, toYear: number,
): Mover[] {
  const from = stateMetrics(records, substance, fromYear)
  const to = stateMetrics(records, substance, toYear)
  const movers: Mover[] = []
  for (const [abbr, m] of to) {
    const f = from.get(abbr)
    if (!f || f.ratePer100k == null || m.ratePer100k == null) continue
    movers.push({
      abbr, name: m.name,
      fromRate: f.ratePer100k, toRate: m.ratePer100k,
      changePct: f.ratePer100k > 0 ? Math.round(((m.ratePer100k - f.ratePer100k) / f.ratePer100k) * 1000) / 1000 : null,
    })
  }
  return movers.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity))
}

/** The years with any full-year state-level record, ascending. */
export function stateYears(records: OverdoseRecord[]): number[] {
  return [...new Set(
    records.filter((r) => r.jurisdiction !== 'US' && !r.partialYear).map((r) => r.year),
  )].sort((a, b) => a - b)
}

/**
 * Sequential colour ramp position 0..1 for a rate against the max on view.
 * Square-root scaled so the crowded low end spreads out instead of all reading
 * as the base colour — the same honest-contrast reasoning as the seizure globe's
 * log ramp, but sqrt suits the tighter dynamic range of rates.
 */
export function ramp(rate: number | null, maxRate: number): number {
  if (rate == null || maxRate <= 0 || rate <= 0) return 0
  return Math.min(1, Math.sqrt(rate) / Math.sqrt(maxRate))
}
