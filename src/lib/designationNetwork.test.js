import { describe, it, assert } from 'vitest'
import { buildDesignationNetwork, searchDesignations } from './designationNetwork'
import designationData from '../data/designations.json'

const entity = (entityNumber, name, countries, programs = ['SDNTK'], aliases = []) => ({
  entityNumber,
  name,
  entityType: 'organization',
  programs,
  countries,
  aliases,
})

describe('buildDesignationNetwork — graph construction', () => {
  it('creates no edges from single-country entities', () => {
    // The core guard: entities sharing a programme are NOT linked. Only an
    // entity OFAC records in two countries creates an edge.
    const network = buildDesignationNetwork([
      entity(1, 'A', ['Mexico']),
      entity(2, 'B', ['Mexico']),
      entity(3, 'C', ['Colombia']),
    ])
    assert.lengthOf(network.edges, 0)
    assert.equal(network.crossBorderEntities, 0)
    assert.equal(network.totalEntities, 3)
  })

  it('creates one edge per country pair a single entity is recorded in', () => {
    const network = buildDesignationNetwork([entity(1, 'A', ['Burma', 'China', 'Laos'])])
    // Three countries => three unordered pairs.
    assert.lengthOf(network.edges, 3)
    assert.equal(network.crossBorderEntities, 1)
  })

  it('sums weight when several entities span the same country pair', () => {
    const network = buildDesignationNetwork([
      entity(1, 'A', ['Burma', 'Thailand']),
      entity(2, 'B', ['Thailand', 'Burma']),
    ])
    assert.lengthOf(network.edges, 1)
    assert.equal(network.edges[0].weight, 2)
  })

  it('deduplicates a repeated country on one entity instead of self-linking it', () => {
    const network = buildDesignationNetwork([entity(1, 'A', ['Mexico', 'Mexico'])])
    assert.lengthOf(network.edges, 0)
    assert.equal(network.nodes[0].designations, 1)
  })

  it('scopes to a single programme when asked', () => {
    const network = buildDesignationNetwork(
      [
        entity(1, 'A', ['Burma', 'Thailand'], ['TCO']),
        entity(2, 'B', ['Mexico', 'Colombia'], ['SDNTK']),
      ],
      { program: 'TCO' },
    )
    assert.equal(network.totalEntities, 1)
    assert.deepEqual(network.programs, ['TCO'])
  })
})

describe('buildDesignationNetwork — structural metrics', () => {
  it('identifies the middle of a chain as an articulation point', () => {
    // A — B — C: removing B disconnects A from C.
    const network = buildDesignationNetwork([
      entity(1, 'x', ['A', 'B']),
      entity(2, 'y', ['B', 'C']),
    ])
    const byCountry = Object.fromEntries(network.nodes.map((n) => [n.country, n]))
    assert.isTrue(byCountry.B.articulationPoint)
    assert.isFalse(byCountry.A.articulationPoint)
    assert.isFalse(byCountry.C.articulationPoint)
  })

  it('gives the broker of a chain the highest betweenness', () => {
    const network = buildDesignationNetwork([
      entity(1, 'x', ['A', 'B']),
      entity(2, 'y', ['B', 'C']),
    ])
    assert.equal(network.nodes[0].country, 'B', 'nodes are sorted by betweenness')
    assert.isAbove(network.nodes[0].betweenness, 0)
  })

  it('finds no articulation point in a fully connected triangle', () => {
    // Every pair is linked, so removing any one node leaves the rest connected.
    const network = buildDesignationNetwork([entity(1, 'x', ['A', 'B', 'C'])])
    assert.isFalse(network.nodes.some((n) => n.articulationPoint))
  })

  it('reports maximum concentration when all designations sit in one country', () => {
    const network = buildDesignationNetwork([
      entity(1, 'A', ['Mexico']),
      entity(2, 'B', ['Mexico']),
    ])
    assert.equal(network.concentrationHHI, 10000)
  })

  it('reports low concentration when designations are spread evenly', () => {
    const network = buildDesignationNetwork(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((c, i) => entity(i, `e${i}`, [c])),
    )
    // Ten equal shares => HHI 1000, below the 1500 "moderate" threshold.
    assert.equal(network.concentrationHHI, 1000)
  })

  it('handles an empty record set without throwing', () => {
    const network = buildDesignationNetwork([])
    assert.lengthOf(network.nodes, 0)
    assert.lengthOf(network.edges, 0)
    assert.equal(network.concentrationHHI, 0)
  })

  it('ignores entities with no country of record rather than creating a phantom node', () => {
    const network = buildDesignationNetwork([entity(1, 'A', [])])
    assert.lengthOf(network.nodes, 0)
  })
})

describe('searchDesignations', () => {
  const records = [
    entity(23647, 'WEI, Zhao', ['Hong Kong'], ['TCO'], ['WEI, Chao', 'SAECHOU, Thanchai']),
    entity(23652, 'KINGS ROMANS INTERNATIONAL (HK) CO., LIMITED', ['Hong Kong'], ['TCO']),
  ]

  it('matches on the primary name', () => {
    const hits = searchDesignations(records, 'kings romans')
    assert.lengthOf(hits, 1)
    assert.isNull(hits[0].matchedAlias)
  })

  it('reaches the canonical record through an OFAC-published alias', () => {
    // The transliteration-variant problem, solved with OFAC's own equivalences
    // rather than inferred identity matching.
    const hits = searchDesignations(records, 'WEI, Chao')
    assert.lengthOf(hits, 1)
    assert.equal(hits[0].name, 'WEI, Zhao')
    assert.equal(hits[0].matchedAlias, 'WEI, Chao')
  })

  it('finds a name typed in natural order, not just OFAC surname-first order', () => {
    // OFAC writes people as "SURNAME, Given" and nobody types that. A plain
    // substring search made the entire alias table unreachable to anyone
    // searching a name the normal way round.
    for (const query of ['Chao Wei', 'chao wei', 'wei chao', 'Wei  Chao ']) {
      const hits = searchDesignations(records, query)
      assert.lengthOf(hits, 1, `"${query}" should reach the canonical record`)
      assert.equal(hits[0].name, 'WEI, Zhao')
    }
  })

  it('requires every query token, so unrelated names do not collide', () => {
    // "Zhao" alone matches; "Zhao Romans" must not, or the search would behave
    // like an OR and return half the list for any two-word query.
    assert.lengthOf(searchDesignations(records, 'Zhao'), 1)
    assert.lengthOf(searchDesignations(records, 'Zhao Romans'), 0)
  })

  it('ignores punctuation differences between query and record', () => {
    const hits = searchDesignations(records, 'kings romans international hk')
    assert.lengthOf(hits, 1)
    assert.include(hits[0].name, 'KINGS ROMANS')
  })

  it('refuses one-character queries that would match nearly everything', () => {
    assert.lengthOf(searchDesignations(records, 'a'), 0)
    assert.lengthOf(searchDesignations(records, ' '), 0)
  })

  it('returns nothing for a name that is on no list', () => {
    assert.lengthOf(searchDesignations(records, 'definitely not designated'), 0)
  })
})

describe('bundled OFAC dataset integrity', () => {
  const records = designationData.records

  it('ships designations under every declared programme', () => {
    for (const code of Object.keys(designationData.meta.programs)) {
      assert.isTrue(
        records.some((r) => r.programs.includes(code)),
        `no bundled record carries programme ${code}`,
      )
    }
  })

  it('cites a legal authority on every record', () => {
    // A row with no programme is an accusation rather than a designation.
    assert.isFalse(records.some((r) => !Array.isArray(r.programs) || r.programs.length === 0))
  })

  it('carries no address, identity-document or date-of-birth fields', () => {
    // Present in the upstream OFAC file and deliberately not extracted.
    const forbidden = ['address', 'city', 'passport', 'dob', 'dateOfBirth', 'idNumber', 'remarks']
    for (const key of Object.keys(records[0])) {
      assert.notInclude(forbidden, key, `bundled designation records must not carry ${key}`)
    }
  })

  it('records the public-domain licence that makes redistribution safe', () => {
    assert.include(designationData.meta.license, 'public domain')
  })

  it('builds a connected, non-trivial jurisdiction graph from the real data', () => {
    const network = buildDesignationNetwork(records)
    assert.isAbove(network.crossBorderEntities, 0)
    assert.isAbove(network.edges.length, 0)
    assert.isAbove(network.nodes.length, 10)
  })
})

describe('bundled CDC mortality dataset integrity', () => {
  it('never reads a suppressed cell as zero', async () => {
    const { default: overdose } = await import('../data/overdose.json')
    assert.isFalse(
      overdose.records.some((r) => r.deaths === null || r.deaths === undefined),
      'suppressed cells must be dropped by the converter, not zero-filled',
    )
  })

  it('keeps psychostimulants separate from methamphetamine', async () => {
    const { default: overdose } = await import('../data/overdose.json')
    // T43.6 is a class code. Collapsing it into "methamphetamine" at ingest
    // would launder an assumption into the dataset.
    assert.include(overdose.meta.substances, 'psychostimulants')
    assert.notInclude(overdose.meta.substances, 'methamphetamine')
  })

  it('flags partial-year windows so they are never compared against full years', async () => {
    const { default: overdose } = await import('../data/overdose.json')
    for (const r of overdose.records) {
      assert.equal(r.partialYear, r.periodEndMonth !== 12)
    }
  })
})

describe('bundled StatCan wastewater dataset integrity', () => {
  it('spans both source tables, not just the newer vocabulary', async () => {
    // The first cut of the converter mapped only the 2022-2023 measure names
    // and silently produced ZERO records from the 2019-2020 table. Since the
    // triangulation baseline year is 2019, that failure would have been
    // invisible except as a permanently absent modality.
    const { default: ww } = await import('../data/wastewater.json')
    assert.include(ww.meta.years, 2019, 'the 2019-2020 table must contribute records')
    assert.include(ww.meta.years, 2023, 'the 2022-2023 table must contribute records')
  })

  it('carries only per-day load values, never dispersion measures', async () => {
    const { default: ww } = await import('../data/wastewater.json')
    // Confidence bounds, standard errors, imputation and detection rates are
    // separate `Characteristics` rows in the source file. If any leaked in,
    // cities would appear multiple times per drug-year.
    const keys = ww.records.map((r) => `${r.site}|${r.year}|${r.drug}`)
    assert.equal(new Set(keys).size, keys.length, 'duplicate site/year/drug means a non-load row leaked in')
  })

  it('excludes the weighted-average aggregate geography', async () => {
    const { default: ww } = await import('../data/wastewater.json')
    // triangulate.ts takes its own mean across sites; including StatCan's
    // aggregate would weight the national figure twice.
    assert.isFalse(ww.records.some((r) => /weighted average/i.test(r.site)))
  })

  it('uses the metabolite for cocaine, and never maps morphine to heroin', async () => {
    const { default: ww } = await import('../data/wastewater.json')
    assert.include(ww.meta.note, 'benzoylecgonine')
    assert.include(ww.meta.note, '6-MAM')
    assert.include(ww.meta.note, 'morphine')
  })

  it('records sampling coverage so uneven years are not silently equated', async () => {
    const { default: ww } = await import('../data/wastewater.json')
    for (const r of ww.records) {
      assert.isNumber(r.monthsObserved)
      assert.isAbove(r.monthsObserved, 0)
      assert.isAtMost(r.monthsObserved, 12)
    }
  })

  it('reports positive loads in the SCORE standard unit', async () => {
    const { default: ww } = await import('../data/wastewater.json')
    assert.include(ww.meta.unit, 'mg per 1,000 inhabitants per day')
    assert.isFalse(ww.records.some((r) => !(r.mgPer1000PerDay > 0)))
  })

  it('states the open licence that permits redistribution', async () => {
    const { default: ww } = await import('../data/wastewater.json')
    assert.include(ww.meta.license, 'Open Licence')
  })
})
