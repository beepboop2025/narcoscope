// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import artifact from '../../public/data/narcoscope-palimpsest-bri-v1.json'
import { resetBriContextCacheForTests } from '../lib/briDossier'
import BriDossier from './BriDossier'

afterEach(() => {
  cleanup()
  resetBriContextCacheForTests()
  vi.unstubAllGlobals()
})

describe('BRI dossier failure boundary', () => {
  it('shows explicit unavailability instead of partial counts for a damaged response', async () => {
    const damaged: any = structuredClone(artifact)
    delete damaged.targetCoverage[0].targets[0].sources[0].rightsStatus
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        resource: 'palimpsest-bri',
        data: { schema: 'narcoscope.api.palimpsest-bri-envelope.v1', data: damaged },
      }),
    }))

    render(<BriDossier scope="bri" />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/cannot be shown safely/i)).toBeTruthy()
    expect(screen.getByText(/No readiness or economic count has been inferred/i)).toBeTruthy()
    expect(screen.queryByText('Target ledgers')).toBeNull()
  })
})
