// =============================================================================
// EXPLAIN — the legibility / democratization layer
// =============================================================================
// Pure functions that turn raw records into ONE plain-English sentence a
// non-expert can understand. The whole product thesis lives here: official data
// is published in institutional units (USD/g, kg seized, hectares); people
// understand it in human units (hours of wages, tonnes, "the biggest route").
// Keep these pure + string-returning so they can be tested and, later, localised.

import { affordabilityDays } from './metrics.js'

const fmtUsd = (v) => (v == null ? 'n/a' : `$${Math.round(v).toLocaleString()}`)

/** kg → a human mass phrase (tonnes once it's big enough to deserve them). */
export function humanizeMass(kg) {
  if (kg == null) return 'n/a'
  if (kg >= 1000) {
    const t = kg / 1000
    return `${t >= 10 ? Math.round(t) : t.toFixed(1)} tonnes`
  }
  return `${Math.round(kg).toLocaleString()} kg`
}

/** "days of income" → a wage phrase ("~15 hours of an average local wage"). */
export function humanizeAffordability(days) {
  if (days == null) return null
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24))
    return `roughly ${hours} hour${hours === 1 ? '' : 's'} of an average local wage`
  }
  const d = days < 10 ? Number(days.toFixed(1)) : Math.round(days)
  return `roughly ${d} day${d === 1 ? '' : 's'} of an average local wage`
}

/** Street prices: contrast cheapest vs dearest, anchored in wages. */
export function explainPrices(rows, drugLabel) {
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

/** Precursor flows: total seized, China's share, biggest single corridor. */
export function explainFlows(flows, scopeLabel = 'the records shown') {
  if (!flows || flows.length === 0) return `No trafficking corridors are recorded for ${scopeLabel}.`
  const total = flows.reduce((s, r) => s + r.quantityKg, 0)
  const chinaTotal = flows.filter((r) => r.origin === 'China').reduce((s, r) => s + r.quantityKg, 0)
  const top = [...flows].sort((a, b) => b.quantityKg - a.quantityKg)[0]
  const share = total ? Math.round((chinaTotal / total) * 100) : 0

  let s = `Across ${scopeLabel}, about ${humanizeMass(total)} of precursor chemicals were seized moving between countries.`
  if (chinaTotal > 0) s += ` China is the listed origin of ${share}% of that seized volume.`
  s += ` The single biggest corridor runs ${top.origin} → ${top.destination}${top.transit ? ` (via ${top.transit})` : ''}, at ${humanizeMass(top.quantityKg)}.`
  return s
}

/** Myanmar focus: where activity/cultivation peaks + the busiest exit route. */
export function explainMyanmar(regionRows, flows, year, labelOf) {
  const parts = []
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
  return parts.length ? parts.join(' ') : null
}
