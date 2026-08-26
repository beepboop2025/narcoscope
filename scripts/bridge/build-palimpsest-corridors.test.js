import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CORRIDOR_ARTIFACT_FILE,
  CORRIDOR_SCHEMA_FILE,
  CORRIDOR_SCHEMA_VERSION,
  assertCorridorBridgeBoundary,
  buildPalimpsestCorridorArtifact,
  serializePalimpsestCorridorArtifact,
} from './build-palimpsest-corridors.mjs'
import { loadBridgeInputs } from './build-palimpsest-china.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicDir = path.join(root, 'public/data')
let inputs
let artifact

beforeAll(async () => {
  inputs = await loadBridgeInputs(root)
  artifact = buildPalimpsestCorridorArtifact(inputs)
})

describe('Palimpsest China-Pakistan-Myanmar corridor bridge', () => {
  it('is deterministic and matches the checked-in artifact', async () => {
    const first = serializePalimpsestCorridorArtifact(buildPalimpsestCorridorArtifact(inputs))
    const second = serializePalimpsestCorridorArtifact(buildPalimpsestCorridorArtifact(inputs))
    const checkedIn = await fs.readFile(path.join(publicDir, CORRIDOR_ARTIFACT_FILE), 'utf8')
    expect(first).toBe(second)
    expect(checkedIn).toBe(first)
  })

  it('publishes an additive v2 contract with strict disclosure boundaries', async () => {
    const schema = JSON.parse(await fs.readFile(path.join(publicDir, CORRIDOR_SCHEMA_FILE), 'utf8'))
    expect(artifact.schemaVersion).toBe(CORRIDOR_SCHEMA_VERSION)
    expect(schema.properties.schemaVersion.const).toBe(CORRIDOR_SCHEMA_VERSION)
    expect(artifact.geographies.map((item) => item.iso3)).toEqual(['CHN', 'MMR', 'PAK'])
    expect(artifact.disclosure).toMatchObject({
      sourcePolicy: 'official_only',
      joinPolicy: 'geography_and_time_only',
      politicalOrArmedActorInference: 'prohibited',
      illustrativeDataIncluded: false,
    })
    expect(() => assertCorridorBridgeBoundary(artifact)).not.toThrow()
  })

  it('adds official country coverage without converting missing rows to zero', () => {
    const prices = artifact.datasets.retailDrugPrices.data.countries
    expect(prices.map((row) => [row.geography.iso3, row.recordCount])).toEqual([
      ['CHN', 4], ['MMR', 3], ['PAK', 2],
    ])
    const seizures = artifact.datasets.drugSeizures.data.countries
    expect(seizures.map((row) => [row.geography.iso3, row.sourceRowCount])).toEqual([
      ['CHN', 102], ['MMR', 86], ['PAK', 95],
    ])
    const wildlife = artifact.datasets.wildlifeConfiscations.data.countries
    const myanmar = wildlife.find((row) => row.geography.iso3 === 'MMR')
    expect(myanmar.exporterOfRecord).toEqual({
      coverageStatus: 'not_in_retained_top_table',
      recordCount: null,
      rankInRetainedTable: null,
    })
  })

  it('preserves the absence of a China-Myanmar bilateral precursor claim', () => {
    const data = artifact.datasets.precursorCorridorIncidents.data
    expect(data.includedQuantitativeRecordCount).toBe(2)
    expect(data.includedContextRecordCount).toBe(1)
    expect(data.crossTargetBilateralRecordCount).toBe(0)
    expect(data.quantityAggregation.summedQuantityKg).toBeNull()
    expect(data.corridors.find((row) => row.destination === 'Myanmar')).toMatchObject({
      reportedOrigin: 'Not reported',
      geographyMatches: ['MMR'],
      quantityRelation: 'less_than',
      sourceLocator: { pdfPage: 43, printedPage: 25, paragraph: 92 },
    })
  })

  it('keeps political movements, licensed conflict rows and subject records outside the bridge', () => {
    const exclusions = Object.fromEntries(artifact.exclusions.map((row) => [row.component, row]))
    expect(exclusions).toHaveProperty('political_and_armed_movements')
    expect(exclusions).toHaveProperty('acled_conflict_rows')
    expect(exclusions).toHaveProperty('designation_subject_details')
    expect(JSON.stringify(artifact)).not.toMatch(
      /"(?:entityNumber|aliases|identityNumber|latitude|longitude)":/,
    )
  })
})
