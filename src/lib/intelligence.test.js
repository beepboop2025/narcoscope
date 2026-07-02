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

  it('flags a rising trajectory when cultivation/synthetic/outflow pressure climbs vs. the nearest earlier year', () => {
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [
        { region: 'shan_north', year: 2020, opiumHa: 10000, methIndex: 50 },
        { region: 'shan_north', year: 2024, opiumHa: 16000, methIndex: 85 },
        { region: 'kachin', year: 2020, opiumHa: 4000, methIndex: 30 },
        { region: 'kachin', year: 2024, opiumHa: 4050, methIndex: 31 },
      ],
      conflictEvents: [],
      precursorFlows: [],
      outflows: [],
    })

    const shan = briefing.profiles.find((p) => p.region === 'shan_north')
    const kachin = briefing.profiles.find((p) => p.region === 'kachin')

    assert.equal(shan.trajectory, 'rising')
    assert.equal(shan.trajectoryBaselineYear, 2020)
    assert.ok(shan.trajectoryChangePct > 0.15)
    assert.equal(kachin.trajectory, 'stable')
  })

  it('flags a falling trajectory when pressure eases vs. the nearest earlier year', () => {
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [
        { region: 'shan_north', year: 2020, opiumHa: 16000, methIndex: 85 },
        { region: 'shan_north', year: 2024, opiumHa: 9000, methIndex: 40 },
      ],
      conflictEvents: [],
      precursorFlows: [],
      outflows: [],
    })

    const shan = briefing.profiles.find((p) => p.region === 'shan_north')
    assert.equal(shan.trajectory, 'falling')
    assert.ok(shan.trajectoryChangePct < -0.15)
  })

  it('reports insufficient-data trajectory when no earlier year exists, and counts risingRegions in enterprise readiness', () => {
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [
        { region: 'shan_north', year: 2024, opiumHa: 10000, methIndex: 90 },
      ],
      conflictEvents: [],
      precursorFlows: [],
      outflows: [],
    })

    const shan = briefing.profiles.find((p) => p.region === 'shan_north')
    const kachin = briefing.profiles.find((p) => p.region === 'kachin')
    assert.equal(shan.trajectory, 'insufficient-data')
    assert.equal(shan.trajectoryChangePct, null)
    assert.equal(shan.trajectoryBaselineYear, null)
    assert.equal(kachin.trajectory, 'insufficient-data')
    assert.equal(briefing.enterpriseReadiness.risingRegions, 0)
  })

  it('uses outbound seizure quantity as part of the momentum index, not just cultivation/synthetic stats', () => {
    const briefing = buildMyanmarIntelligenceBriefing({
      year: 2024,
      regions,
      regionRecords: [
        { region: 'shan_north', year: 2020, opiumHa: 10000, methIndex: 50 },
        { region: 'shan_north', year: 2024, opiumHa: 10000, methIndex: 50 },
      ],
      conflictEvents: [],
      precursorFlows: [],
      outflows: [
        { from: 'shan_north', to: 'muse', year: 2020, quantityKg: 500, drug: 'Methamphetamine' },
        { from: 'shan_north', to: 'muse', year: 2024, quantityKg: 6000, drug: 'Methamphetamine' },
      ],
    })

    const shan = briefing.profiles.find((p) => p.region === 'shan_north')
    assert.equal(shan.trajectory, 'rising')
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

  describe('conflict-event source disagreement', () => {
    it('flags cross-source conflicts when independent conflict-event reports disagree materially on intensity', () => {
      const agreeing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 70, sourceName: 'ACLED Myanmar event data',
            sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
          },
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 75, sourceName: 'International Crisis Group',
            sourceUrl: 'https://www.crisisgroup.org/asia/south-east-asia/myanmar',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })
      const conflicting = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 20, sourceName: 'ACLED Myanmar event data',
            sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
          },
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 90, sourceName: 'International Crisis Group',
            sourceUrl: 'https://www.crisisgroup.org/asia/south-east-asia/myanmar',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })

      const agreeingProfile = agreeing.profiles.find((p) => p.region === 'shan_north')
      const conflictingProfile = conflicting.profiles.find((p) => p.region === 'shan_north')

      assert.equal(agreeingProfile.hasSourceConflict, false)
      assert.equal(conflictingProfile.hasSourceConflict, true)
      assert.ok(conflictingProfile.conflictNotes.some((n) => n.includes('clash intensity')))
      assert.ok(conflictingProfile.confidenceScore < agreeingProfile.confidenceScore)
      assert.equal(conflicting.enterpriseReadiness.conflictedRegions, 1)
    })

    it('does not conflate disagreement across different event types in the same region', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 70, sourceName: 'ACLED Myanmar event data',
            sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
          },
          {
            region: 'shan_north', year: 2024, actor: 'Myanmar military', actorType: 'military',
            eventType: 'territorial_control', intensity: 10, sourceName: 'International Crisis Group',
            sourceUrl: 'https://www.crisisgroup.org/asia/south-east-asia/myanmar',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      assert.equal(shan.hasSourceConflict, false)
    })

    it('accumulates notes from both precursor and conflict-event disagreement for the same region', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 20, sourceName: 'ACLED Myanmar event data',
            sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
          },
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 90, sourceName: 'International Crisis Group',
            sourceUrl: 'https://www.crisisgroup.org/asia/south-east-asia/myanmar',
          },
        ],
        precursorFlows: [
          {
            originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
            precursor: 'meth_precursors', quantityKg: 1000, confidence: 'official',
            sourceName: 'INCB Precursors report', sourceUrl: 'https://www.incb.org/incb/en/precursors/',
          },
          {
            originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
            precursor: 'meth_precursors', quantityKg: 4000, confidence: 'reported',
            sourceName: 'UNODC Synthetic Drugs in East and Southeast Asia',
            sourceUrl: 'https://www.unodc.org/roseap/en/what-we-do/toc/synthetic-drugs.html',
          },
        ],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      assert.equal(shan.conflictNotes.length, 2)
      assert.ok(shan.conflictNotes.some((n) => n.includes('clash intensity')))
      assert.ok(shan.conflictNotes.some((n) => n.includes('meth precursors inflow')))
    })
  })

  describe('spillover watch', () => {
    const adjacency = { shan_north: ['kachin'], kachin: ['shan_north'] }

    it('flags a calm region bordering a high-risk region', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [
          { region: 'shan_north', year: 2024, opiumHa: 20000, methIndex: 95 },
          { region: 'kachin', year: 2024, opiumHa: 500, methIndex: 5 },
        ],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 90, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
        ],
        precursorFlows: [
          {
            originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
            precursor: 'meth_precursors', quantityKg: 5000, confidence: 'official',
            sourceName: 'INCB', sourceUrl: 'https://www.incb.org/incb/en/precursors/',
          },
        ],
        outflows: [],
        regionAdjacency: adjacency,
      })

      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      const kachin = briefing.profiles.find((p) => p.region === 'kachin')
      assert.ok(shan.riskScore >= 70, 'shan_north should be high risk in this fixture')
      assert.equal(shan.spilloverWatch, false, 'a region is never its own spillover watch')
      assert.equal(kachin.neighborRiskScore, shan.riskScore)
      assert.equal(kachin.neighborRegion, 'shan_north')
      assert.equal(kachin.spilloverWatch, true)
      assert.equal(briefing.enterpriseReadiness.spilloverWatchRegions, 1)
    })

    it('does not flag spillover when neighbors are also calm', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [
          { region: 'shan_north', year: 2024, opiumHa: 500, methIndex: 5 },
          { region: 'kachin', year: 2024, opiumHa: 500, methIndex: 5 },
        ],
        conflictEvents: [],
        precursorFlows: [],
        outflows: [],
        regionAdjacency: adjacency,
      })

      assert.ok(briefing.profiles.every((p) => !p.spilloverWatch))
      assert.equal(briefing.enterpriseReadiness.spilloverWatchRegions, 0)
    })

    it('defaults to inert spillover fields when no adjacency map is provided', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [
          { region: 'shan_north', year: 2024, opiumHa: 20000, methIndex: 95 },
        ],
        conflictEvents: [],
        precursorFlows: [],
        outflows: [],
      })

      assert.ok(briefing.profiles.every((p) => p.neighborRiskScore === 0 && p.neighborRegion === null && !p.spilloverWatch))
    })
  })

  describe('evidence staleness', () => {
    it('treats current-year evidence as current with no confidence penalty', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      assert.equal(shan.mostRecentEvidenceYear, 2024)
      assert.equal(shan.evidenceAgeYears, 0)
      assert.equal(shan.evidenceStaleness, 'current')
    })

    it('flags aging evidence 1-2 years old and applies a smaller confidence penalty', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2023, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      assert.equal(shan.mostRecentEvidenceYear, 2023)
      assert.equal(shan.evidenceAgeYears, 1)
      assert.equal(shan.evidenceStaleness, 'aging')
    })

    it('flags stale evidence 3+ years old, penalizes confidence more, and counts it in enterprise readiness', () => {
      const fresh = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })
      const stale = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2020, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })

      const freshShan = fresh.profiles.find((p) => p.region === 'shan_north')
      const staleShan = stale.profiles.find((p) => p.region === 'shan_north')
      assert.equal(staleShan.mostRecentEvidenceYear, 2020)
      assert.equal(staleShan.evidenceAgeYears, 4)
      assert.equal(staleShan.evidenceStaleness, 'stale')
      assert.ok(staleShan.confidenceScore < freshShan.confidenceScore)
      assert.equal(stale.enterpriseReadiness.staleRegions, 1)
      assert.equal(fresh.enterpriseReadiness.staleRegions, 0)
    })

    it('reports no-data staleness when a region has no evidence at all', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [],
        precursorFlows: [],
        outflows: [],
      })
      const kachin = briefing.profiles.find((p) => p.region === 'kachin')
      assert.equal(kachin.mostRecentEvidenceYear, null)
      assert.equal(kachin.evidenceAgeYears, null)
      assert.equal(kachin.evidenceStaleness, 'no-data')
    })

    it('ignores evidence from years after the requested reporting year', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2022,
        regions,
        regionRecords: [],
        conflictEvents: [
          {
            region: 'shan_north', year: 2020, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
          {
            region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
            eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
          },
        ],
        precursorFlows: [],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      assert.equal(shan.mostRecentEvidenceYear, 2020)
      assert.equal(shan.evidenceAgeYears, 2)
      assert.equal(shan.evidenceStaleness, 'aging')
    })
  })

  describe('precursor corridor concentration', () => {
    it('flags a single-corridor region as concentrated with a 10000 HHI', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [],
        precursorFlows: [
          {
            originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
            precursor: 'meth_precursors', quantityKg: 4000, confidence: 'official',
            sourceName: 'INCB', sourceUrl: 'https://example.org/incb',
          },
        ],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      assert.equal(shan.precursorCorridorHHI, 10000)
      assert.equal(shan.precursorCorridorTier, 'concentrated')
      assert.equal(shan.dominantPrecursorCorridor, 'China')
      assert.equal(shan.dominantPrecursorCorridorSharePct, 100)
      assert.equal(briefing.enterpriseReadiness.concentratedCorridorRegions, 1)
    })

    it('rates an eight-way even split as diversified per DOJ/FTC HHI thresholds', () => {
      const origins = ['China', 'Thailand', 'India', 'Laos', 'Vietnam', 'Cambodia', 'Bangladesh', 'Nepal']
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [],
        precursorFlows: origins.map((originCountry) => ({
          originCountry, transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1000, confidence: 'official',
          sourceName: 'INCB', sourceUrl: 'https://example.org/incb',
        })),
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      // 8 equal-share corridors: HHI = 8 * (1/8)^2 * 10000 = 1250.
      assert.equal(shan.precursorCorridorHHI, 1250)
      assert.equal(shan.precursorCorridorTier, 'diversified')
      assert.equal(shan.dominantPrecursorCorridorSharePct, 12.5)
    })

    it('rates a five-way even split as moderate per DOJ/FTC HHI thresholds', () => {
      const origins = ['China', 'Thailand', 'India', 'Laos', 'Vietnam']
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [],
        precursorFlows: origins.map((originCountry) => ({
          originCountry, transitCountry: null, to: 'shan_north', year: 2024,
          precursor: 'meth_precursors', quantityKg: 1000, confidence: 'official',
          sourceName: 'INCB', sourceUrl: 'https://example.org/incb',
        })),
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      // 5 equal-share corridors: HHI = 5 * (1/5)^2 * 10000 = 2000.
      assert.equal(shan.precursorCorridorHHI, 2000)
      assert.equal(shan.precursorCorridorTier, 'moderate')
    })

    it('reports insufficient-data when a region has no precursor-flow records', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [],
        precursorFlows: [],
        outflows: [],
      })
      const kachin = briefing.profiles.find((p) => p.region === 'kachin')
      assert.equal(kachin.precursorCorridorHHI, null)
      assert.equal(kachin.precursorCorridorTier, 'insufficient-data')
      assert.equal(kachin.dominantPrecursorCorridor, null)
    })

    it('rates a 60/40 split as concentrated per DOJ/FTC HHI thresholds', () => {
      const briefing = buildMyanmarIntelligenceBriefing({
        year: 2024,
        regions,
        regionRecords: [],
        conflictEvents: [],
        precursorFlows: [
          {
            originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
            precursor: 'meth_precursors', quantityKg: 6000, confidence: 'official',
            sourceName: 'INCB', sourceUrl: 'https://example.org/incb',
          },
          {
            originCountry: 'Thailand', transitCountry: null, to: 'shan_north', year: 2024,
            precursor: 'meth_precursors', quantityKg: 4000, confidence: 'official',
            sourceName: 'UNODC', sourceUrl: 'https://example.org/unodc',
          },
        ],
        outflows: [],
      })
      const shan = briefing.profiles.find((p) => p.region === 'shan_north')
      // 60/40 split: HHI = 6000^2 + 4000^2 = 5200 (concentrated per DOJ/FTC thresholds).
      assert.equal(shan.precursorCorridorHHI, 5200)
      assert.equal(shan.precursorCorridorTier, 'concentrated')
    })
  })
})
