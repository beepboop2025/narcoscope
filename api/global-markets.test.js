import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getMarketCatalog, queryMarketObservations, validateMarketDataset } from '../lib/global-markets.mjs'
import { MARKET_CATALOG_OUTPUT_SCHEMA, MARKET_QUERY_OUTPUT_SCHEMA } from '../lib/global-market-schemas.mjs'
import { dispatch, TOOLS, toolInputIsValid, toolOutputIsValid } from './mcp.mjs'
import { capabilities } from './lib/narcoscope.mjs'
import { createV1Handler } from './v1.mjs'

const directories = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const sha256 = value => createHash('sha256').update(value).digest('hex')
function fixture(id = 'global-drugs') {
  const row = (key, changes = {}) => ({ id: key, indicatorId: 'seizure-kg', geoCode: 'AAA', geoName: 'Country A', geoLevel: 'country',
    period: '2023', category: 'Cannabis', subgroup: '', value: 10, lower: null, upper: null, status: 'reported', sourceLocator: `Sheet1!${key}`, ...changes })
  return {
    schema: 'narcoscope.global-markets.v1', id, title: 'Temporary API contract fixture', generatedAt: '2026-09-08T12:00:00Z',
    sources: [{ id: 'primary', name: 'Primary table', publisher: 'Example institution', url: 'https://example.org/table', downloadUrl: 'https://example.org/table.xlsx',
      license: 'Educational reproduction with attribution; commercial reuse requires permission', licenseUrl: 'https://example.org/terms',
      retrievedAt: '2026-09-08T11:00:00Z', sha256: 'a'.repeat(64), bytes: 1234, notes: ['Original source restrictions remain in force.'] }],
    indicators: [
      { id: 'seizure-kg', sourceId: 'primary', market: 'drugs', label: 'Seized quantity', unit: 'kg', measureType: 'administrative-count', description: 'Published seized quantity', limitations: ['Enforcement dependent.'] },
      { id: 'informal-share', sourceId: 'primary', market: 'economy', label: 'Informal output', unit: '% of official GDP', measureType: 'model-estimate', description: 'Model estimate', limitations: ['Model uncertainty.'] },
    ],
    observations: [
      row('a1', { value: 0 }), row('a2', { period: '2024', value: null, status: 'unavailable' }),
      row('a3', { period: '2024-06', category: '', value: 15 }),
      row('b1', { geoCode: 'BBB', geoName: 'Country B', value: 12 }),
      row('a4', { subgroup: 'Retail', value: 5 }),
      row('e1', { indicatorId: 'informal-share', category: '', value: 20, lower: 15, upper: 25, status: 'estimated' }),
    ], limitations: ['Fixture never published.'],
  }
}
async function files(datasets = [fixture()]) {
  const directory = await mkdtemp(join(tmpdir(), 'narcoscope-markets-')); directories.push(directory)
  for (const dataset of datasets) await writeFile(join(directory, `${dataset.id}-v1.json`), JSON.stringify(dataset))
  return { marketDataDir: directory }
}
async function rest(url, dependencies, query = {}) {
  const response = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name] = value }, end(body = '') { this.body = body } }
  const resource = new URL(url, 'https://example.org').pathname.split('/').at(-1)
  await createV1Handler(dependencies)({ method: 'GET', url, query: { resource, ...query } }, response)
  return { ...response, data: JSON.parse(response.body) }
}

describe('Granular global market provenance and validation', () => {
  it('preserves native measures, zero, estimated uncertainty, locators and educational-use restrictions', async () => {
    const dependencies = await files()
    const data = await queryMarketObservations({}, dependencies)
    expect(data.observations.find(row => row.id === 'a1')).toMatchObject({ value: 0, status: 'reported', unit: 'kg', sourceId: 'primary', datasetId: 'global-drugs', sourceLocator: 'Sheet1!a1' })
    expect(data.observations.find(row => row.id === 'e1')).toMatchObject({ value: 20, lower: 15, upper: 25, unit: '% of official GDP', status: 'estimated' })
    expect(data.sources[0].license).toContain('commercial reuse requires permission')
    expect(data.sources[0].notes).toEqual(fixture().sources[0].notes)
    expect(data.datasets[0].sha256).toBe(sha256(await readFile(join(dependencies.marketDataDir, 'global-drugs-v1.json'))))
    expect(toolOutputIsValid('query_market_observations', data)).toBe(true)
  })

  it.each([
    ['private root fields', data => { data.rawResponse = 'private' }],
    ['private source fields', data => { data.sources[0].apiKey = 'private' }],
    ['private nested fields', data => { data.sources[0].notes = [{ value: 999 }] }],
    ['private observation fields', data => { data.observations[0].address = 'private' }],
    ['row unit override', data => { data.observations[0].unit = 'tonnes' }],
    ['duplicate grains', data => { data.observations.push({ ...data.observations[0], id: 'another-id' }) }],
    ['duplicate identities', data => { data.observations[1].id = data.observations[0].id }],
    ['missing source binding', data => { data.indicators[0].sourceId = 'unknown' }],
    ['missing indicator binding', data => { data.observations[0].indicatorId = 'unknown' }],
    ['inconsistent geography', data => { data.observations[1].geoName = 'Different country' }],
    ['nonfinite quantity', data => { data.observations[0].value = Infinity }],
    ['null reported as data', data => { data.observations[0].value = null }],
    ['number marked unavailable', data => { data.observations[0].status = 'unavailable' }],
    ['missing with numeric bounds', data => { data.observations[1].upper = 1 }],
    ['bounds excluding point', data => { data.observations[0].lower = 1 }],
    ['invalid month', data => { data.observations[0].period = '2024-13' }],
    ['unbound source digest', data => { data.sources[0].sha256 = 'not-a-hash' }],
    ['missing source bytes', data => { data.sources[0].bytes = 0 }],
    ['unestablished reuse', data => { data.sources[0].license = 'not established' }],
    ['late retrieval', data => { data.sources[0].retrievedAt = '2026-09-09T00:00:00Z' }],
    ['source credentials', data => { data.sources[0].url = 'https://user:password@example.org/' }],
    ['private IPv4 source', data => { data.sources[0].url = 'https://172.16.0.1/' }],
    ['private IPv6 source', data => { data.sources[0].url = 'https://[::1]/' }],
    ['private local source', data => { data.sources[0].url = 'https://metadata.internal/' }],
  ])('rejects %s before publication', (_name, change) => {
    const data = fixture(); change(data); expect(() => validateMarketDataset(data)).toThrow()
  })

  it('describes numeric coverage separately from explicit missing cells and does not recount legacy data', async () => {
    const catalog = await getMarketCatalog({}, await files())
    expect(catalog).toMatchObject({ status: 'partial', unavailableDatasets: ['global-arms-economy'] })
    expect(catalog.datasets[0].coverage).toEqual({ observations: 6, numericObservations: 5, reported: 4, estimated: 1, unavailable: 1, firstPeriod: '2023', lastPeriod: '2024-06', firstNumericPeriod: '2023', lastNumericPeriod: '2024-06' })
    const indicator = catalog.datasets[0].indicators.find(row => row.id === 'seizure-kg')
    expect(indicator.dimensions.categories).toEqual(['', 'Cannabis'])
    expect(indicator.dimensions.subgroups).toEqual(['', 'Retail'])
    expect(indicator.dimensions.geographies.map(row => row.code)).toEqual(['AAA', 'BBB'])
    expect(catalog.relatedResources.map(row => row.id)).toContain('existing-atlas')
    expect(catalog.datasets).toHaveLength(1)
    expect(toolOutputIsValid('get_market_catalog', catalog)).toBe(true)
  })
  it('only offers category and breakdown combinations observed in the source', async () => {
    const catalog = await getMarketCatalog({}, await files())
    const selections = catalog.datasets[0].indicators.find(row => row.id === 'seizure-kg').dimensions.selections
    expect(selections.map(row => [row.category, row.subgroup])).toEqual([['', ''], ['Cannabis', ''], ['Cannabis', 'Retail']])
    expect(selections[0].lastNumericPeriod).toBe('2024-06')
    expect(selections.some(row => row.category === '' && row.subgroup === 'Retail')).toBe(false)
  })
  it('preserves native country labels when different indicators use different names for the same code', async () => {
    const data = fixture()
    data.observations.find(row => row.id === 'e1').geoName = 'Country A source-native label'
    expect(validateMarketDataset(data)).toBe(data)
    const catalog = await getMarketCatalog({}, await files([data]))
    expect(catalog.datasets[0].indicators.find(row => row.id === 'informal-share').dimensions.geographies[0].name).toBe('Country A source-native label')
  })
  it('keeps reserved missing periods separate from the latest numeric evidence period', async () => {
    const data = fixture(); data.observations[1].period = '2025'
    const catalog = await getMarketCatalog({}, await files([data]))
    expect(catalog.datasets[0].coverage).toMatchObject({ lastPeriod: '2025', lastNumericPeriod: '2024-06' })
  })
})

describe('Bounded native-dimension queries', () => {
  it('filters all source dimensions exactly, retaining explicit blank categories/subgroups', async () => {
    const dependencies = await files()
    const query = await queryMarketObservations({ dataset: 'global-drugs', indicator: 'seizure-kg', geo: 'AAA', category: 'Cannabis', subgroup: '', from: '2023', to: '2023' }, dependencies)
    expect(query.observations.map(row => row.id)).toEqual(['a1'])
    const blank = await queryMarketObservations({ indicator: 'seizure-kg', category: '', subgroup: '' }, dependencies)
    expect(blank.observations.map(row => row.id)).toEqual(['a3'])
    const all = await queryMarketObservations({ indicator: 'seizure-kg' }, dependencies)
    expect(all.observations).toHaveLength(5)
  })
  it('keeps annual periods intact instead of disaggregating them into a requested month', async () => {
    const dependencies = await files()
    expect((await queryMarketObservations({ from: '2024-06', to: '2024-06' }, dependencies)).observations.map(row => row.id)).toEqual(['a3'])
    expect((await queryMarketObservations({ from: '2024', to: '2024' }, dependencies)).observations.map(row => row.id)).toEqual(['a3', 'a2'])
  })
  it('paginates reproducibly across dataset hashes without skipping or duplicating rows', async () => {
    const dependencies = await files([fixture(), fixture('global-arms-economy')])
    const first = await queryMarketObservations({ limit: 5 }, dependencies)
    const second = await queryMarketObservations({ limit: 5, page: 2 }, dependencies)
    const third = await queryMarketObservations({ limit: 5, page: 3 }, dependencies)
    const all = await queryMarketObservations({ limit: 500 }, dependencies)
    expect(first.pagination).toEqual({ page: 1, limit: 5, total: 12, pages: 3, nextPage: 2 })
    expect(third.pagination.nextPage).toBeNull()
    expect([...first.observations, ...second.observations, ...third.observations]).toEqual(all.observations)
    expect(first.datasets).toEqual(second.datasets)
    first.observations[0].value = 99999
    expect((await queryMarketObservations({ limit: 5 }, dependencies)).observations[0].value).not.toBe(99999)
  })
  it.each([{ limit: 501 }, { limit: 0 }, { limit: true }, { limit: '1.5' }, { limit: '5junk' }, { page: -1 }, { page: 1000001 }, { from: '2024-13' }, { from: '2025', to: '2024' }, { dataset: '../private' }, { marketSize: true }, { geo: [] }])('rejects invalid request %j', async args => {
    await expect(queryMarketObservations(args, await files())).rejects.toThrow(TypeError)
  })
  it('distinguishes absent datasets, unknown indicators and valid filters with no matches', async () => {
    const dependencies = await files()
    expect((await queryMarketObservations({ geo: 'ZZZ' }, dependencies))).toMatchObject({ status: 'partial', observations: [], pagination: { total: 0, nextPage: null } })
    expect((await queryMarketObservations({ dataset: 'global-arms-economy' }, dependencies)).status).toBe('unavailable')
    await expect(queryMarketObservations({ indicator: 'unknown' }, dependencies)).rejects.toThrow(TypeError)
  })
  it('invalidates the cache when an atomic replacement changes published bytes', async () => {
    const dependencies = await files()
    const before = await getMarketCatalog({}, dependencies)
    const data = fixture(); data.observations[0].value = 99
    const target = join(dependencies.marketDataDir, 'global-drugs-v1.json')
    await writeFile(`${target}.tmp`, JSON.stringify(data)); await rename(`${target}.tmp`, target)
    const after = await getMarketCatalog({}, dependencies)
    expect(after.datasets[0].sha256).not.toBe(before.datasets[0].sha256)
    expect((await queryMarketObservations({ indicator: 'seizure-kg', from: '2023', to: '2023', geo: 'AAA', subgroup: '' }, dependencies)).observations[0].value).toBe(99)
  })
})

describe('Granular market REST, MCP and OpenAPI parity', () => {
  it('registers matching capabilities and strict public schemas', async () => {
    expect(capabilities().mcp.tools).toEqual(Object.keys(TOOLS))
    const spec = JSON.parse(await readFile('public/openapi.json', 'utf8'))
    expect(spec.paths['/markets']).toBeDefined()
    expect(spec.paths['/market-observations']).toBeDefined()
    expect(spec.components.schemas.GlobalMarketCatalog).toEqual(MARKET_CATALOG_OUTPUT_SCHEMA)
    expect(spec.components.schemas.MarketObservations).toEqual(MARKET_QUERY_OUTPUT_SCHEMA)
    expect(toolInputIsValid('query_market_observations', { category: '', limit: 500 })).toBe(true)
    expect(toolInputIsValid('query_market_observations', { limit: '500' })).toBe(false)
    expect(toolInputIsValid('get_market_catalog', { private: true })).toBe(false)
  })
  it('returns the same filtered data and native metadata over REST and MCP', async () => {
    const dependencies = await files()
    const response = await rest('/api/v1/market-observations?indicator=seizure-kg&category=&subgroup=&limit=500', dependencies)
    expect(response.statusCode).toBe(200)
    const mcp = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query_market_observations', arguments: { indicator: 'seizure-kg', category: '', subgroup: '', limit: 500 } } }, dependencies)
    expect(mcp.result.isError).toBe(false)
    expect(mcp.result.structuredContent).toEqual(response.data.data)
    expect(response.data.data.observations.map(row => row.id)).toEqual(['a3'])
  })
  it.each(['/api/v1/markets?limit=2', '/api/v1/market-observations?limit=501', '/api/v1/market-observations?geo=AAA&geo=BBB', '/api/v1/market-observations?offset=3'])('returns a client error for malformed or ambiguous filters: %s', async url => {
    expect((await rest(url, await files())).statusCode).toBe(400)
  })
  it('does not classify damaged server data as a caller error or leak its private fields', async () => {
    const dependencies = await files()
    await writeFile(join(dependencies.marketDataDir, 'global-drugs-v1.json'), Buffer.from([255]))
    const response = await rest('/api/v1/markets', dependencies)
    expect(response.statusCode).toBe(500)
    expect(response.data).toEqual({ ok: false, error: 'internal_error', message: 'NarcoScope could not read the published artifact.' })
  })
  it('exposes typed unavailable states over both transports', async () => {
    const dependencies = await files([])
    const response = await rest('/api/v1/markets', dependencies)
    expect(response.statusCode).toBe(503)
    expect(toolOutputIsValid('get_market_catalog', response.data.data)).toBe(true)
    const mcp = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_market_catalog', arguments: {} } }, dependencies)
    expect(mcp.result.isError).toBe(true)
    expect(mcp.result.structuredContent.status).toBe('unavailable')
  })
  it('rejects nested private fields in published output contracts', async () => {
    const dependencies = await files()
    const catalog = await getMarketCatalog({}, dependencies)
    catalog.datasets[0].sources[0].privateResponse = 'sensitive'
    expect(toolOutputIsValid('get_market_catalog', catalog)).toBe(false)
    const query = await queryMarketObservations({}, dependencies)
    query.observations[0].preciseLocation = 'sensitive'
    expect(toolOutputIsValid('query_market_observations', query)).toBe(false)
  })
})
