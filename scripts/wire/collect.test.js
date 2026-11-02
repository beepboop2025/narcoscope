import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SOURCE_RESPONSE_CEILING_BYTES, buildWire, legalStageFor, parseRss, parseTreasuryPress, responseLimit, validateWire, wiresSemanticallyEqual } from './collect.mjs'

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

  it('admits relevant Europol metadata while excluding feed body text and unrelated posts', async () => {
    const sourceConfig = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'))
    const europol = sourceConfig.sources.find((source) => source.id === 'europol-news')
    expect(europol).toMatchObject({
      kind: 'rss',
      url: 'https://www.europol.europa.eu/rss.xml',
      evidenceClass: 'official-release',
      verificationState: 'source-published',
      publicationAllowed: true,
      requireRelevantTopic: true,
    })
    expect(europol.rights).toMatch(/feed metadata.*titles, links and source clocks only/i)

    const feed = `<rss><channel>
      <item><title>Europol supports operation against amphetamine producers</title><link>https://www.europol.europa.eu/news/amphetamine</link><description>Body details must not enter the public wire.</description></item>
      <item><title>Syrian migrant smugglers arrested in coordinated strike</title><link>https://www.europol.europa.eu/news/smuggling</link></item>
      <item><title>Museum heists turn violent: new cultural property theft report</title><link>https://www.europol.europa.eu/news/cultural-property</link></item>
      <item><title>Season four of the Europol podcast</title><link>https://www.europol.europa.eu/news/podcast</link></item>
    </channel></rss>`
    const artifact = await buildWire({
      config: { ...sourceConfig, sources: [europol] },
      fetchImpl: async () => new Response(feed, { headers: { 'content-type': 'application/rss+xml' } }),
      now: new Date('2026-08-31T12:00:00Z'),
    })

    const itemsByTitle = new Map(artifact.items.map((item) => [item.title, item]))
    expect([...itemsByTitle.keys()].sort()).toEqual([
      'Europol supports operation against amphetamine producers',
      'Museum heists turn violent: new cultural property theft report',
      'Syrian migrant smugglers arrested in coordinated strike',
    ])
    expect(itemsByTitle.get('Europol supports operation against amphetamine producers')?.topics).toEqual(['drug markets'])
    expect(itemsByTitle.get('Syrian migrant smugglers arrested in coordinated strike')?.topics).toEqual(['human smuggling'])
    expect(itemsByTitle.get('Museum heists turn violent: new cultural property theft report')?.topics).toEqual(['cultural property crime'])
    expect(artifact.items.every((item) => item.publishedAt === null && !('description' in item))).toBe(true)
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

  it('keeps one item per release when the http and https spellings of a link coexist', async () => {
    const sourceConfig = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'))
    const europol = sourceConfig.sources.find((source) => source.id === 'europol-news')
    const path = 'www.europol.europa.eu/media-press/newsroom/news/cannabis-smuggling-north-america-and-thailand-europe-europol-highlights-growing-threat'
    const title = 'Cannabis smuggling from North America and Thailand into Europe: Europol highlights growing threat'
    const prior = (id, scheme) => ({ id, title, url: `${scheme}://${path}`, sourceId: 'europol-news', sourceName: europol.name, publishedAt: null,
      retrievedAt: '2026-11-01T09:00:00.000Z', evidenceClass: 'official-release', verificationState: 'source-published', legalStage: 'not-applicable',
      topics: ['drug markets'], countries: [], publicationAllowed: true })
    // The live artifact of 2026-11-02 carried both copies under these two IDs.
    const previous = { items: [prior('europol-news-b5187494919d2c15ec82', 'http'), prior('europol-news-c9411b6786e13ddda652', 'https')],
      sources: [{ id: 'europol-news', lastSuccessAt: '2026-11-01T09:00:00.000Z' }] }
    const config = { ...sourceConfig, sources: [europol] }
    const now = new Date('2026-11-02T10:00:00Z')

    const feed = (...urls) => async () => new Response(`<rss><channel>${urls.map((url) => `<item><title>${title}</title><link>${url}</link></item>`).join('')}</channel></rss>`)
    for (const fetchImpl of [feed(`https://${path}`), feed(`http://${path}`), feed(`http://${path}`, `https://${path}`)]) {
      const artifact = await buildWire({ config, previous, now, fetchImpl })
      expect(artifact.items.map((item) => [item.id, item.url])).toEqual([['europol-news-c9411b6786e13ddda652', `https://${path}`]])
    }
    // A failed fetch republishes retained items once each, not twice.
    const failed = await buildWire({ config, previous, now, fetchImpl: async () => { throw new Error('offline') } })
    expect(failed.items.map((item) => item.id)).toEqual(['europol-news-c9411b6786e13ddda652'])
    // An item only ever seen over http keeps its address and its published ID.
    const httpOnly = await buildWire({ config, previous: { ...previous, items: [previous.items[0]] }, now, fetchImpl: async () => { throw new Error('offline') } })
    expect(httpOnly.items.map((item) => [item.id, item.url])).toEqual([['europol-news-b5187494919d2c15ec82', `http://${path}`]])
  })

  it('applies a reviewed per-source response bound to that source only', async () => {
    const reviewed = { ...config.sources[0], id: 'large', url: 'https://example.test/large.xml', maxResponseBytes: 512, maxResponseBytesReview: 'Measured 300 bytes.' }
    const ordinary = { ...config.sources[0], id: 'ordinary', url: 'https://example.test/ordinary.xml' }
    const body = `<rss><channel><item><title>Officials charge cocaine network</title><link>https://example.test/a</link></item></channel></rss>${' '.repeat(200)}`
    const artifact = await buildWire({ config: { ...config, maxResponseBytes: 256, sources: [reviewed, ordinary] }, now: new Date('2026-08-31T00:00:00Z'),
      fetchImpl: async () => new Response(body) })
    expect(body.length).toBeGreaterThan(256)
    expect(artifact.sources.map((source) => [source.id, source.status])).toEqual([['large', 'fresh'], ['ordinary', 'unavailable']])
    expect(artifact.sources[1].detail).toMatch(/256 byte ceiling/)

    for (const invalid of [{ maxResponseBytes: 512 }, { maxResponseBytes: 128, maxResponseBytesReview: 'smaller than shared' },
      { maxResponseBytes: SOURCE_RESPONSE_CEILING_BYTES + 1, maxResponseBytesReview: 'too large' }, { maxResponseBytesReview: 'no bound' }]) {
      await expect(buildWire({ config: { ...config, maxResponseBytes: 256, sources: [{ ...ordinary, ...invalid }] }, fetchImpl: async () => new Response(body) }))
        .rejects.toThrow(/invalid reviewed response bound/)
    }
  })

  it('raises only the Seiche money-markets bound in production, above its measured size', async () => {
    const sourceConfig = JSON.parse(await readFile(new URL('./sources.json', import.meta.url), 'utf8'))
    const reviewed = sourceConfig.sources.filter((source) => source.maxResponseBytes !== undefined)
    expect(reviewed.map((source) => source.id)).toEqual(['seiche-money-markets'])
    expect(sourceConfig.maxResponseBytes).toBe(2_097_152)
    expect(responseLimit(reviewed[0], sourceConfig)).toBe(4_194_304)
    expect(responseLimit(reviewed[0], sourceConfig)).toBeGreaterThan(2_186_234)
    expect(reviewed[0].maxResponseBytesReview).toMatch(/2,186,234 bytes/)
    for (const source of sourceConfig.sources.filter((row) => row.id !== 'seiche-money-markets')) expect(responseLimit(source, sourceConfig)).toBe(2_097_152)
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
