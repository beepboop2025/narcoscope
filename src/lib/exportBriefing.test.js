import { describe, it, assert } from 'vitest'
import { buildMyanmarIntelligenceBriefing } from './intelligence'
import { riskProfilesToCsv, evidenceLedgerToCsv } from './exportBriefing'

describe('exportBriefing', () => {
  const regions = [
    { id: 'shan_north', label: 'Shan North', lat: 23, lng: 98 },
    { id: 'kachin', label: 'Kachin', lat: 26, lng: 97 },
  ]

  const briefing = buildMyanmarIntelligenceBriefing({
    year: 2024,
    regions,
    regionRecords: [
      { region: 'shan_north', year: 2024, opiumHa: 10000, methIndex: 90 },
      { region: 'kachin', year: 2024, opiumHa: 5000, methIndex: 20 },
    ],
    conflictEvents: [
      {
        region: 'shan_north', year: 2024, actor: 'Border militia', actorType: 'militia',
        eventType: 'clash', intensity: 80, sourceName: 'ACLED', sourceUrl: 'https://example.org/acled',
      },
    ],
    precursorFlows: [
      {
        originCountry: 'China', transitCountry: null, to: 'shan_north', year: 2024,
        precursor: 'meth_precursors', quantityKg: 4000, confidence: 'official',
        sourceName: 'INCB, precursors report', sourceUrl: 'https://example.org/incb',
      },
    ],
    outflows: [
      { from: 'shan_north', to: 'muse', year: 2024, quantityKg: 3000, drug: 'Methamphetamine' },
    ],
  })

  describe('riskProfilesToCsv', () => {
    it('produces one header row plus one row per region profile', () => {
      const csv = riskProfilesToCsv(briefing)
      const lines = csv.split('\r\n')
      assert.equal(lines.length, 1 + briefing.profiles.length)
      assert.ok(lines[0].startsWith('region,label,year,riskScore,confidenceScore'))
    })

    it('includes evidence-staleness and spillover fields for downstream audit', () => {
      const csv = riskProfilesToCsv(briefing)
      assert.ok(csv.includes('evidenceStaleness'))
      assert.ok(csv.includes('spilloverWatch'))
      assert.ok(csv.includes('trajectory'))
    })

    it('includes precursor-corridor concentration fields for downstream audit', () => {
      const csv = riskProfilesToCsv(briefing)
      assert.ok(csv.includes('precursorCorridorHHI'))
      assert.ok(csv.includes('precursorCorridorTier'))
      assert.ok(csv.includes('dominantPrecursorCorridor'))
      const dataLine = csv.split('\r\n').find((line) => line.startsWith('shan_north,'))
      assert.ok(dataLine.includes('10000'))
      assert.ok(dataLine.includes('concentrated'))
    })

    it('quotes fields containing commas per RFC 4180', () => {
      const csv = riskProfilesToCsv(briefing)
      // "INCB, precursors report" flows into a source name referenced by the
      // evidence graph, not this table directly, but drivers/conflictNotes
      // use "; " joins specifically to avoid comma-quoting churn here.
      const dataLine = csv.split('\r\n')[1]
      assert.ok(!dataLine.includes('""'))
    })
  })

  describe('evidenceLedgerToCsv', () => {
    it('produces one header row plus one row per fused edge', () => {
      const csv = evidenceLedgerToCsv(briefing)
      const lines = csv.split('\r\n')
      assert.equal(lines.length, 1 + briefing.edges.length)
      assert.equal(lines[0], 'from,relation,to,weight,sourceName,sourceUrl')
    })

    it('quotes source names containing commas', () => {
      const csv = evidenceLedgerToCsv(briefing)
      assert.ok(csv.includes('"INCB, precursors report"'))
    })

    it('resolves node ids to human-readable labels', () => {
      const csv = evidenceLedgerToCsv(briefing)
      assert.ok(csv.includes('Shan North'))
      assert.ok(!csv.includes('region:shan_north'))
    })
  })
})
