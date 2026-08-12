import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { capabilities, getNewsroom, getOverview, getStory } from './lib/narcoscope.mjs'
import handler, { dispatch, TOOLS } from './mcp.mjs'

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
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
    expect(initialized.result.serverInfo.version).toBe('1.0.0')
    expect(initialized.result.protocolVersion).toBe('2025-03-26')
    const listed = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(Object.keys(TOOLS))
    const called = await dispatch({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_newsroom', arguments: { limit: 1 } },
    })
    expect(called.result.isError).toBe(false)
    expect(called.result.structuredContent.articles).toHaveLength(1)
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
  })
})
