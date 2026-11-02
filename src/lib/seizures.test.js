import { describe, it, assert } from 'vitest'
import {
  SEIZURE_COUNTRIES,
  SEIZURE_GROUPS,
  SEIZURE_YEARS,
  GROUP_SHORT_LABEL,
  countryGroupTotals,
  countryTrend,
  fmtKg,
  groupsByVolume,
  logShare,
  maxCountryTotal,
  topDrugs,
  totalsByCountry,
  worldTotal,
} from './seizures'
import { COUNTRY_CENTROID } from '../data/countryGeo'
import { originalsPresent } from '../../lib/withheld-originals.mjs'
// These tests read real UNODC WDR values, which the public repository no longer
// tracks. They run where the withheld originals exist (the collector's pipeline
// run, an owner's machine) and skip on a clone that holds only projections.
const NEEDS_WDR_ORIGINALS = !originalsPresent()

describe('seizures dataset integrity', () => {
  it('covers the WDR 2025 reporting window', () => {
    assert.deepEqual(SEIZURE_YEARS, [2019, 2020, 2021, 2022, 2023])
  })

  it('every UNODC drug group has a short display label', () => {
    for (const g of SEIZURE_GROUPS) {
      assert.ok(GROUP_SHORT_LABEL[g], `missing short label for group "${g}"`)
    }
  })

  it('every reporting country has a map centroid', () => {
    for (const { iso3, name } of SEIZURE_COUNTRIES) {
      assert.ok(COUNTRY_CENTROID[iso3], `missing centroid for ${iso3} (${name})`)
    }
  })

  it('every country total is a positive finite number', () => {
    for (const year of SEIZURE_YEARS) {
      for (const [iso3, kg] of totalsByCountry(null, year)) {
        assert.ok(Number.isFinite(kg) && kg >= 0, `bad total for ${iso3}/${year}: ${kg}`)
      }
    }
  })
})

describe('seizure selectors', () => {
  it('group-filtered totals never exceed the all-drugs total', () => {
    const year = SEIZURE_YEARS[SEIZURE_YEARS.length - 1]
    const all = totalsByCountry(null, year)
    for (let g = 0; g < SEIZURE_GROUPS.length; g++) {
      for (const [iso3, kg] of totalsByCountry(g, year)) {
        assert.ok(kg <= (all.get(iso3) ?? 0) + 1e-6, `${SEIZURE_GROUPS[g]} > all for ${iso3}`)
      }
    }
  })

  it.skipIf(NEEDS_WDR_ORIGINALS)('per-group country breakdown sums to the country total', () => {
    const year = 2023
    const all = totalsByCountry(null, year)
    const iso3 = [...all.keys()][0]
    const sum = countryGroupTotals(iso3, year).reduce((s, g) => s + g.kg, 0)
    assert.ok(Math.abs(sum - all.get(iso3)) < 1e-6)
  })

  it('world total equals the sum of country totals', () => {
    const year = 2023
    let sum = 0
    for (const kg of totalsByCountry(null, year).values()) sum += kg
    assert.equal(worldTotal(null, year), sum)
  })

  it.skipIf(NEEDS_WDR_ORIGINALS)('topDrugs returns descending volumes from known groups', () => {
    const top = topDrugs('USA', 2023, 5)
    assert.ok(top.length > 0, 'USA must report seizures in 2023')
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].kg >= top[i].kg)
    for (const t of top) assert.ok(SEIZURE_GROUPS.includes(t.group))
  })

  it('countryTrend returns one entry per reporting year, in order', () => {
    const trend = countryTrend('MMR', null)
    assert.deepEqual(trend.map(([y]) => y), SEIZURE_YEARS)
  })

  it('maxCountryTotal bounds every per-year country total', () => {
    const max = maxCountryTotal(null)
    for (const year of SEIZURE_YEARS) {
      for (const kg of totalsByCountry(null, year).values()) {
        assert.ok(kg <= max + 1e-6)
      }
    }
  })

  it('groupsByVolume is sorted descending and covers all groups', () => {
    const ranked = groupsByVolume()
    assert.equal(ranked.length, SEIZURE_GROUPS.length)
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].kg >= ranked[i].kg)
  })

  it('logShare is 0 at zero, 1 at max, monotonic between', () => {
    assert.equal(logShare(0, 1000), 0)
    assert.equal(logShare(1000, 1000), 1)
    assert.ok(logShare(10, 1000) < logShare(100, 1000))
  })

  it('fmtKg switches units at one tonne', () => {
    assert.equal(fmtKg(2500), '2.5 t')
    assert.equal(fmtKg(150000), '150 t')
    assert.equal(fmtKg(42), '42.0 kg')
    assert.equal(fmtKg(0.5), '0.50 kg')
  })
})
