import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  capabilities,
  getNewsroom,
  getOverview,
  getPalimpsestBriContext,
  getPalimpsestCorridors,
  getStory,
} from './lib/narcoscope.mjs'
import handler, { dispatch, TOOLS } from './mcp.mjs'
import { createV1Handler } from './v1.mjs'
import {
  PALIMPSEST_BRI_OUTPUT_SCHEMA,
  REQUIRED_PROHIBITIONS,
  createPalimpsestBriRestSchema,
} from '../lib/palimpsest-bri-contract.mjs'

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
}

function compileStandaloneSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

describe('NarcoScope public surfaces', () => {
  it('publishes one canonical capability contract for API and MCP', () => {
    const card = capabilities()
    expect(card.schema).toBe('narcoscope.capabilities.v1')
    expect(card.mcp.tools).toEqual(Object.keys(TOOLS))
    expect(card.boundaries.join(' ')).toContain('No point-of-sale')
  })

  it('returns bounded official overview data', async () => {
    const overview = await getOverview()
    expect(overview.headline.designations).toBeGreaterThan(2_000)
    expect(overview.top_seizure_countries.length).toBeLessThanOrEqual(10)
    expect(overview.interpretation.join(' ')).toContain('not a live illicit-market estimate')
  })

  it('serves the corridor overlay with the non-causal join boundary intact', async () => {
    const overlay = await getPalimpsestCorridors()
    expect(overlay.geographies.map((item) => item.iso3)).toEqual(['CHN', 'MMR', 'PAK'])
    expect(overlay.disclosure.joinPolicy).toBe('geography_and_time_only')
    expect(overlay.interpretation).toContain('never infer an actor relationship')
  })

  it('serves BRI context as a separately pinned non-joinable lane', async () => {
    const context = await getPalimpsestBriContext()
    expect(context.schema).toBe('narcoscope.api.palimpsest-bri-envelope.v1')
    expect(context.data.schemaVersion).toBe('narcoscope.palimpsest.bri-context.v1')
    expect(context.data.usePolicy).toMatchObject({
      lane: 'parallel_context_only',
      crossLaneJoinPolicy: 'prohibited',
    })
    expect(context.data.sourceReadiness.sourceCount).toBeGreaterThan(0)
    expect(context.data.economicContext.coverage.totals).toMatchObject({
      countries: 3,
      indicators: 18,
    })
    expect(context.data.economicContext.coverage.totals.unavailableRows).toBeGreaterThan(0)
    expect(context.links.sha256).toMatch(/narcoscope-palimpsest-bri-v1\.json\.sha256$/)
  })

  it('serves newsroom metadata and the machine brief without weakening gates', async () => {
    const newsroom = await getNewsroom({ limit: 1 })
    expect(newsroom.articles).toHaveLength(1)
    expect(newsroom.verification.citation_coverage.percent).toBe(100)
    const story = await getStory({ slug: newsroom.articles[0].slug })
    expect(story.artifact).toBe('machine-brief')
    expect(story.content).toBeTruthy()
    expect(story.article.humanReviewStatus).toBe('not_recorded')
  })

  it('rejects path-shaped story slugs', async () => {
    await expect(getStory({ slug: '../private' })).rejects.toThrow(/slug/)
  })

  it('implements MCP initialize, list, and structured tool results', async () => {
    const initialized = await dispatch({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    })
    expect(initialized.result.serverInfo.version).toBe('1.2.0')
    expect(initialized.result.protocolVersion).toBe('2025-03-26')
    const listed = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(Object.keys(TOOLS))
    const called = await dispatch({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_newsroom', arguments: { limit: 1 } },
    })
    expect(called.result.isError).toBe(false)
    expect(called.result.structuredContent.articles).toHaveLength(1)
    const bri = await dispatch({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_palimpsest_bri_context', arguments: {} },
    })
    expect(bri.result.isError).toBe(false)
    expect(bri.result.structuredContent.data.usePolicy.crossLaneJoinPolicy).toBe('prohibited')
    const briTool = listed.result.tools.find((tool) => tool.name === 'get_palimpsest_bri_context')
    expect(briTool.outputSchema).toEqual(PALIMPSEST_BRI_OUTPUT_SCHEMA)
    expect(briTool.outputSchema.properties.data.$ref)
      .toBe('#/$defs/artifact')
    const artifactSchema = JSON.parse(readFileSync(
      'public/data/narcoscope-palimpsest-bri-v1.schema.json',
      'utf8',
    ))
    expect(briTool.outputSchema.$defs.artifact).toEqual(artifactSchema)
    const validateMcpOutput = compileStandaloneSchema(briTool.outputSchema)
    expect(validateMcpOutput(bri.result.structuredContent), JSON.stringify(validateMcpOutput.errors))
      .toBe(true)
  })

  it('validates the real REST BRI envelope against the shared standalone contract', async () => {
    const response = responseRecorder()
    await createV1Handler()({
      method: 'GET',
      headers: {},
      url: '/api/v1/palimpsest-bri',
      query: { resource: 'palimpsest-bri' },
    }, response)
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    const restSchema = createPalimpsestBriRestSchema(PALIMPSEST_BRI_OUTPUT_SCHEMA)
    const validateRestOutput = compileStandaloneSchema(restSchema)
    expect(validateRestOutput(body), JSON.stringify(validateRestOutput.errors)).toBe(true)

    const openapi = JSON.parse(readFileSync('public/openapi.json', 'utf8'))
    const resolvedOpenApiSchema = structuredClone(openapi.components.schemas.PalimpsestBriRestEnvelope)
    resolvedOpenApiSchema.properties.data = structuredClone(openapi.components.schemas.PalimpsestBriContext)
    const validateOpenApiOutput = compileStandaloneSchema(resolvedOpenApiSchema)
    expect(validateOpenApiOutput(body), JSON.stringify(validateOpenApiOutput.errors)).toBe(true)
  })

  it('fails REST and MCP closed when the shared BRI verifier rejects packaged bytes', async () => {
    const unavailable = async () => { throw new Error('verification failed') }
    const rest = responseRecorder()
    await createV1Handler({ getBriContext: unavailable })({
      method: 'GET',
      headers: {},
      url: '/api/v1/palimpsest-bri',
      query: { resource: 'palimpsest-bri' },
    }, rest)
    expect(rest.statusCode).toBe(500)
    expect(JSON.parse(rest.body)).toMatchObject({ ok: false, error: 'internal_error' })

    const mcp = await dispatch({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'get_palimpsest_bri_context', arguments: {} },
    }, { getBriContext: unavailable })
    expect(mcp.result).toMatchObject({ isError: true })
    expect(mcp.result).not.toHaveProperty('structuredContent')
  })

  it('enforces JSON-RPC and Streamable HTTP request boundaries', async () => {
    const invalid = await dispatch({ id: 1, method: 'ping' })
    expect(invalid.error.code).toBe(-32600)

    const unsupported = responseRecorder()
    await handler({
      method: 'POST',
      headers: { 'mcp-protocol-version': '2099-01-01' },
      body: { jsonrpc: '2.0', id: 1, method: 'ping' },
    }, unsupported)
    expect(unsupported.statusCode).toBe(400)

    const notification = responseRecorder()
    await handler({
      method: 'POST',
      headers: { 'mcp-protocol-version': '2025-06-18' },
      body: { jsonrpc: '2.0', method: 'ping' },
    }, notification)
    expect(notification.statusCode).toBe(202)
    expect(notification.body).toBe('')

    const forbidden = responseRecorder()
    await handler({
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      body: { jsonrpc: '2.0', id: 1, method: 'ping' },
    }, forbidden)
    expect(forbidden.statusCode).toBe(403)

    const streamlessGet = responseRecorder()
    await handler({ method: 'GET', headers: {} }, streamlessGet)
    expect(streamlessGet.statusCode).toBe(405)
  })

  it('rejects oversized bodies even when content-length is absent', async () => {
    const response = responseRecorder()
    await handler({
      method: 'POST',
      headers: {},
      body: `{"jsonrpc":"2.0","id":1,"method":"ping","padding":"${'x'.repeat(256 * 1024)}"}`,
    }, response)
    expect(response.statusCode).toBe(413)
  })

  it('keeps the registry and web-served MCP manifests identical', () => {
    const registry = JSON.parse(readFileSync('server.json', 'utf8'))
    const hosted = JSON.parse(readFileSync('public/server.json', 'utf8'))
    expect(registry).toEqual(hosted)
    expect(registry.version).toBe('1.2.0')
  })

  it('advertises the same BRI context lane through OpenAPI and product discovery', () => {
    const openapi = JSON.parse(readFileSync('public/openapi.json', 'utf8'))
    const product = JSON.parse(readFileSync('public/product-card.json', 'utf8'))
    const artifact = JSON.parse(readFileSync('public/data/narcoscope-palimpsest-bri-v1.json', 'utf8'))
    expect(openapi.info.version).toBe('1.2.0')
    expect(openapi.paths).toHaveProperty('/palimpsest-bri')
    expect(openapi.paths['/palimpsest-bri'].get.responses['200'].$ref)
      .toBe('#/components/responses/PalimpsestBriSuccess')
    expect(openapi.components.schemas).not.toHaveProperty('PalimpsestBriArtifact')
    expect(openapi.components.schemas.PalimpsestBriContext)
      .toEqual(PALIMPSEST_BRI_OUTPUT_SCHEMA)
    expect(openapi.components.schemas.PalimpsestBriContext.properties.data.$ref)
      .toBe('#/$defs/artifact')
    expect(product.access.palimpsest_bri_context).toBe('https://narcoscope.com/api/v1/palimpsest-bri')
    expect(product.boundaries.join(' ')).toContain('never enters drug-market inference')
    expect(product.palimpsest_bri_prohibitions).toEqual(artifact.usePolicy.prohibitions)
    expect(Object.keys(product.palimpsest_bri_prohibitions)).toEqual(REQUIRED_PROHIBITIONS)
    expect(Object.values(product.palimpsest_bri_prohibitions)).toEqual(
      REQUIRED_PROHIBITIONS.map(() => 'prohibited'),
    )
  })
})
