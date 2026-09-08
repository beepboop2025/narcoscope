// A compact cross-project summary carries public evidence and acquisition counts.
// It never imports the private SAFE numeric ledger through an extensible object.
export const OBSERVATORY_SOURCE = 'https://www.palimpsest.info/china/evidence/'
export const OBSERVATORY_SCHEMA = 'palimpsest.china-evidence-observatory-summary.v1'
export const OBSERVATORY_POLICY = {
  concealment_inference: 'not_established_by_gaps_or_disagreement',
  actor_inference: 'prohibited', private_numeric_data: 'excluded', missing_values: 'unavailable_not_zero',
}
const datasets = {
  'nbs-history': {
    path: '/readings/china-economic-history-analysis-latest.json', download: '/readings/china-economic-history.csv',
    source_group: 'nbs_official_statistics', visibility: 'public',
    counts: 'archive_numeric_cells archive_vintages comparable_series city_housing_series deduplicated_series_months observed_revision_pairs ambiguous_series_months',
  },
  'mirror-trade': {
    path: '/readings/china-mirror-trade-latest.json', download: '/readings/china-mirror-trade-history.csv',
    source_group: 'eurostat_eu_reported_trade', visibility: 'public',
    counts: 'series rows numeric_cells unavailable_cells products independent_source_groups',
  },
  'publication-watch': {
    path: '/readings/china-publication-watch-latest.json', download: '/readings/china-publication-watch-latest.json',
    source_group: 'official_document_observation', visibility: 'metadata_public',
    counts: 'watched_documents available_documents source_groups available_source_groups retained_documents retained_source_groups baseline_documents changed_documents updated_indexes unavailable_documents removal_observations retained_captures captured_characters captured_numeric_tokens',
  },
  'external-accounts': {
    path: '/readings/china-external-accounts-latest.json', download: '/readings/china-external-accounts-latest.json',
    source_group: 'safe_official_statistics', visibility: 'numeric_data_private',
    counts: 'workbooks_retained sheets_retained numeric_observations_private unavailable_observations_private public_numeric_observations independent_source_groups',
  },
}
const hash = /^[a-f0-9]{64}$/
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(' ').sort().join(',')) throw new Error(`Observatory ${label} has unexpected fields`)
}
function text(value, label, limit = 4000) {
  if (typeof value !== 'string' || !value.length || value.length > limit) throw new Error(`Observatory ${label} is invalid`)
}
function clock(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Observatory clock is invalid')
}
function sourceUrl(value, host) {
  text(value, 'source URL', 2048)
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || (url.port && url.port !== '443') || url.hash) throw new Error('Observatory source URL changed')
}

export function validateObservatory(summary, { inputHash, sourceClock } = {}) {
  exact(summary, 'schema generated_at source_url input_sha256 datasets findings methodology_cases use_policy', 'summary')
  if (summary.schema !== OBSERVATORY_SCHEMA || summary.source_url !== OBSERVATORY_SOURCE) throw new Error('Observatory schema or source changed')
  exact(summary.use_policy, Object.keys(OBSERVATORY_POLICY).join(' '), 'use policy')
  for (const [key, value] of Object.entries(OBSERVATORY_POLICY)) if (summary.use_policy[key] !== value) throw new Error('Observatory use policy changed')
  clock(summary.generated_at)
  if (!hash.test(summary.input_sha256) || summary.input_sha256 !== inputHash) throw new Error('Observatory input hash is not bound to the research snapshot')
  if (summary.generated_at !== sourceClock) throw new Error('Observatory source clock is not bound to the research snapshot')
  if (!Array.isArray(summary.datasets) || summary.datasets.length !== 4 || new Set(summary.datasets.map(row => row.id)).size !== 4) throw new Error('Observatory dataset identities changed')
  for (const row of summary.datasets) {
    exact(row, 'id title status visibility clock source_group path download coverage description', 'dataset')
    const expected = datasets[row.id]
    if (!expected) throw new Error('Observatory dataset is unknown')
    for (const key of ['path', 'download', 'source_group', 'visibility']) if (row[key] !== expected[key]) throw new Error('Observatory dataset publication boundary changed')
    text(row.title, 'dataset title', 240); text(row.description, 'dataset description', 1800)
    text(row.status, 'dataset status', 80); clock(row.clock)
    if (Date.parse(row.clock) > Date.parse(summary.generated_at)) throw new Error('Observatory dataset clock exceeds its snapshot')
    const allowed = new Set(expected.counts.split(' '))
    if (!row.coverage || typeof row.coverage !== 'object' || Array.isArray(row.coverage) || !Object.keys(row.coverage).length) throw new Error('Observatory coverage is missing')
    for (const [key, value] of Object.entries(row.coverage)) {
      if (!allowed.has(key) || !Number.isSafeInteger(value) || value < 0) throw new Error('Observatory coverage must contain reviewed acquisition counts only')
    }
    if (row.id === 'external-accounts' && row.coverage.public_numeric_observations !== 0) throw new Error('Private external-account values cannot be published')
  }
  if (!Array.isArray(summary.findings) || summary.findings.length > 100 || new Set(summary.findings.map(row => row.id)).size !== summary.findings.length) throw new Error('Observatory findings are invalid')
  for (const row of summary.findings) {
    exact(row, `id title text interpretation evidence_class source_urls data_path region${Object.hasOwn(row, 'evidence_series') ? ' evidence_series' : ''}`, 'finding')
    for (const key of ['id', 'title', 'text', 'interpretation']) text(row[key], key, key === 'id' ? 180 : 4000)
    const statistical = row.evidence_class === 'official_statistical_comparison'
    if (!statistical && row.evidence_class !== 'externally_reported_trade') throw new Error('Observatory evidence class is not public')
    if (row.data_path !== datasets[statistical ? 'nbs-history' : 'mirror-trade'].path || row.region !== (statistical ? 'china' : 'regional')) throw new Error('Observatory finding scope changed')
    if (!Array.isArray(row.source_urls) || !row.source_urls.length || row.source_urls.length > 60) throw new Error('Observatory finding lacks source URLs')
    for (const url of row.source_urls) sourceUrl(url, statistical ? 'www.stats.gov.cn' : 'ec.europa.eu')
    if (Object.hasOwn(row, 'evidence_series') && (!Array.isArray(row.evidence_series) || row.evidence_series.length > 500 || row.evidence_series.some(value => typeof value !== 'string' || !/^[A-Z0-9_]+:(CN|PK|MM):(TOTAL|\d{2,8}):eu_(imports_from|exports_to)_partner$/.test(value)))) throw new Error('Observatory finding series must be reviewed trade identifiers only')
  }
  if (!Array.isArray(summary.methodology_cases) || summary.methodology_cases.length > 30) throw new Error('Observatory methodology cases invalid')
  for (const row of summary.methodology_cases) {
    exact(row, 'id title event_date claim interpretation source_ids source_urls evidence_status capture_ids', 'methodology case')
    for (const key of ['id', 'title', 'claim', 'interpretation']) text(row[key], key)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.event_date) || !Number.isFinite(Date.parse(row.event_date)) || Date.parse(row.event_date) > Date.parse(summary.generated_at)) throw new Error('Observatory historical event date invalid')
    if (!Array.isArray(row.source_ids) || !row.source_ids.length || row.source_ids.length > 10 || row.source_ids.some(id => typeof id !== 'string' || !/^nbs-[a-z0-9-]+$/.test(id))) throw new Error('Observatory case source identities invalid')
    if (!Array.isArray(row.source_urls) || row.source_urls.length !== row.source_ids.length || !Array.isArray(row.capture_ids) || row.capture_ids.length !== row.source_ids.length) throw new Error('Observatory case capture evidence incomplete')
    row.source_urls.forEach(url => sourceUrl(url, 'www.stats.gov.cn'))
    if (row.capture_ids.some(value => value !== null && !hash.test(value)) || !['captured', 'source_unavailable'].includes(row.evidence_status) || (row.evidence_status === 'captured' && row.capture_ids.some(value => value === null))) throw new Error('Observatory case capture status invalid')
  }
  return summary
}

export const OBSERVATORY_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema', 'generated_at', 'source_url', 'input_sha256', 'datasets', 'findings', 'methodology_cases', 'use_policy'],
  properties: {
    schema: { const: OBSERVATORY_SCHEMA }, generated_at: { type: 'string' }, source_url: { const: OBSERVATORY_SOURCE },
    input_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    datasets: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'object' } },
    findings: { type: 'array', maxItems: 100, items: { type: 'object' } },
    methodology_cases: { type: 'array', maxItems: 30, items: { type: 'object' } },
    use_policy: { type: 'object', additionalProperties: false, required: Object.keys(OBSERVATORY_POLICY), properties: Object.fromEntries(Object.entries(OBSERVATORY_POLICY).map(([key, value]) => [key, { const: value }])) },
  },
}
