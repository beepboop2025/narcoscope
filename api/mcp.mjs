import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import {
  capabilities,
  getNewsroom,
  getOverview,
  getPalimpsestBridge,
  getPalimpsestBriContext,
  getPalimpsestCorridors,
  getStory,
  SITE_URL,
} from './lib/narcoscope.mjs'
import { TOOL_OUTPUT_SCHEMAS } from './lib/mcp-output-schemas.mjs'
import { PALIMPSEST_BRI_OUTPUT_SCHEMA } from './lib/palimpsest-bri.mjs'

export const PROTOCOL_VERSION = '2026-07-28'
export const LEGACY_PROTOCOL_VERSION = '2025-06-18'
export const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2025-03-26',
  LEGACY_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
])
export const SERVER_VERSION = '1.3.0'
const MAX_BODY_BYTES = 256 * 1024
const DISCOVERY_TTL_MS = 5 * 60 * 1000
const PUBLIC_CACHE_SCOPE = 'public'
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion'
const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo'
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities'
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo'
const API_CATALOG_URL = `${SITE_URL}/.well-known/api-catalog`
const ALLOWED_ORIGINS = new Set([
  SITE_URL,
  'https://narcoscope.com',
  'https://www.narcoscope.com',
  'https://drug-price-observatory.vercel.app',
])

export const TOOLS = Object.freeze({
  list_capabilities: {
    title: 'Discover NarcoScope',
    description: 'List the evidence explorer, newsroom, API, feeds, MCP tools, audiences, and safety boundaries.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: TOOL_OUTPUT_SCHEMAS.list_capabilities,
    call: async () => capabilities(),
  },
  get_overview: {
    title: 'Read the official-data overview',
    description: 'Return bounded headline aggregates across official prices, seizures, overdose mortality, wastewater, and public designations.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: TOOL_OUTPUT_SCHEMAS.get_overview,
    call: async () => getOverview(),
  },
  get_newsroom: {
    title: 'Read the evidence newsroom',
    description: 'List current deterministic analyses with citations, correction metadata, publication gates, and explicit evidence limits.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } },
      additionalProperties: false,
    },
    outputSchema: TOOL_OUTPUT_SCHEMAS.get_newsroom,
    call: getNewsroom,
  },
  get_story: {
    title: 'Read a newsroom story artifact',
    description: 'Fetch one story as metadata, a machine brief, or the cited dossier. Use the machine brief first for agent workflows.',
    inputSchema: {
      type: 'object',
      required: ['slug'],
      properties: {
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        artifact: { type: 'string', enum: ['metadata', 'machine-brief', 'dossier'], default: 'machine-brief' },
      },
      additionalProperties: false,
    },
    outputSchema: TOOL_OUTPUT_SCHEMAS.get_story,
    call: getStory,
  },
  get_palimpsest_bridge: {
    title: 'Read the Palimpsest bridge',
    description: 'Return the official-only China aggregate shared with the Intelligence Commons, including disclosure and causal boundaries.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: TOOL_OUTPUT_SCHEMAS.get_palimpsest_bridge,
    call: async () => getPalimpsestBridge(),
  },
  get_palimpsest_corridors: {
    title: 'Read the Palimpsest corridor overlay',
    description: 'Return official country-level China, Pakistan, and Myanmar aggregates with missing-data, provenance, disclosure, and geography-and-time-only join rules.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: TOOL_OUTPUT_SCHEMAS.get_palimpsest_corridors,
    call: async () => getPalimpsestCorridors(),
  },
  get_palimpsest_bri_context: {
    title: 'Read bounded Palimpsest Belt and Road context',
    description: 'Return pinned source readiness and national WDI coverage for CPEC, Gwadar, CMEC, Kyaukpyu, and Balochistan as a parallel context lane. Cross-lane drug, actor, route, guilt, political, project, causal, tactical, and navigable inference or use is prohibited.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: PALIMPSEST_BRI_OUTPUT_SCHEMA,
    call: async (_args, { getBriContext = getPalimpsestBriContext } = {}) => getBriContext(),
  },
})

const contractValidator = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
addFormats(contractValidator)
const INPUT_VALIDATORS = Object.freeze(Object.fromEntries(
  Object.entries(TOOLS).map(([name, tool]) => [name, contractValidator.compile(tool.inputSchema)]),
))
const OUTPUT_VALIDATORS = Object.freeze(Object.fromEntries(
  Object.entries(TOOLS).map(([name, tool]) => [name, contractValidator.compile(tool.outputSchema)]),
))
const SERVER_INFO = Object.freeze({
  name: 'narcoscope',
  title: 'NarcoScope evidence explorer',
  version: SERVER_VERSION,
})
const SERVER_CAPABILITIES = Object.freeze({ tools: Object.freeze({ listChanged: false }) })
const SERVER_INSTRUCTIONS = 'Use NarcoScope for aggregate official drug-market evidence and bounded newsroom analysis. Start with list_capabilities or get_newsroom. Treat seizures as administrative observations, not trafficking-volume estimates; never infer guilt, political or armed-actor relationships, bilateral routes, project effects, tactical or navigable use, or causality from shared geography, origin labels, designations, or the separate Palimpsest Belt and Road context lane.'

export function toolInputIsValid(name, data) {
  return INPUT_VALIDATORS[name]?.(data) === true
}

export function toolOutputIsValid(name, data) {
  return OUTPUT_VALIDATORS[name]?.(data) === true
}

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value }
}

function protocolResult(id, value, modern) {
  if (!modern) return result(id, value)
  return result(id, {
    resultType: 'complete',
    ...value,
    _meta: {
      ...(value._meta ?? {}),
      [SERVER_INFO_META_KEY]: SERVER_INFO,
    },
  })
}

function failure(id, code, message, data) {
  const response = {
    jsonrpc: '2.0',
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
  if (typeof id === 'string' || typeof id === 'number') response.id = id
  return response
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function modernMetadataError(params) {
  const metadata = params?._meta
  if (!isRecord(metadata)) return 'params._meta is required for MCP 2026-07-28'
  if (metadata[PROTOCOL_VERSION_META_KEY] !== PROTOCOL_VERSION) {
    return `${PROTOCOL_VERSION_META_KEY} must be ${PROTOCOL_VERSION}`
  }
  if (!isRecord(metadata[CLIENT_CAPABILITIES_META_KEY])) {
    return `${CLIENT_CAPABILITIES_META_KEY} must be an object`
  }
  const clientInfo = metadata[CLIENT_INFO_META_KEY]
  if (
    clientInfo !== undefined
    && (
      !isRecord(clientInfo)
      || typeof clientInfo.name !== 'string'
      || !clientInfo.name
      || typeof clientInfo.version !== 'string'
      || !clientInfo.version
    )
  ) {
    return `${CLIENT_INFO_META_KEY} must contain non-empty name and version strings`
  }
  return null
}

function toolList() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }))
}

export async function dispatch(message, dependencies = {}, options = {}) {
  if (
    !message
    || typeof message !== 'object'
    || Array.isArray(message)
    || message.jsonrpc !== '2.0'
    || typeof message.method !== 'string'
  ) {
    return failure(null, -32600, 'Invalid Request')
  }
  if (!Object.hasOwn(message, 'id')) return null
  const { id = null, method } = message
  const params = message.params ?? {}
  if (!isRecord(params)) return failure(id, -32602, 'Invalid params')
  const bodyProtocolVersion = params?._meta?.[PROTOCOL_VERSION_META_KEY]
  const protocolVersion = options.protocolVersion ?? bodyProtocolVersion
  const modern = protocolVersion === PROTOCOL_VERSION
  if (modern) {
    const metadataError = modernMetadataError(params)
    if (metadataError) return failure(id, -32602, metadataError)
    if (method === 'initialize') return failure(id, -32601, 'Method not found')
  }
  if (method === 'server/discover') {
    if (!modern) return failure(id, -32601, 'Method not found')
    return protocolResult(id, {
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: SERVER_CAPABILITIES,
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: DISCOVERY_TTL_MS,
      cacheScope: PUBLIC_CACHE_SCOPE,
    }, true)
  }
  if (method === 'initialize') {
    const requested = params?.protocolVersion
    return result(id, {
      protocolVersion: requested === '2025-03-26' || requested === LEGACY_PROTOCOL_VERSION
        ? requested
        : LEGACY_PROTOCOL_VERSION,
      capabilities: SERVER_CAPABILITIES,
      serverInfo: SERVER_INFO,
      instructions: SERVER_INSTRUCTIONS,
    })
  }
  if (method === 'ping') return protocolResult(id, {}, modern)
  if (method === 'tools/list') {
    return protocolResult(id, {
      tools: toolList(),
      ...(modern ? { ttlMs: DISCOVERY_TTL_MS, cacheScope: PUBLIC_CACHE_SCOPE } : {}),
    }, modern)
  }
  if (method === 'tools/call') {
    const tool = typeof params?.name === 'string' && Object.hasOwn(TOOLS, params.name)
      ? TOOLS[params.name]
      : undefined
    if (!tool) return failure(id, -32602, `Unknown tool: ${params?.name ?? ''}`)
    const args = params.arguments ?? {}
    if (!toolInputIsValid(params.name, args)) {
      return failure(id, -32602, `Invalid arguments for tool: ${params.name}`)
    }
    try {
      const data = await tool.call(args, dependencies)
      if (!toolOutputIsValid(params.name, data)) {
        throw new Error(`NarcoScope tool output violated its published contract: ${params.name}`)
      }
      return protocolResult(id, {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      }, modern)
    } catch (error) {
      const safe = error instanceof TypeError || error instanceof RangeError
      return protocolResult(id, {
        content: [{ type: 'text', text: safe ? error.message : 'The published NarcoScope artifact is unavailable.' }],
        isError: true,
      }, modern)
    }
  }
  return failure(id, -32601, 'Method not found')
}

function headerValue(headers, name) {
  if (!headers) return undefined
  const expected = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected)
  if (!entry) return undefined
  return Array.isArray(entry[1]) ? entry[1][0] : entry[1]
}

function decodeHeaderValue(value) {
  if (typeof value !== 'string') return null
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value)
  if (!encoded) {
    if (value.startsWith('=?base64?') && value.endsWith('?=')) return null
    return /^[\x20-\x7e]+$/.test(value) && value.trim() === value ? value : null
  }
  try {
    const decoded = Buffer.from(encoded[1], 'base64')
    if (decoded.toString('base64') !== encoded[1]) return null
    const text = decoded.toString('utf8')
    return Buffer.from(text, 'utf8').equals(decoded) ? text : null
  } catch {
    return null
  }
}

function modernHttpError(req, message) {
  const protocolVersion = headerValue(req.headers, 'MCP-Protocol-Version')
  const bodyProtocolVersion = message?.params?._meta?.[PROTOCOL_VERSION_META_KEY]
  const modern = protocolVersion === PROTOCOL_VERSION || bodyProtocolVersion === PROTOCOL_VERSION
  if (!modern) {
    if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
      return failure(message?.id, -32022, `Unsupported MCP protocol version: ${protocolVersion}`, {
        requested: protocolVersion,
        supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      })
    }
    if (protocolVersion && bodyProtocolVersion && protocolVersion !== bodyProtocolVersion) {
      return failure(message?.id, -32020, 'Header mismatch: MCP-Protocol-Version does not match request metadata')
    }
    return null
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    return failure(message?.id, -32020, `Header mismatch: MCP-Protocol-Version must be ${PROTOCOL_VERSION}`)
  }
  if (bodyProtocolVersion !== undefined && bodyProtocolVersion !== protocolVersion) {
    return failure(message?.id, -32020, 'Header mismatch: MCP-Protocol-Version does not match request metadata')
  }
  const metadataError = modernMetadataError(message?.params)
  if (metadataError) return failure(message?.id, -32602, metadataError)
  const methodHeader = headerValue(req.headers, 'Mcp-Method')
  if (methodHeader !== message?.method) {
    return failure(message?.id, -32020, 'Header mismatch: Mcp-Method is missing or does not match the request body')
  }
  if (message?.method === 'tools/call') {
    const nameHeader = decodeHeaderValue(headerValue(req.headers, 'Mcp-Name'))
    if (nameHeader !== message?.params?.name) {
      return failure(message?.id, -32020, 'Header mismatch: Mcp-Name is missing, malformed, or does not match the request body')
    }
  }
  return null
}

function setHeaders(req, res) {
  const origin = headerValue(req.headers, 'Origin')
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Link', `<${API_CATALOG_URL}>; rel="api-catalog"; type="application/linkset+json"`)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

export default async function handler(req, res) {
  setHeaders(req, res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const origin = headerValue(req.headers, 'Origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.statusCode = 403
    res.end(JSON.stringify(failure(null, -32600, 'Origin not allowed')))
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    res.statusCode = 405
    res.end(JSON.stringify(failure(null, -32600, 'POST required')))
    return
  }
  const length = Number.parseInt(headerValue(req.headers, 'Content-Length') ?? '0', 10)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    res.statusCode = 413
    res.end(JSON.stringify(failure(null, -32600, 'Request body too large')))
    return
  }
  try {
    const rawBody = typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : JSON.stringify(req.body)
    if (rawBody !== undefined && Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      res.statusCode = 413
      res.end(JSON.stringify(failure(null, -32600, 'Request body too large')))
      return
    }
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body)
      ? JSON.parse(rawBody)
      : req.body
    const transportError = modernHttpError(req, body)
    if (transportError) {
      res.statusCode = 400
      res.end(`${JSON.stringify(transportError)}\n`)
      return
    }
    const protocolVersion = headerValue(req.headers, 'MCP-Protocol-Version')
    const response = await dispatch(body, {}, { protocolVersion })
    const modern = protocolVersion === PROTOCOL_VERSION
    res.statusCode = response === null
      ? 202
      : modern && response.error?.code === -32601
        ? 404
        : 200
    res.end(response === null ? '' : `${JSON.stringify(response)}\n`)
  } catch {
    res.statusCode = 400
    res.end(`${JSON.stringify(failure(null, -32700, 'Parse error'))}\n`)
  }
}
