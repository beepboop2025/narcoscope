// Shared REST/OpenAPI and MCP schemas. All objects are closed to prevent accidental
// publication of collector-private fields through metadata or observation rows.
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const array = (items, maxItems = 500000) => ({ type: 'array', items, maxItems })
const text = (maxLength = 2000, minLength = 1) => ({ type: 'string', minLength, maxLength })
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] })
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' }
const datasetId = { type: 'string', enum: ['global-drugs', 'global-arms-economy'] }
const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const clock = { type: 'string', format: 'date-time' }
const url = { type: 'string', format: 'uri', pattern: '^https://', maxLength: 4096 }
const period = { type: 'string', pattern: '^(18|19|20|21)[0-9]{2}(-(0[1-9]|1[0-2]))?$' }
const geoLevel = { type: 'string', enum: ['country', 'region', 'city', 'world'] }
const numeric = { type: 'integer', minimum: 0 }
const limits = array(text(), 60)
const sourceProperties = {
  id, name: text(1000), publisher: text(1000), url, downloadUrl: url,
  license: text(1000), licenseUrl: url, retrievedAt: clock, sha256,
  bytes: { type: 'integer', minimum: 1 }, notes: limits,
}
const indicatorProperties = {
  id, sourceId: id, market: { type: 'string', enum: ['drugs', 'arms', 'economy'] },
  label: text(500), unit: text(500), measureType: text(500), description: text(2500), limitations: limits,
}
const observationProperties = {
  id, indicatorId: id, geoCode: text(180), geoName: text(180), geoLevel,
  period, category: text(500, 0), subgroup: text(500, 0),
  value: nullable({ type: 'number' }), lower: nullable({ type: 'number' }), upper: nullable({ type: 'number' }),
  status: { type: 'string', enum: ['reported', 'estimated', 'unavailable'] }, sourceLocator: text(),
}
export const MARKET_COVERAGE_SCHEMA = object({
  observations: numeric, numericObservations: numeric, reported: numeric, estimated: numeric,
  unavailable: numeric, firstPeriod: nullable(period), lastPeriod: nullable(period),
  firstNumericPeriod: nullable(period), lastNumericPeriod: nullable(period),
})
export const MARKET_DATASET_SCHEMA = object({
  schema: { const: 'narcoscope.global-markets.v1' }, id: datasetId, title: text(240), generatedAt: clock,
  sources: { ...array(object(sourceProperties), 80), minItems: 1 },
  indicators: { ...array(object(indicatorProperties), 500), minItems: 1 },
  observations: array(object(observationProperties)), limitations: limits,
})
const envelope = schema => ({
  schema: { const: schema }, status: { type: 'string', enum: ['available', 'partial', 'unavailable'] },
  generatedAt: nullable(clock), unavailableDatasets: array(datasetId, 2), limitations: limits,
})
export const MARKET_CATALOG_OUTPUT_SCHEMA = object({
  ...envelope('narcoscope.global-market-catalog.v1'),
  datasets: array(object({
    id: datasetId, title: text(240), sha256, generatedAt: clock,
    sources: array(object(sourceProperties), 80),
    indicators: array(object({
      ...indicatorProperties, featured: { type: 'boolean' }, coverage: MARKET_COVERAGE_SCHEMA,
      dimensions: object({
        geographies: array(object({ code: text(180), name: text(180), level: geoLevel })),
        categories: array(text(500, 0)), subgroups: array(text(500, 0)),
        selections: array(object({ category: text(500, 0), subgroup: text(500, 0),
          firstPeriod: nullable(period), lastPeriod: nullable(period), lastNumericPeriod: nullable(period),
          latestNumericObservations: numeric })),
      }),
    }), 500), coverage: MARKET_COVERAGE_SCHEMA, limitations: limits,
  }), 2),
  relatedResources: array(object({ id, title: text(240), url: text(4096), description: text() }), 10),
})
export const MARKET_QUERY_OUTPUT_SCHEMA = object({
  ...envelope('narcoscope.market-observations.v1'),
  filters: object({ dataset: nullable(datasetId), indicator: nullable(text(160)), geo: nullable(text(180)),
    category: nullable(text(500, 0)), subgroup: nullable(text(500, 0)), from: nullable(period), to: nullable(period) }),
  pagination: object({
    page: { type: 'integer', minimum: 1, maximum: 1000000 },
    limit: { type: 'integer', minimum: 1, maximum: 500 }, total: numeric, pages: numeric,
    nextPage: nullable({ type: 'integer', minimum: 2 }),
  }),
  datasets: array(object({ id: datasetId, sha256, generatedAt: clock }), 2),
  indicators: array(object({ ...indicatorProperties, datasetId }), 1000),
  sources: array(object({ ...sourceProperties, datasetId }), 160),
  observations: array(object({ ...observationProperties, datasetId, sourceId: id,
    unit: text(500), measureType: text(500) }), 500),
})
