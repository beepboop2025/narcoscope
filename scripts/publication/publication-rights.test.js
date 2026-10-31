import { afterAll, describe, expect, it } from 'vitest'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PUBLICATION_POLICY_ID, projectBridge, projectMarketDataset, projectOverview, projectLegacyJson, projectPriceModule, serializePublicData } from '../../lib/publication-rights.mjs'
import { getMarketCatalog, queryMarketObservations } from '../../lib/global-markets.mjs'
import { dispatch } from '../../api/mcp.mjs'
import { createNarcoscopeServer } from '../../server.mjs'
import { projectPublicDirectory } from './build-public-projection.mjs'
const read = async path => JSON.parse(await readFile(new URL('../../' + path, import.meta.url), 'utf8'))
const rawDrugs = await read('public/data/global-drugs-v1.json')
const directories = [], servers = []
afterAll(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); await Promise.all(directories.map(path => rm(path, { recursive: true, force: true }))) })
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

describe('WDR publication enforcement', { timeout: 30_000 }, () => {
  it('retains source identities, removes all WDR rows and preserves every qualified StatCan row byte-for-byte', () => {
    const before = JSON.stringify(rawDrugs)
    const projected = projectMarketDataset(rawDrugs)
    expect(projected.sources).toEqual(rawDrugs.sources)
    expect(projected.indicators).toEqual(rawDrugs.indicators)
    const allowedIds = new Set(rawDrugs.indicators.filter(row => row.sourceId.startsWith('statcan-')).map(row => row.id))
    expect(projected.observations).toEqual(rawDrugs.observations.filter(row => allowedIds.has(row.indicatorId)))
    expect(projected.observations.length).toBeGreaterThan(0)
    expect(projected.publication.sourceIds).toEqual(['wdr2026-labs', 'wdr2026-prices', 'wdr2026-seizures', 'wdr2026-treatment'])
    expect(projectMarketDataset(projected)).toEqual(projected)
    expect(JSON.stringify(rawDrugs)).toBe(before)
  })

  it.each([
    ['orphan observation', data => { data.observations.push({ ...data.observations[0], id: 'unresolved-row', indicatorId: 'not-registered', value: 123456789 }) }],
    ['orphan source', data => { data.indicators[0].sourceId = 'not-registered' }],
    ['duplicate source', data => { data.sources.push({ ...data.sources[0] }) }],
    ['duplicate indicator', data => { data.indicators.push({ ...data.indicators[0] }) }],
    ['duplicate observation', data => { data.observations.push({ ...data.observations[0] }) }],
    ['unknown permission', data => { data.sources[0].license = 'unknown' }],
    ['restricted permission', data => { data.sources[0].license = ' restricted ' }],
    ['unestablished permission', data => { data.sources[0].license = 'not established' }],
  ])('fails closed at the shared boundary for %s', (_name, mutate) => {
    const data = structuredClone(rawDrugs)
    mutate(data)
    expect(() => projectMarketDataset(data)).toThrow(/Publication/)
  })

  it('withholds old artifacts on first load and cache hits; denied queries retain exact source IDs and no fake zero total', async () => {
    for (let hit = 0; hit < 2; hit++) {
      const result = await queryMarketObservations({ dataset: 'global-drugs', indicator: 'wdr2026-seizures-kg', limit: 20 })
      expect(result.status).toBe('metadata_only')
      expect(result.observations).toEqual([])
      expect(result.pagination.total).toBeNull()
      expect(result.sources.map(row => row.id)).toEqual(['wdr2026-seizures'])
      expect(result.publication.permissionEvidence).toBeNull()
    }
    const catalog = await getMarketCatalog()
    const drugs = catalog.datasets.find(row => row.id === 'global-drugs')
    expect(drugs.indicators.find(row => row.id === 'wdr2026-seizures-kg')).toMatchObject({ publication: { status: 'metadata_only' }, coverage: { observations: null, numericObservations: null } })
    expect(drugs.sha256).toBe(sha(serializePublicData(projectMarketDataset(rawDrugs))))
    const allowed = drugs.indicators.find(row => row.sourceId.startsWith('statcan-'))
    const result = await queryMarketObservations({ dataset: 'global-drugs', indicator: allowed.id, limit: 20 })
    expect(result.observations.length).toBeGreaterThan(0)
    expect(result.observations.every(row => row.sourceId.startsWith('statcan-'))).toBe(true)
  })

  it('projects native MCP text and structured payloads identically for bridge, corridor, overview and denied observations', async () => {
    for (const [name, args] of [['get_palimpsest_bridge', {}], ['get_palimpsest_corridors', {}], ['get_overview', {}], ['query_market_observations', { dataset: 'global-drugs', indicator: 'wdr2026-seizures-kg', limit: 20 }]]) {
      const response = await dispatch({ jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name, arguments: args } })
      expect(response.result.isError).toBe(false)
      const data = response.result.structuredContent
      expect(JSON.parse(response.result.content[0].text)).toEqual(data)
      if (name.includes('palimpsest')) {
        expect(data.datasets.retailDrugPrices.data).toBeNull()
        expect(data.datasets.drugSeizures.data).toBeNull()
        expect(data.datasets.retailDrugPrices.provenance.url).toContain('unodc.org')
      } else if (name === 'get_overview') {
        expect(data.headline.worldSeizureTonnes).toBeNull()
        expect(data.top_seizure_countries).toEqual([])
        expect(data.divergences).toEqual([])
        expect(data.headline.usOverdoseLatest).toBeGreaterThan(0)
      } else expect(data.observations).toEqual([])
    }
  })

  it('projects stale static JSON and both REST spellings through the real HTTP server', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'narco-rights-static-')); directories.push(dir)
    await mkdir(join(dir, 'data'))
    await writeFile(join(dir, 'index.html'), '<p>metadata</p>')
    await writeFile(join(dir, 'data/global-drugs-v1.json'), JSON.stringify(rawDrugs))
    const server = createNarcoscopeServer({ distDir: dir }); servers.push(server)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = 'http://127.0.0.1:' + server.address().port
    for (const path of ['/data/global-drugs-v1.json', '/data//global-drugs-v1.json', '/data/global-drugs-v1.json/']) {
      const direct = await fetch(origin + path)
      expect(direct.status).toBe(200)
      expect(direct.headers.get('cache-control')).toBe('no-store')
      expect(await direct.json()).toEqual(projectMarketDataset(rawDrugs))
    }
    for (const path of ['/api/v1/palimpsest-bridge', '/api/v1?resource=palimpsest-bridge']) {
      const response = await fetch(origin + path)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.datasets.retailDrugPrices.data).toBeNull()
    }
    const invalid = structuredClone(rawDrugs)
    invalid.observations.push({ ...invalid.observations[0], id: 'unresolved-row', indicatorId: 'not-registered', value: 123456789 })
    await writeFile(join(dir, 'data/global-drugs-v1.json'), JSON.stringify(invalid))
    await expect(projectPublicDirectory(dir)).rejects.toThrow(/Publication observation/)
    const rejected = await fetch(origin + '/data//global-drugs-v1.json')
    expect(rejected.status).toBe(500)
    expect(await rejected.text()).not.toContain('123456789')
    invalid.observations.pop()
    invalid.sources[0].license = 'unknown'
    await writeFile(join(dir, 'data/global-drugs-v1.json'), JSON.stringify(invalid))
    await expect(projectPublicDirectory(dir)).rejects.toThrow(/Publication source permission/)
    const unknown = await fetch(origin + '/data/global-drugs-v1.json/')
    expect(unknown.status).toBe(500)
    expect(await unknown.text()).not.toContain('observations')
    for (const path of ['/src/data/prices.ts', '/public/data/global-drugs-v1.json', '/.git/config', '/assets/old-wdr-12345678.js']) expect((await fetch(origin + path)).status).toBe(404)
  })

  it('removes derivative and bundle inputs without modifying retained originals or substituting zero measurements', async () => {
    const rawOverview = await read('src/data/overview.json')
    const overview = projectOverview(rawOverview)
    expect(overview.headline.worldSeizureTonnes).toBeNull()
    expect(overview.topSeizureCountries).toEqual([])
    expect(overview.divergences).toEqual([])
    expect(overview.overdoseTrend).toEqual(rawOverview.overdoseTrend)
    expect(projectOverview(overview)).toEqual(overview)
    for (const name of ['priceSeries.json', 'seizures.json']) {
      const raw = await read('src/data/' + name)
      expect(raw.records.length).toBeGreaterThan(0)
      expect(projectLegacyJson(name, raw).records).toEqual([])
    }
    const source = await readFile(new URL('../../src/data/prices.ts', import.meta.url), 'utf8')
    const projected = projectPriceModule(source)
    expect(projected).toContain('export const PRICE_RECORDS: PriceRecord[] = []')
    expect(projected).not.toMatch(/priceUsdPerGram: \d/)
    expect(() => projectPriceModule('export const renamed = []')).toThrow()
  })
})
