// =============================================================================
// METRICS — turning raw prices into awareness signals
// =============================================================================
// Pure functions (no React, no side effects) — trivial to unit-test and reuse.

import { GDP_PER_CAPITA_USD } from '../data/prices'

/** Average daily income (USD) for a country, from nominal GDP per capita. */
export function dailyIncomeUsd(iso3: string): number | null {
  const annual = GDP_PER_CAPITA_USD[iso3]
  if (!annual) return null
  return annual / 365
}

/**
 * Affordability: a street price expressed as a share of one day's income.
 * Reframes a raw price into lived reality — the same $18/g is trivial in one
 * economy and ruinous in another.
 */
export function affordabilityDays(priceUsd: number | null, iso3: string): number | null {
  const daily = dailyIncomeUsd(iso3)
  if (!daily || priceUsd == null) return null
  return priceUsd / daily
}

/** Year-over-year % change, available only for unique consecutive annual points. */
export function latestYoYChange(
  series: { year: number; price: number }[] | null | undefined,
): number | null {
  if (!series || series.length < 2) return null
  if (series.some(({ year, price }) => !Number.isInteger(year) || !Number.isFinite(price) || price < 0)) return null
  if (new Set(series.map(({ year }) => year)).size !== series.length) return null
  const sorted = [...series].sort((a, b) => a.year - b.year)
  const last = sorted[sorted.length - 1]
  const prev = sorted[sorted.length - 2]
  if (last.year !== prev.year + 1 || prev.price === 0) return null
  const change = ((last.price - prev.price) / prev.price) * 100
  return Number.isFinite(change) ? change : null
}

/**
 * Price per PURE gram. A headline street price is misleading alone: $100/g at
 * 30% purity holds far less active drug than $100/g at 75%. Normalise to the
 * price of one pure gram: price / (purity fraction).
 */
export function purityAdjustedPrice(priceUsd: number | null, purityPct: number | null): number | null {
  if (priceUsd == null) return null
  // Editorial choice (b): when purity is unknown, REFUSE to adjust and return
  // null — the UI then shows "n/a" rather than silently comparing a cut street
  // price against a pure one. Cannabis (no reported purity) therefore drops out
  // of purity-adjusted views by design. An honest gap beats a misleading number.
  if (purityPct == null) return null
  // A sample at 0% (or an out-of-range purity) can't yield a meaningful price
  // per pure gram, and 0 would divide to Infinity — reject rather than mislead.
  if (purityPct <= 0 || purityPct > 100) return null
  return priceUsd / (purityPct / 100)
}
