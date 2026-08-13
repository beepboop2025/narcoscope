import { describe, expect, it } from 'vitest'
import { resolveCorridorTabIndex, resolveTabFromHash } from './App'

describe('App hash navigation', () => {
  it('resolves tab routes and newsroom deep links', () => {
    expect(resolveTabFromHash('#flows')).toBe('flows')
    expect(resolveTabFromHash('#/newsroom')).toBe('newsroom')
    expect(resolveTabFromHash('#news-source-SRC-INCB-PRECURSORS-2025')).toBe('newsroom')
    expect(resolveTabFromHash('#news-sentence-S007')).toBe('newsroom')
    expect(resolveTabFromHash('#news-limitations')).toBe('newsroom')
    expect(resolveTabFromHash('#news-corrections')).toBe('newsroom')
    expect(resolveTabFromHash('')).toBe('overview')
    expect(resolveTabFromHash('#not-a-route')).toBeNull()
  })
})

describe('Evidence corridor keyboard navigation', () => {
  it('wraps arrow keys and supports Home and End', () => {
    expect(resolveCorridorTabIndex('ArrowRight', 3)).toBe(0)
    expect(resolveCorridorTabIndex('ArrowLeft', 0)).toBe(3)
    expect(resolveCorridorTabIndex('Home', 2)).toBe(0)
    expect(resolveCorridorTabIndex('End', 1)).toBe(3)
    expect(resolveCorridorTabIndex('Tab', 1)).toBeNull()
  })
})
