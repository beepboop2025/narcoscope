import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

import {
  buildOrganizedCrimeArtifact,
  OC_INDEX_YEARS,
} from './ocindex-to-json.mjs'
import {
  createCountryResolver,
  createCountryResolverFromTopology,
} from './lib/country-iso3.mjs'

const makeRow = (year, Country, score = 5) => {
  const row = {
    Continent: 'Africa',
    Region: 'Central Africa',
    Country,
    'Criminality avg.': score,
    'Criminal markets avg.': score,
    'Human trafficking': score,
    'Human smuggling': score,
    'Extortion and protection racketeering': score,
    'Arms trafficking': score,
    'Trade in counterfeit goods': score,
    'Illicit trade in excisable goods': score,
    'Flora crimes': score,
    'Fauna crimes': score,
    'Non-renewable resource crimes': score,
    'Heroin trade': score,
    'Cocaine trade': score,
    'Cannabis trade': score,
    'Synthetic drug trade': score,
    'Cyber-dependent crimes': score,
    'Financial crimes': score,
    'Criminal actors avg.': score,
    'Mafia-style groups': score,
    'Criminal networks': score,
    'State-embedded actors': score,
    'Foreign actors': score,
    'Private sector actors': score,
    'Resilience avg.': score,
    'Political leadership and governance': score,
    'Government transparency and accountability': score,
    'International cooperation': score,
    'National policies and laws': score,
    'Judicial system and detention': score,
    'Law enforcement': score,
    'Territorial integrity': score,
    'Anti-money laundering': score,
    'Economic regulatory capacity': score,
    'Victim and witness support': score,
    Prevention: score,
    'Non-state actors': score,
  }

  if (year === 2021) {
    row['Criminality avg,'] = row['Criminality avg.']; delete row['Criminality avg.']
    row['Criminal markets avg,'] = row['Criminal markets avg.']; delete row['Criminal markets avg.']
    row['Criminal actors'] = row['Criminal actors avg.']; delete row['Criminal actors avg.']
    row.Resilience = row['Resilience avg.']; delete row['Resilience avg.']
    for (const header of [
      'Extortion and protection racketeering',
      'Trade in counterfeit goods',
      'Illicit trade in excisable goods',
      'Cyber-dependent crimes',
      'Financial crimes',
      'Private sector actors',
    ]) delete row[header]
  } else if (year === 2023) {
    row['Criminal actors avg,'] = row['Criminal actors avg.']; delete row['Criminal actors avg.']
    row['Resilience avg,'] = row['Resilience avg.']; delete row['Resilience avg.']
  }
  return row
}

const fixture = () => ({
  2021: [makeRow(2021, 'Congo, Dem. Rep.', 4), makeRow(2021, 'Angola', 3)],
  2023: [makeRow(2023, 'Congo, Dem, Rep,', 6), makeRow(2023, 'Angola', 5)],
  2025: [makeRow(2025, 'Congo, Dem. Rep.', 8), makeRow(2025, 'Angola', 7)],
})

describe('OC Index country identity', () => {
  it('resolves exact Natural Earth names and reviewed upstream aliases', () => {
    const resolve = createCountryResolver()
    expect(resolve('Angola').iso3).toBe('AGO')
    expect(resolve('Congo, Dem, Rep,').iso3).toBe('COD')
    expect(resolve('St. Vincent and the Grenadines').iso3).toBe('VCT')
  })

  it('fails closed on unmapped names', () => {
    const resolve = createCountryResolver()
    expect(() => resolve('Atlantis')).toThrow('unmapped country name: Atlantis')
  })

  it('rejects duplicate ISO3 identities in an atlas', () => {
    const topology = {
      objects: {
        countries: {
          geometries: [
            { id: 'AAA', properties: { name: 'Alpha', ADM0_A3: 'AAA' } },
            { id: 'AAA', properties: { name: 'Beta', ADM0_A3: 'AAA' } },
          ],
        },
      },
    }
    expect(() => createCountryResolverFromTopology(topology, {}))
      .toThrow('duplicate Natural Earth ISO3 AAA')
  })
})

describe('ocindex-to-json', () => {
  it('emits deterministic longitudinal records with every market, actor and resilience field', () => {
    const artifact = buildOrganizedCrimeArtifact(fixture(), {
      downloadedAt: '2026-08-30T19:57:25Z',
    })

    expect(artifact.meta.years).toEqual(OC_INDEX_YEARS)
    expect(artifact.records.map(({ year, iso3 }) => `${year}|${iso3}`)).toEqual([
      '2021|AGO', '2021|COD', '2023|AGO', '2023|COD', '2025|AGO', '2025|COD',
    ])
    const old = artifact.records.find((record) => record.year === 2021 && record.iso3 === 'COD')
    expect(old.country).toBe('Congo, Dem. Rep.')
    expect(old.markets).toMatchObject({
      armsTrafficking: 4,
      nonRenewableResourceCrimes: 4,
      financialCrimes: null,
      extortion: null,
    })
    expect(old.actors).toMatchObject({ average: 4, stateEmbeddedActors: 4, privateSectorActors: null })
    expect(old.resilience).toMatchObject({
      average: 4,
      antiMoneyLaundering: 4,
      economicRegulatoryCapacity: 4,
      nonStateActors: 4,
    })
    expect(Object.keys(artifact.records.at(-1).markets)).toHaveLength(15)
    expect(Object.keys(artifact.records.at(-1).actors)).toHaveLength(6)
    expect(Object.keys(artifact.records.at(-1).resilience)).toHaveLength(13)
  })

  it('fails closed on duplicate country-year keys', () => {
    const datasets = fixture()
    datasets[2025].push({ ...datasets[2025][0] })
    expect(() => buildOrganizedCrimeArtifact(datasets, { downloadedAt: '2026-08-30T19:57:25Z' }))
      .toThrow('duplicate OC Index 2025 ISO3 COD')
  })

  it('fails closed on scores outside the documented 1-10 scale', () => {
    const datasets = fixture()
    datasets[2023][0]['Arms trafficking'] = 10.01
    expect(() => buildOrganizedCrimeArtifact(datasets, { downloadedAt: '2026-08-30T19:57:25Z' }))
      .toThrow('outside 1-10')
  })

  it('fails closed when a required edition field disappears', () => {
    const datasets = fixture()
    delete datasets[2025][0]['Fauna crimes']
    expect(() => buildOrganizedCrimeArtifact(datasets, { downloadedAt: '2026-08-30T19:57:25Z' }))
      .toThrow('required workbook column is missing: Fauna crimes')
  })

  it('bundles all 193 countries in each reviewed edition with provenance and caveats', () => {
    const artifact = JSON.parse(fs.readFileSync('src/data/organizedCrime.json', 'utf8'))
    expect(artifact.meta).toMatchObject({
      schemaVersion: 'narcoscope.organized-crime.v1',
      years: [2021, 2023, 2025],
      scale: { minimum: 1, maximum: 10 },
    })
    expect(artifact.meta.rights).toContain('GI-TOC')
    expect(artifact.meta.caveats.join(' ')).toMatch(/not counts|not transaction/i)
    expect(artifact.records).toHaveLength(579)
    for (const year of OC_INDEX_YEARS) {
      expect(artifact.records.filter((record) => record.year === year)).toHaveLength(193)
    }
    expect(new Set(artifact.records.map((record) => `${record.year}|${record.iso3}`)).size)
      .toBe(artifact.records.length)
  })
})
