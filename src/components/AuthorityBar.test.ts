import { describe, expect, it } from 'vitest'
import { canonicalViewUrl, trackedViewUrl, viewCitation } from './AuthorityBar'

describe('NarcoScope authority links', () => {
  it('preserves an exact evidence tab in canonical and tracked links', () => {
    expect(canonicalViewUrl('flows')).toBe('https://narcoscope.com/#flows')
    const tracked = new URL(trackedViewUrl('flows', 'copy_link'))
    expect(tracked.hash).toBe('#flows')
    expect(tracked.searchParams.get('utm_medium')).toBe('earned_share')
    expect(tracked.searchParams.get('utm_content')).toBe('copy_link')
  })

  it('keeps citations canonical rather than adding campaign parameters', () => {
    const citation = viewCitation('Precursor Flows & Prices', 'flows', '2026-08-13')
    expect(citation).toContain('accessed 2026-08-13')
    expect(citation).toContain('https://narcoscope.com/#flows')
    expect(citation).not.toContain('utm_')
  })
})
