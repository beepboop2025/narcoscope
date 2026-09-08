import { describe, it, expect } from 'vitest'
import { readResearchNetwork, RESEARCH_NETWORK_URL } from '../lib/research-network.mjs'
import { TOOLS } from './mcp.mjs'
import { resource } from './lib/narcoscope.mjs'

function payload() {
  return { schema: 'seiche.research-network.v1', status: 'stale', context_only: true,
    selection: { topic: 'china', offset: 0, limit: 5 }, datasets: [{ id: 'china', values_included: false, evidence_state: 'gated' }],
    eligibility: { blend_into_score: false, training: false, execution: false } }
}
describe('connected research contract', () => {
  it('carries the source status identically through API and MCP', async () => {
    const data = payload(); const requests = []
    const dependencies = { fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(data)) } }
    expect(await resource('research-network', { topic: 'china', limit: '5' }, dependencies)).toEqual(data)
    expect(await TOOLS.research_network.call({ topic: 'china', limit: 5 }, dependencies)).toEqual(data)
    for (const request of requests) {
      expect(request.url).toBe(`${RESEARCH_NETWORK_URL}?topic=china&offset=0&limit=5`)
      expect(request.options.credentials).toBe('omit')
      expect(request.options.redirect).toBe('error')
    }
  })
  it.each([{ topic: 'unknown' }, { limit: 26 }, { offset: -1 }, { limit: true }, { url: 'https://evil.test' }])('rejects ambiguous inputs before any fetch: %j', async args => {
    let calls = 0
    await expect(readResearchNetwork(args, { fetchImpl: () => { calls++; throw new Error('should not fetch') } })).rejects.toThrow()
    expect(calls).toBe(0)
  })
  it('fails closed when a response broadens value or scoring authority', async () => {
    const data = payload(); data.datasets[0].values_included = true
    const result = await readResearchNetwork({ topic: 'china', limit: 5 }, { fetchImpl: async () => new Response(JSON.stringify(data)) })
    expect(result.status).toBe('unavailable'); expect(result.datasets).toEqual([])
  })
  it('bounds downloads and suppresses transport details', async () => {
    const result = await readResearchNetwork({}, { fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) })
    expect(result.status).toBe('unavailable')
    const failed = await readResearchNetwork({}, { fetchImpl: async () => { throw new Error('private transport detail') } })
    expect(JSON.stringify(failed)).not.toContain('private transport detail')
  })
})
