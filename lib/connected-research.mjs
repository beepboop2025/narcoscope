import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { OBSERVATORY_OUTPUT_SCHEMA, validateObservatory } from './china-observatory.mjs'

export const CONNECTED_FILE = 'palimpsest-connected-research-v1.json'
export const CONNECTED_SOURCE = 'https://www.palimpsest.info/readings/connected-research-latest.json'
export const CONNECTED_MAX_BYTES = 4 * 1024 * 1024
const directory = fileURLToPath(new URL('../public/data/', import.meta.url))
const regions = new Set(['china', 'cpec', 'balochistan', 'bri', 'myanmar'])
export const connectedSha256 = (raw) => createHash('sha256').update(raw).digest('hex')

export const CONNECTED_OUTPUT_SCHEMA = {
  type: 'object', required: ['schema', 'data', 'sha256', 'source_url'], additionalProperties: false,
  properties: {
    schema: { const: 'narcoscope.connected-research-envelope.v1' },
    data: { type: 'object', required: ['schema', 'regions', 'source_clocks', 'use_policy'],
      properties: { schema: { const: 'palimpsest.connected-research.v1' }, regions: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'object' } }, source_clocks: { type: 'object' }, use_policy: { type: 'object' }, observatory: OBSERVATORY_OUTPUT_SCHEMA }, additionalProperties: true },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, source_url: { const: CONNECTED_SOURCE },
  },
}

function safeUrl(value) {
  if (typeof value !== 'string') throw new Error('Research source URL is missing')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Research source URL must use HTTPS')
}

export function validateConnectedResearch(data) {
  if (data?.schema !== 'palimpsest.connected-research.v1' || !Array.isArray(data.regions)
      || data.regions.length !== 5 || new Set(data.regions.map(r => r.region)).size !== 5
      || data.regions.some(r => !regions.has(r.region))) throw new Error('Connected research region/schema contract changed')
  if (data.use_policy?.actor_inference !== 'prohibited'
      || data.use_policy?.joins !== 'country_theme_time_context_only'
      || data.use_policy?.causal_inference !== 'not_established'
      || data.use_policy?.missing_values !== 'unavailable_not_zero') throw new Error('Connected research scope changed')
  if (!Number.isFinite(Date.parse(data.generated_at))) throw new Error('Research capture clock missing')
  for (const hash of Object.values(data.input_sha256 ?? {})) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Research input hash invalid')
  }
  const hasObservatory = Object.hasOwn(data, 'observatory')
  const expectedInputs = hasObservatory ? 'china,economy,observatory,partner,wire' : 'china,economy,partner,wire'
  if (Object.keys(data.input_sha256 ?? {}).sort().join(',') !== expectedInputs) throw new Error('Research input identities changed')
  if (hasObservatory) validateObservatory(data.observatory, { inputHash: data.input_sha256.observatory, sourceClock: data.source_clocks?.observatory })
  else if (Object.hasOwn(data.source_clocks ?? {}, 'observatory')) throw new Error('Observatory clock lacks a matching summary')
  for (const key of ['regional_collection', 'economic_retrieval', 'china_analysis', 'narcoscope_data_as_of']) {
    if (!Number.isFinite(Date.parse(data.source_clocks?.[key]))) throw new Error('Research source clock invalid')
  }
  for (const region of data.regions) {
    if (!Array.isArray(region.questions) || !Array.isArray(region.national_indicators)) throw new Error('Research question data missing')
    for (const question of region.questions) {
      if (!Array.isArray(question.recent_reporting) || !Array.isArray(question.missing_evidence)) throw new Error('Research evidence or gaps missing')
      for (const item of question.recent_reporting) {
        safeUrl(item.url)
        if (item.rights_policy !== 'metadata-link-only') throw new Error('Publisher metadata rights changed')
      }
    }
    for (const indicator of region.national_indicators) {
      const observation = indicator.latest_available
      safeUrl(indicator.source_url)
      if (observation !== null && (!Number.isFinite(observation?.value)
          || observation.evidence_state !== 'observed' || observation.aggregate_level !== 'country'
          || observation.country_code !== indicator.country_code
          || observation.indicator_id !== indicator.indicator_id
          || observation.rights?.redistribution_status !== 'allowed_with_attribution')) throw new Error('Economic value or country scope changed')
      if (region.country !== null && indicator.country_code !== region.country) throw new Error('Regional country context mismatch')
    }
    if (!Array.isArray(region.economic_findings)) throw new Error('Regional economic findings missing')
    for (const finding of region.economic_findings) {
      if (finding.scope !== 'annual_country_context' || !Array.isArray(finding.evidence) || !finding.evidence.length) throw new Error('Regional finding scope or evidence invalid')
      for (const point of finding.evidence) {
        safeUrl(point.source_url)
        if (new URL(point.source_url).hostname !== 'data.worldbank.org' || point.evidence_state !== 'observed'
            || !Number.isFinite(point.value) || !/^\d{4}-12-31$/.test(point.period_end)
            || !/^[a-f0-9]{64}$/.test(point.source_row_sha256)) throw new Error('Regional finding source/value invalid')
      }
    }
  }
  if (!Array.isArray(data.china_findings)) throw new Error('China findings missing')
  for (const finding of data.china_findings) {
    if (!Array.isArray(finding.evidence) || !finding.evidence.length) throw new Error('China finding lacks evidence')
    for (const evidence of finding.evidence) {
      safeUrl(evidence.source_url)
      if (new URL(evidence.source_url).hostname !== 'www.stats.gov.cn' || !Number.isFinite(evidence.value)) throw new Error('China finding source/value invalid')
    }
  }
  return data
}

export async function loadConnectedResearch({ dataDir = directory } = {}) {
  const [raw, sidecar] = await Promise.all([readFile(`${dataDir}/${CONNECTED_FILE}`), readFile(`${dataDir}/${CONNECTED_FILE}.sha256`, 'utf8')])
  if (raw.length > CONNECTED_MAX_BYTES) throw new Error('Connected research exceeds byte bound')
  const hash = connectedSha256(raw)
  if (sidecar !== `${hash}  ${CONNECTED_FILE}\n`) throw new Error('Connected research hash mismatch')
  const data = validateConnectedResearch(JSON.parse(raw.toString('utf8')))
  return { schema: 'narcoscope.connected-research-envelope.v1', data, sha256: hash, source_url: CONNECTED_SOURCE }
}
