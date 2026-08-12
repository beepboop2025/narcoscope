// Supplemental tests pinning under-covered branches of the legibility layer:
// the single-country price fallback, the latest-year scoping, and the China
// origin-share sentence in flow explanations.

import { describe, it, assert } from 'vitest'
import { explainPrices, explainFlows } from './explain'

describe('explainPrices — single-country fallback', () => {
  it('uses the "costs about" phrasing when only one country is in scope', () => {
    const rows = [
      { country: 'Colombia', iso3: 'COL', year: 2023, priceUsdPerGram: 45 },
    ]
    const s = explainPrices(rows, 'Cocaine')
    assert.ok(s.includes('costs about'))
    assert.ok(s.includes('Colombia'))
    assert.ok(s.includes('$45'))
    // The two-country "runs ... versus ..." phrasing must NOT appear.
    assert.equal(s.includes('versus'), false)
  })

  it('scopes to the latest year when multiple countries report that year', () => {
    const rows = [
      { country: 'OldLand', iso3: 'OLD', year: 2010, priceUsdPerGram: 999 },
      { country: 'CheapLand', iso3: 'AAA', year: 2023, priceUsdPerGram: 10 },
      { country: 'DearLand', iso3: 'BBB', year: 2023, priceUsdPerGram: 200 },
    ]
    const s = explainPrices(rows, 'Heroin')
    // 2010 outlier must be excluded; latest-year pair drives the sentence.
    assert.ok(s.includes('CheapLand'))
    assert.ok(s.includes('DearLand'))
    assert.equal(s.includes('OldLand'), false)
    assert.equal(s.includes('$999'), false)
  })

  it('falls back to all rows when the latest year has fewer than two points', () => {
    const rows = [
      { country: 'Alpha', iso3: 'AAA', year: 2010, priceUsdPerGram: 10 },
      { country: 'Beta', iso3: 'BBB', year: 2011, priceUsdPerGram: 200 },
    ]
    const s = explainPrices(rows, 'Cannabis')
    // Latest year (2011) has only one row, so scope widens back to both years.
    assert.ok(s.includes('Alpha'))
    assert.ok(s.includes('Beta'))
  })
})

describe('explainFlows — qualified aggregate boundary', () => {
  it('does not infer a country share from curated corridor quantities', () => {
    const flows = [
      { origin: 'China', destination: 'Mexico', transit: null, quantityKg: 750, quantityRelation: 'exact', recordKind: 'multi_incident_aggregate', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass', drug: 'x' },
      { origin: 'India', destination: 'Mexico', transit: null, quantityKg: 250, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass', drug: 'x' },
    ]
    const s = explainFlows(flows, 'the records shown')
    assert.ok(s.includes('1.0 tonnes across 2 aggregation-eligible exact records'))
    assert.equal(s.includes('China is the listed origin'), false)
    assert.equal(s.includes('China → Mexico'), false)
  })

  it('omits the China sentence entirely when no flow originates in China', () => {
    const flows = [
      { origin: 'India', destination: 'Mexico', transit: 'UAE', quantityKg: 100, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass', drug: 'x' },
    ]
    const s = explainFlows(flows, 'the records shown')
    assert.equal(s.includes('China is the listed origin'), false)
    assert.ok(s.includes('100 kg across 1 aggregation-eligible exact record'))
  })

  it('excludes an exact derived mixed-basis row from a compatible subtotal', () => {
    const flows = [
      { origin: 'India', destination: 'DR Congo', transit: null, quantityKg: 350, quantityRelation: 'exact', recordKind: 'derived_subtotal', aggregationEligibility: 'ineligible_derived', aggregationGroup: null },
      { origin: 'Egypt', destination: 'Germany', transit: null, quantityKg: 40, quantityRelation: 'exact', recordKind: 'multi_incident_aggregate', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass' },
    ]
    const s = explainFlows(flows, 'methamphetamine precursors')

    assert.ok(s.includes('40 kg across 1 aggregation-eligible exact record'))
    assert.equal(s.includes('390 kg'), false)
    assert.ok(s.includes('1 non-exact, derived, incompatible-basis or unqualified record is kept separate'))
  })

  it('does not produce one subtotal across multiple eligible canonical groups', () => {
    const flows = [
      { origin: 'A', destination: 'B', transit: null, quantityKg: 100, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass' },
      { origin: 'C', destination: 'D', transit: null, quantityKg: 200, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'potassium_permanganate_substance_mass' },
    ]
    const s = explainFlows(flows, 'mixed bases')

    assert.ok(s.includes('no cross-group subtotal'))
    assert.ok(s.includes('2 canonical aggregation groups'))
    assert.equal(s.includes('300 kg'), false)
  })
})
