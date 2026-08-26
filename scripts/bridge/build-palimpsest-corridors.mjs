#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildPalimpsestChinaArtifact,
  loadBridgeInputs,
} from './build-palimpsest-china.mjs'

export const CORRIDOR_SCHEMA_VERSION = 'narcoscope.palimpsest.corridor-aggregate.v2'
export const CORRIDOR_SCHEMA_FILE = 'narcoscope-palimpsest-corridors-v2.schema.json'
export const CORRIDOR_ARTIFACT_FILE = 'narcoscope-palimpsest-corridors-v2.json'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(scriptDir, '../..')
export const DEFAULT_CORRIDOR_OUTPUT = path.join(
  defaultRoot,
  'public/data',
  CORRIDOR_ARTIFACT_FILE,
)

const GEOGRAPHIES = Object.freeze([
  Object.freeze({ country: 'China', iso2: 'CN', iso3: 'CHN' }),
  Object.freeze({ country: 'Myanmar', iso2: 'MM', iso3: 'MMR' }),
  Object.freeze({ country: 'Pakistan', iso2: 'PK', iso3: 'PAK' }),
])
const TARGET_NAME_TO_ISO3 = new Map(GEOGRAPHIES.map((item) => [item.country, item.iso3]))
const NARCOTICS_PROGRAMS = new Set(['SDNT', 'SDNTK', 'ILLICIT-DRUGS-EO14059'])
const SCOPED_DESIGNATION_PROGRAMS = new Set([...NARCOTICS_PROGRAMS, 'TCO'])
const FORBIDDEN_KEYS = new Set([
  'entityNumber',
  'name',
  'aliases',
  'address',
  'addresses',
  'passport',
  'identityNumber',
  'dateOfBirth',
  'latitude',
  'longitude',
])

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const round = (value, places = 2) => {
  const factor = 10 ** places
  return Math.round((value + Number.EPSILON) * factor) / factor
}
const sum = (values) => values.reduce((total, value) => total + value, 0)

function yearRange(years) {
  const sorted = [...new Set(years)].sort((a, b) => a - b)
  return {
    kind: 'year_range',
    fromYear: sorted[0] ?? null,
    toYear: sorted.at(-1) ?? null,
    snapshotDate: null,
  }
}

function sourceEnvelope({ datasetId, topic, measurement, temporalCoverage, provenance, data, limitations }) {
  return {
    datasetId,
    topic,
    sourceStatus: 'official',
    measurement,
    temporalCoverage,
    provenance,
    data,
    limitations,
  }
}

function buildRetailPrices(inputs) {
  const countries = GEOGRAPHIES.map((geography) => {
    const observations = inputs.prices.records
      .filter((record) => record.iso3 === geography.iso3)
      .map((record) => ({
        drug: record.drug,
        year: record.year,
        priceUsdPerGram: record.priceUsdPerGram,
        purityPct: record.purityPct,
      }))
      .sort((a, b) => compareText(a.drug, b.drug) || a.year - b.year)
    return {
      geography,
      coverageStatus: observations.length > 0 ? 'observed' : 'no_matching_rows_in_snapshot',
      recordCount: observations.length,
      observations,
    }
  })
  const observations = countries.flatMap((country) => country.observations)
  return sourceEnvelope({
    datasetId: 'retail_drug_prices',
    topic: 'drug_market_prices',
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
      recordCount: sum(countries.map((country) => country.recordCount)),
      countries,
    },
    limitations: [
      'The retained extract contains one year for these countries and cannot establish a trend.',
      'Prices are nominal reported retail values, not market-size, availability or transaction-volume estimates.',
      'Cross-country price comparisons require exchange-rate, purchasing-power, purity and reporting-context caveats.',
    ],
  })
}

function seizureRowsFor(inputs, geography) {
  const { data } = inputs.seizures
  const countryIndex = data.countries.findIndex((country) => country[0] === geography.iso3)
  if (countryIndex < 0) return []
  return data.records.filter((row) => row[0] === countryIndex).map((row) => {
    const drug = data.drugs[row[1]]
    const drugGroup = drug ? data.groups[drug[1]] : null
    if (!drugGroup) throw new Error(`${geography.iso3} seizure row has an unknown drug index`)
    return { year: row[2], quantityKg: row[3], drugGroup }
  })
}

function groupedSeizures(rows, field, outputField) {
  const values = [...new Set(rows.map((row) => row[field]))]
    .sort(typeof rows[0]?.[field] === 'number' ? (a, b) => a - b : compareText)
  return values.map((value) => {
    const matching = rows.filter((row) => row[field] === value)
    return {
      [outputField]: value,
      sourceRowCount: matching.length,
      quantityKg: round(sum(matching.map((row) => row.quantityKg))),
    }
  })
}

function buildSeizures(inputs) {
  const countries = GEOGRAPHIES.map((geography) => {
    const rows = seizureRowsFor(inputs, geography)
    return {
      geography,
      coverageStatus: rows.length > 0 ? 'observed' : 'no_matching_rows_in_snapshot',
      sourceRowCount: rows.length,
      quantityKg: round(sum(rows.map((row) => row.quantityKg))),
      byYear: groupedSeizures(rows, 'year', 'year'),
      byDrugGroup: groupedSeizures(rows, 'drugGroup', 'drugGroup'),
    }
  })
  const allRows = GEOGRAPHIES.flatMap((geography) => seizureRowsFor(inputs, geography))
  const { data } = inputs.seizures
  return sourceEnvelope({
    datasetId: 'drug_seizures',
    topic: 'drug_seizures',
    measurement: {
      status: 'official_reported',
      valueType: 'administrative_measurement',
      method: 'UNODC-reported seizure quantities retained at country, drug and year grain and summarized independently within each country',
      unit: 'kilograms',
      grain: 'country, drug and year; summarized by year and drug group',
    },
    temporalCoverage: yearRange(allRows.map((row) => row.year)),
    provenance: {
      publisher: 'United Nations Office on Drugs and Crime',
      title: String(data.meta.source).replace(/[\u2013\u2014]/g, '-'),
      url: data.meta.url,
      sourceEdition: 'World Drug Report 2025',
      localDataDate: data.meta.downloaded,
      input: inputs.seizures.input,
    },
    data: {
      sourceRowCount: sum(countries.map((country) => country.sourceRowCount)),
      countries,
    },
    limitations: [
      'Seizures measure detected and reported enforcement events, not total production, movement or consumption.',
      'Country totals are not added across countries because reporting systems and drug composition differ.',
      'A change can reflect enforcement capacity, classification or reporting practice as well as underlying activity.',
    ],
  })
}

function namesInLocation(value) {
  if (typeof value !== 'string') return []
  return value.split('/').map((part) => part.trim()).filter((part) => TARGET_NAME_TO_ISO3.has(part))
}

function matchesForFlow(record) {
  const names = new Set([
    ...namesInLocation(record.origin),
    ...namesInLocation(record.transit),
    ...namesInLocation(record.destination),
    ...namesInLocation(record.seizureLocation),
  ])
  return [...names].map((name) => TARGET_NAME_TO_ISO3.get(name)).sort(compareText)
}

function buildPrecursorCorridors(inputs) {
  // Reuse the v1 builder as the canonical input-audit gate before widening the
  // geography. This keeps quantity qualifiers and source locators under the
  // same invariants instead of implementing a looser second audit path.
  buildPalimpsestChinaArtifact(inputs)
  const corridors = inputs.flows.records
    .map((record) => ({ record, geographyMatches: matchesForFlow(record) }))
    .filter(({ geographyMatches }) => geographyMatches.length > 0)
    .map(({ record, geographyMatches }) => ({
      geographyMatches,
      reportedOrigin: record.origin,
      transit: record.transit,
      destination: record.destination,
      seizureLocation: record.seizureLocation,
      year: record.year,
      precursor: record.precursor,
      quantityKg: record.quantityKg,
      quantityRelation: record.quantityRelation,
      quantityBasis: record.quantityBasis,
      recordKind: record.recordKind,
      aggregationEligibility: record.aggregationEligibility,
      aggregationGroup: record.aggregationGroup,
      incidentCount: record.incidentCount,
      sourceLocator: record.sourceLocator,
    }))
    .sort((a, b) => a.year - b.year || compareText(a.reportedOrigin, b.reportedOrigin))
  const contextRecords = inputs.flows.contextRecords
    .map((record) => {
      const matches = [...new Set([
        ...record.origins.filter((name) => TARGET_NAME_TO_ISO3.has(name)),
        ...record.destinations.filter((name) => TARGET_NAME_TO_ISO3.has(name)),
      ])].map((name) => TARGET_NAME_TO_ISO3.get(name)).sort(compareText)
      return { record, geographyMatches: matches }
    })
    .filter(({ geographyMatches }) => geographyMatches.length > 0)
    .map(({ record, geographyMatches }) => ({
      geographyMatches,
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
  const source = inputs.flows.source
  return sourceEnvelope({
    datasetId: 'precursor_corridor_incidents',
    topic: 'precursor_flows',
    measurement: {
      status: 'official_reported',
      valueType: 'administrative_measurement',
      method: 'Target-geography matches in audited INCB statements, retaining source wording, bounds, record kinds and paragraph locators',
      unit: 'reported kilograms or qualified bounds; qualitative operation records remain non-summable',
      grain: 'source statement and named geography role',
    },
    temporalCoverage: yearRange([
      ...corridors.map((record) => record.year),
      ...contextRecords.map((record) => record.year),
    ]),
    provenance: {
      publisher: 'International Narcotics Control Board',
      title: 'Precursors Report 2025',
      url: source.sourceUrl,
      sourceEdition: '2025, published February 2026',
      localDataDate: source.sourceRetrievedAt.slice(0, 10),
      documentSha256: source.sourceDocumentSha256,
      retrievedAt: source.sourceRetrievedAt,
      input: inputs.flows.input,
    },
    data: {
      includedQuantitativeRecordCount: corridors.length,
      includedContextRecordCount: contextRecords.length,
      crossTargetBilateralRecordCount: corridors.filter((record) => record.geographyMatches.length > 1).length,
      quantityAggregation: {
        status: 'not_computed_mixed_claim_semantics',
        summedQuantityKg: null,
        reason: 'The retained records include bounds, different precursor bases and different geographic roles.',
      },
      corridors,
      contextRecords,
    },
    limitations: [
      'A geography match is not proof of a bilateral route between target countries.',
      'The Myanmar record reports Myanmar as destination and explicitly leaves origin unreported; it is not a China-Myanmar flow.',
      'Operation Pseudonym names China and India as reported origins but does not allocate count or mass by origin-destination pair.',
      'The records are selected reported incidents, not a complete flow series or an estimate of successful movement.',
    ],
  })
}

function buildDesignations(inputs) {
  const { data } = inputs.designations
  const scoped = data.records.filter((record) => (
    record.programs.some((program) => SCOPED_DESIGNATION_PROGRAMS.has(program))
  ))
  const countries = GEOGRAPHIES.map((geography) => {
    const records = scoped.filter((record) => record.countries.includes(geography.country))
    const narcoticsSpecific = records.filter((record) => (
      record.programs.some((program) => NARCOTICS_PROGRAMS.has(program))
    ))
    const tcoOnly = records.filter((record) => (
      record.programs.includes('TCO')
      && !record.programs.some((program) => NARCOTICS_PROGRAMS.has(program))
    ))
    return {
      geography,
      coverageStatus: records.length > 0 ? 'observed' : 'no_matching_rows_in_snapshot',
      recordCount: records.length,
      narcoticsSpecificProgramRecordCount: narcoticsSpecific.length,
      tcoOnlyRecordCount: tcoOnly.length,
    }
  })
  return sourceEnvelope({
    datasetId: 'ofac_designations',
    topic: 'official_designations',
    measurement: {
      status: 'official_action_record',
      valueType: 'administrative_action',
      method: 'Count of OFAC SDN records carrying each target country as a country of record and a retained narcotics or TCO program; subject fields removed',
      unit: 'designation records',
      grain: 'country of record and program family',
    },
    temporalCoverage: {
      kind: 'snapshot', fromYear: null, toYear: null, snapshotDate: data.meta.downloaded,
    },
    provenance: {
      publisher: 'US Department of the Treasury, Office of Foreign Assets Control',
      title: String(data.meta.source).replace(/[\u2013\u2014]/g, '-'),
      url: data.meta.url,
      sourceEdition: 'SDN snapshot',
      localDataDate: data.meta.downloaded,
      input: inputs.designations.input,
    },
    data: { countries },
    limitations: [
      'A designation is a published government action, not an adjudication of guilt or independent proof of described conduct.',
      'Country of record comes from the retained OFAC address geography and is not a nationality finding.',
      'No matching rows means only that this scoped snapshot produced none; it is not a claim that no relevant actor or action exists.',
      'No subject name, alias, identifier or address crosses this bridge.',
    ],
  })
}

function wildlifeRole(rows, iso2) {
  const index = rows.findIndex((record) => record.country === iso2)
  return index < 0
    ? { coverageStatus: 'not_in_retained_top_table', recordCount: null, rankInRetainedTable: null }
    : { coverageStatus: 'observed', recordCount: rows[index].records, rankInRetainedTable: index + 1 }
}

function buildWildlife(inputs) {
  const { data } = inputs.wildlife
  const countries = GEOGRAPHIES.map((geography) => ({
    geography,
    exporterOfRecord: wildlifeRole(data.topExporters, geography.iso2),
    importerOfRecord: wildlifeRole(data.topImporters, geography.iso2),
  }))
  return sourceEnvelope({
    datasetId: 'wildlife_confiscations',
    topic: 'wildlife_confiscations',
    measurement: {
      status: 'official_reported',
      valueType: 'administrative_measurement',
      method: 'CITES confiscation-record counts where a target country appears in the retained exporter or importer ranking',
      unit: 'confiscation records, not physical quantity',
      grain: 'country role in retained top-country table',
    },
    temporalCoverage: {
      kind: 'year_range', fromYear: data.meta.yearRange[0], toYear: data.meta.yearRange[1], snapshotDate: null,
    },
    provenance: {
      publisher: 'Convention on International Trade in Endangered Species of Wild Fauna and Flora',
      title: String(data.meta.source).replace(/[\u2013\u2014]/g, '-'),
      url: data.meta.url,
      sourceEdition: 'Trade Database extract',
      localDataDate: data.meta.downloaded,
      input: inputs.wildlife.input,
    },
    data: { datasetRecordCount: data.meta.totalRecords, countries },
    limitations: [
      'Not in the retained top table is an unavailable value, never zero.',
      'Exporter and importer record counts can overlap and must not be added.',
      'CITES quantities mix incompatible units, so the bridge counts records and never sums physical quantities.',
      'Coverage is limited to listed species and depends on party reporting and enforcement.',
    ],
  })
}

function forbiddenPaths(value, parts = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenPaths(item, [...parts, String(index)]))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(FORBIDDEN_KEYS.has(key) ? [[...parts, key].join('.')] : []),
    ...forbiddenPaths(item, [...parts, key]),
  ])
}

export function assertCorridorBridgeBoundary(artifact) {
  if (artifact.schemaVersion !== CORRIDOR_SCHEMA_VERSION) {
    throw new Error(`unexpected corridor schema: ${artifact.schemaVersion}`)
  }
  if (JSON.stringify(artifact.geographies) !== JSON.stringify(GEOGRAPHIES)) {
    throw new Error('corridor bridge geography order or identity changed')
  }
  if (artifact.disclosure.joinPolicy !== 'geography_and_time_only') {
    throw new Error('corridor bridge must use the geography-and-time-only join policy')
  }
  if (artifact.disclosure.illustrativeDataIncluded !== false) {
    throw new Error('corridor bridge must exclude illustrative data')
  }
  if (Object.values(artifact.datasets).some((dataset) => dataset.sourceStatus !== 'official')) {
    throw new Error('corridor bridge may contain official source datasets only')
  }
  const forbidden = forbiddenPaths(artifact)
  if (forbidden.length > 0) {
    throw new Error(`corridor bridge contains forbidden subject or location fields: ${forbidden.join(', ')}`)
  }
  const precursor = artifact.datasets.precursorCorridorIncidents.data
  if (precursor.crossTargetBilateralRecordCount !== 0) {
    throw new Error('current audited extract must not imply a target-country bilateral precursor record')
  }
  if (precursor.quantityAggregation.summedQuantityKg !== null) {
    throw new Error('mixed precursor claims must remain unsummed')
  }
  const myanmarRecord = precursor.corridors.find((record) => record.destination === 'Myanmar')
  if (!myanmarRecord || myanmarRecord.reportedOrigin !== 'Not reported') {
    throw new Error('Myanmar precursor record must preserve its unreported origin')
  }
  return artifact
}

export function buildPalimpsestCorridorArtifact(inputs) {
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
  return assertCorridorBridgeBoundary({
    $schema: `./${CORRIDOR_SCHEMA_FILE}`,
    schemaVersion: CORRIDOR_SCHEMA_VERSION,
    artifactId: 'narcoscope.china-pakistan-myanmar.official-coverage',
    dataAsOf: localDates.at(-1) ?? null,
    geographies: GEOGRAPHIES,
    disclosure: {
      level: 'public_country_aggregate',
      sourcePolicy: 'official_only',
      subjectEntityDisclosure: 'none',
      exactAddressDisclosure: 'none',
      preciseCoordinateDisclosure: 'none',
      identifierDisclosure: 'none',
      illustrativeDataIncluded: false,
      runtimeCoupling: 'none_static_artifact',
      joinPolicy: 'geography_and_time_only',
      politicalOrArmedActorInference: 'prohibited',
    },
    datasets,
    exclusions: [
      {
        component: 'myanmar_constructed_and_illustrative_series',
        classification: 'illustrative_or_constructed',
        reason: 'Regional flow volumes, the meth activity index and country-to-region precursor inflows are not official observations.',
      },
      {
        component: 'acled_conflict_rows',
        classification: 'licensed_conflict_data',
        reason: 'Conflict-event data has separate licensing and claim semantics and does not enter this official drug-market bridge.',
      },
      {
        component: 'political_and_armed_movements',
        classification: 'out_of_scope',
        reason: 'No political party, civil-society movement, armed organization or community is classified through aggregate drug-market data.',
      },
      {
        component: 'designation_subject_details',
        classification: 'privacy_minimized',
        reason: 'Names, aliases, identifiers and addresses do not cross the aggregate boundary.',
      },
      {
        component: 'tactical_location_and_methods',
        classification: 'safety_minimized',
        reason: 'The bridge carries no navigable coordinates, operational vulnerabilities, synthesis routes, yields or procurement guidance.',
      },
    ],
    limitations: [
      'This is a deterministic country-level evidence overlay, not a risk score, relationship graph or live feed.',
      'A shared geography or period does not establish that two datasets describe the same event, actor or causal chain.',
      'Official source status describes provenance and does not make a source complete or convert an allegation into a finding.',
      'Palimpsest must byte-pin and review a changed artifact before using it in a public claim.',
    ],
  })
}

export function serializePalimpsestCorridorArtifact(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`
}

export async function generatePalimpsestCorridorArtifact({
  root = defaultRoot,
  output = DEFAULT_CORRIDOR_OUTPUT,
} = {}) {
  const inputs = await loadBridgeInputs(root)
  const artifact = buildPalimpsestCorridorArtifact(inputs)
  const serialized = serializePalimpsestCorridorArtifact(artifact)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, serialized, 'utf8')
  return { artifact, output, bytes: Buffer.byteLength(serialized) }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  generatePalimpsestCorridorArtifact()
    .then(({ artifact, output, bytes }) => {
      console.log(`wrote ${path.relative(defaultRoot, output)} (${bytes} bytes, data as of ${artifact.dataAsOf})`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
