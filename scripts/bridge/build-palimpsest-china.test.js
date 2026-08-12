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
  sumExactQuantityKg,
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
    expect(schema.$defs.precursorCorridorData.properties.corridors.items.properties.quantityRelation.enum)
      .toEqual(['exact', 'approx', 'less_than', 'greater_than'])
    expect(schema.$defs.precursorCorridorData.properties.contextRecords.items.additionalProperties).toBe(false)
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
      includedQuantitativeRecordCount: 1,
      includedContextRecordCount: 1,
      quantityAggregation: {
        status: 'not_computed_non_exact_inputs',
        exactRecordCount: 0,
        nonExactRecordCount: 1,
        summedQuantityKg: null,
      },
    })
    expect(artifact.datasets.precursorCorridorIncidents.temporalCoverage).toEqual({
      kind: 'year_range',
      fromYear: 2024,
      toYear: 2025,
      snapshotDate: null,
    })
    expect(artifact.datasets.ofacDesignations.data).toMatchObject({
      recordCount: 118,
      narcoticsSpecificProgramRecordCount: 79,
      tcoOnlyRecordCount: 39,
    })
    expect(artifact.datasets.wildlifeConfiscations.data).toMatchObject({
      exporterOfRecord: { recordCount: 20214, rankInRetainedTable: 2 },
      importerOfRecord: { recordCount: 2222, rankInRetainedTable: 5 },
    })
    expect(() => assertPublicBridgeBoundary(artifact)).not.toThrow()
  })

  it('preserves every audited INCB quantity qualifier and locator without cross-paragraph joins', () => {
    const rows = inputs.flows.records.map((record) => ({
      origin: record.origin,
      transit: record.transit,
      destination: record.destination,
      quantityKg: record.quantityKg,
      quantityRelation: record.quantityRelation,
      recordKind: record.recordKind,
      incidentCount: record.incidentCount,
      sourceLocator: record.sourceLocator,
    }))

    expect(rows).toEqual([
      {
        origin: 'Not reported', transit: 'Thailand', destination: 'Myanmar', quantityKg: 1000,
        quantityRelation: 'less_than', recordKind: 'single_incident', incidentCount: 1,
        sourceLocator: { pdfPage: 43, printedPage: 25, paragraph: 92 },
      },
      {
        origin: 'China', transit: null, destination: 'European Union', quantityKg: 5000,
        quantityRelation: 'approx', recordKind: 'multi_incident_aggregate', incidentCount: 9,
        sourceLocator: { pdfPage: 44, printedPage: 26, paragraph: 94 },
      },
      {
        origin: 'Morocco', transit: 'Türkiye', destination: 'Iran', quantityKg: 15000,
        quantityRelation: 'greater_than', recordKind: 'single_incident', incidentCount: 1,
        sourceLocator: { pdfPage: 31, printedPage: 13, paragraph: 47 },
      },
      {
        origin: 'Not reported', transit: 'Ecuador', destination: 'Colombia', quantityKg: 2000,
        quantityRelation: 'approx', recordKind: 'annual_aggregate', incidentCount: null,
        sourceLocator: { pdfPage: 47, printedPage: 29, paragraph: 112 },
      },
      {
        origin: 'India', transit: null, destination: 'Democratic Republic of the Congo', quantityKg: 350,
        quantityRelation: 'exact', recordKind: 'derived_subtotal', incidentCount: null,
        sourceLocator: { pdfPage: 39, printedPage: 21, paragraph: 74 },
      },
      {
        origin: 'Egypt', transit: null, destination: 'Germany', quantityKg: 40,
        quantityRelation: 'exact', recordKind: 'multi_incident_aggregate', incidentCount: 6,
        sourceLocator: { pdfPage: 39, printedPage: 21, paragraph: 76 },
      },
    ])
    expect(rows.some((record) => (
      ['Australia', 'New Zealand'].includes(record.destination)
      && record.origin.includes('China')
    ))).toBe(false)
    expect(inputs.flows.records.every((record) => (
      record.quantityBasis.length > 0
      && record.sourceUrl === 'https://www.incb.org/incb/uploads/documents/Publications/AnnualReports/AR2025/Precursors_Report/E_INCB_2025_4_eng.pdf'
      && record.sourceDocumentSha256 === '8397f2799116fe33ce6851ec2c7e03a042886fb9c048f72cdb259724de5ddd6e'
      && record.sourceRetrievedAt === '2026-08-12T13:50:25Z'
    ))).toBe(true)
  })

  it('keeps Operation Pseudonym as non-summable qualitative context', () => {
    const [sourceContext] = inputs.flows.contextRecords
    const [publicContext] = artifact.datasets.precursorCorridorIncidents.data.contextRecords

    expect(sourceContext).toMatchObject({
      contextId: 'operation-pseudonym-australia-new-zealand-origins-2024',
      origins: ['China', 'India'],
      destinations: ['Australia', 'New Zealand'],
      recordKind: 'qualitative_context',
      allocationStatus: 'not_reported_by_origin_destination_pair',
      operationReportedSeizureCount: 168,
      countScope: 'four_reporting_countries_operation_total',
      sourceLocator: { pdfPage: 31, printedPage: 13, paragraph: 46 },
    })
    for (const context of [sourceContext, publicContext]) {
      expect(context).not.toHaveProperty('quantityKg')
      expect(context).not.toHaveProperty('quantityRelation')
      expect(context).not.toHaveProperty('incidentCount')
    }
    expect(publicContext.operationReportedSeizureCount).toBe(168)
    expect(publicContext.countScope).toBe('four_reporting_countries_operation_total')
  })

  it('pins the exact INCB document URL, hash, retrieval time and paragraph locator', () => {
    const precursor = artifact.datasets.precursorCorridorIncidents
    expect(precursor.provenance).toMatchObject({
      url: 'https://www.incb.org/incb/uploads/documents/Publications/AnnualReports/AR2025/Precursors_Report/E_INCB_2025_4_eng.pdf',
      documentSha256: '8397f2799116fe33ce6851ec2c7e03a042886fb9c048f72cdb259724de5ddd6e',
      retrievedAt: '2026-08-12T13:50:25Z',
    })
    expect(precursor.data.corridors[0].sourceLocator).toEqual({
      pdfPage: 44,
      printedPage: 26,
      paragraph: 94,
    })
  })

  it('rejects non-exact quantity summation and public totals derived from qualified values', () => {
    expect(sumExactQuantityKg([
      { origin: 'A', destination: 'B', quantityKg: 2, quantityRelation: 'exact' },
      { origin: 'C', destination: 'D', quantityKg: 3, quantityRelation: 'exact' },
    ])).toBe(5)
    expect(() => sumExactQuantityKg([
      { origin: 'China', destination: 'European Union', quantityKg: 5000, quantityRelation: 'approx' },
    ])).toThrow(/cannot sum non-exact quantity/)

    const unsafe = structuredClone(artifact)
    unsafe.datasets.precursorCorridorIncidents.data.quantityAggregation.summedQuantityKg = 5000
    expect(() => assertPublicBridgeBoundary(unsafe)).toThrow(/may not enter a reported quantity total/)
  })

  it('runtime-validates every audited flow row and qualitative context before filtering', () => {
    const invalidNonChinaRow = structuredClone(inputs)
    invalidNonChinaRow.flows.records[0].quantityRelation = undefined
    expect(() => buildPalimpsestChinaArtifact(invalidNonChinaRow))
      .toThrow(/lacks audited quantity semantics/)

    const mismatchedProvenance = structuredClone(inputs)
    mismatchedProvenance.flows.records[2].sourceDocumentSha256 = '0'.repeat(64)
    expect(() => buildPalimpsestChinaArtifact(mismatchedProvenance))
      .toThrow(/does not match the pinned INCB document provenance/)

    const summableContext = structuredClone(inputs)
    summableContext.flows.contextRecords[0].quantityKg = 168
    expect(() => buildPalimpsestChinaArtifact(summableContext))
      .toThrow(/must remain non-summable/)
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
