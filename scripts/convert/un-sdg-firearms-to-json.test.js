import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

import {
  buildFirearmsTracingArtifact,
  extractRelease,
  SERIES,
} from './un-sdg-firearms-to-json.mjs'

const observation = (overrides = {}) => ({
  goal: ['16'],
  target: ['16.4'],
  indicator: ['16.4.2'],
  series: SERIES,
  seriesDescription: 'Proportion of seized, found or surrendered arms whose illicit origin or context has been traced or established by a competent authority in line with international instruments',
  geoAreaCode: '8',
  geoAreaName: 'Albania',
  timePeriodStart: 2024,
  value: '0',
  source: 'IAFQ',
  footnotes: [''],
  attributes: { Nature: 'C', Units: 'PERCENT' },
  dimensions: { 'Reporting Type': 'G' },
  ...overrides,
})

const fixture = () => ({
  totalElements: 2,
  data: [
    observation({
      geoAreaCode: '68',
      geoAreaName: 'Bolivia (Plurinational State of)',
      timePeriodStart: 2016,
      value: '18.25',
      source: 'SDG',
      footnotes: ['2016-2017 average based on available data'],
    }),
    observation(),
  ],
})

const options = {
  release: '2026.Q2.G.02',
  downloadedAt: '2026-08-30T20:05:00Z',
}

describe('un-sdg-firearms-to-json', () => {
  it('preserves the SDG dimensions and sorts deterministic ISO3/year records', () => {
    const artifact = buildFirearmsTracingArtifact(fixture(), options)

    expect(artifact.records).toEqual([
      {
        iso3: 'ALB',
        country: 'Albania',
        m49: '8',
        year: 2024,
        valuePercent: 0,
        nature: 'C',
        source: 'IAFQ',
        reportingType: 'G',
        footnotes: [],
      },
      {
        iso3: 'BOL',
        country: 'Bolivia (Plurinational State of)',
        m49: '68',
        year: 2016,
        valuePercent: 18.25,
        nature: 'C',
        source: 'SDG',
        reportingType: 'G',
        footnotes: ['2016-2017 average based on available data'],
      },
    ])
    expect(artifact.meta).toMatchObject({
      schemaVersion: 'narcoscope.firearms-tracing.v1',
      series: SERIES,
      release: '2026.Q2.G.02',
      downloadedAt: '2026-08-30T20:05:00.000Z',
      unit: 'percent',
    })
    expect(artifact.meta.caveats.join(' ')).toMatch(/Tracing effectiveness is not arms-flow volume/i)
  })

  it('extracts the current release attached to the exact SDG series', () => {
    expect(extractRelease([{
      series: [
        { code: 'OTHER', release: 'old' },
        { code: SERIES, release: '2026.Q2.G.02' },
      ],
    }])).toBe('2026.Q2.G.02')
  })

  it('fails closed on an incomplete paginated payload', () => {
    const payload = fixture()
    payload.totalElements = 3
    expect(() => buildFirearmsTracingArtifact(payload, options)).toThrow('payload is incomplete')
  })

  it('fails closed on duplicate observation keys', () => {
    const row = observation()
    expect(() => buildFirearmsTracingArtifact({ totalElements: 2, data: [row, { ...row }] }, options))
      .toThrow('duplicate UN SDG firearms-tracing key')
  })

  it('fails closed on percentages outside 0-100 and unexpected units', () => {
    expect(() => buildFirearmsTracingArtifact({ data: [observation({ value: '100.1' })] }, options))
      .toThrow('outside 0-100 percent')
    expect(() => buildFirearmsTracingArtifact({
      data: [observation({ attributes: { Nature: 'C', Units: 'NUMBER' } })],
    }, options)).toThrow('unsupported unit NUMBER')
    expect(() => buildFirearmsTracingArtifact({
      data: [observation({ attributes: { Nature: 'UNKNOWN', Units: 'PERCENT' } })],
    }, options)).toThrow('unsupported nature UNKNOWN')
    expect(() => buildFirearmsTracingArtifact({
      data: [observation({ dimensions: { 'Reporting Type': 'UNKNOWN' } })],
    }, options)).toThrow('unsupported reporting type UNKNOWN')
  })

  it('bundles the complete current official series without person-level data', () => {
    const artifact = JSON.parse(fs.readFileSync('src/data/firearmsTracing.json', 'utf8'))
    expect(artifact.meta).toMatchObject({
      schemaVersion: 'narcoscope.firearms-tracing.v1',
      series: SERIES,
      unit: 'percent',
    })
    expect(artifact.meta.release).toMatch(/^\d{4}\.Q[1-4]\.G\.\d{2}$/)
    expect(artifact.meta.rights).toContain('United Nations')
    expect(artifact.meta.caveats.join(' ')).toMatch(/not arms-flow volume/i)
    expect(artifact.records.length).toBeGreaterThanOrEqual(100)
    expect(new Set(artifact.records.map((record) => record.iso3)).size).toBeGreaterThanOrEqual(40)
    expect(new Set(artifact.records.map((record) => [
      record.iso3,
      record.year,
      record.nature,
      record.source,
      record.reportingType,
    ].join('|'))).size).toBe(artifact.records.length)
    for (const record of artifact.records) {
      expect(record.valuePercent).toBeGreaterThanOrEqual(0)
      expect(record.valuePercent).toBeLessThanOrEqual(100)
      expect(record).not.toHaveProperty('person')
      expect(record).not.toHaveProperty('actor')
    }
  })
})
