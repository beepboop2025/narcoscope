import {
  capabilities,
  getNewsroom,
  getOverview,
  getPalimpsestBridge,
  getStory,
  SITE_URL,
} from './lib/narcoscope.mjs'

const PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', PROTOCOL_VERSION])
const SERVER_VERSION = '1.0.0'
const MAX_BODY_BYTES = 256 * 1024
const ALLOWED_ORIGINS = new Set([
  SITE_URL,
  'https://narcoscope.com',
  'https://drug-price-observatory.vercel.app',
])

export const TOOLS = Object.freeze({
  list_capabilities: {
    title: 'Discover NarcoScope',
    description: 'List the evidence explorer, newsroom, API, feeds, MCP tools, audiences, and safety boundaries.',
    inputSchema: { type: 'object', additionalProperties: false },
    call: async () => capabilities(),
  },
  get_overview: {
    title: 'Read the official-data overview',
    description: 'Return bounded headline aggregates across official prices, seizures, overdose mortality, wastewater, and public designations.',
    inputSchema: { type: 'object', additionalProperties: false },
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
    call: getStory,
  },
  get_palimpsest_bridge: {
    title: 'Read the Palimpsest bridge',
    description: 'Return the official-only China aggregate shared with the Intelligence Commons, including disclosure and causal boundaries.',
    inputSchema: { type: 'object', additionalProperties: false },
    call: async () => getPalimpsestBridge(),
  },
})

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value }
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

export async function dispatch(message) {
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
  const { id = null, method, params = {} } = message
  if (method === 'initialize') {
    const requested = params?.protocolVersion
    return result(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'narcoscope', title: 'NarcoScope evidence explorer', version: SERVER_VERSION },
      instructions: 'Use NarcoScope for aggregate official drug-market evidence and bounded newsroom analysis. Start with list_capabilities or get_newsroom. Treat seizures as administrative observations, not trafficking-volume estimates; never infer guilt or causality from origin labels or designations.',
    })
  }
  if (method === 'ping') return result(id, {})
  if (method === 'tools/list') {
    return result(id, { tools: Object.entries(TOOLS).map(([name, tool]) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    })) })
  }
  if (method === 'tools/call') {
    const tool = TOOLS[params?.name]
    if (!tool) return failure(id, -32602, `Unknown tool: ${params?.name ?? ''}`)
    try {
      const data = await tool.call(params.arguments ?? {})
      return result(id, {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      })
    } catch (error) {
      const safe = error instanceof TypeError || error instanceof RangeError
      return result(id, {
        content: [{ type: 'text', text: safe ? error.message : 'The published NarcoScope artifact is unavailable.' }],
        isError: true,
      })
    }
  }
  return failure(id, -32601, 'Method not found')
}

function setHeaders(req, res) {
  const origin = req.headers?.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
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
  if (req.headers?.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
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
  const protocolVersion = req.headers?.['mcp-protocol-version']
  if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
    res.statusCode = 400
    res.end(JSON.stringify(failure(null, -32600, `Unsupported MCP protocol version: ${protocolVersion}`)))
    return
  }
  const length = Number.parseInt(req.headers?.['content-length'] ?? '0', 10)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    res.statusCode = 413
    res.end(JSON.stringify(failure(null, -32600, 'Request body too large')))
    return
  }
  try {
    const rawBody = typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body)
    if (rawBody !== undefined && Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
      res.statusCode = 413
      res.end(JSON.stringify(failure(null, -32600, 'Request body too large')))
      return
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const response = await dispatch(body)
    res.statusCode = response === null ? 202 : 200
    res.end(response === null ? '' : `${JSON.stringify(response)}\n`)
  } catch {
    res.statusCode = 400
    res.end(`${JSON.stringify(failure(null, -32700, 'Parse error'))}\n`)
  }
}
