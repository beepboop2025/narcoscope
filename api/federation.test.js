import { describe, expect, it } from 'vitest'

import {
  FEDERATION_MAX_RESPONSE_BYTES,
  FEDERATION_TIMEOUT_MS,
  fetchBoundedJson,
  getFederation,
  validateGlobalMoneyAtlas,
  validateWorldMarkets,
} from './lib/federation.mjs'
import { getPalimpsestBriContext } from './lib/narcoscope.mjs'
import { dispatch, toolOutputIsValid } from './mcp.mjs'
import { createV1Handler } from './v1.mjs'

const FIXED_NOW = () => new Date('2026-08-31T01:00:00Z')

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

function worldFixture(section, { status, ok } = {}) {
  const domains = {
    money_markets: '2026-08-28',
    forex: '2026-08-29',
    capital_markets: '2026-08-30',
  }
  const selected = section === 'summary'
    ? '2026-08-30'
    : domains[section]
  const evidenceStatus = status ?? (section === 'summary' ? 'derived' : 'observed')
  return {
    ok: ok ?? evidenceStatus !== 'unavailable',
    schema: 'seiche.world-markets.v1',
    status: evidenceStatus,
    selection: section,
    generated_at: '2026-08-30T20:00:00Z',
    as_of: selected,
    clocks: {
      boundary: 'Observation, generation, and retrieval clocks are distinct.',
      snapshot_generated_at: '2026-08-30T20:00:00Z',
      evaluation_at: '2026-08-30T20:00:00Z',
      domains,
      latest_domain_as_of: '2026-08-30',
      selected_evidence_as_of: selected,
      excluded_from_observation_clocks: ['china_macro.knowledge_time'],
    },
    context_only: true,
    chart_history_included: false,
    available_selectors: ['summary', 'money_markets', 'capital_markets'],
    canonical_urls: {},
    citation: {
      publisher: 'Seiche',
      title: 'Seiche World Markets',
      canonical_url: 'https://seiche.info/markets/',
      topic_url: `https://seiche.info/${section.replaceAll('_', '-')}/`,
      api_url: 'https://api.seiche.info/api/v2/world-markets',
      generated_at: '2026-08-30T20:00:00Z',
      evidence_as_of: selected,
    },
    scope: {
      coverage_claim: 'curated_partial_non_exhaustive',
      included: ['money_markets', 'forex', 'capital_markets', 'china_macro'],
      not_claimed: ['a consolidated real-time market data feed'],
    },
    coverage: {},
    status_definitions: {},
    disclaimer: 'Research context, not investment advice.',
    [section]: section === 'summary'
      ? { domains: [] }
      : { status: evidenceStatus, as_of: selected, values: [] },
  }
}

function globalAtlasFixture() {
  return {
    ok: true,
    schema: 'seiche.global-money-markets.v1',
    generated_at: '2026-08-30T20:00:00+00:00',
    status: 'PARTIAL',
    plain_language: 'No cross-market score is produced.',
    quant_read: 'Own-market comparisons only.',
    strongest_divergence: null,
    countercase: 'Policy and calendar changes can explain a local deviation.',
    coverage: { declared_markets: 0 },
    markets: [],
    expansion_ledger: [],
    expansion_scope: {
      definition: 'Reviewed monetary-area discovery records.',
      exclusions: 'Metadata is not live coverage.',
      promotion_gate: 'Methodology and rights review required.',
      compatibility_note: 'Legacy names do not promise coverage.',
    },
    methodology: {
      publication_boundary: 'already collected canonical observations; no collection on request',
      role: 'context-only; does not enter the Seiche composite or constitute investment advice',
    },
    caveats: ['Unavailable evidence is not zero.'],
    legal_notices: [],
    read_faults: [],
  }
}

describe('NarcoScope Seiche and Palimpsest federation', () => {
  it('enforces one GET, the 15-second timeout, and the 2,000,000-byte ceiling', async () => {
    let calls = 0
    const fetched = await fetchBoundedJson('https://api.seiche.info/example', {
      fetchImpl: async (_url, options) => {
        calls += 1
        expect(options).toMatchObject({ method: 'GET', redirect: 'error' })
        expect(options.signal).toBeInstanceOf(AbortSignal)
        return jsonResponse({ ok: true })
      },
    })
    expect(calls).toBe(1)
    expect(fetched.httpStatus).toBe(200)
    expect(fetched.bytes).toBeGreaterThan(0)
    expect(FEDERATION_TIMEOUT_MS).toBe(15_000)
    expect(FEDERATION_MAX_RESPONSE_BYTES).toBe(2_000_000)
  })

  it('rejects declared and streamed oversized responses without retrying', async () => {
    let declaredCalls = 0
    await expect(fetchBoundedJson('https://api.seiche.info/declared', {
      maxResponseBytes: 32,
      fetchImpl: async () => {
        declaredCalls += 1
        return jsonResponse({ ok: true }, { headers: { 'content-length': '33' } })
      },
    })).rejects.toMatchObject({ code: 'response_too_large' })
    expect(declaredCalls).toBe(1)

    let cancelled = false
    const streamed = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {
        getReader() {
          let read = false
          return {
            async read() {
              if (read) return { done: true }
              read = true
              return { done: false, value: new Uint8Array(33) }
            },
            async cancel() { cancelled = true },
            releaseLock() {},
          }
        },
      },
    }
    await expect(fetchBoundedJson('https://api.seiche.info/streamed', {
      maxResponseBytes: 32,
      fetchImpl: async () => streamed,
    })).rejects.toMatchObject({ code: 'response_too_large' })
    expect(cancelled).toBe(true)
  })

  it('times out both before headers and while a response body stalls', async () => {
    await expect(fetchBoundedJson('https://api.seiche.info/no-headers', {
      timeoutMs: 5,
      fetchImpl: async () => new Promise(() => {}),
    })).rejects.toMatchObject({ code: 'upstream_timeout' })

    let cancelled = false
    const stalled = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {
        getReader() {
          return {
            read() { return new Promise(() => {}) },
            async cancel() { cancelled = true },
            releaseLock() {},
          }
        },
      },
    }
    await expect(fetchBoundedJson('https://api.seiche.info/stalled-body', {
      timeoutMs: 5,
      fetchImpl: async () => stalled,
    })).rejects.toMatchObject({ code: 'upstream_timeout' })
    expect(cancelled).toBe(true)
  })

  it('rejects invalid UTF-8 JSON, media types, and non-503 HTTP failures', async () => {
    await expect(fetchBoundedJson('https://api.seiche.info/not-json', {
      fetchImpl: async () => new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    })).rejects.toMatchObject({ code: 'invalid_upstream_json' })
    await expect(fetchBoundedJson('https://api.seiche.info/html', {
      fetchImpl: async () => new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    })).rejects.toMatchObject({ code: 'invalid_content_type' })
    await expect(fetchBoundedJson('https://api.seiche.info/rate-limited', {
      fetchImpl: async () => jsonResponse({ error: 'busy' }, {
        status: 429,
        headers: { 'retry-after': '60' },
      }),
    })).rejects.toMatchObject({
      code: 'upstream_http_error',
      httpStatus: 429,
      retryAfter: '60',
    })
  })

  it('validates the actual distinct Seiche public contracts', () => {
    expect(validateWorldMarkets(worldFixture('summary'), 'summary').selection).toBe('summary')
    expect(validateWorldMarkets(worldFixture('money_markets'), 'money_markets').status).toBe('observed')
    expect(validateGlobalMoneyAtlas(globalAtlasFixture()).status).toBe('PARTIAL')

    const missingCitation = worldFixture('summary')
    delete missingCitation.citation
    expect(() => validateWorldMarkets(missingCitation, 'summary')).toThrow(/citation|clock/)
    const wrongSelection = worldFixture('summary')
    wrongSelection.selection = 'capital_markets'
    expect(() => validateWorldMarkets(wrongSelection, 'summary')).toThrow(/selection/)
    const invalidAtlas = globalAtlasFixture()
    delete invalidAtlas.expansion_scope
    expect(() => validateGlobalMoneyAtlas(invalidAtlas)).toThrow(/scope/)

    const invalidClock = worldFixture('summary')
    invalidClock.generated_at = 'not-a-clock'
    invalidClock.clocks.snapshot_generated_at = 'not-a-clock'
    invalidClock.citation.generated_at = 'not-a-clock'
    expect(() => validateWorldMarkets(invalidClock, 'summary')).toThrow(/clock|instant/)
    const invalidDomainClock = worldFixture('summary')
    invalidDomainClock.clocks.domains.money_markets = 'zzz'
    expect(() => validateWorldMarkets(invalidDomainClock, 'summary')).toThrow(/clock|date/)
    const invalidCitation = worldFixture('summary')
    invalidCitation.citation.topic_url = 'http://seiche.info/markets/'
    expect(() => validateWorldMarkets(invalidCitation, 'summary')).toThrow(/citation/)
  })

  it('returns one schema-valid Seiche lane without joining or recomputing it', async () => {
    let calls = 0
    const payload = worldFixture('capital_markets')
    const federation = await getFederation({ lane: 'seiche-capital-markets' }, {
      fetchImpl: async () => {
        calls += 1
        return jsonResponse(payload)
      },
      now: FIXED_NOW,
    })
    expect(calls).toBe(1)
    expect(federation).toMatchObject({
      status: 'available',
      query: { lane: 'seiche-capital-markets' },
      policy: {
        cross_lane_join: 'prohibited',
        composite_generation: 'prohibited',
        causal_inference: 'prohibited',
        culpability_inference: 'prohibited',
      },
    })
    expect(federation.lanes).toHaveLength(1)
    expect(federation.lanes[0].data).toEqual(payload)
    expect(federation.lanes[0].transport).toEqual({
      attempts: 1,
      timeout_ms: 15_000,
      max_response_bytes: 2_000_000,
    })
    expect(toolOutputIsValid('get_federation', federation)).toBe(true)
    const serialized = JSON.stringify(federation)
    for (const forbidden of ['"composite_score"', '"causal_score"', '"culpability_score"', '"guilt_score"']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('rejects an upstream composite instead of forwarding it', async () => {
    const payload = worldFixture('summary')
    payload.summary.composite = 91
    const federation = await getFederation({ lane: 'seiche-summary' }, {
      fetchImpl: async () => jsonResponse(payload),
      now: FIXED_NOW,
    })
    expect(federation.status).toBe('unavailable')
    expect(federation.lanes[0]).toMatchObject({
      availability: 'unavailable',
      data: null,
      error: { code: 'invalid_upstream_contract' },
    })
    expect(JSON.stringify(federation)).not.toContain('91')
    expect(toolOutputIsValid('get_federation', federation)).toBe(true)
  })

  it('preserves a typed upstream 503 through REST and structured MCP output', async () => {
    const unavailable = worldFixture('summary', { status: 'unavailable', ok: false })
    const fetchImpl = async () => jsonResponse(unavailable, {
      status: 503,
      headers: { 'retry-after': '120' },
    })
    const dependencies = { fetchImpl, now: FIXED_NOW }

    const rest = responseRecorder()
    await createV1Handler(dependencies)({
      method: 'GET',
      headers: {},
      url: '/api/v1/federation?lane=seiche-summary',
      query: { resource: 'federation' },
    }, rest)
    expect(rest.statusCode).toBe(503)
    expect(JSON.parse(rest.body)).toMatchObject({
      ok: false,
      resource: 'federation',
      error: 'unavailable',
      data: {
        status: 'unavailable',
        lanes: [{
          availability: 'unavailable',
          upstream_status: 'unavailable',
          error: {
            code: 'upstream_unavailable',
            upstream_http_status: 503,
            retry_after: '120',
          },
        }],
      },
    })

    const mcp = await dispatch({
      jsonrpc: '2.0',
      id: 'federation-unavailable',
      method: 'tools/call',
      params: { name: 'get_federation', arguments: { lane: 'seiche-summary' } },
    }, dependencies)
    expect(mcp.result.isError).toBe(true)
    expect(mcp.result.structuredContent.status).toBe('unavailable')
    expect(toolOutputIsValid('get_federation', mcp.result.structuredContent)).toBe(true)
  })

  it('exposes BRI and its pinned rights-suppressed receipt as separate lanes', async () => {
    const bri = await getFederation({ lane: 'palimpsest-bri' }, {
      getBriContext: getPalimpsestBriContext,
      now: FIXED_NOW,
    })
    const rights = await getFederation({ lane: 'palimpsest-newswire-rights' }, {
      getBriContext: getPalimpsestBriContext,
      now: FIXED_NOW,
    })
    expect(bri.lanes[0]).toMatchObject({
      id: 'palimpsest-bri',
      availability: 'available',
      evidence_status: 'structural',
    })
    expect(rights.lanes[0]).toMatchObject({
      id: 'palimpsest-newswire-rights',
      availability: 'restricted',
      evidence_status: 'restricted',
      data: {
        status: 'rights_suppressed',
        availability: 'unavailable',
        publication_allowed: false,
        freshness: 'verified_at_pinned_release_not_continuous_monitoring',
      },
    })
    expect(rights.lanes[0].data.status_artifact.bytes).toBeGreaterThan(2_000_000)
    expect(rights.lanes[0].data).not.toHaveProperty('quarantined_paths')
    expect(rights.lanes[0].transport).toBeNull()
    expect(toolOutputIsValid('get_federation', rights)).toBe(true)
  })

  it('rejects invalid federation lane selectors before any fetch', async () => {
    let calls = 0
    await expect(getFederation({ lane: 'joined-score' }, {
      fetchImpl: async () => { calls += 1 },
    })).rejects.toThrow(/lane must be one of/)
    expect(calls).toBe(0)
  })
})
