#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MARKET_CATALOG_OUTPUT_SCHEMA, MARKET_QUERY_OUTPUT_SCHEMA, MARKET_DATASET_SCHEMA } from '../../lib/global-market-schemas.mjs'
import { MARKET_QUERY_INPUT_SCHEMA } from '../../lib/global-markets.mjs'

const openApiPath = fileURLToPath(new URL('../../public/openapi.json', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../public/data/global-markets-v1.schema.json', import.meta.url))
const before = await readFile(openApiPath, 'utf8')
const spec = JSON.parse(before)
spec.components.schemas.GlobalMarketCatalog = MARKET_CATALOG_OUTPUT_SCHEMA
spec.components.schemas.MarketObservations = MARKET_QUERY_OUTPUT_SCHEMA
const envelope = (resource, schema) => ({ type: 'object', additionalProperties: false, required: ['ok', 'resource', 'data'], properties: {
  ok: { const: true }, resource: { const: resource }, data: { $ref: `#/components/schemas/${schema}` },
} })
const responses = (resource, schema) => ({
  200: { description: 'Source-bound published data. Partial coverage lists unavailable datasets explicitly.', content: { 'application/json': { schema: envelope(resource, schema) } } },
  400: { $ref: '#/components/responses/BadRequest' },
  503: { $ref: '#/components/responses/Unavailable' },
})
spec.paths['/markets'] = { get: {
  operationId: 'getMarketCatalog', summary: 'Discover granular drugs, arms and informal-economy evidence',
  description: 'Indicator-specific countries, categories, subgroups, native units, numeric and unavailable coverage, source hashes and source-specific reuse restrictions. Legacy atlas and drug histories remain linked but are not recounted.',
  responses: responses('markets', 'GlobalMarketCatalog'),
} }
const descriptions = {
  dataset: 'Dataset ID from the catalog. Omit to query both available datasets.',
  indicator: 'Exact source-native indicator ID from the catalog.', geo: 'Exact geography code from indicator dimensions; no implicit country-name mapping.',
  category: 'Exact category. Empty string matches empty categories; omitted means all.',
  subgroup: 'Exact subgroup. Empty string matches empty subgroups; omitted means all.',
  from: 'Inclusive first year or month. A row must fit wholly within the requested interval; annual rows are not disaggregated.',
  to: 'Inclusive last year or month. Native source periods are preserved.',
  page: 'One-based page in stable dataset/indicator/geography/category/subgroup/period order. Retain dataset hashes across pages and restart if they change.',
  limit: 'Maximum returned observations per page. No automatic market-size aggregation or unit conversion.',
}
spec.paths['/market-observations'] = { get: {
  operationId: 'queryMarketObservations', summary: 'Query granular native-unit observations',
  description: 'Bounded source-dimension filtering with source locators, dataset hashes, exact units, uncertainty and missing values. Duplicate and unknown parameters are rejected. A valid empty query returns zero matches; missing datasets remain unavailable. Source-specific licenses remain attached.',
  parameters: Object.entries(MARKET_QUERY_INPUT_SCHEMA.properties).map(([name, schema]) => ({ name, in: 'query', required: false, description: descriptions[name], schema })),
  responses: responses('market-observations', 'MarketObservations'),
} }
const after = `${JSON.stringify(spec, null, 2)}\n`
const schema = `${JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...MARKET_DATASET_SCHEMA }, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (after !== before || await readFile(schemaPath, 'utf8') !== schema) throw new Error('Global market OpenAPI or dataset schema is stale; run sync-contracts.mjs')
} else {
  await writeFile(openApiPath, after)
  await writeFile(schemaPath, schema)
}
console.log('Global market REST, MCP and dataset schema contracts agree.')
