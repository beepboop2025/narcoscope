import { describe, it, assert } from 'vitest'
import {
  triangulate,
  triangulateSeries,
  scanDivergences,
  DRUG_BRIDGE,
  MODALITY_SIDE,
  MODALITY_COLLECTOR,
  MATERIAL_CHANGE_THRESHOLD,
  MIN_MODALITIES_FOR_VERDICT,
} from './triangulate'
import { SEIZURE_GROUPS } from './seizures'

/**
 * Builds a triangulate() input where every modality is caller-controlled.
 * iso3 defaults to a code with no UNODC seizure record so the seizure modality
 * is absent unless a test deliberately wants it — keeping each test's evidence
 * set explicit rather than implicitly inheriting the bundled dataset.
 */
function scenario(overrides = {}) {
  return {
    iso3: 'ZZZ',
    country: 'Testland',
    drug: 'cocaine',
    year: 2023,
    baselineYear: 2019,
    priceRecords: [],
    overdoseRecords: [],
    wastewaterRecords: [],
    ...overrides,
  }
}

const wastewater = (iso3, drug, year, load) => ({
  site: 'Test City',
  country: 'Testland',
  iso3,
  year,
  drug,
  mgPer1000PerDay: load,
  sourceName: 'Test Authority',
  sourceUrl: 'https://example.org/report',
})

const price = (iso3, drug, year, usd) => ({
  drug,
  country: 'Testland',
  iso3,
  region: 'Test',
  year,
  priceUsdPerGram: usd,
  purityPct: null,
})

describe('DRUG_BRIDGE', () => {
  it('maps every drug to a seizure group that actually exists in the UNODC dataset', () => {
    for (const [drug, bridge] of Object.entries(DRUG_BRIDGE)) {
      assert.include(
        SEIZURE_GROUPS,
        bridge.seizureGroup,
        `${drug} maps to a UNODC group that is not in seizures.json`,
      )
    }
  })

  it('states a caveat wherever the join to another vocabulary is inexact', () => {
    // Meth -> psychostimulants (T43.6) and heroin -> the broad "Opioids"
    // seizure group are both lossy. Silently lossy joins are the failure mode
    // this assertion exists to prevent.
    assert.isString(DRUG_BRIDGE.methamphetamine.caveat)
    assert.isString(DRUG_BRIDGE.heroin.caveat)
    assert.isNull(DRUG_BRIDGE.cocaine.caveat, 'cocaine maps exactly and needs no caveat')
  })

  it('does not invent a mortality series for cannabis', () => {
    assert.isNull(DRUG_BRIDGE.cannabis.overdoseSubstance)
    assert.isString(DRUG_BRIDGE.cannabis.caveat)
  })
})

describe('modality independence', () => {
  it('assigns supply and demand modalities to different collector institutions', () => {
    const supply = Object.entries(MODALITY_SIDE).filter(([, side]) => side === 'supply').map(([m]) => m)
    const demand = Object.entries(MODALITY_SIDE).filter(([, side]) => side === 'demand').map(([m]) => m)
    const supplyCollectors = new Set(supply.map((m) => MODALITY_COLLECTOR[m]))
    const demandCollectors = new Set(demand.map((m) => MODALITY_COLLECTOR[m]))
    for (const c of demandCollectors) {
      assert.notInclude([...supplyCollectors], c, 'a collector cannot sit on both sides of the market')
    }
  })
})

describe('triangulate — verdicts', () => {
  it('refuses a verdict when only one side of the market has data', () => {
    // Price alone: a supply modality with nothing to check it against.
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 50)],
    }))
    assert.equal(result.verdict, 'untriangulated')
    assert.equal(result.modalityCoverage, 1)
    assert.isBelow(result.modalityCoverage, MIN_MODALITIES_FOR_VERDICT)
  })

  it('refuses a verdict when no modality has data at all', () => {
    const result = triangulate(scenario())
    assert.equal(result.verdict, 'untriangulated')
    assert.equal(result.modalityCoverage, 0)
    assert.isFalse(result.verdictFragile, 'an untriangulated result cannot be fragile')
  })

  it('reads falling price + rising consumption as a concordant expansion', () => {
    // Price halves (supply up, inverted signal) and wastewater load doubles.
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 50)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 100), wastewater('ZZZ', 'cocaine', 2023, 200)],
    }))
    assert.equal(result.verdict, 'concordantExpansion')
    assert.equal(result.supplyDirection, 1)
    assert.equal(result.demandDirection, 1)
  })

  it('reads rising price + falling consumption as a concordant contraction', () => {
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 50), price('ZZZ', 'cocaine', 2023, 100)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 200), wastewater('ZZZ', 'cocaine', 2023, 100)],
    }))
    assert.equal(result.verdict, 'concordantContraction')
  })

  it('flags rising consumption against a flat supply signal as undetected expansion', () => {
    // Price barely moves (flat), consumption doubles. This is the pattern a
    // seizure-only view structurally cannot surface.
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 101)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 100), wastewater('ZZZ', 'cocaine', 2023, 200)],
    }))
    assert.equal(result.verdict, 'undetectedExpansion')
    assert.equal(result.supplyDirection, 0)
    assert.equal(result.demandDirection, 1)
  })

  it('flags a rising supply signal against flat consumption as an enforcement effect', () => {
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 40)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 100), wastewater('ZZZ', 'cocaine', 2023, 101)],
    }))
    assert.equal(result.verdict, 'enforcementArtifact')
  })

  it('treats sub-threshold movement on both sides as a stable market, not a divergence', () => {
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 105)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 100), wastewater('ZZZ', 'cocaine', 2023, 104)],
    }))
    assert.equal(result.verdict, 'concordantContraction')
    assert.equal(result.supplyDirection, 0)
    assert.equal(result.demandDirection, 0)
  })

  it('honours MATERIAL_CHANGE_THRESHOLD at its boundary', () => {
    // Exactly at the threshold counts as flat; direction() uses a strict >.
    const atThreshold = 100 * (1 + MATERIAL_CHANGE_THRESHOLD)
    const result = triangulate(scenario({
      wastewaterRecords: [
        wastewater('ZZZ', 'cocaine', 2019, 100),
        wastewater('ZZZ', 'cocaine', 2023, atThreshold),
      ],
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 100)],
    }))
    assert.equal(result.demandDirection, 0, 'movement exactly at the threshold is flat')
  })
})

describe('triangulate — robustness and provenance', () => {
  it('does not call a two-modality verdict fragile just for losing coverage', () => {
    // At the minimum, dropping either modality always degrades to
    // `untriangulated`. Counting that as a flip would fire the flag on every
    // minimum-coverage reading and train analysts to ignore it.
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 50)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 100), wastewater('ZZZ', 'cocaine', 2023, 200)],
    }))
    assert.equal(result.verdict, 'concordantExpansion')
    assert.isFalse(result.verdictFragile, 'losing the ability to judge is not judging differently')
    assert.isTrue(result.atMinimumCoverage)
    assert.isTrue(
      result.caveats.some((c) => c.includes('minimum two')),
      'minimum coverage must still be disclosed, just not as fragility',
    )
  })

  it('marks a verdict fragile when dropping one modality flips it to a different verdict', () => {
    // Three modalities: price (supply), wastewater (demand, leads) and
    // mortality (demand, fallback) pointing opposite ways. Removing wastewater
    // promotes mortality and flips the verdict.
    const result = triangulate(scenario({
      iso3: 'USA',
      drug: 'cocaine',
      priceRecords: [price('USA', 'cocaine', 2019, 100), price('USA', 'cocaine', 2023, 101)],
      wastewaterRecords: [wastewater('USA', 'cocaine', 2019, 100), wastewater('USA', 'cocaine', 2023, 200)],
      overdoseRecords: [
        { jurisdiction: 'US', year: 2019, periodEndMonth: 12, partialYear: false, substance: 'cocaine', deaths: 200, predictedDeaths: null, percentComplete: 100 },
        { jurisdiction: 'US', year: 2023, periodEndMonth: 12, partialYear: false, substance: 'cocaine', deaths: 100, predictedDeaths: null, percentComplete: 100 },
      ],
    }))
    assert.isTrue(result.verdictFragile)
    assert.isNotNull(result.fragileModality)
    assert.isTrue(
      result.caveats.some((c) => c.includes('not robust')),
      'a fragile verdict must say so in the caveats, not only in a flag',
    )
  })

  it('never reports a modality as available when it has no data', () => {
    const result = triangulate(scenario())
    for (const reading of result.readings) {
      assert.isFalse(reading.available)
      assert.isNull(reading.changePct)
      assert.isString(reading.absentReason, 'every absent modality must explain why')
    }
  })

  it('states plainly that bundled mortality data is US-only rather than looking merely missing', () => {
    const result = triangulate(scenario({ iso3: 'MMR', country: 'Myanmar', drug: 'heroin' }))
    const mortality = result.readings.find((r) => r.modality === 'mortality')
    assert.isFalse(mortality.available)
    assert.include(mortality.absentReason, 'United States')
  })

  it('explains the absent wastewater modality by pointing at the CSV loader', () => {
    const result = triangulate(scenario())
    const ww = result.readings.find((r) => r.modality === 'wastewater')
    assert.include(ww.absentReason, 'CSV')
  })

  it('surfaces the drug-bridge caveat in the result caveats', () => {
    const result = triangulate(scenario({ drug: 'methamphetamine' }))
    assert.isTrue(result.caveats.some((c) => c.includes('T43.6')))
  })

  it('counts independent collectors, not modalities, when two modalities share a collector', () => {
    const result = triangulate(scenario({
      priceRecords: [price('ZZZ', 'cocaine', 2019, 100), price('ZZZ', 'cocaine', 2023, 50)],
      wastewaterRecords: [wastewater('ZZZ', 'cocaine', 2019, 100), wastewater('ZZZ', 'cocaine', 2023, 200)],
    }))
    assert.equal(result.modalityCoverage, 2)
    assert.equal(result.independentCollectors, 2, 'price and wastewater have distinct collectors')
  })
})

describe('triangulate — against the bundled datasets', () => {
  it('produces a real multi-modality reading for the United States', () => {
    // The one country where seizures, prices and CDC mortality all exist.
    const result = triangulate(scenario({
      iso3: 'USA',
      country: 'United States of America',
      drug: 'cocaine',
      priceRecords: [price('USA', 'cocaine', 2019, 100), price('USA', 'cocaine', 2023, 90)],
      overdoseRecords: [
        { jurisdiction: 'US', year: 2019, periodEndMonth: 12, partialYear: false, substance: 'cocaine', deaths: 15000, predictedDeaths: null, percentComplete: 100 },
        { jurisdiction: 'US', year: 2023, periodEndMonth: 12, partialYear: false, substance: 'cocaine', deaths: 28000, predictedDeaths: null, percentComplete: 100 },
      ],
    }))
    assert.isAtLeast(result.modalityCoverage, 2)
    assert.notEqual(result.verdict, 'untriangulated')
    assert.equal(result.demandDirection, 1)
  })

  it('ignores partial-year mortality windows so a 12-month count is never compared to a shorter one', () => {
    const result = triangulate(scenario({
      iso3: 'USA',
      drug: 'cocaine',
      overdoseRecords: [
        { jurisdiction: 'US', year: 2019, periodEndMonth: 12, partialYear: false, substance: 'cocaine', deaths: 100, predictedDeaths: null, percentComplete: 100 },
        // Partial window for the comparison year — must not be used.
        { jurisdiction: 'US', year: 2023, periodEndMonth: 6, partialYear: true, substance: 'cocaine', deaths: 400, predictedDeaths: null, percentComplete: 55 },
      ],
    }))
    const mortality = result.readings.find((r) => r.modality === 'mortality')
    assert.isFalse(mortality.available, 'a partial-year window is not a comparable annual figure')
  })
})

describe('triangulate — wastewater absence is explained precisely', () => {
  const ca = (drug, year, load) => ({
    site: 'Toronto', country: 'Canada', iso3: 'CAN', year, drug,
    mgPer1000PerDay: load, sourceName: 'StatCan', sourceUrl: 'https://example.gc.ca',
  })

  it('says nothing is loaded only when nothing is loaded', () => {
    const r = triangulate(scenario({ iso3: 'USA' }))
    const ww = r.readings.find((x) => x.modality === 'wastewater')
    assert.include(ww.absentReason, 'No wastewater data loaded at all')
  })

  it('names the covered countries when data exists but not for this one', () => {
    // The bug this pins: a user looking at the US was told "no wastewater data
    // loaded" while a complete Canadian series sat in the bundle.
    const r = triangulate(scenario({
      iso3: 'USA',
      wastewaterRecords: [ca('cocaine', 2019, 100), ca('cocaine', 2023, 150)],
    }))
    const ww = r.readings.find((x) => x.modality === 'wastewater')
    assert.notInclude(ww.absentReason, 'No wastewater data loaded at all')
    assert.include(ww.absentReason, 'Canada')
  })

  it('distinguishes a missing drug from a missing country', () => {
    const r = triangulate(scenario({
      iso3: 'CAN', drug: 'heroin',
      wastewaterRecords: [ca('cocaine', 2019, 100), ca('cocaine', 2023, 150)],
    }))
    const ww = r.readings.find((x) => x.modality === 'wastewater')
    assert.include(ww.absentReason, 'No wastewater series for heroin')
  })

  it('still reports missing years once country and drug both match', () => {
    const r = triangulate(scenario({
      iso3: 'CAN', drug: 'cocaine',
      wastewaterRecords: [ca('cocaine', 2019, 100)],
    }))
    const ww = r.readings.find((x) => x.modality === 'wastewater')
    assert.include(ww.absentReason, 'No wastewater readings for both')
  })
})

describe('triangulateSeries', () => {
  const ww = (drug, year, load) => ({
    site: 'City', country: 'X', iso3: 'XXX', year, drug,
    mgPer1000PerDay: load, sourceName: 'S', sourceUrl: 'https://e.org',
  })

  it('rebases each modality to 100 at its own first year', () => {
    const s = triangulateSeries({
      iso3: 'XXX', country: 'X', drug: 'cocaine',
      priceRecords: [], overdoseRecords: [],
      wastewaterRecords: [ww('cocaine', 2019, 200), ww('cocaine', 2021, 300)],
    })
    const wwSeries = s.series.find((x) => x.modality === 'wastewater')
    assert.equal(wwSeries.baseYear, 2019)
    const p2019 = wwSeries.points.find((p) => p.year === 2019)
    const p2021 = wwSeries.points.find((p) => p.year === 2021)
    assert.equal(p2019.index, 100)
    assert.equal(p2021.index, 150) // 300/200 * 100
  })

  it('omits a modality entirely when it has no data', () => {
    const s = triangulateSeries({
      iso3: 'XXX', country: 'X', drug: 'cocaine',
      priceRecords: [], overdoseRecords: [],
      wastewaterRecords: [ww('cocaine', 2019, 200)],
    })
    assert.isUndefined(s.series.find((x) => x.modality === 'mortality'))
    assert.isDefined(s.series.find((x) => x.modality === 'wastewater'))
  })

  it('unions all years across modalities into the shared x-axis', () => {
    const s = triangulateSeries({
      iso3: 'XXX', country: 'X', drug: 'cocaine',
      priceRecords: [
        { drug: 'cocaine', country: 'X', iso3: 'XXX', region: 'R', year: 2018, priceUsdPerGram: 50, purityPct: null },
      ],
      overdoseRecords: [],
      wastewaterRecords: [ww('cocaine', 2020, 200)],
    })
    assert.deepEqual(s.years, [2018, 2020])
  })

  it('leaves the index null rather than dividing by a zero base', () => {
    // A modality whose earliest value is 0 cannot be rebased.
    const s = triangulateSeries({
      iso3: 'XXX', country: 'X', drug: 'cocaine',
      priceRecords: [
        { drug: 'cocaine', country: 'X', iso3: 'XXX', region: 'R', year: 2019, priceUsdPerGram: 0, purityPct: null },
        { drug: 'cocaine', country: 'X', iso3: 'XXX', region: 'R', year: 2020, priceUsdPerGram: 80, purityPct: null },
      ],
      overdoseRecords: [], wastewaterRecords: [],
    })
    const price = s.series.find((x) => x.modality === 'retail_price')
    assert.isTrue(price.points.every((p) => p.index === null))
  })

  it('draws the real divergence on the bundled US methamphetamine data', async () => {
    const { PRICE_RECORDS } = await import('../data/prices')
    const { BUNDLED_OVERDOSE_RECORDS, BUNDLED_WASTEWATER_RECORDS } = await import('../data/bundled')
    const s = triangulateSeries({
      iso3: 'USA', country: 'US', drug: 'methamphetamine',
      priceRecords: PRICE_RECORDS,
      overdoseRecords: BUNDLED_OVERDOSE_RECORDS,
      wastewaterRecords: BUNDLED_WASTEWATER_RECORDS,
    })
    const seiz = s.series.find((x) => x.modality === 'seizures')
    const mort = s.series.find((x) => x.modality === 'mortality')
    assert.isDefined(seiz)
    assert.isDefined(mort)
    // The headline: by the latest shared year seizures are DOWN and mortality
    // is well UP relative to their own baselines. The lines cross.
    const seizLast = [...seiz.points].reverse().find((p) => p.index != null)
    const mortLast = [...mort.points].reverse().find((p) => p.index != null)
    assert.isBelow(seizLast.index, 100, 'seizures should fall below their baseline')
    assert.isAbove(mortLast.index, 200, 'meth-involved deaths should more than double')
  })
})

describe('scanDivergences', () => {
  const country = (iso3, name) => ({ iso3, name })

  it('ranks genuine divergences ahead of concordant results', async () => {
    const { PRICE_RECORDS } = await import('../data/prices')
    const { BUNDLED_OVERDOSE_RECORDS, BUNDLED_WASTEWATER_RECORDS } = await import('../data/bundled')
    const { SEIZURE_COUNTRIES } = await import('./seizures')
    const hits = scanDivergences({
      countries: SEIZURE_COUNTRIES.filter((c) => ['USA', 'CAN'].includes(c.iso3)).map((c) => country(c.iso3, c.name)),
      drugs: ['cocaine', 'heroin', 'methamphetamine', 'cannabis'],
      year: 2023, baselineYear: 2019,
      priceRecords: PRICE_RECORDS,
      overdoseRecords: BUNDLED_OVERDOSE_RECORDS,
      wastewaterRecords: BUNDLED_WASTEWATER_RECORDS,
    })
    const divergent = new Set(['enforcementArtifact', 'undetectedExpansion'])
    // Once a concordant verdict appears, no divergent one may follow it.
    let seenConcordant = false
    for (const h of hits) {
      if (!divergent.has(h.verdict)) seenConcordant = true
      else assert.isFalse(seenConcordant, `${h.iso3}/${h.drug} divergence ranked below a concordant result`)
    }
    // And the known cases are present and flagged divergent.
    const usMeth = hits.find((h) => h.iso3 === 'USA' && h.drug === 'methamphetamine')
    const caCannabis = hits.find((h) => h.iso3 === 'CAN' && h.drug === 'cannabis')
    assert.equal(usMeth.verdict, 'undetectedExpansion')
    assert.equal(caCannabis.verdict, 'undetectedExpansion')
  })

  it('excludes untriangulated pairs entirely', () => {
    const hits = scanDivergences({
      countries: [country('ZZZ', 'Nowhere')],
      drugs: ['cocaine'],
      year: 2023, baselineYear: 2019,
      priceRecords: [], overdoseRecords: [], wastewaterRecords: [],
    })
    assert.lengthOf(hits, 0)
  })
})
