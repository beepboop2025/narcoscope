import { describe, expect, it } from 'vitest'
import { buildWire, legalStageFor, parseRss, parseTreasuryPress, validateWire, wiresSemanticallyEqual } from './collect.mjs'

const config = {
  maxResponseBytes: 20_000,
  timeoutMs: 1_000,
  maxItemsPerSource: 20,
  retentionDays: 45,
  topicRules: [
    { topic: 'drug markets', pattern: '\\b(drug|fentanyl|cocaine)\\b' },
    { topic: 'arms trafficking', pattern: '\\b(firearms?|weapons?)\\b' },
  ],
  sources: [{
    id: 'official', name: 'Official source', kind: 'rss', url: 'https://example.test/feed.xml',
    cadenceMinutes: 15, staleAfterMinutes: 120, evidenceClass: 'official-action', verificationState: 'source-published',
    rights: 'public metadata', publicationAllowed: true, requireRelevantTopic: true,
  }, {
    id: 'restricted', name: 'Restricted context', kind: 'status-json', url: 'https://example.test/restricted.json',
    cadenceMinutes: 15, staleAfterMinutes: 90, evidenceClass: 'reported-lead', verificationState: 'context-only',
    rights: 'receipt only', publicationAllowed: false, expectedStatus: 'restricted',
  }],
}

describe('evidence wire parsing', () => {
  it('parses RSS metadata without carrying article body text', () => {
    const parsed = parseRss(`<?xml version="1.0"?><rss><channel><item><title>Three charged in cocaine and firearms case</title><link>https://example.test/action</link><description>Home address and other body detail that must not be copied.</description><pubDate>Fri, 28 Aug 2026 12:00:00 +0000</pubDate></item></channel></rss>`, 'https://example.test')
    expect(parsed).toEqual([{ title: 'Three charged in cocaine and firearms case', url: 'https://example.test/action', publishedAt: '2026-08-28T12:00:00.000Z' }])
  })

  it('parses current Treasury headline and publication-time markup', () => {
    const parsed = parseTreasuryPress('<h3 class=featured-stories__headline><a href=/news/press-releases/sb0617/ hreflang=en>Network sanctioned for laundering drug proceeds</a></h3></div><div><span><time datetime=2026-08-26T14:30:00Z>August 26</time>', 'https://home.treasury.gov')
    expect(parsed[0]).toMatchObject({ title: 'Network sanctioned for laundering drug proceeds', url: 'https://home.treasury.gov/news/press-releases/sb0617/', publishedAt: '2026-08-26T14:30:00.000Z' })
  })

  it('keeps legal stages distinct', () => {
    expect(legalStageFor('Two defendants charged in fentanyl case')).toBe('charge')
    expect(legalStageFor('Federal jury convicts trafficking organizer')).toBe('conviction')
    expect(legalStageFor('Treasury sanctions cocaine network')).toBe('designation')
    expect(legalStageFor('Company reaches settlement')).toBe('settlement')
    expect(legalStageFor('Company agrees to pay fine')).toBe('settlement')
  })
})

describe('evidence wire assembly', () => {
  it('publishes relevant public metadata and a restricted receipt without leaking restricted items', async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('restricted.json')) return new Response(JSON.stringify({ status: 'restricted', publication_allowed: false, schema_version: 'palimpsest-newswire.v1', reason: 'source policy' }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('<rss><channel><item><title>Officials charge cocaine and firearms network</title><link>https://example.test/action</link><pubDate>Fri, 28 Aug 2026 12:00:00 +0000</pubDate></item><item><title>Unrelated office update</title><link>https://example.test/other</link></item></channel></rss>', { status: 200, headers: { 'content-type': 'application/rss+xml' } })
    }
    const artifact = validateWire(await buildWire({ config, fetchImpl, now: new Date('2026-08-31T00:00:00Z') }))
    expect(artifact.status).toBe('partial')
    expect(artifact.items).toHaveLength(1)
    expect(artifact.items[0]).toMatchObject({ legalStage: 'charge', topics: ['drug markets', 'arms trafficking'], publicationAllowed: true })
    expect(artifact.sources.find((source) => source.id === 'restricted')?.status).toBe('restricted')
  })

  it('retains a prior public item as stale when one bounded fetch fails', async () => {
    const previous = {
      items: [{ id: 'old', title: 'Prior fentanyl release', url: 'https://example.test/old', sourceId: 'official', sourceName: 'Official source', publishedAt: '2026-08-28T00:00:00Z', retrievedAt: '2026-08-28T01:00:00Z', evidenceClass: 'official-action', verificationState: 'source-published', legalStage: 'report', topics: ['drug markets'], countries: [], publicationAllowed: true }],
      sources: [{ id: 'official', lastSuccessAt: '2026-08-28T01:00:00Z' }],
    }
    const failingConfig = { ...config, sources: [config.sources[0]] }
    const artifact = await buildWire({ config: failingConfig, previous, now: new Date('2026-08-31T00:00:00Z'), fetchImpl: async () => { throw new Error('offline') } })
    expect(artifact.items.map((item) => item.id)).toEqual(['old'])
    expect(artifact.sources[0]).toMatchObject({ status: 'stale', lastSuccessAt: '2026-08-28T01:00:00Z' })
  })

  it('keeps a recent last-good receipt aging until the source SLO expires', async () => {
    const previous = {
      items: [],
      sources: [{ id: 'official', lastSuccessAt: '2026-08-31T00:30:00Z' }],
    }
    const failingConfig = { ...config, sources: [config.sources[0]] }
    const artifact = await buildWire({ config: failingConfig, previous, now: new Date('2026-08-31T01:00:00Z'), fetchImpl: async () => { throw new Error('offline') } })
    expect(artifact.status).toBe('aging')
    expect(artifact.sources[0]).toMatchObject({ status: 'aging', staleAfterMinutes: 120 })
  })

  it('treats a successful empty relevant slice as fresh-to-source', async () => {
    const freshConfig = { ...config, sources: [config.sources[0]] }
    const artifact = await buildWire({ config: freshConfig, now: new Date('2026-08-31T01:00:00Z'), fetchImpl: async () => new Response('<rss><channel><item><title>Administrative notice</title><link>https://example.test/notice</link></item></channel></rss>') })
    expect(artifact.items).toHaveLength(0)
    expect(artifact.sources[0].status).toBe('fresh')
  })

  it('keeps prior in-scope metadata when a successful RSS window rotates', async () => {
    const prior = {
      items: [{ id: 'old', title: 'Prior fentanyl release', url: 'https://example.test/old', sourceId: 'official', sourceName: 'Official source', publishedAt: '2026-08-30T00:00:00Z', retrievedAt: '2026-08-30T01:00:00Z', evidenceClass: 'official-action', verificationState: 'source-published', legalStage: 'report', topics: ['drug markets'], countries: [], publicationAllowed: true }],
      sources: [{ id: 'official', lastSuccessAt: '2026-08-30T01:00:00Z' }],
    }
    const freshConfig = { ...config, sources: [config.sources[0]] }
    const artifact = await buildWire({ config: freshConfig, previous: prior, now: new Date('2026-08-31T01:00:00Z'), fetchImpl: async () => new Response('<rss><channel><item><title>Administrative notice</title><link>https://example.test/notice</link></item></channel></rss>') })
    expect(artifact.sources[0]).toMatchObject({ status: 'fresh', detail: expect.stringContaining('0 current in-scope · 1 retained') })
    expect(artifact.items.map((item) => item.id)).toEqual(['old'])

    const expired = await buildWire({ config: freshConfig, previous: prior, now: new Date('2026-10-16T01:00:00Z'), fetchImpl: async () => new Response('<rss><channel /></rss>') })
    expect(expired.items).toHaveLength(0)
  })

  it('fails closed when a response exceeds its byte ceiling', async () => {
    const tinyConfig = { ...config, maxResponseBytes: 8, sources: [config.sources[0]] }
    const artifact = await buildWire({ config: tinyConfig, fetchImpl: async () => new Response('this response is too large'), now: new Date('2026-08-31T00:00:00Z') })
    expect(artifact.items).toHaveLength(0)
    expect(artifact.sources[0].status).toBe('unavailable')
    expect(artifact.sources[0].detail).toMatch(/ceiling/)
  })

  it('ignores collector heartbeat clocks but detects evidence and source-state changes', async () => {
    const fetchImpl = async () => new Response('<rss><channel><item><title>Officials charge cocaine network</title><link>https://example.test/action</link><pubDate>Fri, 28 Aug 2026 12:00:00 +0000</pubDate></item></channel></rss>')
    const oneSource = { ...config, sources: [config.sources[0]] }
    const first = await buildWire({ config: oneSource, fetchImpl, now: new Date('2026-08-31T00:00:00Z') })
    const heartbeat = await buildWire({ config: oneSource, fetchImpl, now: new Date('2026-08-31T00:10:00Z') })
    expect(wiresSemanticallyEqual(first, heartbeat)).toBe(true)

    const rotatedWindowCount = structuredClone(heartbeat)
    rotatedWindowCount.sources[0].detail = '24 source items read · 3 current in-scope · 1 retained metadata items published'
    expect(wiresSemanticallyEqual(heartbeat, rotatedWindowCount)).toBe(true)

    const sourceFailure = await buildWire({ config: oneSource, previous: heartbeat, now: new Date('2026-08-31T00:20:00Z'), fetchImpl: async () => { throw new Error('offline') } })
    expect(sourceFailure.sources[0].status).toBe('aging')
    expect(wiresSemanticallyEqual(heartbeat, sourceFailure)).toBe(false)

    const changedItem = structuredClone(heartbeat)
    changedItem.items[0].legalStage = 'conviction'
    expect(wiresSemanticallyEqual(heartbeat, changedItem)).toBe(false)
  })
})
