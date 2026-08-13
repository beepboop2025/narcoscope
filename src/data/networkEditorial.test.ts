import { describe, expect, it } from 'vitest'
import { PALIMPSEST_FALLBACK, selectPalimpsestRelayStory, type PalimpsestRelayStory } from './networkEditorial'

const story = (id: string, status: string, priority: string): PalimpsestRelayStory => ({
  ...PALIMPSEST_FALLBACK,
  id,
  status,
  priority,
})

describe('Palimpsest relay editorial policy', () => {
  it('never prefers a stale lead over an available live story', () => {
    const chosen = selectPalimpsestRelayStory([
      story('stale-lead', 'stale', 'lead'),
      story('live-standard', 'live', 'standard'),
    ])
    expect(chosen?.id).toBe('live-standard')
  })

  it('prefers the live lead and safely handles an empty feed', () => {
    expect(selectPalimpsestRelayStory([
      story('live-standard', 'live', 'standard'),
      story('live-lead', 'live', 'lead'),
    ])?.id).toBe('live-lead')
    expect(selectPalimpsestRelayStory([])).toBeNull()
  })
})
