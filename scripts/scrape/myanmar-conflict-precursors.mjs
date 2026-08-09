#!/usr/bin/env node
/**
 * Governed public-source scraper for Myanmar conflict / precursor-flow research.
 *
 * Adapted from the Palimpsest approach: public-read source manifest, host
 * allowlist, DNS/private-address refusal, redirect caps, byte caps, normalized
 * content fingerprints, simple item extraction, and CSV output. It never
 * executes fetched content and never infers drug-trade figures.
 */

import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_MIN_INTERVAL_MS = 1500
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 500
const USER_AGENT = 'DrugPriceObservatory/0.1 (public data preparation; aggregate research only)'
export const SOURCE_FOCUSES = Object.freeze(['conflict_events', 'precursor_flows', 'convergence'])

export class FetchError extends Error {}
export class BlockedAddressError extends FetchError {}
export class ResponseTooLargeError extends FetchError {}
export class TooManyRedirectsError extends FetchError {}

/**
 * Transient failures (network hiccups, 5xx, timeouts) are safe to retry with
 * backoff. Policy/security failures (blocked address, robots disallow, host
 * not allowlisted, 4xx) must never be retried — retrying those would just
 * repeat a request we have already decided is unsafe or invalid.
 */
export function isRetryableError(err) {
  if (err instanceof BlockedAddressError) return false
  if (!(err instanceof FetchError)) return false
  const message = String(err.message ?? '')
  if (/^http status 4\d\d/.test(message)) return false
  if (/robots\.txt disallows/.test(message)) return false
  if (/host is not in manifest allowlist/.test(message)) return false
  if (/scheme not allowed/.test(message)) return false
  return true
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultManifest = path.join(__dirname, 'myanmar-sources.json')

function parseArgs(argv) {
  const args = {
    manifest: defaultManifest,
    output: '',
    maxBytes: DEFAULT_MAX_BYTES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRedirects: DEFAULT_MAX_REDIRECTS,
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    respectRobots: true,
    cacheDir: '',
    auditLog: '',
    dedupeAgainst: '',
    pretty: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--manifest') args.manifest = argv[++i]
    else if (arg === '--out') args.output = argv[++i]
    else if (arg === '--max-bytes') args.maxBytes = Number(argv[++i])
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i])
    else if (arg === '--max-redirects') args.maxRedirects = Number(argv[++i])
    else if (arg === '--min-interval-ms') args.minIntervalMs = Number(argv[++i])
    else if (arg === '--max-retries') args.maxRetries = Number(argv[++i])
    else if (arg === '--retry-base-ms') args.retryBaseMs = Number(argv[++i])
    else if (arg === '--cache-dir') args.cacheDir = argv[++i]
    else if (arg === '--audit-log') args.auditLog = argv[++i]
    else if (arg === '--dedupe-against') args.dedupeAgainst = argv[++i]
    else if (arg === '--no-robots') args.respectRobots = false
    else if (arg === '--pretty') args.pretty = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage: npm run scrape:myanmar -- [options]

Options:
  --manifest <path>       Source manifest JSON (default: scripts/scrape/myanmar-sources.json)
  --out <path>            Write CSV to a file instead of stdout
  --max-bytes <number>    Response byte cap (default: ${DEFAULT_MAX_BYTES})
  --timeout-ms <number>   Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --max-redirects <n>     Redirect cap (default: ${DEFAULT_MAX_REDIRECTS})
  --min-interval-ms <n>   Minimum interval per host (default: ${DEFAULT_MIN_INTERVAL_MS})
  --max-retries <n>       Retries for transient (network/5xx) failures (default: ${DEFAULT_MAX_RETRIES})
  --retry-base-ms <n>     Exponential backoff base delay (default: ${DEFAULT_RETRY_BASE_MS})
  --cache-dir <path>      Reuse/write fetched source bodies by URL hash
  --audit-log <path>      Append JSONL audit events for every source
  --dedupe-against <path> Previous observation CSV; suppress already-seen item/keyword rows
  --no-robots             Disable robots.txt checks (off by default only for tests)
  --pretty                Print a human summary to stderr
`)
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase()
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  )
}

function isPublicIp(address) {
  const version = net.isIP(address)
  if (version === 4) return !isPrivateIpv4(address)
  if (version === 6) return !isPrivateIpv6(address)
  return false
}

async function validatePublicUrl(url, allowedHosts) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new FetchError(`scheme not allowed: ${parsed.protocol}`)
  }
  if (!allowedHosts.has(parsed.hostname)) {
    throw new FetchError(`host is not in manifest allowlist: ${parsed.hostname}`)
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true })
  if (addresses.length === 0) throw new FetchError(`no DNS addresses for ${parsed.hostname}`)
  const blocked = addresses.find((entry) => !isPublicIp(entry.address))
  if (blocked) {
    throw new BlockedAddressError(`${parsed.hostname} resolves to non-public address ${blocked.address}`)
  }
  return parsed
}

async function readCapped(body, maxBytes) {
  if (!body) return ''
  const reader = body.getReader()
  const chunks = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      throw new ResponseTooLargeError(`body exceeds ${maxBytes} bytes`)
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf8')
}

export async function safeFetch(url, options = {}) {
  const {
    allowedHosts = new Set([new URL(url).hostname]),
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    respectRobots = true,
    robotsCache = new Map(),
  } = options

  let current = url
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = await validatePublicUrl(current, allowedHosts)
    if (respectRobots) {
      const allowed = await robotsCanFetch(parsed, allowedHosts, { maxBytes, timeoutMs, maxRedirects, robotsCache })
      if (!allowed) throw new FetchError(`robots.txt disallows ${parsed.pathname || '/'}`)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,text/plain,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
        },
      })
    } catch (err) {
      throw new FetchError(`fetch failed for ${current}: ${err.message}`)
    } finally {
      clearTimeout(timer)
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new FetchError(`redirect (${response.status}) without location`)
      current = new URL(location, current).toString()
      continue
    }
    if (response.status >= 400) throw new FetchError(`http status ${response.status}`)
    return readCapped(response.body, maxBytes)
  }

  throw new TooManyRedirectsError(`exceeded ${maxRedirects} redirects`)
}

export async function robotsCanFetch(parsedUrl, allowedHosts, options = {}) {
  const parsed = typeof parsedUrl === 'string' ? new URL(parsedUrl) : parsedUrl
  const {
    maxBytes = 128 * 1024,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    robotsCache = new Map(),
  } = options
  const origin = parsed.origin
  if (!robotsCache.has(origin)) {
    const robotsUrl = `${origin}/robots.txt`
    try {
      const body = await safeFetch(robotsUrl, {
        allowedHosts,
        maxBytes,
        timeoutMs,
        maxRedirects,
        respectRobots: false,
        robotsCache,
      })
      robotsCache.set(origin, body)
    } catch (err) {
      robotsCache.set(origin, '')
    }
  }
  return robotsAllows(robotsCache.get(origin), parsed.pathname || '/', USER_AGENT)
}

export function robotsAllows(robotsText, pathname, userAgent = USER_AGENT) {
  const groups = []
  let currentAgents = []
  let currentRules = []

  const flush = () => {
    if (currentAgents.length > 0) {
      groups.push({ agents: currentAgents, rules: currentRules })
    }
    currentAgents = []
    currentRules = []
  }

  for (const raw of String(robotsText ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      if (currentRules.length > 0) flush()
      currentAgents.push(value.toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && currentAgents.length > 0) {
      currentRules.push({ type: key, path: value })
    }
  }
  flush()

  const ua = userAgent.toLowerCase()
  const applicable = groups.filter((group) =>
    group.agents.some((agent) => agent === '*' || ua.includes(agent)),
  )
  const rules = applicable.flatMap((group) => group.rules)
    .filter((rule) => rule.path && pathname.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length)

  if (rules.length === 0) return true
  return rules[0].type !== 'disallow'
}

export function normalizeBody(text) {
  return String(text ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\d{3,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000)
}

export function contentKey(...parts) {
  return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\x1f')).digest('hex')
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractItems(html, selector = {}) {
  const tag = selector.tag
  if (!tag) return []
  const className = selector.class
  const classLookahead = className
    ? `(?=[^>]*\\bclass=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'])`
    : ''
  const pattern = new RegExp(`<${escapeRegExp(tag)}\\b${classLookahead}[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tag)}>`, 'gi')
  return [...String(html ?? '').matchAll(pattern)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keywordObservations(source, normalizedText, observedAt, itemFp) {
  const lower = normalizedText.toLowerCase()
  return (source.keywords ?? []).flatMap((keyword) => {
    const needle = String(keyword).toLowerCase()
    const idx = lower.indexOf(needle)
    if (idx < 0) return []
    const start = Math.max(0, idx - 140)
    const end = Math.min(normalizedText.length, idx + needle.length + 180)
    return [{
      sourceId: source.id,
      sourceName: source.name,
      focus: source.focus,
      url: source.url,
      observedAt,
      contentSha256: contentKey(normalizedText),
      itemSha256: itemFp,
      keyword,
      excerpt: normalizedText.slice(start, end).trim(),
    }]
  })
}

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function observationsToCsv(rows) {
  const headers = [
    'sourceId',
    'sourceName',
    'focus',
    'url',
    'observedAt',
    'contentSha256',
    'itemSha256',
    'keyword',
    'excerpt',
  ]
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n')
}

export function validateManifest(manifest, file = '<manifest>') {
  const sources = manifest?.sources ?? []
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`manifest has no sources: ${file}`)
  }
  const ids = new Set()
  return sources.map((source, index) => {
    const prefix = `source[${index}]`
    if (!source || typeof source !== 'object') throw new Error(`${prefix} must be an object`)
    if (!source.id || !/^[a-z0-9][a-z0-9-]*$/.test(source.id)) {
      throw new Error(`${prefix}.id must be kebab-case`)
    }
    if (ids.has(source.id)) throw new Error(`duplicate source id: ${source.id}`)
    ids.add(source.id)
    if (!source.name || typeof source.name !== 'string') throw new Error(`${prefix}.name is required`)
    if (!SOURCE_FOCUSES.includes(source.focus)) {
      throw new Error(`${prefix}.focus must be one of: ${SOURCE_FOCUSES.join(', ')}`)
    }
    const url = new URL(source.url)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${prefix}.url must be http(s)`)
    if (!Array.isArray(source.keywords) || source.keywords.length === 0) {
      throw new Error(`${prefix}.keywords must be a non-empty array`)
    }
    return {
      ...source,
      keywords: source.keywords.map((keyword) => String(keyword)).filter(Boolean),
    }
  })
}

async function readManifest(file) {
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'))
  return validateManifest(manifest, file)
}

export async function scrapeSources(sources, options = {}) {
  const allowedHosts = new Set(sources.map((source) => new URL(source.url).hostname))
  const observedAt = new Date().toISOString()
  const rows = []
  const errors = []
  const robotsCache = new Map()
  const lastFetchByHost = new Map()
  const seenObservations = options.dedupeAgainst
    ? await loadObservationFingerprints(options.dedupeAgainst)
    : null
  let duplicatesSuppressed = 0

  for (const source of sources) {
    try {
      await emitAudit(options.auditLog, { event: 'source_start', sourceId: source.id, url: source.url, observedAt })
      await waitForHostBudget(source.url, lastFetchByHost, options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS)
      const html = await fetchWithRetry(source, {
        ...options,
        allowedHosts,
        robotsCache,
      })
      const items = extractItems(html, source.selector)
      const normalizedText = normalizeBody(items.length ? items.join('\n') : stripTags(html))
      const itemFp = items.length ? contentKey(...items.sort()) : ''
      let sourceRows = keywordObservations(source, normalizedText, observedAt, itemFp)

      if (seenObservations) {
        const before = sourceRows.length
        sourceRows = sourceRows.filter((row) => !seenObservations.has(observationFingerprint(row)))
        duplicatesSuppressed += before - sourceRows.length
      }

      rows.push(...sourceRows)
      await emitAudit(options.auditLog, {
        event: 'source_success',
        sourceId: source.id,
        url: source.url,
        observedAt,
        contentSha256: contentKey(normalizedText),
        keywordMatches: sourceRows.length,
      })
    } catch (err) {
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        url: source.url,
        error: err.message,
      })
      await emitAudit(options.auditLog, {
        event: 'source_error',
        sourceId: source.id,
        url: source.url,
        observedAt,
        error: err.message,
      })
    }
  }

  return { rows, errors, duplicatesSuppressed }
}

/**
 * Retries only transient (network/5xx/timeout) failures with exponential
 * backoff + jitter. Policy failures (blocked address, robots, allowlist) fail
 * immediately — see `isRetryableError`.
 */
async function fetchWithRetry(source, options) {
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES
  const retryBaseMs = Number.isFinite(options.retryBaseMs) ? options.retryBaseMs : DEFAULT_RETRY_BASE_MS
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchWithCache(source, options)
    } catch (err) {
      lastError = err
      if (attempt >= maxRetries || !isRetryableError(err)) throw err
      const backoff = retryBaseMs * 2 ** attempt
      const jitter = Math.random() * retryBaseMs
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter))
    }
  }

  throw lastError
}

/** Fingerprint used to recognize the same keyword observation across runs. */
function observationFingerprint(row) {
  return contentKey(row.sourceId, row.keyword, row.itemSha256 || row.contentSha256)
}

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

/** Loads fingerprints of previously emitted observations so repeat scrapes stay idempotent. */
export async function loadObservationFingerprints(csvPath) {
  const seen = new Set()
  let body
  try {
    body = await fs.readFile(csvPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return seen
    throw err
  }
  const lines = body.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return seen
  const headers = parseCsvLine(lines[0])
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']))
    seen.add(observationFingerprint(row))
  }
  return seen
}

async function waitForHostBudget(url, lastFetchByHost, minIntervalMs) {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) return
  const host = new URL(url).hostname
  const now = Date.now()
  const nextAllowed = (lastFetchByHost.get(host) ?? 0) + minIntervalMs
  const delay = Math.max(0, nextAllowed - now)
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  lastFetchByHost.set(host, Date.now())
}

async function fetchWithCache(source, options) {
  if (!options.cacheDir) {
    return safeFetch(source.url, options)
  }
  await fs.mkdir(options.cacheDir, { recursive: true })
  const cacheFile = path.join(options.cacheDir, `${source.id}-${contentKey(source.url).slice(0, 16)}.html`)
  try {
    return await fs.readFile(cacheFile, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const body = await safeFetch(source.url, options)
  await fs.writeFile(cacheFile, body, 'utf8')
  return body
}

async function emitAudit(auditLog, event) {
  if (!auditLog) return
  await fs.mkdir(path.dirname(auditLog), { recursive: true })
  const previousHash = await readLastAuditHash(auditLog)
  const record = buildAuditRecord(event, previousHash)
  await fs.appendFile(auditLog, `${JSON.stringify(record)}\n`, 'utf8')
}

export function buildAuditRecord(event, previousHash = '') {
  const payload = { ...event, auditAt: new Date().toISOString(), previousHash }
  return {
    ...payload,
    auditHash: contentKey(stableJson(payload)),
  }
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

async function readLastAuditHash(auditLog) {
  try {
    const body = await fs.readFile(auditLog, 'utf8')
    const last = body.trim().split(/\r?\n/).filter(Boolean).pop()
    if (!last) return ''
    const parsed = JSON.parse(last)
    return typeof parsed.auditHash === 'string' ? parsed.auditHash : ''
  } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sources = await readManifest(args.manifest)
  const { rows, errors, duplicatesSuppressed } = await scrapeSources(sources, args)
  const csv = observationsToCsv(rows)

  if (args.output) {
    await fs.mkdir(path.dirname(args.output), { recursive: true })
    await fs.writeFile(args.output, `${csv}\n`, 'utf8')
  } else {
    process.stdout.write(`${csv}\n`)
  }

  if (args.pretty) {
    process.stderr.write(`Scraped ${sources.length} source(s), matched ${rows.length} keyword observation(s).\n`)
    if (duplicatesSuppressed) {
      process.stderr.write(`Suppressed ${duplicatesSuppressed} duplicate observation(s) already seen in --dedupe-against.\n`)
    }
    for (const error of errors) {
      process.stderr.write(`WARN ${error.sourceId}: ${error.error}\n`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err.stack ?? err.message}\n`)
    process.exit(1)
  })
}
