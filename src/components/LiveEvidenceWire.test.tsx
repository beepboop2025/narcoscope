// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LiveEvidenceWire from './LiveEvidenceWire'

const artifact = {
  schema: 'narcoscope.evidence-wire.v1',
  generatedAt: '2026-08-31T00:00:00Z',
  status: 'partial',
  window: { start: '2026-08-30T00:00:00Z', end: '2026-08-30T00:00:00Z' },
  items: [{
    id: 'action-1',
    title: 'Authority charges three defendants in firearms and fentanyl case',
    url: 'https://example.test/action-1',
    sourceId: 'authority',
    sourceName: 'Public authority',
    publishedAt: '2026-08-30T00:00:00Z',
    retrievedAt: '2026-08-31T00:00:00Z',
    evidenceClass: 'official-action',
    verificationState: 'source-published',
    legalStage: 'charge',
    topics: ['drug markets', 'arms trafficking'],
    countries: [],
    publicationAllowed: true,
  }],
  sources: [{
    id: 'authority', name: 'Public authority', status: 'fresh', checkedAt: '2026-08-31T00:00:00Z',
    lastSuccessAt: '2026-08-31T00:00:00Z', cadenceMinutes: 10, staleAfterMinutes: 90, rights: 'public metadata', detail: 'one item',
  }, {
    id: 'palimpsest', name: 'Palimpsest wire', status: 'restricted', checkedAt: '2026-08-31T00:00:00Z',
    lastSuccessAt: '2026-08-31T00:00:00Z', cadenceMinutes: 10, staleAfterMinutes: 90, rights: 'receipt only', detail: 'publication suppressed',
  }],
  caveats: ['A charge is not a conviction.'],
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('LiveEvidenceWire', () => {
  it('renders public metadata, legal stage and restricted source state separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(artifact), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<LiveEvidenceWire />)
    await waitFor(() => expect(screen.getByRole('heading', { name: artifact.items[0].title })).toBeTruthy())
    expect(screen.getByText('charge')).toBeTruthy()
    expect(screen.getByText('restricted')).toBeTruthy()
    expect(screen.getByText(/publication suppressed/i)).toBeTruthy()
    expect(screen.getAllByText(/stale after 90m/i)).toHaveLength(2)
    expect(screen.getByText(/headline is not an allegation ledger/i)).toBeTruthy()
  })

  it('retains a typed unavailable state when both the wire and fallback fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 503 })))
    render(<LiveEvidenceWire />)
    await waitFor(() => expect(screen.getByText(/last-good view retained/i)).toBeTruthy())
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
