// =============================================================================
// METRICS — turning raw prices into awareness signals
// =============================================================================
// These functions are pure (no React, no side effects) so they're trivial to
// unit-test and reuse. Each takes plain records and returns plain numbers.

import { GDP_PER_CAPITA_USD } from '../data/prices.js'

/**
 * Average daily income (USD) for a country, from nominal GDP per capita.
 * A crude proxy, but enough to make "how affordable is this drug?" tangible.
 */
export function dailyIncomeUsd(iso3) {
  const annual = GDP_PER_CAPITA_USD[iso3]
  if (!annual) return null
  return annual / 365
}

/**
 * Affordability: a street price expressed as a share of one day's income.
 * 0.5 → half a day's wages per gram; 3 → three days' wages per gram.
 * This is the metric that reframes a raw price into lived reality: the same
 * $18/g of heroin is trivial in one economy and ruinous in another.
 */
export function affordabilityDays(priceUsd, iso3) {
  const daily = dailyIncomeUsd(iso3)
  if (!daily || priceUsd == null) return null
  return priceUsd / daily
}

/**
 * Year-over-year price change (%) for a sorted series of {year, price} points.
 * Returns the latest point's change vs the previous available year.
 */
export function latestYoYChange(series) {
  if (!series || series.length < 2) return null
  const sorted = [...series].sort((a, b) => a.year - b.year)
  const last = sorted[sorted.length - 1]
  const prev = sorted[sorted.length - 2]
  if (prev.price === 0) return null
  return ((last.price - prev.price) / prev.price) * 100
}

/**
 * PURITY-ADJUSTED PRICE — "price per PURE gram".
 * --------------------------------------------------------------------------
 * THIS IS YOURS TO IMPLEMENT (see src/lib/metrics.js). It's a small function
 * but it encodes a real analytical stance, which is why I'm handing it to you
 * instead of guessing.
 *
 * WHY IT MATTERS:
 *   A headline street price is misleading on its own. $100/g of heroin at 30%
 *   purity contains far less active drug than $100/g at 75%. To compare prices
 *   honestly across countries and years, you normalise to the price of one gram
 *   of the *pure* substance: pricePerPureGram = price / (purity fraction).
 *
 * THE DESIGN DECISIONS (this is the interesting part):
 *   1. purityPct is a PERCENT (e.g. 65 means 65%). Convert to a 0–1 fraction.
 *   2. What do you return when purityPct is null? Two valid philosophies:
 *        (a) return the raw price unchanged (treat "unknown" as "as-sold") —
 *            simplest, but it silently mixes pure and impure prices.
 *        (b) return null (refuse to adjust) — more honest, the UI then shows
 *            "n/a" and the user knows the comparison isn't apples-to-apples.
 *      Cannabis has null purity by design, so your choice here shapes whether
 *      cannabis appears in purity-adjusted views at all.
 *   3. Guard the divide-by-zero / nonsensical cases (purity 0, negative, >100).
 *      A street sample at "0% purity" shouldn't yield an infinite price.
 *
 * @param {number}      priceUsd  retail price per gram, as sold (USD)
 * @param {number|null} purityPct typical purity as a percent (e.g. 65), or null
 * @returns {number|null} price per pure gram, or null if you choose not to adjust
 */
export function purityAdjustedPrice(priceUsd, purityPct) {
  // TODO(you): implement the normalisation + your null/edge-case policy.
  // Aim for ~5–8 lines. Decide (a) vs (b) for the null case and defend it.
  return null
}
