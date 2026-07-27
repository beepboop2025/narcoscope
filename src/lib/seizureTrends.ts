// =============================================================================
// SEIZURE TRENDS — the time dimension of the largest dataset
// =============================================================================
// The Flow Map shows seizures one year at a time. This opens the other axis:
// across 2019-2023, which drug classes are rising or falling worldwide, and
// which countries drove the change. Built entirely on the selectors in
// seizures.ts, so it inherits the same columnar decode and the same honest
// framing — "seizures", never "consumption" or "production".
//
// A standing caveat this module surfaces rather than hides: seizure totals are
// dominated by a handful of mega-seizures, so a single record can swing a
// world total (cocaine's 2023 jump is one such spike). The movers therefore
// report the raw change and let the reader see the magnitude, and the trend
// chart is drawn on a shared honest scale, never per-year-normalised.

import {
  SEIZURE_GROUPS, SEIZURE_YEARS, SEIZURE_COUNTRIES,
  worldTotal, totalsByCountry, shortGroupLabel,
} from './seizures'

export interface GroupTrend {
  group: string
  label: string
  groupIndex: number
  /** [year, kg] across every reporting year, ascending. */
  series: [year: number, kg: number][]
  latestKg: number
  /** Change over the full window as a proportion (0.5 = +50%); null if base is 0. */
  changePct: number | null
}

/**
 * World seizure trend per drug group, ordered by latest-year volume. Groups
 * with no volume in any year are dropped (nothing to chart).
 */
export function worldTrendByGroup(): GroupTrend[] {
  const first = SEIZURE_YEARS[0]
  const last = SEIZURE_YEARS[SEIZURE_YEARS.length - 1]
  return SEIZURE_GROUPS
    .map((group, groupIndex) => {
      const series = SEIZURE_YEARS.map((y) => [y, worldTotal(groupIndex, y)] as [number, number])
      const base = worldTotal(groupIndex, first)
      const latestKg = worldTotal(groupIndex, last)
      return {
        group, label: shortGroupLabel(group), groupIndex, series, latestKg,
        changePct: base > 0 ? (latestKg - base) / base : null,
      }
    })
    .filter((g) => g.series.some(([, kg]) => kg > 0))
    .sort((a, b) => b.latestKg - a.latestKg)
}

export interface CountryMover {
  iso3: string
  name: string
  fromKg: number
  toKg: number
  changeKg: number
  changePct: number | null
}

/**
 * Countries ranked by absolute change in seized volume for a drug group (or all
 * drugs when groupIndex is null) between the first and last year. Absolute
 * change, not percentage, because a country going from 1 kg to 100 kg is +9900%
 * but irrelevant next to one moving thousands of tonnes — the mega-seizure
 * reality this dataset is shaped by.
 */
export function countryMovers(groupIndex: number | null): CountryMover[] {
  const first = SEIZURE_YEARS[0]
  const last = SEIZURE_YEARS[SEIZURE_YEARS.length - 1]
  const from = totalsByCountry(groupIndex, first)
  const to = totalsByCountry(groupIndex, last)
  const iso3s = new Set<string>([...from.keys(), ...to.keys()])
  const nameOf = (iso3: string) => SEIZURE_COUNTRIES.find((c) => c.iso3 === iso3)?.name ?? iso3

  const movers: CountryMover[] = []
  for (const iso3 of iso3s) {
    const fromKg = from.get(iso3) ?? 0
    const toKg = to.get(iso3) ?? 0
    movers.push({
      iso3, name: nameOf(iso3), fromKg, toKg,
      changeKg: toKg - fromKg,
      changePct: fromKg > 0 ? (toKg - fromKg) / fromKg : null,
    })
  }
  return movers.sort((a, b) => Math.abs(b.changeKg) - Math.abs(a.changeKg))
}

/** The window label, e.g. "2019–2023". */
export const TREND_WINDOW: [number, number] = [
  SEIZURE_YEARS[0], SEIZURE_YEARS[SEIZURE_YEARS.length - 1],
]
