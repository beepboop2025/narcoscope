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
    expect(schema.$defs.precursorCorridorData.properties.corridors.items.properties.aggregationEligibility.enum)
      .toContain('eligible')
    expect(schema.$defs.precursorCorridorData.properties.quantityAggregation.required)
      .toEqual(expect.arrayContaining(['eligibleRecordCount', 'excludedRecordCount', 'aggregationGroup']))
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
        eligibleRecordCount: 0,
        excludedRecordCount: 1,
        aggregationGroup: null,
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
      seizureLocation: record.seizureLocation,
      quantityKg: record.quantityKg,
      quantityRelation: record.quantityRelation,
      recordKind: record.recordKind,
      aggregationEligibility: record.aggregationEligibility,
      aggregationGroup: record.aggregationGroup,
      incidentCount: record.incidentCount,
      sourceLocator: record.sourceLocator,
    }))

    expect(rows).toEqual([
      {
        origin: 'Not reported', transit: null, destination: 'Myanmar', seizureLocation: 'Thailand', quantityKg: 1000,
        quantityRelation: 'less_than', recordKind: 'single_incident', incidentCount: 1,
        aggregationEligibility: 'ineligible_non_exact', aggregationGroup: 'mdma_precursor_substance_mass',
        sourceLocator: { pdfPage: 43, printedPage: 25, paragraph: 92 },
      },
      {
        origin: 'China', transit: null, destination: 'European Union', seizureLocation: null, quantityKg: 5000,
        quantityRelation: 'less_than', recordKind: 'multi_incident_aggregate', incidentCount: 9,
        aggregationEligibility: 'ineligible_non_exact', aggregationGroup: 'meth_pre_precursor_substance_mass',
        sourceLocator: { pdfPage: 44, printedPage: 26, paragraph: 94 },
      },
      {
        origin: 'Morocco', transit: 'Türkiye', destination: 'Iran', seizureLocation: null, quantityKg: 15000,
        quantityRelation: 'greater_than', recordKind: 'single_incident', incidentCount: 1,
        aggregationEligibility: 'ineligible_non_exact', aggregationGroup: 'pseudoephedrine_preparation_gross_mass',
        sourceLocator: { pdfPage: 31, printedPage: 13, paragraph: 47 },
      },
      {
        origin: 'Not reported', transit: 'Ecuador', destination: 'Colombia', seizureLocation: 'Ecuador', quantityKg: 2000,
        quantityRelation: 'approx', recordKind: 'annual_aggregate', incidentCount: null,
        aggregationEligibility: 'ineligible_non_exact', aggregationGroup: 'potassium_permanganate_substance_mass',
        sourceLocator: { pdfPage: 47, printedPage: 29, paragraph: 112 },
      },
      {
        origin: 'India', transit: null, destination: 'Democratic Republic of the Congo', seizureLocation: 'Democratic Republic of the Congo', quantityKg: 350,
        quantityRelation: 'exact', recordKind: 'derived_subtotal', incidentCount: null,
        aggregationEligibility: 'ineligible_derived', aggregationGroup: null,
        sourceLocator: { pdfPage: 39, printedPage: 21, paragraph: 74 },
      },
      {
        origin: 'Egypt', transit: null, destination: 'Germany', seizureLocation: 'Germany', quantityKg: 40,
        quantityRelation: 'exact', recordKind: 'multi_incident_aggregate', incidentCount: 6,
        aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass',
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
      { origin: 'A', destination: 'B', quantityKg: 2, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass' },
      { origin: 'C', destination: 'D', quantityKg: 3, quantityRelation: 'exact', recordKind: 'multi_incident_aggregate', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass' },
    ])).toBe(5)
    expect(() => sumExactQuantityKg([
      { origin: 'China', destination: 'European Union', quantityKg: 5000, quantityRelation: 'approx' },
    ])).toThrow(/cannot sum non-exact quantity/)
    expect(() => sumExactQuantityKg([
      { origin: 'A', destination: 'B', quantityKg: 2, quantityRelation: 'exact', recordKind: 'derived_subtotal', aggregationEligibility: 'ineligible_derived', aggregationGroup: null },
    ])).toThrow(/aggregation-ineligible/)
    expect(() => sumExactQuantityKg([
      { origin: 'A', destination: 'B', quantityKg: 2, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'pseudoephedrine_preparation_mass' },
      { origin: 'C', destination: 'D', quantityKg: 3, quantityRelation: 'exact', recordKind: 'single_incident', aggregationEligibility: 'eligible', aggregationGroup: 'potassium_permanganate_substance_mass' },
    ])).toThrow(/incompatible aggregation groups/)

    const unsafe = structuredClone(artifact)
    unsafe.datasets.precursorCorridorIncidents.data.quantityAggregation.summedQuantityKg = 5000
    expect(() => assertPublicBridgeBoundary(unsafe)).toThrow(/canonical eligibility contract/)
  })

  it('computes a compatible exact-only group and reports no total when no China corridor remains', () => {
    const exactOnly = structuredClone(inputs)
    const chinaRow = exactOnly.flows.records.find((record) => record.origin === 'China')
    chinaRow.quantityRelation = 'exact'
    chinaRow.quantityBasis = 'Synthetic exact fixture for aggregation branch coverage.'
    chinaRow.aggregationEligibility = 'eligible'
    const exactArtifact = buildPalimpsestChinaArtifact(exactOnly)
    expect(exactArtifact.datasets.precursorCorridorIncidents.data.quantityAggregation).toEqual({
      status: 'computed_exact_only',
      exactRecordCount: 1,
      nonExactRecordCount: 0,
      eligibleRecordCount: 1,
      excludedRecordCount: 0,
      aggregationGroup: 'meth_pre_precursor_substance_mass',
      summedQuantityKg: 5000,
    })
    expect(() => assertPublicBridgeBoundary(exactArtifact)).not.toThrow()

    const incompatibleExact = structuredClone(inputs)
    const incompatibleChinaRow = incompatibleExact.flows.records
      .find((record) => record.origin === 'China')
    incompatibleChinaRow.quantityRelation = 'exact'
    incompatibleChinaRow.quantityBasis = 'Synthetic incompatible-basis fixture.'
    incompatibleChinaRow.aggregationEligibility = 'ineligible_incompatible_basis'
    incompatibleChinaRow.aggregationGroup = null
    const incompatibleArtifact = buildPalimpsestChinaArtifact(incompatibleExact)
    expect(incompatibleArtifact.datasets.precursorCorridorIncidents.data.quantityAggregation)
      .toMatchObject({
        status: 'not_computed_ineligible_exact_inputs',
        eligibleRecordCount: 0,
        excludedRecordCount: 1,
        aggregationGroup: null,
        summedQuantityKg: null,
      })

    const mixedGroups = structuredClone(exactOnly)
    const secondChinaRow = {
      ...structuredClone(mixedGroups.flows.records.find((record) => record.origin === 'China')),
      precursor: 'meth_precursors',
      destination: 'Germany',
      quantityKg: 40,
      quantityBasis: 'Synthetic second compatible group fixture.',
      aggregationGroup: 'pseudoephedrine_preparation_mass',
    }
    mixedGroups.flows.records.push(secondChinaRow)
    const mixedArtifact = buildPalimpsestChinaArtifact(mixedGroups)
    expect(mixedArtifact.datasets.precursorCorridorIncidents.data.quantityAggregation)
      .toMatchObject({
        status: 'not_computed_mixed_aggregation_groups',
        eligibleRecordCount: 2,
        excludedRecordCount: 0,
        aggregationGroup: null,
        summedQuantityKg: null,
      })
    expect(() => assertPublicBridgeBoundary(mixedArtifact)).not.toThrow()

    const noChina = structuredClone(inputs)
    noChina.flows.records = noChina.flows.records
      .filter((record) => !record.origin.split('/').map((part) => part.trim()).includes('China'))
    const emptyArtifact = buildPalimpsestChinaArtifact(noChina)
    expect(emptyArtifact.datasets.precursorCorridorIncidents.data.quantityAggregation).toEqual({
      status: 'not_computed_no_records',
      exactRecordCount: 0,
      nonExactRecordCount: 0,
      eligibleRecordCount: 0,
      excludedRecordCount: 0,
      aggregationGroup: null,
      summedQuantityKg: null,
    })
    expect(emptyArtifact.datasets.precursorCorridorIncidents.temporalCoverage).toEqual({
      kind: 'year_range',
      fromYear: 2024,
      toYear: 2024,
      snapshotDate: null,
    })
    expect(() => assertPublicBridgeBoundary(emptyArtifact)).not.toThrow()
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

    const missingOrigin = structuredClone(inputs)
    missingOrigin.flows.records[0].origin = ''
    expect(() => buildPalimpsestChinaArtifact(missingOrigin))
      .toThrow(/lacks a reported origin and destination/)

    const missingDestination = structuredClone(inputs)
    missingDestination.flows.records[0].destination = undefined
    expect(() => buildPalimpsestChinaArtifact(missingDestination))
      .toThrow(/lacks a reported origin and destination/)

    const unsafeDerived = structuredClone(inputs)
    const derived = unsafeDerived.flows.records.find((record) => record.recordKind === 'derived_subtotal')
    derived.aggregationEligibility = 'eligible'
    expect(() => buildPalimpsestChinaArtifact(unsafeDerived))
      .toThrow(/not eligible for a compatible exact subtotal|must exclude a derived subtotal/)

    const groupedDerived = structuredClone(inputs)
    groupedDerived.flows.records
      .find((record) => record.recordKind === 'derived_subtotal')
      .aggregationGroup = 'pseudoephedrine_preparation_mass'
    expect(() => buildPalimpsestChinaArtifact(groupedDerived))
      .toThrow(/may not assign a canonical aggregation group to a derived subtotal/)
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

  it('rejects a public derived subtotal that names a canonical aggregation group', () => {
    const unsafe = structuredClone(artifact)
    const corridor = unsafe.datasets.precursorCorridorIncidents.data.corridors[0]
    corridor.quantityRelation = 'exact'
    corridor.recordKind = 'derived_subtotal'
    corridor.aggregationEligibility = 'ineligible_derived'
    corridor.aggregationGroup = 'meth_pre_precursor_substance_mass'
    unsafe.datasets.precursorCorridorIncidents.data.quantityAggregation = {
      status: 'not_computed_ineligible_exact_inputs',
      exactRecordCount: 1,
      nonExactRecordCount: 0,
      eligibleRecordCount: 0,
      excludedRecordCount: 1,
      aggregationGroup: null,
      summedQuantityKg: null,
    }

    expect(() => assertPublicBridgeBoundary(unsafe))
      .toThrow(/invalid aggregation semantics/)
  })
})
