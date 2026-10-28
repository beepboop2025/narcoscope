// Public-serving policy, independent of collector input, artifact age, and UI state.
// Originals remain retained; public source metadata does not grant redistribution rights.
export const PUBLICATION_POLICY_ID = 'narcoscope.publication-rights.2026-10-28.v1'
export const WDR_WITHHELD_REASON = 'UNODC World Drug Report measurements and derived values are withheld pending documented permission for this public commercial product. Source metadata remains available; withheld is not zero or missing source coverage.'
export const WDR_LEGACY_SOURCES = ['wdr2026-prices', 'wdr2025-seizures', 'wdr-price-history']
export const withheldPublication = (sourceIds) => ({ policyId: PUBLICATION_POLICY_ID, status: 'metadata_only', sourceIds: [...sourceIds], permissionEvidence: null, observationScope: 'published_rows_only', reason: WDR_WITHHELD_REASON })
export const publishedPublication = () => ({ policyId: PUBLICATION_POLICY_ID, status: 'published', sourceIds: [], permissionEvidence: null, observationScope: 'published_rows_only', reason: 'Retained under the existing source-specific publication contract; this status is not a grant of additional reuse rights.' })
export function isRestrictedWdrSource(source) {
  return /^wdr(?:20\d{2})?-/.test(source.id ?? '') || /(?:WDR[_ /-]?20\d{2}|World Drug Report)/i.test([source.name, source.url, source.downloadUrl, source.license].join(' '))
}
export function projectMarketDataset(input) {
  const data = structuredClone(input)
  const denied = new Set(data.sources.filter(isRestrictedWdrSource).map(source => source.id))
  const deniedIndicators = new Set(data.indicators.filter(indicator => denied.has(indicator.sourceId)).map(indicator => indicator.id))
  data.observations = data.observations.filter(row => !deniedIndicators.has(row.indicatorId))
  data.publication = denied.size ? withheldPublication([...denied].sort()) : publishedPublication()
  if (denied.size && data.sources.some(source => !denied.has(source.id))) data.publication.status = 'partial'
  // All source/indicator names survive. Observation arrays contain published rows only.
  data.limitations = data.limitations.filter(line => !line.startsWith('UNODC WDR observations are reproduced for this educational'))
  if (denied.size && !data.limitations.includes(WDR_WITHHELD_REASON)) data.limitations.push(WDR_WITHHELD_REASON)
  return data
}
export function projectBridge(input) {
  const data = structuredClone(input)
  for (const [key, source] of [['retailDrugPrices', 'wdr2026-prices'], ['drugSeizures', 'wdr2025-seizures']]) {
    const dataset = data.datasets[key]
    dataset.data = null
    dataset.publication = withheldPublication([source])
    if (!dataset.limitations.includes(WDR_WITHHELD_REASON)) dataset.limitations.push(WDR_WITHHELD_REASON)
  }
  return data
}
export function projectOverview(input) {
  const data = structuredClone(input)
  data.headline.worldSeizureTonnes = null
  data.headline.seizureCountries = null
  data.topSeizureCountries = []
  data.divergences = []
  data.publication = withheldPublication(['wdr2025-seizures'])
  if (!data.meta.note?.includes(WDR_WITHHELD_REASON)) data.meta.note = [data.meta.note, WDR_WITHHELD_REASON].filter(Boolean).join(' ')
  return data
}
export function projectLegacyJson(name, input) {
  if (name === 'overview.json') return projectOverview(input)
  const data = structuredClone(input)
  data.records = []
  data.publication = withheldPublication([name === 'seizures.json' ? 'wdr2025-seizures' : 'wdr-price-history'])
  return data
}
export function projectPriceModule(code) {
  const pattern = /export const PRICE_RECORDS: PriceRecord\[\] = \[[\s\S]*?\n\]/
  if (!pattern.test(code)) throw new Error('Price module publication boundary changed; refuse to build unsanitized source')
  return code.replace(pattern, 'export const PRICE_RECORDS: PriceRecord[] = []')
}
export function publicRightsVitePlugin() {
  return { name: 'narcoscope-publication-rights', enforce: 'pre', apply: 'build', transform(code, id) {
    const path = id.split('?')[0].replaceAll('\\', '/')
    if (path.endsWith('/src/data/prices.ts')) return { code: projectPriceModule(code), map: null }
    for (const name of ['priceSeries.json', 'seizures.json', 'overview.json']) {
      if (path.endsWith('/src/data/' + name)) return { code: JSON.stringify(projectLegacyJson(name, JSON.parse(code))), map: null }
    }
    return null
  } }
}

export const PUBLICATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['policyId', 'status', 'sourceIds', 'permissionEvidence', 'observationScope', 'reason'],
  properties: {
    policyId: { const: PUBLICATION_POLICY_ID }, status: { enum: ['published', 'partial', 'metadata_only'] },
    sourceIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    permissionEvidence: { type: 'null' }, observationScope: { const: 'published_rows_only' }, reason: { type: 'string', minLength: 1 },
  },
}
export const serializePublicData = data => JSON.stringify(data, null, 2) + '\n'
