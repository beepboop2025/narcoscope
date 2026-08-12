import { describe, it, assert } from 'vitest'
import {
  humanizeMass,
  humanizeAffordability,
  explainPrices,
  explainFlows,
  explainMyanmar,
} from './explain'

describe('humanizeMass', () => {
  it('formats small masses in kg', () => {
    assert.equal(humanizeMass(500), '500 kg')
  })

  it('formats large masses in tonnes', () => {
    assert.equal(humanizeMass(12000), '12 tonnes')
  })

  it('keeps one decimal for sub-10-tonne masses', () => {
    assert.equal(humanizeMass(1500), '1.5 tonnes')
  })

  it('returns n/a for null input', () => {
    assert.equal(humanizeMass(null), 'n/a')
  })
})

describe('humanizeAffordability', () => {
  it('returns null for null input', () => {
    assert.equal(humanizeAffordability(null), null)
  })

  it('describes short spans in hours', () => {
    assert.equal(
      humanizeAffordability(0.5),
      'roughly 12 hours of an average local wage',
    )
  })

  it('uses a single hour for very small day values', () => {
    assert.equal(
      humanizeAffordability(0.04),
      'roughly 1 hour of an average local wage',
    )
  })

  it('describes one day in days', () => {
    assert.equal(humanizeAffordability(1), 'roughly 1 day of an average local wage')
  })

  it('describes longer spans in rounded days', () => {
    assert.equal(
      humanizeAffordability(15),
      'roughly 15 days of an average local wage',
    )
  })
})

describe('explainPrices', () => {
  it('returns null for empty input', () => {
    assert.equal(explainPrices([], 'methamphetamine'), null)
    assert.equal(explainPrices(null, 'methamphetamine'), null)
  })

  it('names both the cheapest and dearest country', () => {
    const rows = [
      { country: 'United States', iso3: 'USA', year: 2021, priceUsdPerGram: 65 },
      { country: 'Australia', iso3: 'AUS', year: 2021, priceUsdPerGram: 320 },
    ]
    const sentence = explainPrices(rows, 'methamphetamine')
    assert.ok(sentence.includes('United States'))
    assert.ok(sentence.includes('Australia'))
    assert.ok(sentence.includes('$65'))
    assert.ok(sentence.includes('$320'))
  })
})

describe('explainFlows', () => {
  it('reports an exact-only subtotal without ranking unlike records', () => {
    const flows = [
      {
        origin: 'China',
        destination: 'Myanmar',
        transit: 'Thailand',
        quantityKg: 5000,
        quantityRelation: 'exact',
        recordKind: 'multi_incident_aggregate',
        aggregationEligibility: 'eligible',
        aggregationGroup: 'pseudoephedrine_preparation_mass',
        drug: 'Methamphetamine',
      },
      {
        origin: 'Laos',
        destination: 'Thailand',
        quantityKg: 2000,
        quantityRelation: 'exact',
        recordKind: 'multi_incident_aggregate',
        aggregationEligibility: 'eligible',
        aggregationGroup: 'pseudoephedrine_preparation_mass',
        drug: 'Methamphetamine',
      },
    ]
    const sentence = explainFlows(flows, 'East Asia')
    assert.ok(sentence.includes('7.0 tonnes'))
    assert.ok(sentence.includes('2 aggregation-eligible exact records'))
    assert.ok(sentence.includes('pseudoephedrine-preparation mass group'))
    assert.ok(sentence.includes('not combined into a route share'))
  })

  it('returns the no-data phrase when flows are empty', () => {
    assert.equal(
      explainFlows([], 'East Asia'),
      'No trafficking corridors are recorded for East Asia.',
    )
  })

  it('does not treat a missing quantity qualifier as exact', () => {
    const sentence = explainFlows([
      { origin: 'Unknown', destination: 'Elsewhere', quantityKg: 900 },
    ], 'legacy imports')

    assert.ok(sentence.includes('no compatible exact subtotal'))
    assert.ok(sentence.includes('1 non-exact, derived, incompatible-basis or unqualified record is kept separate'))
  })
})

describe('explainMyanmar', () => {
  it('includes the highest-meth region and busiest route', () => {
    const regionRows = [
      { region: 'Shan', methIndex: 85, opiumHa: 45000 },
      { region: 'Kachin', methIndex: 30, opiumHa: 12000 },
    ]
    const flows = [
      {
        from: 'MYA-Shan',
        to: 'THA-ChiangMai',
        quantityKg: 8000,
        drug: 'Methamphetamine',
      },
      {
        from: 'MYA-Kachin',
        to: 'CHN-Yunnan',
        quantityKg: 3000,
        drug: 'Heroin',
      },
    ]
    const labelOf = (id) => id
    const conflictEvents = [
      {
        region: 'Shan',
        actor: 'Border militias',
        actorType: 'militia',
        eventType: 'clash',
        intensity: 90,
        sourceName: 'ACLED',
        sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
      },
    ]
    const precursorFlows = [
      {
        originCountry: 'China',
        transitCountry: 'Laos',
        to: 'Shan',
        precursor: 'meth_precursors',
        quantityKg: 5000,
        confidence: 'reported',
        sourceName: 'INCB',
        sourceUrl: 'https://www.incb.org/incb/en/precursors/',
      },
    ]
    const sentence = explainMyanmar(regionRows, flows, 2023, labelOf, conflictEvents, precursorFlows)
    assert.ok(sentence.includes('Shan'))
    assert.ok(sentence.includes('MYA-Shan'))
    assert.ok(sentence.includes('THA-ChiangMai'))
    assert.ok(sentence.includes('2023'))
    assert.ok(sentence.includes('civil-war overlay'))
    assert.ok(sentence.includes('China accounts for 100%'))
  })
})
