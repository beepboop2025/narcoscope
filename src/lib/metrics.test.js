import { describe, it, assert } from 'vitest'
import {
  dailyIncomeUsd,
  affordabilityDays,
  latestYoYChange,
  purityAdjustedPrice,
} from './metrics'
import { GDP_PER_CAPITA_USD } from '../data/prices'

describe('dailyIncomeUsd(iso3)', () => {
  it('returns annual GDP per capita divided by 365 for a known country', () => {
    // Derived from the bundled table, not a magic number, so refreshing the
    // World Bank figures (fetch-gdp.mjs) can't silently break this test.
    assert.equal(dailyIncomeUsd('USA'), GDP_PER_CAPITA_USD.USA / 365)
  })

  it('returns null for an unknown iso3', () => {
    assert.equal(dailyIncomeUsd('ZZZ'), null)
  })
})

describe('affordabilityDays(priceUsd, iso3)', () => {
  it('returns the price divided by daily income for a known country', () => {
    const expected = 100 / (GDP_PER_CAPITA_USD.USA / 365)
    assert.equal(affordabilityDays(100, 'USA'), expected)
  })

  it('returns null when the price is null', () => {
    assert.equal(affordabilityDays(null, 'USA'), null)
  })

  it('returns null when the iso3 is unknown', () => {
    assert.equal(affordabilityDays(100, 'ZZZ'), null)
  })
})

describe('latestYoYChange(series)', () => {
  it('returns the correct percentage change for consecutive annual points', () => {
    const series = [
      { year: 2020, price: 100 },
      { year: 2021, price: 120 },
    ]
    assert.equal(latestYoYChange(series), 20)
  })

  it('returns the correct percentage change for an unsorted series', () => {
    const series = [
      { year: 2021, price: 120 },
      { year: 2020, price: 100 },
    ]
    assert.equal(latestYoYChange(series), 20)
  })

  it('leaves a multi-year gap unavailable instead of calling it year-over-year', () => {
    assert.equal(latestYoYChange([{ year: 2018, price: 100 }, { year: 2021, price: 120 }]), null)
    assert.equal(latestYoYChange([{ year: 2020, price: 100 }, { year: 2021, price: 110 }, { year: 2023, price: 120 }]), null)
  })

  it('refuses ambiguous duplicate years and nonfinite values', () => {
    assert.equal(latestYoYChange([{ year: 2020, price: 100 }, { year: 2020, price: 110 }, { year: 2021, price: 120 }]), null)
    assert.equal(latestYoYChange([{ year: 2020, price: Infinity }, { year: 2021, price: 120 }]), null)
    assert.equal(latestYoYChange([{ year: 2020, price: 100 }, { year: NaN, price: 120 }]), null)
  })

  it('returns null for fewer than 2 points', () => {
    assert.equal(latestYoYChange([{ year: 2021, price: 100 }]), null)
    assert.equal(latestYoYChange([]), null)
    assert.equal(latestYoYChange(null), null)
  })

  it('returns null when the previous price is 0', () => {
    const series = [
      { year: 2018, price: 0 },
      { year: 2021, price: 100 },
    ]
    assert.equal(latestYoYChange(series), null)
  })
})

describe('purityAdjustedPrice(priceUsd, purityPct)', () => {
  it('divides price by the purity fraction to get price per pure gram', () => {
    assert.equal(purityAdjustedPrice(100, 50), 200)
    assert.equal(purityAdjustedPrice(100, 100), 100)
    assert.equal(purityAdjustedPrice(60, 30), 200)
  })

  it('returns null when purity is unknown (policy: refuse to adjust)', () => {
    assert.equal(purityAdjustedPrice(100, null), null)
  })

  it('returns null when the price is null', () => {
    assert.equal(purityAdjustedPrice(null, 50), null)
  })

  it('returns null for nonsensical / out-of-range purity', () => {
    assert.equal(purityAdjustedPrice(100, 0), null)
    assert.equal(purityAdjustedPrice(100, -5), null)
    assert.equal(purityAdjustedPrice(100, 150), null)
  })
})
