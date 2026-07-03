import { describe, it, assert } from 'vitest'
import { canonicalSourceId, sourceFamilyLabel, sourceReliabilityTier, sourceReliabilityWeight } from './sourceReliability'

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

describe('canonicalSourceId', () => {
  it('collapses name-string variants of the same organisation into one family', () => {
    assert.equal(canonicalSourceId('UNODC'), canonicalSourceId('UNODC Myanmar Opium Survey 2024'))
    assert.equal(canonicalSourceId('ACLED'), canonicalSourceId('ACLED Myanmar event data'))
    assert.equal(canonicalSourceId('International Crisis Group'), canonicalSourceId('Crisis Group briefing'))
  })

  it('resolves name variants via matching domain when the name itself is ambiguous', () => {
    assert.equal(canonicalSourceId('Ministry statement', 'https://www.unodc.org/statement'), canonicalSourceId('UNODC'))
  })

  it('keeps genuinely distinct organisations as distinct families', () => {
    assert.notEqual(canonicalSourceId('UNODC'), canonicalSourceId('INCB'))
    assert.notEqual(canonicalSourceId('Reuters'), canonicalSourceId('AFP'))
  })

  it('normalises unrecognised source names so casing/whitespace differences still collapse', () => {
    assert.equal(canonicalSourceId('Local NGO Bulletin'), canonicalSourceId(' local ngo bulletin '))
  })

  it('keeps genuinely distinct unrecognised sources apart', () => {
    assert.notEqual(canonicalSourceId('Local NGO Bulletin'), canonicalSourceId('Another Local Outlet'))
  })

  it('falls back to a stable "unknown" id when there is no name or url', () => {
    assert.equal(canonicalSourceId(undefined), 'unknown')
    assert.equal(canonicalSourceId(null), 'unknown')
  })

  it('strips the internal name: prefix from display labels but leaves curated family ids alone', () => {
    assert.equal(sourceFamilyLabel(canonicalSourceId('Local NGO Bulletin')), 'local ngo bulletin')
    assert.equal(sourceFamilyLabel('incb'), 'incb')
    assert.equal(sourceFamilyLabel('unknown'), 'unknown')
  })
})
