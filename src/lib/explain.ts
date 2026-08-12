// =============================================================================
// EXPLAIN — the legibility / democratization layer
// =============================================================================
// Pure functions that turn raw records into ONE plain-English sentence a
// non-expert can understand. Official data is published in institutional units
// (USD/g, kg, hectares); people understand human units (hours of wages, tonnes).
// Keep these pure + string-returning so they can be tested and, later, localised.

import { affordabilityDays } from './metrics'
import type {
  FlowAggregationGroup,
  FlowRecord,
  MmConflictEventRecord,
  MmFlowRecord,
  MmPrecursorFlowRecord,
  MmRegionRecord,
  PriceRecord,
} from '../types'
import { isFlowAggregationEligible } from '../types'

const fmtUsd = (v: number | null): string => (v == null ? 'n/a' : `$${Math.round(v).toLocaleString()}`)

/** kg → a human mass phrase (tonnes once it's big enough to deserve them). */
export function humanizeMass(kg: number | null): string {
  if (kg == null) return 'n/a'
  if (kg >= 1000) {
    const t = kg / 1000
    return `${t >= 10 ? Math.round(t) : t.toFixed(1)} tonnes`
  }
  return `${Math.round(kg).toLocaleString()} kg`
}

/** "days of income" → a wage phrase ("~15 hours of an average local wage"). */
export function humanizeAffordability(days: number | null): string | null {
  if (days == null) return null
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24))
    return `roughly ${hours} hour${hours === 1 ? '' : 's'} of an average local wage`
  }
  const d = days < 10 ? Number(days.toFixed(1)) : Math.round(days)
  return `roughly ${d} day${d === 1 ? '' : 's'} of an average local wage`
}

/** Street prices: contrast cheapest vs dearest, anchored in wages. */
export function explainPrices(rows: PriceRecord[] | null | undefined, drugLabel: string): string | null {
  if (!rows || rows.length === 0) return null
  const latestYear = Math.max(...rows.map((r) => r.year))
  let scope = rows.filter((r) => r.year === latestYear)
  if (scope.length < 2) scope = rows
  const sorted = [...scope].sort((a, b) => a.priceUsdPerGram - b.priceUsdPerGram)
  const cheap = sorted[0]
  const dear = sorted[sorted.length - 1]

  if (cheap === dear) {
    return `A gram of ${drugLabel.toLowerCase()} costs about ${fmtUsd(dear.priceUsdPerGram)} in ${dear.country} in the latest year on record.`
  }
  const dearAff = humanizeAffordability(affordabilityDays(dear.priceUsdPerGram, dear.iso3))
  let s = `A gram of ${drugLabel.toLowerCase()} runs about ${fmtUsd(cheap.priceUsdPerGram)} in ${cheap.country} versus ${fmtUsd(dear.priceUsdPerGram)} in ${dear.country}`
  if (dearAff) s += ` — ${dearAff} there`
  s += '. As a rule, street prices are lowest near where a drug is produced and climb the further it has to travel.'
  return s
}

/** Precursor flows: record counts and an exact-only subtotal when explicitly qualified. */
export interface FlowAggregationSummary {
  aggregationGroup: FlowAggregationGroup | null
  aggregationGroupCount: number
  eligibleRecordCount: number
  excludedRecordCount: number
  summedQuantityKg: number | null
}

export function flowAggregationGroupLabel(group: FlowAggregationGroup): string {
  const labels: Record<FlowAggregationGroup, string> = {
    mdma_precursor_substance_mass: 'MDMA precursor substance mass',
    meth_pre_precursor_substance_mass: 'methamphetamine pre-precursor substance mass',
    pseudoephedrine_preparation_gross_mass: 'pseudoephedrine-preparation gross mass',
    potassium_permanganate_substance_mass: 'potassium permanganate substance mass',
    pseudoephedrine_preparation_mass: 'pseudoephedrine-preparation mass',
  }
  return labels[group]
}

/**
 * Produces one subtotal only when the explicitly eligible exact rows share one
 * canonical compatible basis. All other rows remain excluded from that sum.
 */
export function summarizeFlowAggregation(flows: FlowRecord[]): FlowAggregationSummary {
  const eligible = flows.filter(isFlowAggregationEligible)
  const groups = [...new Set(eligible.map((record) => record.aggregationGroup))]
  const aggregationGroup = groups.length === 1 ? groups[0] : null
  return {
    aggregationGroup,
    aggregationGroupCount: groups.length,
    eligibleRecordCount: eligible.length,
    excludedRecordCount: flows.length - eligible.length,
    summedQuantityKg: aggregationGroup == null
      ? null
      : eligible
        .filter((record) => record.aggregationGroup === aggregationGroup)
        .reduce((total, record) => total + record.quantityKg, 0),
  }
}

export function explainFlows(
  flows: FlowRecord[] | null | undefined,
  scopeLabel = 'the records shown',
): string | null {
  if (!flows || flows.length === 0) return `No trafficking corridors are recorded for ${scopeLabel}.`
  const aggregation = summarizeFlowAggregation(flows)
  let subtotalText: string
  if (aggregation.summedQuantityKg != null && aggregation.aggregationGroup != null) {
    subtotalText = `${humanizeMass(aggregation.summedQuantityKg)} across ${aggregation.eligibleRecordCount} aggregation-eligible exact record${aggregation.eligibleRecordCount === 1 ? '' : 's'} in the ${flowAggregationGroupLabel(aggregation.aggregationGroup)} group`
  } else if (aggregation.aggregationGroupCount > 1) {
    subtotalText = `no cross-group subtotal; ${aggregation.eligibleRecordCount} eligible exact records remain split across ${aggregation.aggregationGroupCount} canonical aggregation groups`
  } else {
    subtotalText = 'no compatible exact subtotal'
  }
  return `The ${scopeLabel} view contains ${flows.length} source-grained record${flows.length === 1 ? '' : 's'}: ${subtotalText}; ${aggregation.excludedRecordCount} non-exact, derived, incompatible-basis or unqualified record${aggregation.excludedRecordCount === 1 ? ' is' : 's are'} kept separate. Values with different precision, incident grain or quantity bases are not combined into a route share or “largest shipment.”`
}

/** Myanmar focus: where activity/cultivation peaks + the busiest exit route. */
export function explainMyanmar(
  regionRows: MmRegionRecord[] | null | undefined,
  flows: MmFlowRecord[] | null | undefined,
  year: number | undefined,
  labelOf: (id: string) => string,
  conflictEvents?: MmConflictEventRecord[] | null,
  precursorFlows?: MmPrecursorFlowRecord[] | null,
): string | null {
  const parts: string[] = []
  if (regionRows && regionRows.length) {
    const topMeth = [...regionRows].sort((a, b) => b.methIndex - a.methIndex)[0]
    const topOpium = [...regionRows].sort((a, b) => b.opiumHa - a.opiumHa)[0]
    parts.push(
      `In ${year}, synthetic-drug activity in the Golden Triangle peaks in ${labelOf(topMeth.region)}, while opium poppy concentrates in ${labelOf(topOpium.region)} (~${topOpium.opiumHa.toLocaleString()} hectares).`,
    )
  }
  if (flows && flows.length) {
    const top = [...flows].sort((a, b) => b.quantityKg - a.quantityKg)[0]
    parts.push(
      `The busiest tracked route carries ${humanizeMass(top.quantityKg)} of ${top.drug.toLowerCase()} from ${labelOf(top.from)} toward ${labelOf(top.to)}.`,
    )
  }
  if (conflictEvents && conflictEvents.length) {
    const topConflict = [...conflictEvents].sort((a, b) => b.intensity - a.intensity)[0]
    parts.push(
      `The civil-war overlay shows the strongest conflict pressure in ${labelOf(topConflict.region)} (${topConflict.actor}, ${topConflict.intensity}/100).`,
    )
  }
  if (precursorFlows && precursorFlows.length) {
    const total = precursorFlows.reduce((s, r) => s + r.quantityKg, 0)
    const china = precursorFlows
      .filter((r) => r.originCountry.toLowerCase() === 'china')
      .reduce((s, r) => s + r.quantityKg, 0)
    const share = total ? Math.round((china / total) * 100) : 0
    const top = [...precursorFlows].sort((a, b) => b.quantityKg - a.quantityKg)[0]
    parts.push(
      `Inbound precursor reporting adds ${humanizeMass(total)} flowing toward Myanmar regions; China accounts for ${share}% of the shown volume, led by ${top.originCountry} → ${labelOf(top.to)}.`,
    )
  }
  return parts.length ? parts.join(' ') : null
}
