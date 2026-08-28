import { describe, expect, it } from 'vitest'
import { canonicalViewUrl, citationCardKicker, trackedViewUrl, viewCitation } from './AuthorityBar'

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

  it('keeps Palimpsest identity and readiness semantics on regional dossiers', () => {
    const citation = viewCitation('Balochistan evidence', 'balochistan', '2026-08-27')
    expect(citation).toContain('Palimpsest, via NarcoScope')
    expect(citation).toContain('Evidence-readiness ledger')
    expect(citation).not.toContain('official record')
    expect(citationCardKicker('bri')).toBe('PALIMPSEST VIA NARCOSCOPE · EVIDENCE READINESS')
    expect(citationCardKicker('flows')).toBe('NARCOSCOPE · OFFICIAL RECORD')
  })
})
