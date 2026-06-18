import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dailyIncomeUsd,
  affordabilityDays,
  latestYoYChange,
  purityAdjustedPrice,
} from './metrics.js'

describe('dailyIncomeUsd(iso3)', () => {
  it('returns annual GDP per capita divided by 365 for a known country', () => {
    assert.equal(dailyIncomeUsd('USA'), 70000 / 365)
  })

  it('returns null for an unknown iso3', () => {
    assert.equal(dailyIncomeUsd('ZZZ'), null)
  })
})

describe('affordabilityDays(priceUsd, iso3)', () => {
  it('returns the price divided by daily income for a known country', () => {
    const expected = 100 / (70000 / 365)
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
  it('returns the correct percentage change for a sorted series with >=2 points', () => {
    const series = [
      { year: 2018, price: 100 },
      { year: 2021, price: 120 },
    ]
    assert.equal(latestYoYChange(series), 20)
  })

  it('returns the correct percentage change for an unsorted series', () => {
    const series = [
      { year: 2021, price: 120 },
      { year: 2018, price: 100 },
    ]
    assert.equal(latestYoYChange(series), 20)
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
  it('returns null for now (stub)', () => {
    // TODO: tighten once implemented
    assert.equal(purityAdjustedPrice(100, 50), null)
    assert.equal(purityAdjustedPrice(100, null), null)
    assert.equal(purityAdjustedPrice(100, 0), null)
  })
})
