import { describe, it, assert } from 'vitest'
import { buildMyanmarIntelligenceBriefing } from './intelligence'

describe('buildMyanmarIntelligenceBriefing', () => {
  const regions = [
    { id: 'shan_north', label: 'Shan North', lat: 23, lng: 98 },
    { id: 'kachin', label: 'Kachin', lat: 26, lng: 97 },
  ]

  it('ranks regions by fused risk and exposes evidence provenance', () => {
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [
        { region: 'shan_north', year: 2024, opiumHa: 10000, methIndex: 90 },
        { region: 'kachin', year: 2024, opiumHa: 5000, methIndex: 20 },
      ],
      conflictEvents: [
        {
          region: 'shan_north',
          year: 2024,
          actor: 'Border militia',
          actorType: 'militia',
          eventType: 'clash',
          intensity: 80,
          sourceName: 'ACLED',
          sourceUrl: 'https://example.org/acled',
        },
      ],
      precursorFlows: [
        {
          originCountry: 'China',
          transitCountry: null,
          to: 'shan_north',
          year: 2024,
          precursor: 'meth_precursors',
          quantityKg: 4000,
          confidence: 'official',
          sourceName: 'INCB',
          sourceUrl: 'https://example.org/incb',
        },
      ],
      outflows: [
        { from: 'shan_north', to: 'muse', year: 2024, quantityKg: 3000, drug: 'Methamphetamine' },
      ],
    })

    assert.equal(briefing.profiles[0].region, 'shan_north')
    assert.ok(briefing.profiles[0].riskScore > briefing.profiles[1].riskScore)
    assert.equal(briefing.profiles[0].sourceDiversity, 2)
    assert.equal(briefing.profiles[0].verificationTier, 'multi-source')
    assert.equal(briefing.profiles[1].verificationTier, 'unverified')
    assert.equal(briefing.enterpriseReadiness.multiSourceRegions, 1)
    assert.ok(briefing.edges.some((edge) => edge.relation === 'precursor_inflow'))
    assert.ok(briefing.edges.some((edge) => edge.relation === 'conflict_pressure'))
  })

  it('downweights estimated precursor observations compared with official observations', () => {
    const official = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [],
      conflictEvents: [],
      precursorFlows: [
        {
          originCountry: 'China',
          transitCountry: null,
          to: 'shan_north',
          year: 2024,
          precursor: 'meth_precursors',
          quantityKg: 1000,
          confidence: 'official',
          sourceName: 'INCB',
          sourceUrl: 'https://example.org',
        },
      ],
      outflows: [],
    })
    const estimated = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [],
      conflictEvents: [],
      precursorFlows: [
        {
          originCountry: 'China',
          transitCountry: null,
          to: 'shan_north',
          year: 2024,
          precursor: 'meth_precursors',
          quantityKg: 1000,
          confidence: 'estimated',
          sourceName: 'Report',
          sourceUrl: 'https://example.org',
        },
      ],
      outflows: [],
    })

    assert.ok(
      official.edges.find((edge) => edge.relation === 'precursor_inflow').weight >
        estimated.edges.find((edge) => edge.relation === 'precursor_inflow').weight,
    )
  })

  it('flags cross-source conflicts when independent precursor reports disagree materially and penalizes confidence', () => {
    const agreeing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [],
      conflictEvents: [],
      precursorFlows: [
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1000, confidence: 'official',
          sourceName: 'INCB', sourceUrl: 'https://example.org/incb',
        },
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1050, confidence: 'reported',
          sourceName: 'UNODC', sourceUrl: 'https://example.org/unodc',
        },
      ],
      outflows: [],
    })
    const conflicting = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [],
      conflictEvents: [],
      precursorFlows: [
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1000, confidence: 'official',
          sourceName: 'INCB', sourceUrl: 'https://example.org/incb',
        },
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 4000, confidence: 'reported',
          sourceName: 'UNODC', sourceUrl: 'https://example.org/unodc',
        },
      ],
      outflows: [],
    })

    const agreeingProfile = agreeing.profiles.find((p) => p.region === 'shan_north')
    const conflictingProfile = conflicting.profiles.find((p) => p.region === 'shan_north')

    assert.equal(agreeingProfile.hasSourceConflict, false)
    assert.equal(conflictingProfile.hasSourceConflict, true)
    assert.ok(conflictingProfile.conflictNotes[0].includes('sources disagree'))
    assert.ok(conflictingProfile.confidenceScore < agreeingProfile.confidenceScore)
    assert.equal(conflicting.enterpriseReadiness.conflictedRegions, 1)
  })

  it('weights the conflict-detection fused mean by source reliability instead of a naive average', () => {
    // A single low-reliability outlier claiming a huge quantity should not
    // drag the "fused mean" far enough to itself dodge being flagged as the
    // outlier, and should not out-vote two high-reliability sources that agree.
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [],
      conflictEvents: [],
      precursorFlows: [
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1000, confidence: 'official',
          sourceName: 'INCB Precursors report', sourceUrl: 'https://incb.org/report',
        },
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1020, confidence: 'reported',
          sourceName: 'UNODC Synthetic Drugs in East and Southeast Asia', sourceUrl: 'https://unodc.org/report',
        },
        {
          originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 9000, confidence: 'estimated',
          sourceName: 'Anonymous Telegram channel', sourceUrl: 'https://t.me/somechannel',
        },
      ],
      outflows: [],
    })

    const profile = briefing.profiles.find((p) => p.region === 'shan_north')
    assert.equal(profile.hasSourceConflict, true)
    // The two high-reliability sources should still be recognisable as the
    // dominant signal: the flagged deviation is attributed to disagreement,
    // and confidence still reflects strong multi-source corroboration
    // among the credible sources rather than collapsing to the outlier.
    assert.equal(profile.verificationTier, 'multi-source')
  })

  it('exposes average source reliability per region for analyst triage', () => {
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [],
      conflictEvents: [
        {
          region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
          eventType: 'clash', intensity: 80, sourceName: 'ACLED Myanmar event data',
          sourceUrl: 'https://acleddata.com/data',
        },
      ],
      precursorFlows: [],
      outflows: [],
    })
    const shan = briefing.profiles.find((p) => p.region === 'shan_north')
    const kachin = briefing.profiles.find((p) => p.region === 'kachin')
    assert.ok(shan.avgSourceReliability > 0)
    assert.equal(kachin.avgSourceReliability, 0)
  })
})
