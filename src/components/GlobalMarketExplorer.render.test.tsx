// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import GlobalMarketExplorer from './GlobalMarketExplorer'

const source = { id: 'wb-wdi-arms-imports', name: 'World Development Indicators', publisher: 'World Bank', url: 'https://data.worldbank.org/', downloadUrl: 'https://data.worldbank.org/', license: 'CC BY 4.0', licenseUrl: 'https://www.worldbank.org/terms', retrievedAt: '2026-09-23T00:00:00Z', sha256: 'a'.repeat(64), notes: [] }
const coverage = (lastNumericPeriod: string) => ({ observations: 2, numericObservations: 2, reported: 2, estimated: 0, unavailable: 0, firstPeriod: '2024', lastPeriod: lastNumericPeriod, firstNumericPeriod: '2024', lastNumericPeriod })
const indicator = (id: string, market: string, label: string, lastNumericPeriod: string, featured: boolean) => ({ id, sourceId: source.id, market, label, unit: 'TIV', measureType: 'transfer', description: label, limitations: [], featured,
  publication: { status: 'published', reason: '' }, coverage: coverage(lastNumericPeriod),
  dimensions: { geographies: [{ code: 'AAA', name: 'Country A', level: 'country' }], categories: [''], subgroups: [''], selections: [{ category: '', subgroup: '', firstPeriod: '2024', lastPeriod: lastNumericPeriod, lastNumericPeriod, latestNumericObservations: 1 }] } })
const catalog = { schema: 'narcoscope.global-market-catalog.v1', generatedAt: '2026-09-23T00:00:00Z', limitations: [], datasets: [{ id: 'global-arms-economy', title: 'Arms and economy', sha256: 'b'.repeat(64), generatedAt: '2026-09-23T00:00:00Z', sources: [source], coverage: coverage('2025'), limitations: [],
  indicators: [indicator('older', 'economy', 'Older featured measure', '2020', true), indicator('arms-imports', 'arms', 'Arms imports', '2025', true)] }] }
const row = (period: string, value: number) => ({ id: 'arms-imports:AAA:' + period, indicatorId: 'arms-imports', geoCode: 'AAA', geoName: 'Country A', geoLevel: 'country', period, category: '', subgroup: '', value, lower: null, upper: null, status: 'reported', sourceLocator: 'WDI', datasetId: 'global-arms-economy', sourceId: source.id, unit: 'TIV', measureType: 'transfer' })
const query = (rows: ReturnType<typeof row>[]) => ({ datasets: [{ id: 'global-arms-economy', sha256: 'b'.repeat(64) }], observations: rows, pagination: { page: 1, limit: 500, total: rows.length, pages: 1, nextPage: null }, sources: [source], limitations: [] })

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Global market explorer table', () => {
  it('opens on the latest measure and hides columns that every loaded record leaves empty', async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ ok: true, data: url.includes('/markets') ? catalog : query(url.includes('geo=') ? [row('2024', 3), row('2025', 5)] : [row('2025', 5)]) }) }))
    vi.stubGlobal('fetch', fetch)
    render(<GlobalMarketExplorer market="all" />)
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1))
    // The world view opens on the 2025 arms measure rather than the 2020 one listed first.
    expect(screen.getByRole('heading', { name: 'Arms imports' })).toBeTruthy()
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Location', 'Period', 'Value', 'Record'])
    expect(screen.getByRole('note').textContent).toBe('Hidden columns: Category, Breakdown and Reported interval. The source supplies no value for them in this record, so they would be blank in every row. The download keeps every source column.')
    expect(document.body.textContent).not.toMatch(/[\u2013\u2014]/)
  })
})
