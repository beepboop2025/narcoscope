// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import GlobalMarketExplorer from './GlobalMarketExplorer'
import WdrRightsNotice from './WdrRightsNotice'
import AuthorityBar from './AuthorityBar'
const source = { id: 'wdr2026-seizures', name: 'UNODC WDR seizure source', publisher: 'UNODC', url: 'https://www.unodc.org/', downloadUrl: 'https://www.unodc.org/', license: 'Commercial permission required', licenseUrl: 'https://www.unodc.org/', retrievedAt: '2026-10-28T00:00:00Z', sha256: 'a'.repeat(64), notes: [] }
const indicator = { id: 'wdr2026-seizures-kg', sourceId: source.id, label: 'Reported drug seizures', market: 'drugs', unit: 'kg', description: 'Source-defined administrative evidence', limitations: [], publication: { status: 'metadata_only', reason: 'Measurements and derivatives withheld pending permission.' }, coverage: { observations: null, numericObservations: null, reported: null, estimated: null, unavailable: null, firstPeriod: null, lastPeriod: null }, dimensions: { geographies: [], categories: [], subgroups: [], selections: [] } }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Publication rights states', () => {
  it('keeps the source and units discoverable without numeric charts, CSV download or a false no-records claim', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, data: { datasets: [{ id: 'global-drugs', title: 'Drug evidence', sha256: 'b'.repeat(64), sources: [source], indicators: [indicator], limitations: [] }] } }) }))
    vi.stubGlobal('fetch', fetch)
    render(<GlobalMarketExplorer market="drugs" />)
    await waitFor(() => expect(screen.getByText('Measurements withheld pending publication permission')).toBeTruthy())
    expect(screen.getByText('UNODC WDR seizure source')).toBeTruthy()
    expect(screen.getByText('kg')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download this selection' })).toBeNull()
    expect(screen.queryByText(/No records match/)).toBeNull()
    expect(document.querySelectorAll('svg')).toHaveLength(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not offer chart SVG export on a restricted legacy route', () => {
    render(<AuthorityBar tab="prices" label="Street-price source metadata" />)
    expect(screen.queryByRole('button', { name: 'Download chart SVG' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy citation' })).toBeTruthy()
  })
  it('preserves legacy route meaning and points to source metadata and separately permitted evidence', () => {
    render(<WdrRightsNotice title="Drug-seizure source metadata" />)
    expect(screen.getByText('Drug-seizure source metadata')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'research catalog' }).getAttribute('href')).toBe('/api/v1/markets')
    expect(screen.getByText(/withheld values are not zero/)).toBeTruthy()
    expect(document.querySelectorAll('svg, table, button[download]')).toHaveLength(0)
  })
})
