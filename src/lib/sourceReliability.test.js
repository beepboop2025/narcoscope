import { describe, it, assert } from 'vitest'
import { sourceReliabilityTier, sourceReliabilityWeight } from './sourceReliability'

describe('sourceReliabilityTier', () => {
  it('grades well-known intergovernmental and conflict-monitoring sources as high reliability', () => {
    assert.equal(sourceReliabilityTier('UNODC Synthetic Drugs in East and Southeast Asia'), 'high')
    assert.equal(sourceReliabilityTier('INCB Precursors report'), 'high')
    assert.equal(sourceReliabilityTier('ACLED Myanmar event data'), 'high')
    assert.equal(sourceReliabilityTier('International Crisis Group'), 'high')
  })

  it('grades established wire services and regional press as medium reliability', () => {
    assert.equal(sourceReliabilityTier('Radio Free Asia'), 'medium')
    assert.equal(sourceReliabilityTier('Frontier Myanmar'), 'medium')
    assert.equal(sourceReliabilityTier('Reuters'), 'medium')
  })

  it('falls back to domain-based tiering for unrecognised source names', () => {
    assert.equal(sourceReliabilityTier('Ministry statement', 'https://example.gov/statement'), 'high')
    assert.equal(sourceReliabilityTier('Local NGO bulletin', 'https://ngo-watch.org/bulletin'), 'medium')
    assert.equal(sourceReliabilityTier('Anonymous Telegram channel', 'https://t.me/somechannel'), 'low')
  })

  it('defaults unknown sources with no URL to low reliability without discarding them', () => {
    assert.equal(sourceReliabilityTier('Unverified tip'), 'low')
    assert.equal(sourceReliabilityTier(undefined), 'low')
    assert.equal(sourceReliabilityTier(null, 'not a valid url'), 'low')
  })

  it('maps tiers to a monotonically ordered numeric weight', () => {
    const high = sourceReliabilityWeight('UNODC')
    const medium = sourceReliabilityWeight('Reuters')
    const low = sourceReliabilityWeight('Some blog')
    assert.ok(high > medium)
    assert.ok(medium > low)
    assert.ok(low > 0)
  })
})
