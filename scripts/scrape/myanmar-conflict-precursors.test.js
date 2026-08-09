import { describe, it, assert } from 'vitest'
import {
  buildAuditRecord,
  contentKey,
  extractItems,
  isRetryableError,
  loadObservationFingerprints,
  normalizeBody,
  observationsToCsv,
  robotsAllows,
  SOURCE_FOCUSES,
  validateManifest,
  FetchError,
  BlockedAddressError,
} from './myanmar-conflict-precursors.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('myanmar conflict/precursor scraper helpers', () => {
  it('normalizes volatile page chrome before fingerprinting', () => {
    const a = normalizeBody('<main>Myanmar precursor report 123456</main>')
    const b = normalizeBody('<main>Myanmar   precursor report 999999</main>')

    assert.equal(a, b)
    assert.equal(contentKey(a), contentKey(b))
  })

  it('extracts repeated tag/class items like the Palimpsest item-set path', () => {
    const html = `
      <article class="card report">Shan conflict update</article>
      <article class="card report"><span>China precursor note</span></article>
      <article class="other">Ignore me</article>
    `

    assert.deepEqual(extractItems(html, { tag: 'article', class: 'report' }), [
      'Shan conflict update',
      'China precursor note',
    ])
  })

  it('escapes CSV fields with commas and quotes', () => {
    const csv = observationsToCsv([
      {
        sourceId: 's1',
        sourceName: 'Source, "quoted"',
        focus: 'conflict_events',
        url: 'https://example.org',
        observedAt: '2026-01-01T00:00:00.000Z',
        contentSha256: 'abc',
        itemSha256: '',
        keyword: 'Myanmar',
        excerpt: 'Myanmar, China',
      },
    ])

    assert.ok(csv.includes('"Source, ""quoted"""'))
    assert.ok(csv.includes('"Myanmar, China"'))
  })

  it('validates source manifests before any outbound fetch', () => {
    const sources = validateManifest({
      sources: [
        {
          id: 'unodc-test',
          name: 'UNODC Test',
          url: 'https://example.org/report',
          focus: 'precursor_flows',
          keywords: ['Myanmar'],
        },
      ],
    })

    assert.equal(sources.length, 1)
    assert.throws(
      () => validateManifest({ sources: [{ id: 'Bad ID', url: 'file:///tmp/x', keywords: [] }] }),
      /kebab-case/,
    )
  })

  it('accepts every semantically distinct focus in the default manifest', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('./myanmar-sources.json', import.meta.url), 'utf8'))
    const sources = validateManifest(manifest)

    assert.deepEqual([...new Set(sources.map((source) => source.focus))].sort(), [...SOURCE_FOCUSES].sort())
    assert.equal(sources.filter((source) => source.focus === 'convergence').length, 2)
    assert.throws(
      () => validateManifest({
        sources: [{
          id: 'unknown-focus',
          name: 'Unknown Focus',
          url: 'https://example.org',
          focus: 'financial_inference',
          keywords: ['Myanmar'],
        }],
      }),
      /must be one of/,
    )
  })

  it('honours robots.txt longest-match allow and disallow rules', () => {
    const robots = `
      User-agent: *
      Disallow: /private
      Allow: /private/public
    `

    assert.equal(robotsAllows(robots, '/private/report'), false)
    assert.equal(robotsAllows(robots, '/private/public/report'), true)
    assert.equal(robotsAllows(robots, '/public/report'), true)
  })

  it('builds hash-chained audit records for append-only provenance', () => {
    const first = buildAuditRecord({ event: 'source_start', sourceId: 's1' }, '')
    const second = buildAuditRecord({ event: 'source_success', sourceId: 's1' }, first.auditHash)

    assert.equal(second.previousHash, first.auditHash)
    assert.notEqual(first.auditHash, second.auditHash)
    assert.equal(first.auditHash, contentKey(JSON.stringify({
      auditAt: first.auditAt,
      event: 'source_start',
      previousHash: '',
      sourceId: 's1',
    })))
  })

  it('classifies transient network/5xx failures as retryable but never policy failures', () => {
    assert.equal(isRetryableError(new FetchError('fetch failed for https://x: getaddrinfo ENOTFOUND')), true)
    assert.equal(isRetryableError(new FetchError('http status 503')), true)
    assert.equal(isRetryableError(new FetchError('http status 404')), false)
    assert.equal(isRetryableError(new BlockedAddressError('host resolves to non-public address')), false)
    assert.equal(isRetryableError(new FetchError('robots.txt disallows /private')), false)
    assert.equal(isRetryableError(new FetchError('host is not in manifest allowlist: evil.example')), false)
    assert.equal(isRetryableError(new Error('not a fetch error')), false)
  })

  it('loads prior-run observation fingerprints from an existing CSV for cross-run dedupe', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'myanmar-scrape-test-'))
    const csvPath = path.join(dir, 'observations.csv')
    const csv = observationsToCsv([
      {
        sourceId: 's1',
        sourceName: 'Source One',
        focus: 'conflict_events',
        url: 'https://example.org',
        observedAt: '2026-01-01T00:00:00.000Z',
        contentSha256: 'abc',
        itemSha256: 'item-1',
        keyword: 'Myanmar',
        excerpt: 'Myanmar update',
      },
    ])
    await fs.writeFile(csvPath, `${csv}\n`, 'utf8')

    const seen = await loadObservationFingerprints(csvPath)
    assert.equal(seen.size, 1)

    const missing = await loadObservationFingerprints(path.join(dir, 'does-not-exist.csv'))
    assert.equal(missing.size, 0)

    await fs.rm(dir, { recursive: true, force: true })
  })
})
