import { createHash } from 'node:crypto'

export const FEDERATION_TIMEOUT_MS = 15_000
export const FEDERATION_MAX_RESPONSE_BYTES = 2_000_000

const SEICHE_BASE_URL = 'https://api.seiche.info'
const PALIMPSEST_RIGHTS_URL = 'https://www.palimpsest.info/readings/china-publication-rights-latest.json'
const FEDERATION_LANES = new Set([
  'all',
  'palimpsest-bri',
  'palimpsest-newswire-rights',
  'seiche-capital-markets',
  'seiche-global-money-atlas',
  'seiche-money-markets',
  'seiche-summary',
])
const WORLD_SECTION_BY_LANE = Object.freeze({
  'seiche-summary': 'summary',
  'seiche-money-markets': 'money_markets',
  'seiche-capital-markets': 'capital_markets',
})
const CORE_WORLD_DOMAINS = Object.freeze(['money_markets', 'forex', 'capital_markets'])
const WORLD_CONTENT_KEYS = new Set([
  'summary', 'money_markets', 'forex', 'capital_markets', 'china_macro', 'sources', 'methodology',
])
const EVIDENCE_STATUSES = new Set(['derived', 'observed', 'restricted', 'structural', 'unavailable'])
const FORBIDDEN_JOIN_KEYS = new Set([
  'causal_score',
  'composite',
  'composite_score',
  'culpability',
  'culpability_score',
  'guilt',
  'guilt_score',
])

class UpstreamError extends Error {
  constructor(code, message, { httpStatus = null, retryAfter = null } = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.code = code
    this.httpStatus = httpStatus
    this.retryAfter = retryAfter
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function canonicalInstant(value) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
}

function canonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function expectedHttpsUrl(value, hosts, pathPrefix) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && hosts.includes(parsed.hostname)
      && (pathPrefix === undefined || parsed.pathname.startsWith(pathPrefix))
      && parsed.username === ''
      && parsed.password === ''
  } catch {
    return false
  }
}

function parseLane(value) {
  if (value === undefined || value === null) return 'all'
  const lane = String(value)
  if (!FEDERATION_LANES.has(lane)) {
    throw new TypeError(`lane must be one of: ${[...FEDERATION_LANES].sort().join(', ')}`)
  }
  return lane
}

function assertNoGeneratedJoinFields(value, label) {
  const stack = [value]
  while (stack.length) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    if (!isRecord(current)) continue
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_JOIN_KEYS.has(key.toLocaleLowerCase('en-US'))) {
        throw new Error(`${label} contains a prohibited causal, composite, or culpability field`)
      }
      stack.push(child)
    }
  }
}

async function readLimitedBody(response, maxResponseBytes, signal) {
  const contentLength = response.headers?.get?.('content-length')
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      throw new UpstreamError('invalid_content_length', 'upstream returned an invalid Content-Length')
    }
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared > maxResponseBytes) {
      throw new UpstreamError('response_too_large', `upstream response exceeded ${maxResponseBytes} bytes`)
    }
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    const cancelReader = () => {
      try {
        const cancellation = reader.cancel('response deadline exceeded')
        cancellation?.catch?.(() => {})
      } catch {
        // The outer deadline remains authoritative even if a custom reader cannot be cancelled.
      }
    }
    if (signal?.aborted) cancelReader()
    else signal?.addEventListener?.('abort', cancelReader, { once: true })
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxResponseBytes) {
          await reader.cancel('response byte limit exceeded')
          throw new UpstreamError('response_too_large', `upstream response exceeded ${maxResponseBytes} bytes`)
        }
        chunks.push(value)
      }
    } finally {
      signal?.removeEventListener?.('abort', cancelReader)
      reader.releaseLock()
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }

  if (typeof response.arrayBuffer !== 'function') {
    throw new UpstreamError('unreadable_response', 'upstream returned no readable response body')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxResponseBytes) {
    throw new UpstreamError('response_too_large', `upstream response exceeded ${maxResponseBytes} bytes`)
  }
  return bytes
}

export async function fetchBoundedJson(url, {
  fetchImpl = globalThis.fetch,
  maxResponseBytes = FEDERATION_MAX_RESPONSE_BYTES,
  timeoutMs = FEDERATION_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is unavailable')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be positive')
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new TypeError('maxResponseBytes must be positive')
  }
  const controller = new AbortController()
  let timer
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new UpstreamError('upstream_timeout', `upstream did not respond within ${timeoutMs}ms`))
    }, timeoutMs)
  })
  const request = async () => {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'narcoscope-federation/1.0 (+https://narcoscope.com/developers/)',
      },
      redirect: 'error',
      signal: controller.signal,
    })
    const contentType = response.headers?.get?.('content-type')
    if (contentType && !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
      throw new UpstreamError('invalid_content_type', 'upstream did not return JSON', {
        httpStatus: response.status,
        retryAfter: response.headers?.get?.('retry-after') ?? null,
      })
    }
    const bytes = await readLimitedBody(response, maxResponseBytes, controller.signal)
    let payload
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      payload = JSON.parse(text)
    } catch {
      throw new UpstreamError('invalid_upstream_json', 'upstream returned invalid UTF-8 JSON', {
        httpStatus: response.status,
        retryAfter: response.headers?.get?.('retry-after') ?? null,
      })
    }
    const httpStatus = Number(response.status)
    const retryAfter = response.headers?.get?.('retry-after') ?? null
    if (!(httpStatus >= 200 && httpStatus < 300) && httpStatus !== 503) {
      throw new UpstreamError('upstream_http_error', `upstream returned HTTP ${httpStatus}`, {
        httpStatus,
        retryAfter,
      })
    }
    return {
      bytes: bytes.byteLength,
      httpStatus,
      payload,
      retryAfter,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
  try {
    return await Promise.race([request(), timedOut])
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    const code = error?.name === 'AbortError' ? 'upstream_timeout' : 'upstream_unreachable'
    throw new UpstreamError(code, code === 'upstream_timeout'
      ? `upstream did not respond within ${timeoutMs}ms`
      : 'upstream request failed')
  } finally {
    clearTimeout(timer)
  }
}

function validateWorldClockContract(payload, section) {
  const clocks = payload.clocks
  const citation = payload.citation
  if (!isRecord(clocks) || !nonEmpty(clocks.boundary)) throw new Error('world-markets clock boundary is missing')
  if (
    !isRecord(citation)
    || !nonEmpty(citation.publisher)
    || !nonEmpty(citation.canonical_url)
    || !expectedHttpsUrl(citation.canonical_url, ['seiche.info', 'www.seiche.info'])
    || !expectedHttpsUrl(citation.topic_url, ['seiche.info', 'www.seiche.info'])
    || !expectedHttpsUrl(citation.api_url, ['api.seiche.info'], '/api/v2/world-markets')
  ) {
    throw new Error('world-markets citation is missing')
  }
  const domains = clocks.domains
  if (
    !isRecord(domains)
    || Object.keys(domains).length !== CORE_WORLD_DOMAINS.length
    || !CORE_WORLD_DOMAINS.every((domain) => Object.hasOwn(domains, domain))
    || Object.values(domains).some((clock) => clock !== null && typeof clock !== 'string')
  ) throw new Error('world-markets domain clocks are invalid')
  const required = [
    [payload, 'generated_at'],
    [payload, 'as_of'],
    [clocks, 'snapshot_generated_at'],
    [clocks, 'evaluation_at'],
    [clocks, 'latest_domain_as_of'],
    [clocks, 'selected_evidence_as_of'],
    [citation, 'generated_at'],
    [citation, 'evidence_as_of'],
  ]
  if (required.some(([object, key]) => !Object.hasOwn(object, key))) {
    throw new Error('world-markets required clocks are missing')
  }
  if (
    !Array.isArray(clocks.excluded_from_observation_clocks)
    || clocks.excluded_from_observation_clocks.length !== 1
    || clocks.excluded_from_observation_clocks[0] !== 'china_macro.knowledge_time'
  ) throw new Error('world-markets knowledge-clock exclusion is missing')
  const unavailable = payload.status === 'unavailable'
  const dateTimes = [
    payload.generated_at,
    clocks.snapshot_generated_at,
    clocks.evaluation_at,
    citation.generated_at,
  ]
  if (dateTimes.some((clock) => clock !== null && !canonicalInstant(clock))) {
    throw new Error('world-markets generation or evaluation clock is not a canonical ISO instant')
  }
  if (!unavailable && dateTimes.some((clock) => clock === null)) {
    throw new Error('available world-markets evidence is missing a generation or evaluation clock')
  }
  const nonNull = Object.values(domains).filter((clock) => clock !== null)
  if (nonNull.some((clock) => !canonicalDate(clock))) {
    throw new Error('world-markets domain clock is not a canonical ISO date')
  }
  const latest = nonNull.length ? nonNull.reduce((left, right) => (left > right ? left : right)) : null
  const selected = CORE_WORLD_DOMAINS.includes(section) ? domains[section] : latest
  if (
    (payload.as_of !== null && !canonicalDate(payload.as_of))
    || (citation.evidence_as_of !== null && !canonicalDate(citation.evidence_as_of))
  ) throw new Error('world-markets selected evidence clock is not a canonical ISO date')
  if (
    clocks.latest_domain_as_of !== latest
    || clocks.selected_evidence_as_of !== selected
    || payload.as_of !== selected
    || citation.evidence_as_of !== selected
    || clocks.snapshot_generated_at !== payload.generated_at
    || citation.generated_at !== payload.generated_at
  ) throw new Error('world-markets clocks are inconsistent')
}

export function validateWorldMarkets(payload, section) {
  if (!isRecord(payload)) throw new Error('world-markets response must be an object')
  if (
    payload.schema !== 'seiche.world-markets.v1'
    || payload.selection !== section
    || typeof payload.ok !== 'boolean'
    || !EVIDENCE_STATUSES.has(payload.status)
    || payload.context_only !== true
  ) throw new Error('world-markets identity, selection, status, or scope is invalid')
  if (
    !isRecord(payload.scope)
    || payload.scope.coverage_claim !== 'curated_partial_non_exhaustive'
    || !Array.isArray(payload.scope.included)
    || !Array.isArray(payload.scope.not_claimed)
  ) throw new Error('world-markets partial-coverage boundary is missing')
  const present = Object.keys(payload).filter((key) => WORLD_CONTENT_KEYS.has(key))
  if (present.length !== 1 || present[0] !== section || !isRecord(payload[section])) {
    throw new Error('world-markets response content does not match the requested section')
  }
  if (payload[section].status !== payload.status && section !== 'summary') {
    throw new Error('world-markets section status is inconsistent')
  }
  validateWorldClockContract(payload, section)
  assertNoGeneratedJoinFields(payload, 'Seiche world-markets response')
  return payload
}

export function validateGlobalMoneyAtlas(payload) {
  if (!isRecord(payload)) throw new Error('global money atlas response must be an object')
  if (
    payload.schema !== 'seiche.global-money-markets.v1'
    || typeof payload.ok !== 'boolean'
    || !['PARTIAL', 'READY', 'UNAVAILABLE'].includes(payload.status)
    || !canonicalInstant(payload.generated_at)
    || !isRecord(payload.coverage)
    || !Array.isArray(payload.markets)
    || !Array.isArray(payload.expansion_ledger)
    || !isRecord(payload.expansion_scope)
    || !isRecord(payload.methodology)
    || !nonEmpty(payload.methodology.publication_boundary)
    || !nonEmpty(payload.methodology.role)
    || !Array.isArray(payload.caveats)
    || !payload.caveats.every(nonEmpty)
    || !Array.isArray(payload.read_faults)
  ) throw new Error('global money atlas schema, status, clock, scope, or caveat contract is invalid')
  if (
    !Number.isSafeInteger(payload.coverage.declared_markets)
    || payload.coverage.declared_markets < 0
    || payload.coverage.declared_markets !== payload.markets.length
  ) throw new Error('global money atlas coverage is inconsistent')
  assertNoGeneratedJoinFields(payload, 'Seiche global money atlas response')
  return payload
}

function laneError(id, product, sourceUrl, error, retrievedAt) {
  const safe = error instanceof UpstreamError ? error : new UpstreamError(
    'invalid_upstream_contract',
    'upstream response violated its public contract',
  )
  return {
    id,
    product,
    availability: 'unavailable',
    evidence_status: 'unavailable',
    upstream_schema: null,
    upstream_status: null,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    clocks: null,
    scope: null,
    citation: null,
    transport: id.startsWith('seiche-') ? {
      attempts: 1,
      timeout_ms: FEDERATION_TIMEOUT_MS,
      max_response_bytes: FEDERATION_MAX_RESPONSE_BYTES,
    } : null,
    data: null,
    error: {
      code: safe.code,
      message: safe.message,
      upstream_http_status: safe.httpStatus,
      retry_after: safe.retryAfter,
    },
    boundaries: [
      'Unavailable upstream evidence is not zero, calm, healthy, or proof of absence.',
      'This lane is not joined to any other product lane.',
    ],
  }
}

function worldUrl(section) {
  const url = new URL('/api/v2/world-markets', SEICHE_BASE_URL)
  url.searchParams.set('section', section)
  return url.toString()
}

async function seicheWorldLane(id, section, dependencies, retrievedAt) {
  const url = worldUrl(section)
  try {
    const response = await fetchBoundedJson(url, dependencies)
    const data = validateWorldMarkets(response.payload, section)
    const unavailable = response.httpStatus === 503 || data.status === 'unavailable'
    return {
      id,
      product: 'Seiche',
      availability: unavailable ? 'unavailable' : data.status === 'restricted' ? 'restricted' : 'available',
      evidence_status: data.status,
      upstream_schema: data.schema,
      upstream_status: data.status,
      source_url: url,
      retrieved_at: retrievedAt,
      clocks: data.clocks,
      scope: data.scope,
      citation: data.citation,
      transport: {
        attempts: 1,
        timeout_ms: dependencies.timeoutMs ?? FEDERATION_TIMEOUT_MS,
        max_response_bytes: dependencies.maxResponseBytes ?? FEDERATION_MAX_RESPONSE_BYTES,
      },
      data,
      error: unavailable ? {
        code: 'upstream_unavailable',
        message: 'Seiche returned a typed unavailable world-markets response.',
        upstream_http_status: response.httpStatus,
        retry_after: response.retryAfter,
      } : null,
      boundaries: [
        'Seiche market context remains separate from NarcoScope illicit-market evidence.',
        'Co-movement is not causality, and no security, execution, or investment recommendation is produced.',
      ],
    }
  } catch (error) {
    return laneError(id, 'Seiche', url, error, retrievedAt)
  }
}

async function seicheAtlasLane(dependencies, retrievedAt) {
  const id = 'seiche-global-money-atlas'
  const url = `${SEICHE_BASE_URL}/api/v2/money-markets`
  try {
    const response = await fetchBoundedJson(url, dependencies)
    const data = validateGlobalMoneyAtlas(response.payload)
    const unavailable = response.httpStatus === 503 || data.status === 'UNAVAILABLE'
    return {
      id,
      product: 'Seiche',
      availability: unavailable ? 'unavailable' : 'available',
      evidence_status: unavailable ? 'unavailable' : 'derived',
      upstream_schema: data.schema,
      upstream_status: data.status,
      source_url: url,
      retrieved_at: retrievedAt,
      clocks: {
        generated_at: data.generated_at,
        retrieved_at: retrievedAt,
        note: 'The global atlas has a generation clock, not the world-markets multi-domain clock block.',
      },
      scope: {
        expansion_scope: data.expansion_scope,
        publication_boundary: data.methodology.publication_boundary,
        role: data.methodology.role,
      },
      citation: {
        publisher: 'Seiche',
        canonical_url: 'https://seiche.info/money-markets/',
        api_url: url,
        generated_at: data.generated_at,
        wrapper_supplied: true,
      },
      transport: {
        attempts: 1,
        timeout_ms: dependencies.timeoutMs ?? FEDERATION_TIMEOUT_MS,
        max_response_bytes: dependencies.maxResponseBytes ?? FEDERATION_MAX_RESPONSE_BYTES,
      },
      data,
      error: unavailable ? {
        code: 'upstream_unavailable',
        message: 'Seiche returned a typed unavailable global money atlas response.',
        upstream_http_status: response.httpStatus,
        retry_after: response.retryAfter,
      } : null,
      boundaries: [
        'The atlas compares each monetary area with its own history and does not create a cross-market stress score.',
        'Discovery candidates are metadata, not live coverage or delivery commitments.',
        'This lane is not joined to NarcoScope illicit-market records.',
      ],
    }
  } catch (error) {
    return laneError(id, 'Seiche', url, error, retrievedAt)
  }
}

function palimpsestBriLane(envelope, retrievedAt) {
  assertNoGeneratedJoinFields(envelope, 'Palimpsest BRI context')
  return {
    id: 'palimpsest-bri',
    product: 'Palimpsest',
    availability: 'available',
    evidence_status: 'structural',
    upstream_schema: envelope.schema,
    upstream_status: envelope.data?.provenance?.release?.verificationState ?? null,
    source_url: envelope.links.canonical,
    retrieved_at: retrievedAt,
    clocks: {
      data_as_of: envelope.data.dataAsOf,
      release_verified_at: envelope.data.provenance.release.verifiedAt,
      pages_verified_at: envelope.data.provenance.release.pagesPublication.verifiedAt,
      pages_fresh_until: envelope.data.provenance.release.pagesPublication.freshUntil,
      retrieved_at: retrievedAt,
    },
    scope: {
      description: envelope.data.scope,
      use_policy: envelope.data.usePolicy,
    },
    citation: {
      publisher: envelope.data.provenance.producer,
      canonical_url: envelope.links.canonical,
      schema_url: envelope.links.schema,
      sha256_url: envelope.links.sha256,
    },
    transport: null,
    data: envelope,
    error: null,
    boundaries: [
      envelope.interpretation,
      'This is a pinned release receipt, not continuous proof of Palimpsest availability or freshness.',
      'Belt and Road context never enters a drug-market, actor, route, guilt, political, project, tactical, or causal inference.',
    ],
  }
}

function palimpsestRightsLane(envelope, retrievedAt) {
  const release = envelope.data?.provenance?.release
  const semantics = release?.verificationSemantics
  const match = typeof semantics === 'string'
    ? /Exact published rights-status bytes are ([^ ]+) \((\d+) bytes, SHA-256 ([0-9a-f]{64})\)\./u.exec(semantics)
    : null
  if (
    !release
    || release.verificationState !== 'release_receipt_validated'
    || !canonicalInstant(release.verifiedAt)
    || !match
  ) throw new Error('pinned Palimpsest release does not contain a verified newswire restriction receipt')
  const [, path, bytes, digest] = match
  const data = {
    schema: 'narcoscope.federation.palimpsest-newswire-rights.v1',
    status: 'rights_suppressed',
    availability: 'unavailable',
    evidence_class: 'restricted',
    publication_allowed: false,
    verified_at: release.verifiedAt,
    verification_state: release.verificationState,
    source_revision: release.sourceRevision,
    receipt_sha256: release.receiptSha256,
    status_artifact: {
      url: new URL(path, `${release.canonicalBaseUrl}/`).toString(),
      bytes: Number(bytes),
      sha256: digest,
    },
    freshness: 'verified_at_pinned_release_not_continuous_monitoring',
    limitations: [
      'This projects the exact restriction receipt pinned into the verified BRI artifact; it does not refetch or republish the multi-megabyte quarantine-path list.',
      'The verified clock is historical and does not prove current Palimpsest production availability or freshness.',
      'Restricted or unavailable evidence is not zero, calm, healthy, or a directional signal.',
      'No restricted newswire values, article bodies, actor details, or tactical locations are present.',
    ],
  }
  return {
    id: 'palimpsest-newswire-rights',
    product: 'Palimpsest',
    availability: 'restricted',
    evidence_status: 'restricted',
    upstream_schema: data.schema,
    upstream_status: data.status,
    source_url: data.status_artifact.url,
    retrieved_at: retrievedAt,
    clocks: {
      verified_at: data.verified_at,
      retrieved_at: retrievedAt,
      freshness: data.freshness,
    },
    scope: {
      publication_allowed: false,
      evidence_class: 'restricted',
      projection: 'pinned_receipt_metadata_only',
    },
    citation: {
      publisher: 'Palimpsest',
      canonical_url: data.status_artifact.url,
      sha256: data.status_artifact.sha256,
      verified_at: data.verified_at,
    },
    transport: null,
    data,
    error: null,
    boundaries: data.limitations,
  }
}

function localLaneError(id, error, retrievedAt) {
  return laneError(
    id,
    'Palimpsest',
    id === 'palimpsest-bri'
      ? 'https://narcoscope.com/data/narcoscope-palimpsest-bri-v1.json'
      : PALIMPSEST_RIGHTS_URL,
    new UpstreamError('pinned_artifact_unavailable', 'verified Palimpsest context is unavailable'),
    retrievedAt,
  )
}

function requestedLanes(lane) {
  return lane === 'all'
    ? [
      'seiche-summary',
      'seiche-money-markets',
      'seiche-capital-markets',
      'seiche-global-money-atlas',
      'palimpsest-bri',
      'palimpsest-newswire-rights',
    ]
    : [lane]
}

export async function getFederation(params = {}, {
  fetchImpl = globalThis.fetch,
  getBriContext,
  maxResponseBytes = FEDERATION_MAX_RESPONSE_BYTES,
  now = () => new Date(),
  timeoutMs = FEDERATION_TIMEOUT_MS,
} = {}) {
  const lane = parseLane(params.lane)
  const retrievedAt = now().toISOString()
  const dependencies = { fetchImpl, maxResponseBytes, timeoutMs }
  const requested = requestedLanes(lane)
  let briPromise
  const loadBri = () => {
    if (!briPromise) {
      briPromise = typeof getBriContext === 'function'
        ? Promise.resolve().then(() => getBriContext())
        : Promise.reject(new Error('Palimpsest BRI verifier is unavailable'))
    }
    return briPromise
  }
  const lanes = await Promise.all(requested.map(async (id) => {
    if (Object.hasOwn(WORLD_SECTION_BY_LANE, id)) {
      return seicheWorldLane(id, WORLD_SECTION_BY_LANE[id], dependencies, retrievedAt)
    }
    if (id === 'seiche-global-money-atlas') return seicheAtlasLane(dependencies, retrievedAt)
    if (id === 'palimpsest-bri') {
      try {
        return palimpsestBriLane(await loadBri(), retrievedAt)
      } catch (error) {
        return localLaneError(id, error, retrievedAt)
      }
    }
    try {
      return palimpsestRightsLane(await loadBri(), retrievedAt)
    } catch (error) {
      return localLaneError(id, error, retrievedAt)
    }
  }))
  const successful = lanes.filter((item) => item.error === null).length
  const status = successful === 0 ? 'unavailable' : successful === lanes.length ? 'available' : 'partial'
  const output = {
    schema: 'narcoscope.api.federation.v1',
    status,
    retrieved_at: retrievedAt,
    query: { lane },
    lanes,
    policy: {
      mode: 'read_only_parallel_context',
      cross_lane_join: 'prohibited',
      composite_generation: 'prohibited',
      causal_inference: 'prohibited',
      culpability_inference: 'prohibited',
      missing_value_policy: 'unavailable_not_zero',
    },
    limitations: [
      'Each product retains its own status, source, scope, rights, event or observation clock, publication clock, and retrieval clock.',
      'NarcoScope does not average, rank, or merge Seiche and Palimpsest values into a shared score.',
      'Cross-product co-movement is research context only and does not establish causality, culpability, a trafficking route, or an actor relationship.',
      'No fetch triggers upstream collection, refresh, recomputation, authentication, or retries.',
    ],
  }
  assertNoGeneratedJoinFields(output, 'NarcoScope federation response')
  return output
}

export const __test = Object.freeze({
  assertNoGeneratedJoinFields,
  parseLane,
  validateGlobalMoneyAtlas,
  validateWorldMarkets,
})
