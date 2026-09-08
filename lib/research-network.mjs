// Read only Seiche's published contract; never send a person's query or identity.
export const RESEARCH_NETWORK_URL = 'https://api.seiche.info/api/v2/research-network'
export const RESEARCH_TOPICS = ['all', 'china', 'regions', 'information_controls', 'model_evaluations', 'funding', 'institutions', 'liquidity', 'global_data']
export const RESEARCH_NETWORK_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    topic: { type: 'string', enum: RESEARCH_TOPICS, default: 'all' },
    offset: { type: 'integer', minimum: 0, maximum: 1000, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 25, default: 12 },
  },
}
export const RESEARCH_NETWORK_OUTPUT_SCHEMA = {
  type: 'object', required: ['schema', 'status', 'context_only', 'selection', 'datasets', 'eligibility'],
  properties: {
    schema: { const: 'seiche.research-network.v1' },
    status: { type: 'string', enum: ['available', 'stale', 'unavailable'] },
    context_only: { const: true }, selection: { type: 'object' },
    datasets: { type: 'array', maxItems: 25, items: { type: 'object' } },
    eligibility: { type: 'object' },
  }, additionalProperties: true,
}

export async function readResearchNetwork(args = {}, { fetchImpl = fetch } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['topic', 'offset', 'limit'].includes(key))) throw new TypeError('Only topic, offset and limit are supported')
  const topic = args.topic ?? 'all'
  const integer = (value, fallback) => value === undefined ? fallback : typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? Number(value) : NaN
  const offset = integer(args.offset, 0), limit = integer(args.limit, 12)
  if (!RESEARCH_TOPICS.includes(topic) || !Number.isInteger(offset) || offset < 0 || offset > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new TypeError('Invalid research topic or pagination')
  const selection = { topic, offset, limit }
  const eligibility = { blend_into_score: false, training: false, execution: false }
  try {
    const response = await fetchImpl(`${RESEARCH_NETWORK_URL}?${new URLSearchParams(selection)}`, {
      signal: AbortSignal.timeout(12000), redirect: 'error', credentials: 'omit',
      headers: { Accept: 'application/json', 'User-Agent': 'narcoscope-research-client/1' },
    })
    if (!response.ok || !response.body) throw new Error('Research unavailable')
    const reader = response.body.getReader(); const chunks = []; let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Research byte budget exceeded') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (result?.schema !== 'seiche.research-network.v1' || result.context_only !== true
      || !['available', 'stale', 'unavailable'].includes(result.status)
      || Object.entries(selection).some(([key, value]) => result.selection?.[key] !== value)
      || !result.eligibility || Object.keys(result.eligibility).length !== 3
      || Object.keys(eligibility).some(key => result.eligibility[key] !== false)
      || !Array.isArray(result.datasets) || result.datasets.length > limit
      || result.datasets.some(row => !row || row.values_included !== false)) throw new Error('Research contract changed')
    return result
  } catch {
    return { schema: 'seiche.research-network.v1', status: 'unavailable', context_only: true, selection, eligibility, datasets: [],
      source: { url: RESEARCH_NETWORK_URL }, links: { site: 'https://seiche.info/#RESEARCH' },
      reason: 'The connected research service is unavailable or returned an incompatible contract.' }
  }
}
