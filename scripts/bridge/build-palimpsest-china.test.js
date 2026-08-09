import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BRIDGE_ARTIFACT_FILE,
  BRIDGE_SCHEMA_FILE,
  BRIDGE_SCHEMA_VERSION,
  assertPublicBridgeBoundary,
  buildPalimpsestChinaArtifact,
  loadBridgeInputs,
  serializePalimpsestChinaArtifact,
} from './build-palimpsest-china.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicDir = path.join(root, 'public/data')
let inputs
let artifact

beforeAll(async () => {
  inputs = await loadBridgeInputs(root)
  artifact = buildPalimpsestChinaArtifact(inputs)
})

describe('Palimpsest China aggregate bridge', () => {
  it('is deterministic and the checked-in artifact matches current source data', async () => {
    const first = serializePalimpsestChinaArtifact(buildPalimpsestChinaArtifact(inputs))
    const second = serializePalimpsestChinaArtifact(buildPalimpsestChinaArtifact(inputs))
    const checkedIn = await fs.readFile(path.join(publicDir, BRIDGE_ARTIFACT_FILE), 'utf8')

    expect(first).toBe(second)
    expect(checkedIn).toBe(first)
  })

  it('uses the versioned public schema and includes only official datasets', async () => {
    const schema = JSON.parse(await fs.readFile(path.join(publicDir, BRIDGE_SCHEMA_FILE), 'utf8'))
    const datasets = Object.values(artifact.datasets)

    expect(artifact.schemaVersion).toBe(BRIDGE_SCHEMA_VERSION)
    expect(artifact.$schema).toBe(`./${BRIDGE_SCHEMA_FILE}`)
    expect(schema.properties.schemaVersion.const).toBe(BRIDGE_SCHEMA_VERSION)
    expect(datasets.every((dataset) => dataset.sourceStatus === 'official')).toBe(true)
    expect(artifact.disclosure.illustrativeDataIncluded).toBe(false)
    expect(artifact.exclusions.map((item) => item.component)).toEqual(expect.arrayContaining([
      'precursor_price_series',
      'myanmar_region_flow_volumes_and_meth_index',
      'myanmar_precursor_inflows',
      'governed_scraper_observations',
      'designation_subject_details',
    ]))
  })

  it('pins the expected China aggregates without publishing subject records', () => {
    expect(artifact.datasets.retailDrugPrices.data.recordCount).toBe(4)
    expect(artifact.datasets.drugSeizures.data.sourceRowCount).toBe(102)
    expect(artifact.datasets.precursorCorridorIncidents.data).toMatchObject({
      includedIncidentCount: 3,
      reportedQuantityAcrossIncludedIncidentsKg: 7200,
    })
    expect(artifact.datasets.ofacDesignations.data.recordCount).toBe(118)
    expect(artifact.datasets.wildlifeConfiscations.data).toMatchObject({
      exporterOfRecord: { recordCount: 20214, rankInRetainedTable: 2 },
      importerOfRecord: { recordCount: 2222, rankInRetainedTable: 5 },
    })
    expect(() => assertPublicBridgeBoundary(artifact)).not.toThrow()
  })

  it('does not leak a designation name, alias or identifier into the aggregate', () => {
    const sentinelName = 'PRIVATE SUBJECT SENTINEL'
    const sentinelAlias = 'PRIVATE ALIAS SENTINEL'
    const chinaRecordIndex = inputs.designations.data.records
      .findIndex((record) => record.countries.includes('China'))
    expect(chinaRecordIndex).toBeGreaterThanOrEqual(0)
    const changedRecords = inputs.designations.data.records.map((record, index) => index === chinaRecordIndex
      ? { ...record, entityNumber: 999999999, name: sentinelName, aliases: [sentinelAlias] }
      : record)
    const changedInputs = {
      ...inputs,
      designations: {
        ...inputs.designations,
        data: { ...inputs.designations.data, records: changedRecords },
      },
    }
    const serialized = serializePalimpsestChinaArtifact(buildPalimpsestChinaArtifact(changedInputs))

    expect(serialized).not.toContain(sentinelName)
    expect(serialized).not.toContain(sentinelAlias)
    expect(serialized).not.toContain('999999999')
    expect(serialized).not.toContain('"entityNumber":')
    expect(serialized).not.toContain('"aliases":')
  })
})
