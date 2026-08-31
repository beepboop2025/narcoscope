#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const defaultConfigPath = path.join(scriptDir, 'sources.json')
const defaultOutputPath = path.join(repoRoot, 'public/data/evidence-wire-v1.json')
const legalStages = new Set(['designation', 'charge', 'conviction', 'sentencing', 'settlement', 'report', 'not-applicable'])
const wireStatuses = new Set(['fresh', 'aging', 'stale', 'partial', 'restricted', 'unavailable'])

function text(value) {
  return String(value ?? '').replaceAll('\u0000', '').trim()
}

function decodeEntities(value) {
  return text(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function stripMarkup(value) {
  return decodeEntities(text(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function element(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return match ? stripMarkup(match[1]) : ''
}

function absoluteUrl(value, base) {
  try {
    const url = new URL(decodeEntities(value), base)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function isoClock(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function stableId(sourceId, url) {
  return `${sourceId}-${createHash('sha256').update(url).digest('hex').slice(0, 20)}`
}

export function legalStageFor(title) {
  const normalized = text(title).toLocaleLowerCase()
  if (/\b(sanctions?|designates?|designated|targets? .* network)\b/.test(normalized)) return 'designation'
  if (/\b(sentenced|sentencing)\b/.test(normalized)) return 'sentencing'
  if (/\b(convicts?|convicted|conviction|pleads? guilty|pleaded guilty|admits? role)\b/.test(normalized)) return 'conviction'
  if (/\b(charged|charges?|indicted|indictment|complaint alleges|arrested)\b/.test(normalized)) return 'charge'
  if (/\b(settlement|settles?|resolves allegations|agrees? to pay)\b/.test(normalized)) return 'settlement'
  return 'report'
}

export function parseRss(xml, baseUrl) {
  const blocks = [...text(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2])
  return blocks.map((block) => {
    const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
    const rawUrl = href || element(block, 'link') || element(block, 'guid') || element(block, 'id')
    const url = absoluteUrl(rawUrl, baseUrl)
    const title = element(block, 'title')
    const publishedAt = isoClock(element(block, 'pubDate') || element(block, 'published') || element(block, 'updated'))
    return url && title ? { title, url, publishedAt } : null
  }).filter(Boolean)
}

export function parseTreasuryPress(html, baseUrl) {
  const results = []
  const pattern = /<h[23][^>]*>\s*<a\s+href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>\s*<\/h[23]>([\s\S]{0,700}?)<time\s+datetime=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi
  for (const match of text(html).matchAll(pattern)) {
    const rawUrl = match[1] || match[2] || match[3]
    if (!rawUrl?.includes('/news/press-releases/')) continue
    const url = absoluteUrl(rawUrl, baseUrl)
    const title = stripMarkup(match[4])
    const publishedAt = isoClock(match[6] || match[7] || match[8])
    if (url && title && !/^(press releases|statements|readouts|testimonies)$/i.test(title)) results.push({ title, url, publishedAt })
  }
  return results
}

async function readBoundedBody(response, maximumBytes) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error(`response exceeds ${maximumBytes} byte ceiling`)
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new Error(`response exceeds ${maximumBytes} byte ceiling`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

async function fetchOnce(source, config, fetchImpl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${config.timeoutMs}ms`)), config.timeoutMs)
  try {
    const response = await fetchImpl(source.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: source.kind === 'status-json' ? 'application/json' : 'application/rss+xml, application/xml, text/html;q=0.8',
        'user-agent': 'NarcoScopeEvidenceBot/1.0 (+https://narcoscope.com)',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await readBoundedBody(response, config.maxResponseBytes)
    return { body, finalUrl: response.url || source.url }
  } finally {
    clearTimeout(timeout)
  }
}

function topicRules(config) {
  return config.topicRules.map((rule) => ({ topic: rule.topic, regex: new RegExp(rule.pattern, 'i') }))
}

function topicsFor(title, compiledRules) {
  return compiledRules.filter((rule) => rule.regex.test(title)).map((rule) => rule.topic)
}

function normalizeItems(source, parsed, retrievedAt, config) {
  const rules = topicRules(config)
  const seen = new Set()
  return parsed.flatMap((record) => {
    if (seen.has(record.url)) return []
    seen.add(record.url)
    const topics = topicsFor(record.title, rules)
    if (source.requireRelevantTopic && topics.length === 0) return []
    return [{
      id: stableId(source.id, record.url),
      title: record.title.slice(0, 320),
      url: record.url,
      sourceId: source.id,
      sourceName: source.name,
      publishedAt: record.publishedAt,
      retrievedAt,
      evidenceClass: source.evidenceClass,
      verificationState: source.verificationState,
      legalStage: source.evidenceClass === 'official-action' ? legalStageFor(record.title) : 'not-applicable',
      topics,
      countries: [],
      publicationAllowed: source.publicationAllowed === true,
    }]
  }).slice(0, config.maxItemsPerSource)
}

function statusDetail(payload, source) {
  const status = text(payload?.status || payload?.master_status || payload?.availability?.status || 'available').toLocaleLowerCase()
  const schema = text(payload?.schema || payload?.schema_version || payload?.artifact?.schema || 'schema not declared')
  const generatedAt = isoClock(payload?.generated_at || payload?.generatedAt || payload?.clocks?.generated_at)
  const allowed = payload?.publication_allowed ?? payload?.publicationAllowed
  const reason = text(payload?.reason || payload?.limitations?.[0] || '')
  return {
    status,
    detail: [schema, generatedAt ? `generated ${generatedAt}` : '', allowed === false ? 'publication suppressed by upstream rights policy' : '', reason].filter(Boolean).join(' · ').slice(0, 500),
  }
}

function statusForSuccess(source, retrievedAt, parsedItems, detail) {
  if (source.kind === 'status-json') {
    if (detail.status === 'restricted' || source.expectedStatus === 'restricted') return 'restricted'
    if (detail.status === 'partial') return 'partial'
  }
  return 'fresh'
}

function previousItems(previous, sourceId) {
  return Array.isArray(previous?.items) ? previous.items.filter((item) => item.sourceId === sourceId) : []
}

function previousSource(previous, sourceId) {
  return Array.isArray(previous?.sources) ? previous.sources.find((source) => source.id === sourceId) : null
}

function retainedItems(items, now, retentionDays) {
  const cutoff = now.getTime() - retentionDays * 86_400_000
  return items.filter((item) => {
    const clock = new Date(item.publishedAt || item.retrievedAt).getTime()
    return Number.isFinite(clock) && clock >= cutoff
  })
}

function statusForFailure(source, oldReceipt, now) {
  const lastSuccess = new Date(oldReceipt?.lastSuccessAt ?? '').getTime()
  if (!Number.isFinite(lastSuccess)) return 'unavailable'
  const staleAfterMinutes = Number(source.staleAfterMinutes)
  if (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) return 'stale'
  return now.getTime() - lastSuccess <= staleAfterMinutes * 60_000 ? 'aging' : 'stale'
}

export async function buildWire({ config, previous = null, now = new Date(), fetchImpl = fetch }) {
  const generatedAt = now.toISOString()
  const collected = await Promise.all(config.sources.map(async (source) => {
    try {
      const { body, finalUrl } = await fetchOnce(source, config, fetchImpl)
      if (source.kind === 'status-json') {
        const payload = JSON.parse(body)
        const detail = statusDetail(payload, source)
        return {
          items: [],
          receipt: {
            id: source.id,
            name: source.name,
            url: finalUrl,
            status: statusForSuccess(source, generatedAt, [], detail),
            checkedAt: generatedAt,
            lastSuccessAt: generatedAt,
            cadenceMinutes: source.cadenceMinutes,
            staleAfterMinutes: source.staleAfterMinutes ?? null,
            rights: source.rights,
            detail: detail.detail,
          },
        }
      }
      const parsed = source.kind === 'treasury-html' ? parseTreasuryPress(body, finalUrl) : parseRss(body, finalUrl)
      const items = normalizeItems(source, parsed, generatedAt, config)
      return {
        items,
        receipt: {
          id: source.id,
          name: source.name,
          url: finalUrl,
          status: statusForSuccess(source, generatedAt, items, {}),
          checkedAt: generatedAt,
          lastSuccessAt: generatedAt,
          cadenceMinutes: source.cadenceMinutes,
          staleAfterMinutes: source.staleAfterMinutes ?? null,
          rights: source.rights,
          detail: `${parsed.length} source items read · ${items.length} in-scope metadata items published`,
        },
      }
    } catch (error) {
      const oldReceipt = previousSource(previous, source.id)
      const oldItems = retainedItems(previousItems(previous, source.id), now, config.retentionDays)
      return {
        items: oldItems,
        receipt: {
          id: source.id,
          name: source.name,
          url: source.url,
          status: statusForFailure(source, oldReceipt, now),
          checkedAt: generatedAt,
          lastSuccessAt: oldReceipt?.lastSuccessAt ?? null,
          cadenceMinutes: source.cadenceMinutes,
          staleAfterMinutes: source.staleAfterMinutes ?? null,
          rights: source.rights,
          detail: `Bounded fetch failed: ${text(error instanceof Error ? error.message : error).slice(0, 240)}`,
        },
      }
    }
  }))

  const items = collected.flatMap((entry) => entry.items)
    .filter((item) => item.publicationAllowed)
    .sort((a, b) => new Date(b.publishedAt || b.retrievedAt).getTime() - new Date(a.publishedAt || a.retrievedAt).getTime())
  const sources = collected.map((entry) => entry.receipt)
  const statuses = new Set(sources.map((source) => source.status))
  const status = statuses.has('unavailable') || statuses.has('stale') || statuses.has('restricted') || statuses.has('partial') ? 'partial' : statuses.has('aging') ? 'aging' : 'fresh'
  const publicationTimes = items.map((item) => item.publishedAt).filter(Boolean).sort()

  return {
    schema: 'narcoscope.evidence-wire.v1',
    generatedAt,
    status,
    window: { start: publicationTimes[0] ?? null, end: publicationTimes.at(-1) ?? null },
    items,
    sources,
    caveats: [
      'The wire contains publication-allowed metadata and links, not full articles or private upstream records.',
      'A source-published enforcement release records an official action; a charge or designation is not a conviction.',
      'News items are leads and do not overwrite validated country, entity or market datasets.',
      'After a bounded fetch failure, the last-good receipt remains aging only until that source\'s declared stale-after threshold; stale, unavailable and restricted remain visible states.',
    ],
  }
}

export function validateWire(payload) {
  if (payload?.schema !== 'narcoscope.evidence-wire.v1') throw new Error('unsupported wire schema')
  if (!isoClock(payload.generatedAt)) throw new Error('generatedAt must be an ISO clock')
  if (!wireStatuses.has(payload.status)) throw new Error('invalid wire status')
  if (!Array.isArray(payload.items) || !Array.isArray(payload.sources)) throw new Error('wire items and sources must be arrays')
  for (const item of payload.items) {
    if (!item.id || !item.title || !absoluteUrl(item.url, 'https://narcoscope.com')) throw new Error('wire item missing id, title or valid URL')
    if (item.publicationAllowed !== true) throw new Error('restricted item reached public artifact')
    if (!legalStages.has(item.legalStage)) throw new Error('wire item has invalid legal stage')
  }
  for (const source of payload.sources) {
    if (!wireStatuses.has(source.status)) throw new Error(`invalid source status for ${source.id}`)
    if (source.staleAfterMinutes !== null && (!Number.isFinite(source.staleAfterMinutes) || source.staleAfterMinutes <= 0)) {
      throw new Error(`invalid stale-after threshold for ${source.id}`)
    }
  }
  return payload
}

function semanticDetail(value) {
  return text(value).replace(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
    '<source-clock>',
  )
}

export function wireSemanticProjection(payload) {
  validateWire(payload)
  return {
    schema: payload.schema,
    status: payload.status,
    window: payload.window,
    items: payload.items.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary ?? null,
      url: item.url,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      evidenceClass: item.evidenceClass,
      verificationState: item.verificationState,
      legalStage: item.legalStage,
      topics: item.topics,
      countries: item.countries,
      publicationAllowed: item.publicationAllowed,
    })),
    sources: payload.sources.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      status: source.status,
      cadenceMinutes: source.cadenceMinutes,
      staleAfterMinutes: source.staleAfterMinutes,
      rights: source.rights,
      detail: semanticDetail(source.detail),
    })),
    caveats: payload.caveats,
  }
}

export function wiresSemanticallyEqual(left, right) {
  return JSON.stringify(wireSemanticProjection(left)) === JSON.stringify(wireSemanticProjection(right))
}

async function readJsonIfPresent(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function atomicWrite(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o644 })
  await rename(temporary, filePath)
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const outputIndex = process.argv.indexOf('--output')
  const configIndex = process.argv.indexOf('--config')
  const semanticEqualIndex = process.argv.indexOf('--semantic-equal')
  const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : defaultOutputPath)
  const configPath = path.resolve(configIndex >= 0 ? process.argv[configIndex + 1] : defaultConfigPath)
  const semanticEqualPath = semanticEqualIndex >= 0 ? process.argv[semanticEqualIndex + 1] : null
  if (semanticEqualIndex >= 0 && !semanticEqualPath) throw new Error('--semantic-equal requires a path')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  if (semanticEqualPath) {
    const [candidate, baseline] = await Promise.all([
      readFile(outputPath, 'utf8').then(JSON.parse),
      readFile(path.resolve(semanticEqualPath), 'utf8').then(JSON.parse),
    ])
    if (wiresSemanticallyEqual(candidate, baseline)) {
      console.log(`evidence wire semantically unchanged: ${outputPath}`)
      return
    }
    console.log(`evidence wire semantic change detected: ${outputPath}`)
    process.exitCode = 10
    return
  }
  if (checkOnly) {
    validateWire(JSON.parse(await readFile(outputPath, 'utf8')))
    const info = await stat(outputPath)
    console.log(`evidence wire valid: ${outputPath} (${info.size} bytes)`)
    return
  }
  const previous = await readJsonIfPresent(outputPath)
  const artifact = validateWire(await buildWire({ config, previous }))
  await atomicWrite(outputPath, artifact)
  console.log(`evidence wire: ${artifact.items.length} public items · ${artifact.status} · ${outputPath}`)
}

if (
  process.argv[1]
  && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
