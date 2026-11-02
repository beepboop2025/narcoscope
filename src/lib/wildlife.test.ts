import { describe, expect, it } from 'vitest'
import { WILDLIFE, taxonCommon } from './wildlife'

describe('wildlife taxon names', () => {
  it('gives every confiscated taxon in the extract an English common name', () => {
    // 14 of these 25 showed a dash on the live page on 2026-11-02.
    expect(WILDLIFE.topTaxa).toHaveLength(25)
    expect(WILDLIFE.topTaxa.filter((row) => !taxonCommon(row.taxon)).map((row) => row.taxon)).toEqual([])
  })

  it('uses the CITES names for species, families and genera', () => {
    // Species+ English names.
    expect(taxonCommon('Malayopython reticulatus')).toBe('Reticulated python')
    expect(taxonCommon('Eretmochelys imbricata')).toBe('Hawksbill turtle')
    expect(taxonCommon('Caiman crocodilus')).toBe('Spectacled caiman')
    // CITES Appendices family names; a genus is marked when its family has others.
    expect(taxonCommon('Orchidaceae spp.')).toBe('Orchids')
    expect(taxonCommon('Hippocampus spp.')).toBe('Seahorses')
    expect(taxonCommon('Crocodylus spp.')).toBe('Crocodiles (genus Crocodylus)')
    expect(taxonCommon('Crocodylidae spp.')).toBe('Crocodiles (family)')
    expect(taxonCommon('Unlisted taxon')).toBeNull()
  })
})
