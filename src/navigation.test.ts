import { describe, expect, it } from 'vitest'
import {
  LENS_GROUPS,
  PRIMARY_DOSSIER_IDS,
  PRIMARY_DOSSIERS,
  TABS,
  groupForTab,
  lensForTab,
} from './navigation'

describe('research lens information architecture', () => {
  it('keeps every view unique and reachable through one group', () => {
    const ids = TABS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(17)
    expect(LENS_GROUPS.every((group) => group.items.length > 0)).toBe(true)
    expect(ids.every((id) => Boolean(groupForTab(id)))).toBe(true)
  })

  it('keeps public labels and evidence descriptions beside each route', () => {
    expect(groupForTab('triangulate')?.label).toBe('Networks')
    expect(lensForTab('newsroom')?.description).toMatch(/countercases/i)
    expect(lensForTab('states')?.description).toMatch(/mortality/i)
  })

  it('keeps all four regional dossiers in the persistent navigation rail', () => {
    expect(PRIMARY_DOSSIER_IDS).toEqual(['bri', 'balochistan', 'pakistan-gwadar', 'myanmar'])
    expect(PRIMARY_DOSSIERS.map((item) => item.shortLabel)).toEqual([
      'BRI & Corridors',
      'Balochistan',
      'Pakistan & Gwadar',
      'Myanmar',
    ])
  })
})
