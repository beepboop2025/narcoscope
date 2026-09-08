import { createHash } from 'node:crypto'

export const WDI_SERIES = Object.freeze({
  'wb-wdi-arms-imports': { code: 'MS.MIL.MPRT.KD', id: 'wdi-arms-imports-tiv', label: 'Major conventional arms imports', market: 'arms', start: 1960 },
  'wb-wdi-arms-exports': { code: 'MS.MIL.XPRT.KD', id: 'wdi-arms-exports-tiv', label: 'Major conventional arms exports', market: 'arms', start: 1960 },
  'wb-wdi-informal-payments': { code: 'IC.FRM.CORR.ZS', id: 'wdi-informal-payments-firms', label: 'Informal payments to public officials', market: 'economy', start: 2002 },
})

export function validatePage(payload, maxRows = 20000) {
  if (!Array.isArray(payload) || payload.length !== 2 || !Array.isArray(payload[1])) throw new Error('WDI payload shape')
  const [meta, rows] = payload
  if (Number(meta.page) !== 1 || Number(meta.pages) !== 1 || !Number.isInteger(meta.total) || meta.total !== rows.length || rows.length > maxRows) throw new Error('WDI truncated or unbounded response')
  return rows
}

export function countryMap(payload) {
  const rows = validatePage(payload, 400)
  const map = new Map()
  map.byIso2 = new Map()
  for (const row of rows) {
    if (!/^[A-Z0-9]{3}$/.test(row.id) || typeof row.name !== 'string' || typeof row.region?.id !== 'string' || map.has(row.id)) throw new Error('WDI country classification drift')
    const item = { code: row.id, name: row.name, level: row.id === 'WLD' ? 'world' : row.region.id === 'NA' ? 'region' : 'country' }
    map.set(row.id, item)
    if (typeof row.iso2Code !== 'string' || map.byIso2.has(row.iso2Code)) throw new Error('WDI short geography code is ambiguous')
    map.byIso2.set(row.iso2Code, item)
  }
  return map
}

export function normalizeWdi(payload, sourceId, countries) {
  const spec = WDI_SERIES[sourceId]
  if (!spec) throw new Error('unreviewed WDI series')
  const rows = validatePage(payload)
  if (String(payload[0].sourceid) !== '2' || !/^\d{4}-\d{2}-\d{2}$/.test(payload[0].lastupdated)) throw new Error('WDI source identity drift')
  const arms = spec.market === 'arms'
  const indicator = {
    id: spec.id, sourceId, market: spec.market, label: spec.label,
    unit: arms ? 'SIPRI trend-indicator values (TIVs)' : '% of firms',
    measureType: arms ? 'arms-transfer-volume-estimate' : 'firm-survey',
    description: arms
      ? 'Volume of major conventional-weapons transfers through sales, gifts, aid and manufacturing licences, compiled by SIPRI and distributed in World Development Indicators.'
      : 'Share of surveyed establishments considering that similar firms make informal payments or give gifts to public officials to get things done.',
    limitations: arms ? [
      'TIV is a transfer-volume measure, not US dollars, a sale price, revenue or illegal-market value; do not divide it by GDP.',
      'These observations do not classify transfers as legal or illegal. Most small arms, light weapons, ammunition and support services are excluded.',
      'A reported zero denotes deliveries between 0 and 0.5 million TIV; it is not proof of no transfers. Null is unavailable.',
      'Country and regional/world totals overlap. SIPRI includes some transfers involving rebel groups; these national aggregates do not resolve individual actors or routes.',
    ] : [
      'This survey perception measure is not a count of bribes, all corruption, or the value of a black economy.',
      'Survey years are sparse; early survey instruments may differ from the later global methodology. Do not interpolate absent years.',
      'Enterprise Surveys primarily sample formal private firms with at least five workers, not the whole informal economy.',
    ],
  }
  const seen = new Set()
  const observations = []
  let unmapped = 0
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.indicator?.id !== spec.code || !/^\d{4}$/.test(row.date) || Number(row.date) < spec.start || Number(row.date) > 2025) throw new Error('WDI series or time period drift')
    const geography = countries.get(row.countryiso3code) ?? (row.countryiso3code === '' ? countries.byIso2?.get(row.country?.id) : undefined)
    if (!geography) {
      if (row.value !== null) throw new Error('numeric WDI observation lacks verified geography')
      unmapped++
      continue
    }
    if (row.value !== null && (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0 || (!arms && row.value > 100))) throw new Error('invalid WDI measurement')
    const geoCode = geography.code
    const grain = [spec.id, geoCode, row.date]
    const id = 'ae-' + createHash('sha256').update(JSON.stringify(grain)).digest('hex').slice(0, 24)
    if (seen.has(id)) throw new Error('duplicate WDI country/year')
    seen.add(id)
    observations.push({ id, indicatorId: spec.id, geoCode, geoName: row.country.value,
      geoLevel: geography.level, period: row.date, category: '', subgroup: '', value: row.value,
      lower: null, upper: null, status: row.value === null ? 'unavailable' : arms ? 'estimated' : 'reported',
      sourceLocator: `/1/${index}/value; indicator=${spec.code}; country=${geoCode}; year=${row.date}`,
    })
  }
  observations.sort((a, b) => a.geoCode.localeCompare(b.geoCode) || a.period.localeCompare(b.period))
  const numeric = observations.filter(row => row.value !== null)
  return { indicators: [indicator], observations, summary: {
    rows: observations.length, numeric: numeric.length, indicators: 1,
    countries: new Set(numeric.filter(row => row.geoLevel === 'country').map(row => row.geoCode)).size,
    periodStart: numeric.map(row => row.period).sort().at(0) ?? null,
    periodEnd: numeric.map(row => row.period).sort().at(-1) ?? null,
    sourceUpdated: payload[0].lastupdated, unmappedUnavailable: unmapped,
  } }
}
