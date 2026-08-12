#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BRIDGE_SCHEMA_VERSION = 'narcoscope.palimpsest.china-aggregate.v1'
export const BRIDGE_SCHEMA_FILE = 'narcoscope-palimpsest-v1.schema.json'
export const BRIDGE_ARTIFACT_FILE = 'narcoscope-palimpsest-v1.json'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '../..')
export const DEFAULT_BRIDGE_OUTPUT = path.join(
  defaultRoot,
  'public/data',
  BRIDGE_ARTIFACT_FILE,
)

const INPUT_PATHS = Object.freeze({
  prices: 'src/data/prices.ts',
  flows: 'src/data/flows.ts',
  seizures: 'src/data/seizures.json',
  designations: 'src/data/designations.json',
  wildlife: 'src/data/wildlifeSeizures.json',
})

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const round = (value, places = 2) => {
  const factor = 10 ** places
  return Math.round((value + Number.EPSILON) * factor) / factor
}
const sum = (values) => values.reduce((total, value) => total + value, 0)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const QUANTITY_RELATIONS = new Set(['exact', 'approx', 'less_than', 'greater_than'])
const FLOW_RECORD_KINDS = new Set([
  'single_incident',
  'multi_incident_aggregate',
  'annual_aggregate',
  'derived_subtotal',
])
const NARCOTICS_SPECIFIC_OFAC_PROGRAMS = new Set([
  'SDNT',
  'SDNTK',
  'ILLICIT-DRUGS-EO14059',
])

function inputDescriptor(relativePath, raw) {
  return { path: relativePath, sha256: sha256(raw) }
}

function normalizedSourceTitle(value) {
  return String(value).replace(/[\u2013\u2014]/g, '-')
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function hasValidSourceLocator(locator) {
  return locator
    && isPositiveInteger(locator.pdfPage)
    && isPositiveInteger(locator.printedPage)
    && isPositiveInteger(locator.paragraph)
}

function assertPinnedIncbProvenance(record, source, label) {
  if (record.sourceName !== source.sourceName
    || record.sourceUrl !== source.sourceUrl
    || record.sourceDocumentSha256 !== source.sourceDocumentSha256
    || record.sourceRetrievedAt !== source.sourceRetrievedAt) {
    throw new Error(`${label} does not match the pinned INCB document provenance`)
  }
  if (!hasValidSourceLocator(record.sourceLocator)) {
    throw new Error(`${label} lacks a valid paragraph and page locator`)
  }
}

function assertAuditedFlowInputs(flows) {
  const { records, contextRecords, source } = flows
  if (!Array.isArray(records) || !Array.isArray(contextRecords)) {
    throw new Error('audited precursor records and context records must be arrays')
  }
  if (!source?.sourceName
    || !/^https:\/\/www\.incb\.org\/.+\.pdf$/.test(source.sourceUrl ?? '')
    || !/^[a-f0-9]{64}$/.test(source.sourceDocumentSha256 ?? '')
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(source.sourceRetrievedAt ?? '')) {
    throw new Error('pinned INCB document provenance is incomplete or invalid')
  }

  for (const record of records) {
    const label = `precursor-flow record ${record.origin ?? '?'} to ${record.destination ?? '?'}`
    if (!Number.isFinite(record.quantityKg) || record.quantityKg < 0) {
      throw new Error(`${label} has an invalid quantity`)
    }
    if (!QUANTITY_RELATIONS.has(record.quantityRelation)
      || !FLOW_RECORD_KINDS.has(record.recordKind)
      || typeof record.quantityBasis !== 'string'
      || record.quantityBasis.trim().length === 0) {
      throw new Error(`${label} lacks audited quantity semantics`)
    }
    if (record.incidentCount !== null && !isPositiveInteger(record.incidentCount)) {
      throw new Error(`${label} has an invalid incident count`)
    }
    assertPinnedIncbProvenance(record, source, label)
  }

  for (const record of contextRecords) {
    const label = `precursor context ${record.contextId ?? '?'}`
    if (record.recordKind !== 'qualitative_context'
      || record.allocationStatus !== 'not_reported_by_origin_destination_pair'
      || record.countScope !== 'four_reporting_countries_operation_total'
      || !isPositiveInteger(record.operationReportedSeizureCount)
      || !Array.isArray(record.origins)
      || record.origins.length === 0
      || !Array.isArray(record.destinations)
      || record.destinations.length === 0) {
      throw new Error(`${label} lacks audited non-bilateral context semantics`)
    }
    if (Object.hasOwn(record, 'quantityKg')
      || Object.hasOwn(record, 'quantityRelation')
      || Object.hasOwn(record, 'incidentCount')) {
      throw new Error(`${label} must remain non-summable`)
    }
    assertPinnedIncbProvenance(record, source, label)
  }
}

async function evaluateTypeScript(raw, fileName) {
  const imported = await import('typescript')
  const ts = imported.default ?? imported
  const result = ts.transpileModule(raw, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const message = errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ')
    throw new Error(`could not read ${fileName}: ${message}`)
  }
  const encoded = Buffer.from(result.outputText).toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

async function readInput(root, relativePath) {
  const raw = await fs.readFile(path.join(root, relativePath), 'utf8')
  return { raw, input: inputDescriptor(relativePath, raw) }
}

export async function loadBridgeInputs(root = defaultRoot) {
  const [pricesFile, flowsFile, seizuresFile, designationsFile, wildlifeFile] = await Promise.all([
    readInput(root, INPUT_PATHS.prices),
    readInput(root, INPUT_PATHS.flows),
    readInput(root, INPUT_PATHS.seizures),
    readInput(root, INPUT_PATHS.designations),
    readInput(root, INPUT_PATHS.wildlife),
  ])
  const [pricesModule, flowsModule] = await Promise.all([
    evaluateTypeScript(pricesFile.raw, INPUT_PATHS.prices),
    evaluateTypeScript(flowsFile.raw, INPUT_PATHS.flows),
  ])
  const generatedMatch = pricesFile.raw.match(/GENERATED by[^\n]* on (\d{4}-\d{2}-\d{2})/)
  const priceUrlMatch = pricesFile.raw.match(/https:\/\/[^\s]+8\.1_Prices_and_purities_of_drugs\.xlsx/)
  if (!generatedMatch || !priceUrlMatch) {
    throw new Error('street-price provenance header is incomplete')
  }

  return {
    prices: {
      records: pricesModule.PRICE_RECORDS,
      localDataDate: generatedMatch[1],
      sourceUrl: priceUrlMatch[0],
      input: pricesFile.input,
    },
    flows: {
      records: flowsModule.FLOW_RECORDS,
      contextRecords: flowsModule.FLOW_CONTEXT_RECORDS,
      source: flowsModule.INCB_REPORT_2025,
      input: flowsFile.input,
    },
    seizures: {
      data: JSON.parse(seizuresFile.raw),
      input: seizuresFile.input,
    },
    designations: {
      data: JSON.parse(designationsFile.raw),
      input: designationsFile.input,
    },
    wildlife: {
      data: JSON.parse(wildlifeFile.raw),
      input: wildlifeFile.input,
    },
  }
}

/** Sum only fully exact reported quantities; callers must handle qualified values explicitly. */
export function sumExactQuantityKg(records) {
  const invalid = records.find((record) => record.quantityRelation !== 'exact')
  if (invalid) {
    throw new Error(
      `cannot sum non-exact quantity (${invalid.quantityRelation}) for ${invalid.origin ?? invalid.reportedOrigin} to ${invalid.destination}`,
    )
  }
  if (records.some((record) => !Number.isFinite(record.quantityKg) || record.quantityKg < 0)) {
    throw new Error('cannot sum an invalid quantity')
  }
  return round(sum(records.map((record) => record.quantityKg)))
}

function yearRange(years) {
  const sorted = [...new Set(years)].sort((a, b) => a - b)
  return {
    kind: 'year_range',
    fromYear: sorted[0] ?? null,
    toYear: sorted.at(-1) ?? null,
    snapshotDate: null,
  }
}

function groupCounts(values, keyOf) {
  const counts = new Map()
  for (const value of values) {
    const key = keyOf(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function buildRetailPrices(inputs) {
  const observations = inputs.prices.records
    .filter((record) => record.iso3 === 'CHN')
    .map((record) => ({
      drug: record.drug,
      year: record.year,
      priceUsdPerGram: record.priceUsdPerGram,
      purityPct: record.purityPct,
    }))
    .sort((a, b) => compareText(a.drug, b.drug) || a.year - b.year)

  return {
    datasetId: 'retail_drug_prices',
    topic: 'drug_market_prices',
    sourceStatus: 'official',
    measurement: {
      status: 'official_reported',
      valueType: 'statistical_measurement',
      method: 'UNODC typical retail value, with a documented midpoint fallback for a complete minimum and maximum range',
      unit: 'nominal USD per gram; purity in percent where reported',
      grain: 'country, drug and year',
    },
    temporalCoverage: yearRange(observations.map((record) => record.year)),
    provenance: {
      publisher: 'United Nations Office on Drugs and Crime',
      title: 'World Drug Report 2025, Statistical Annex 8.1: Prices and purities of drugs',
      url: inputs.prices.sourceUrl,
      sourceEdition: '2025',
      localDataDate: inputs.prices.localDataDate,
      input: inputs.prices.input,
    },
    data: {
      recordCount: observations.length,
      observations,
    },
    limitations: [
      'NarcoScope has one China year in this extract, so it cannot establish a trend.',
      'Prices are nominal reported retail values and do not estimate market size or transaction volume.',
      'A missing purity value means the source did not provide a usable value at the retained grain.',
    ],
  }
}

function buildSeizures(inputs) {
  const { data } = inputs.seizures
  const chinaIndex = data.countries.findIndex((country) => country[0] === 'CHN')
  if (chinaIndex < 0) throw new Error('China is absent from the seizure country dictionary')
  const rows = data.records.filter((row) => row[0] === chinaIndex)
  const expanded = rows.map((row) => {
    const drug = data.drugs[row[1]]
    const group = drug ? data.groups[drug[1]] : null
    if (!group) throw new Error(`seizure row has unknown drug index ${row[1]}`)
    return { year: row[2], quantityKg: row[3], group }
  })

  const byYear = [...groupCounts(expanded, (record) => record.year).keys()]
    .sort((a, b) => a - b)
    .map((year) => {
      const annual = expanded.filter((record) => record.year === year)
      const groupNames = [...new Set(annual.map((record) => record.group))].sort(compareText)
      return {
        year,
        sourceRowCount: annual.length,
        quantityKg: round(sum(annual.map((record) => record.quantityKg))),
        byDrugGroup: groupNames.map((group) => {
          const grouped = annual.filter((record) => record.group === group)
          return {
            drugGroup: group,
            sourceRowCount: grouped.length,
            quantityKg: round(sum(grouped.map((record) => record.quantityKg))),
          }
        }),
      }
    })

  const groupNames = [...new Set(expanded.map((record) => record.group))].sort(compareText)
  const byDrugGroup = groupNames.map((group) => {
    const grouped = expanded.filter((record) => record.group === group)
    return {
      drugGroup: group,
      sourceRowCount: grouped.length,
      quantityKg: round(sum(grouped.map((record) => record.quantityKg))),
    }
  })

  return {
    datasetId: 'drug_seizures',
    topic: 'drug_seizures',
    sourceStatus: 'official',
    measurement: {
      status: 'official_reported',
      valueType: 'administrative_measurement',
      method: 'Sum of UNODC-reported seizure quantities retained at country, drug and year grain',
      unit: 'kilograms',
      grain: 'country, drug and year, aggregated here by year and drug group',
    },
    temporalCoverage: yearRange(expanded.map((record) => record.year)),
    provenance: {
      publisher: 'United Nations Office on Drugs and Crime',
      title: normalizedSourceTitle(data.meta.source),
      url: data.meta.url,
      sourceEdition: 'World Drug Report 2025',
      localDataDate: data.meta.downloaded,
      input: inputs.seizures.input,
    },
    data: {
      sourceRowCount: rows.length,
      quantityKg: round(sum(expanded.map((record) => record.quantityKg))),
      byYear,
      byDrugGroup,
    },
    limitations: [
      'Seizures measure detected and reported enforcement events, not total production, movement or consumption.',
      'Changes can reflect enforcement capacity, reporting practice and drug classification as well as underlying activity.',
      'Summed kilograms combine drug categories and should not be interpreted as equivalent harm or value.',
    ],
  }
}

function buildPrecursorCorridors(inputs) {
  assertAuditedFlowInputs(inputs.flows)
  const records = inputs.flows.records
    .filter((record) => record.origin.split('/').map((part) => part.trim()).includes('China'))
    .map((record) => {
      if (!QUANTITY_RELATIONS.has(record.quantityRelation)) {
        throw new Error(`precursor-flow record has invalid quantity relation: ${record.quantityRelation}`)
      }
      if (!record.quantityBasis || !record.recordKind || !record.sourceLocator) {
        throw new Error(`precursor-flow record lacks audited quantity metadata: ${record.origin} to ${record.destination}`)
      }
      return {
        originAttribution: record.origin === 'China' ? 'china_only' : 'joint_origin_includes_china',
        reportedOrigin: record.origin,
        transit: record.transit,
        destination: record.destination,
        year: record.year,
        precursor: record.precursor,
        quantityKg: record.quantityKg,
        quantityRelation: record.quantityRelation,
        quantityBasis: record.quantityBasis,
        recordKind: record.recordKind,
        incidentCount: record.incidentCount,
        sourceLocator: record.sourceLocator,
      }
    })
    .sort((a, b) => a.year - b.year
      || compareText(a.originAttribution, b.originAttribution)
      || compareText(a.destination, b.destination)
      || compareText(a.precursor, b.precursor))

  const contextRecords = inputs.flows.contextRecords
    .filter((record) => record.origins.includes('China'))
    .map((record) => ({
      contextId: record.contextId,
      precursor: record.precursor,
      origins: record.origins,
      destinations: record.destinations,
      year: record.year,
      recordKind: record.recordKind,
      allocationStatus: record.allocationStatus,
      operationReportedSeizureCount: record.operationReportedSeizureCount,
      countScope: record.countScope,
      summary: record.summary,
      sourceLocator: record.sourceLocator,
    }))
    .sort((a, b) => a.year - b.year || compareText(a.contextId, b.contextId))

  const officialSource = inputs.flows.source
  if (!officialSource?.sourceUrl || !officialSource.sourceDocumentSha256 || !officialSource.sourceRetrievedAt) {
    throw new Error('official precursor-flow document provenance is incomplete')
  }

  const exactRecordCount = records.filter((record) => record.quantityRelation === 'exact').length
  const nonExactRecordCount = records.length - exactRecordCount
  const quantityAggregation = {
    status: nonExactRecordCount > 0
      ? 'not_computed_non_exact_inputs'
      : records.length > 0
        ? 'computed_exact_only'
        : 'not_computed_no_records',
    exactRecordCount,
    nonExactRecordCount,
    summedQuantityKg: records.length > 0 && nonExactRecordCount === 0
      ? sumExactQuantityKg(records)
      : null,
  }

  return {
    datasetId: 'precursor_corridor_incidents',
    topic: 'precursor_flows',
    sourceStatus: 'official',
    measurement: {
      status: 'official_reported',
      valueType: 'administrative_measurement',
      method: 'Country-level corridor quantities stated or transparently derived from the INCB Precursors Report 2025, retaining every qualifier and quantity basis',
      unit: 'reported kilograms or qualified kilogram bounds; quantityBasis identifies gross preparation weight and derivations',
      grain: 'reported origin, transit, destination, precursor class, year and record kind',
    },
    temporalCoverage: yearRange([
      ...records.map((record) => record.year),
      ...contextRecords.map((record) => record.year),
    ]),
    provenance: {
      publisher: 'International Narcotics Control Board',
      title: 'Precursors Report 2025',
      url: officialSource.sourceUrl,
      sourceEdition: '2025, published February 2026',
      localDataDate: officialSource.sourceRetrievedAt.slice(0, 10),
      documentSha256: officialSource.sourceDocumentSha256,
      retrievedAt: officialSource.sourceRetrievedAt,
      input: inputs.flows.input,
    },
    data: {
      includedQuantitativeRecordCount: records.length,
      includedContextRecordCount: contextRecords.length,
      quantityAggregation,
      corridors: records,
      contextRecords,
    },
    limitations: [
      'These are selected reported incidents, not a complete flow series or an estimate of total precursor trade.',
      'Operation Pseudonym does not allocate seizure counts or mass by origin-and-destination pair, so its China/India and Australia/New Zealand statement is retained only as non-summable context.',
      'Approximate quantities and bounds are never added into an exact total.',
      'Quantities describe seizures or incidents and do not measure successful movement or end-drug output.',
    ],
  }
}

function buildDesignations(inputs) {
  const { data } = inputs.designations
  const records = data.records.filter((record) => record.countries.includes('China'))
  const narcoticsSpecificRecords = records.filter((record) => (
    record.programs.some((program) => NARCOTICS_SPECIFIC_OFAC_PROGRAMS.has(program))
  ))
  const tcoOnlyRecords = records.filter((record) => (
    record.programs.includes('TCO')
    && !record.programs.some((program) => NARCOTICS_SPECIFIC_OFAC_PROGRAMS.has(program))
  ))
  if (narcoticsSpecificRecords.length + tcoOnlyRecords.length !== records.length) {
    throw new Error('OFAC China scope contains a record outside the narcotics-specific/TCO-only partition')
  }
  const typeCounts = groupCounts(records, (record) => record.entityType)
  const programCounts = new Map()
  for (const record of records) {
    for (const program of record.programs) {
      programCounts.set(program, (programCounts.get(program) ?? 0) + 1)
    }
  }
  const byEntityType = [...typeCounts.entries()]
    .map(([entityType, count]) => ({ entityType, count }))
    .sort((a, b) => compareText(a.entityType, b.entityType))
  const byProgram = [...programCounts.entries()]
    .map(([program, count]) => ({
      program,
      label: data.meta.programs[program] ?? program,
      count,
    }))
    .sort((a, b) => compareText(a.program, b.program))

  return {
    datasetId: 'ofac_designations',
    topic: 'official_designations',
    sourceStatus: 'official',
    measurement: {
      status: 'official_action_record',
      valueType: 'administrative_action',
      method: 'Count of scoped OFAC SDN records carrying China as a country of record, split between narcotics-specific authorities and TCO-only records',
      unit: 'designation records',
      grain: 'designated subject, program codes and countries of record; subject details removed from this bridge',
    },
    temporalCoverage: {
      kind: 'snapshot',
      fromYear: null,
      toYear: null,
      snapshotDate: data.meta.downloaded,
    },
    provenance: {
      publisher: 'US Department of the Treasury, Office of Foreign Assets Control',
      title: normalizedSourceTitle(data.meta.source),
      url: data.meta.url,
      sourceEdition: 'SDN snapshot',
      localDataDate: data.meta.downloaded,
      input: inputs.designations.input,
    },
    data: {
      recordCount: records.length,
      narcoticsSpecificProgramRecordCount: narcoticsSpecificRecords.length,
      tcoOnlyRecordCount: tcoOnlyRecords.length,
      byEntityType,
      byProgram,
      multiCountryRecordCount: records.filter((record) => record.countries.length > 1).length,
    },
    limitations: [
      'A designation is a published government action, not an adjudication of guilt or proof of described conduct.',
      'China is a country of record from OFAC address data; it is not a nationality finding.',
      'The broad record count includes TCO-only records; only narcoticsSpecificProgramRecordCount is explicitly tied to a narcotics authority in the retained OFAC program codes.',
      'Program counts are not mutually exclusive because a record may carry more than one program code.',
      'The bridge excludes every subject name, alias, entity number, address and identity field.',
    ],
  }
}

function buildWildlife(inputs) {
  const { data } = inputs.wildlife
  const exporterIndex = data.topExporters.findIndex((record) => record.country === 'CN')
  const importerIndex = data.topImporters.findIndex((record) => record.country === 'CN')
  if (exporterIndex < 0 || importerIndex < 0) {
    throw new Error('China is absent from the retained CITES country rankings')
  }

  return {
    datasetId: 'wildlife_confiscations',
    topic: 'wildlife_confiscations',
    sourceStatus: 'official',
    measurement: {
      status: 'official_reported',
      valueType: 'administrative_measurement',
      method: 'Count of CITES Trade Database confiscation records with China as exporter or importer of record',
      unit: 'confiscation records, not physical quantity',
      grain: 'reporting record and country role, pre-aggregated here',
    },
    temporalCoverage: {
      kind: 'year_range',
      fromYear: data.meta.yearRange[0],
      toYear: data.meta.yearRange[1],
      snapshotDate: null,
    },
    provenance: {
      publisher: 'Convention on International Trade in Endangered Species of Wild Fauna and Flora',
      title: normalizedSourceTitle(data.meta.source),
      url: data.meta.url,
      sourceEdition: 'Trade Database extract',
      localDataDate: data.meta.downloaded,
      input: inputs.wildlife.input,
    },
    data: {
      datasetRecordCount: data.meta.totalRecords,
      exporterOfRecord: {
        recordCount: data.topExporters[exporterIndex].records,
        rankInRetainedTable: exporterIndex + 1,
      },
      importerOfRecord: {
        recordCount: data.topImporters[importerIndex].records,
        rankInRetainedTable: importerIndex + 1,
      },
    },
    limitations: [
      'CITES quantities mix incompatible units, so this bridge counts records and never sums physical quantities.',
      'Exporter and importer counts can overlap and must not be added into a China total.',
      'Coverage includes only CITES-listed species and depends on party reporting and enforcement.',
      'Recent years can be incomplete because annual reports arrive with a long lag.',
    ],
  }
}

function findForbiddenKeys(value, pathParts = []) {
  const forbidden = new Set([
    'entityNumber',
    'aliases',
    'address',
    'addresses',
    'passport',
    'identityNumber',
    'dateOfBirth',
  ])
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenKeys(item, [...pathParts, String(index)]))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(forbidden.has(key) ? [[...pathParts, key].join('.')] : []),
    ...findForbiddenKeys(item, [...pathParts, key]),
  ])
}

export function assertPublicBridgeBoundary(artifact) {
  if (artifact.schemaVersion !== BRIDGE_SCHEMA_VERSION) {
    throw new Error(`unexpected bridge schema: ${artifact.schemaVersion}`)
  }
  const expectedIds = [
    'drug_seizures',
    'ofac_designations',
    'precursor_corridor_incidents',
    'retail_drug_prices',
    'wildlife_confiscations',
  ]
  const actualIds = Object.values(artifact.datasets).map((dataset) => dataset.datasetId).sort(compareText)
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`unexpected public datasets: ${actualIds.join(', ')}`)
  }
  if (Object.values(artifact.datasets).some((dataset) => dataset.sourceStatus !== 'official')) {
    throw new Error('public bridge may contain official source datasets only')
  }
  if (artifact.disclosure.illustrativeDataIncluded) {
    throw new Error('public bridge must not include illustrative data')
  }
  const forbidden = findForbiddenKeys(artifact)
  if (forbidden.length > 0) {
    throw new Error(`public bridge contains forbidden subject fields: ${forbidden.join(', ')}`)
  }

  const precursor = artifact.datasets.precursorCorridorIncidents
  const { corridors, contextRecords, quantityAggregation } = precursor.data
  if (precursor.data.includedQuantitativeRecordCount !== corridors.length
    || precursor.data.includedContextRecordCount !== contextRecords.length) {
    throw new Error('precursor bridge record counts do not match their arrays')
  }
  const exactRecordCount = corridors.filter((record) => record.quantityRelation === 'exact').length
  const nonExactRecordCount = corridors.length - exactRecordCount
  if (corridors.some((record) => !QUANTITY_RELATIONS.has(record.quantityRelation))) {
    throw new Error('precursor bridge contains an invalid quantity relation')
  }
  if (quantityAggregation.exactRecordCount !== exactRecordCount
    || quantityAggregation.nonExactRecordCount !== nonExactRecordCount) {
    throw new Error('precursor quantity aggregation counts do not match corridor qualifiers')
  }
  if (nonExactRecordCount > 0
    && (quantityAggregation.status !== 'not_computed_non_exact_inputs'
      || quantityAggregation.summedQuantityKg !== null)) {
    throw new Error('non-exact precursor values may not enter a reported quantity total')
  }
  if (corridors.length > 0 && nonExactRecordCount === 0
    && (quantityAggregation.status !== 'computed_exact_only'
      || quantityAggregation.summedQuantityKg !== sumExactQuantityKg(corridors))) {
    throw new Error('exact-only precursor quantity total is inconsistent')
  }
  if (corridors.length === 0
    && (quantityAggregation.status !== 'not_computed_no_records'
      || quantityAggregation.summedQuantityKg !== null)) {
    throw new Error('empty precursor quantity input may not produce a total')
  }
  if (contextRecords.some((record) => (
    Object.hasOwn(record, 'quantityKg')
    || Object.hasOwn(record, 'quantityRelation')
    || Object.hasOwn(record, 'incidentCount')
  ))) {
    throw new Error('qualitative precursor context must remain non-summable')
  }
  if (contextRecords.some((record) => (
    record.countScope !== 'four_reporting_countries_operation_total'
    || !Number.isInteger(record.operationReportedSeizureCount)
    || record.operationReportedSeizureCount < 1
  ))) {
    throw new Error('qualitative precursor count must retain its non-bilateral operation scope')
  }

  const designations = artifact.datasets.ofacDesignations.data
  if (designations.narcoticsSpecificProgramRecordCount + designations.tcoOnlyRecordCount
    !== designations.recordCount) {
    throw new Error('OFAC narcotics-specific and TCO-only record counts must partition the scoped records')
  }
  return artifact
}

export function buildPalimpsestChinaArtifact(inputs) {
  const datasets = {
    retailDrugPrices: buildRetailPrices(inputs),
    drugSeizures: buildSeizures(inputs),
    precursorCorridorIncidents: buildPrecursorCorridors(inputs),
    ofacDesignations: buildDesignations(inputs),
    wildlifeConfiscations: buildWildlife(inputs),
  }
  const localDates = Object.values(datasets)
    .map((dataset) => dataset.provenance.localDataDate)
    .filter(Boolean)
    .sort(compareText)

  return assertPublicBridgeBoundary({
    $schema: `./${BRIDGE_SCHEMA_FILE}`,
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    artifactId: 'narcoscope.china.official-coverage',
    dataAsOf: localDates.at(-1) ?? null,
    geography: {
      country: 'China',
      iso2: 'CN',
      iso3: 'CHN',
    },
    disclosure: {
      level: 'public_aggregate',
      sourcePolicy: 'official_only',
      subjectEntityDisclosure: 'none',
      exactAddressDisclosure: 'none',
      identifierDisclosure: 'none',
      illustrativeDataIncluded: false,
      runtimeCoupling: 'none_static_artifact',
    },
    datasets,
    exclusions: [
      {
        component: 'precursor_price_series',
        classification: 'illustrative',
        reason: 'NarcoScope marks the bundled precursor prices as illustrative pending a citable source.',
      },
      {
        component: 'myanmar_region_flow_volumes_and_meth_index',
        classification: 'illustrative_or_constructed',
        reason: 'The regional flow volumes are illustrative and the meth index is constructed, so neither enters an official bridge.',
      },
      {
        component: 'myanmar_precursor_inflows',
        classification: 'illustrative',
        reason: 'NarcoScope marks the bundled country-to-region precursor inflows as illustrative pending annex ingestion.',
      },
      {
        component: 'governed_scraper_observations',
        classification: 'unreviewed_leads',
        reason: 'The scraper output is an analyst work queue and never app data or a public factual record.',
      },
      {
        component: 'designation_subject_details',
        classification: 'privacy_minimized',
        reason: 'Names, aliases, entity numbers, addresses and identity fields are not part of the aggregate bridge.',
      },
    ],
    limitations: [
      'This artifact is a deterministic static summary of NarcoScope coverage, not a live feed or a risk score.',
      'Datasets retain different meanings and must not be joined into a claim about a person, organization or causal relationship.',
      'Official source status describes provenance, not completeness, truth of an allegation or adjudicated guilt.',
      'Palimpsest should pin and verify input hashes before promoting a changed artifact.',
    ],
  })
}

export function serializePalimpsestChinaArtifact(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`
}

export async function generatePalimpsestChinaArtifact({
  root = defaultRoot,
  output = DEFAULT_BRIDGE_OUTPUT,
} = {}) {
  const inputs = await loadBridgeInputs(root)
  const artifact = buildPalimpsestChinaArtifact(inputs)
  const serialized = serializePalimpsestChinaArtifact(artifact)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, serialized, 'utf8')
  return { artifact, output, bytes: Buffer.byteLength(serialized) }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  generatePalimpsestChinaArtifact()
    .then(({ artifact, output, bytes }) => {
      console.log(`wrote ${path.relative(defaultRoot, output)} (${bytes} bytes, data as of ${artifact.dataAsOf})`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
