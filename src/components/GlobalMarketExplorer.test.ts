import { describe, expect, it } from 'vitest'
import { chartPeriods, defaultEntry, hiddenColumnsNote, periodEnd, suppliedColumns, type MarketObservation } from './GlobalMarketExplorer'

const rows = (...periods: string[]) => periods.map(period => ({ period })) as MarketObservation[]
describe('source-period chart continuity', () => {
  it('exposes unreported annual gaps instead of connecting distant observations', () => {
    expect(chartPeriods(rows('2020', '2023'))).toEqual(['2020', '2021', '2022', '2023'])
  })
  it('keeps monthly gaps across year boundaries visible', () => {
    expect(chartPeriods(rows('2020-11', '2021-02'))).toEqual(['2020-11', '2020-12', '2021-01', '2021-02'])
  })
  it('does not disaggregate annual observations into invented monthly periods', () => {
    expect(chartPeriods(rows('2020', '2021-02'))).toEqual(['2020', '2021-02'])
    expect(chartPeriods([])).toEqual([])
  })
})

const entry = (key: string, lastNumericPeriod: string | null, featured = true) => ({ key, indicator: { featured, coverage: { lastNumericPeriod } } })
describe('default measure', () => {
  it('opens the world view on the featured measure with the latest reference period', () => {
    // The live catalog previously opened a StatCan table whose newest value is December 2020.
    const entries = [entry('drugs', '2023-11'), entry('arms', '2025'), entry('economy', '2025'), entry('withheld', null, false)]
    expect(defaultEntry(entries)?.key).toBe('arms')
    expect(defaultEntry([entry('old-monthly', '2020-12'), entry('annual', '2020')])?.key).toBe('old-monthly')
    expect(defaultEntry([entry('annual', '2023'), entry('monthly', '2023-11')])?.key).toBe('annual')
  })
  it('falls back to the first measure when nothing is featured', () => {
    expect(defaultEntry([entry('first', null, false), entry('second', null, false)])?.key).toBe('first')
    expect(defaultEntry([])).toBeUndefined()
    expect(periodEnd('2024')).toBe('2024-12')
    expect(periodEnd(null)).toBe('')
  })
})

const record = (category: string, subgroup: string, lower: number | null = null, upper: number | null = null) => ({ category, subgroup, lower, upper })
describe('blank observation columns', () => {
  it('hides category, breakdown and interval columns that no loaded record supplies, and says so', () => {
    // The arms and economy measures report neither a category, a breakdown nor an interval.
    const loaded = [record('', ''), record('', '')]
    expect(suppliedColumns(loaded)).toEqual({ category: false, subgroup: false, interval: false })
    expect(hiddenColumnsNote(loaded)).toBe('Hidden columns: Category, Breakdown and Reported interval. The source supplies no value for them in any of these 2 records, so they would be blank in every row. The download keeps every source column.')
  })
  it('keeps a column when any record supplies it, including a one-sided interval', () => {
    const loaded = [record('Cocaine', ''), record('', '', null, 4)]
    expect(suppliedColumns(loaded)).toEqual({ category: true, subgroup: false, interval: true })
    expect(hiddenColumnsNote(loaded)).toBe('Hidden column: Breakdown. The source supplies no value for it in any of these 2 records, so it would be blank in every row. The download keeps every source column.')
    expect(hiddenColumnsNote([record('A', 'B', 1, 2)])).toBe('')
  })
  it('says nothing before records load', () => {
    expect(hiddenColumnsNote([])).toBe('')
  })
})
