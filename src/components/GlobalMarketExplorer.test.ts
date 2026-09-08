import { describe, expect, it } from 'vitest'
import { chartPeriods, type MarketObservation } from './GlobalMarketExplorer'

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
