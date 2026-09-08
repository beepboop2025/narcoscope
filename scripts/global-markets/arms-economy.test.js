import { describe, expect, it, vi } from 'vitest'
import { SOURCES, buildPublicDataset, fetchWorkbook, sha256, validateDownloadUrl, validateReceipt } from './arms-economy.mjs'
import { countryMap, normalizeWdi, validatePage } from './arms-economy-wdi.mjs'

const source = SOURCES.find(row => row.id === 'wb-informality')
const body = Buffer.from([80, 75, 3, 4, 0, 0])
const receipt = { url: source.downloadUrl, bytes: body.length, sha256: sha256(body), retrievedAt: '2026-01-01T00:00:00Z' }
const classification = [
  { page: 1, pages: 1, total: 2 },
  [ { id: 'CHN', iso2Code: 'CN', name: 'China', region: { id: 'EAS' } },
    { id: 'WLD', iso2Code: '1W', name: 'World', region: { id: 'NA' } } ],
]
const wdi = value => [
  { page: 1, pages: 1, total: 1, sourceid: '2', lastupdated: '2026-07-13' },
  [ { indicator: { id: 'MS.MIL.MPRT.KD' }, country: { id: 'CN', value: 'China' }, countryiso3code: 'CHN', date: '2024', value } ],
]

describe('arms/economy official-source transport and evidence', () => {
  it.each(['http://thedocs.worldbank.org/a.xlsx', 'https://127.0.0.1/a.xlsx', source.downloadUrl + '#x', source.downloadUrl + '?url=https://evil.test'])('rejects unreviewed endpoint %s', url => {
    expect(() => validateDownloadUrl(url)).toThrow()
  })
  it('rejects a redirect rather than following another host', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }))
    await expect(fetchWorkbook(source.downloadUrl, { fetchImpl })).rejects.toThrow('302')
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
  })
  it('bounds streamed bodies even without a Content-Length', async () => {
    await expect(fetchWorkbook(source.downloadUrl, { maxBytes: 5, fetchImpl: async () => new Response(body) })).rejects.toThrow('byte limit')
  })
  it('rejects HTML masquerading as a successful workbook', async () => {
    await expect(fetchWorkbook(source.downloadUrl, { fetchImpl: async () => new Response('<html>error</html>') })).rejects.toThrow('not an XLSX')
  })
  it('uses only the bounded retry budget for temporary failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(body))
    expect(await fetchWorkbook(source.downloadUrl, { fetchImpl, sleep: async () => {} })).toEqual(body)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('binds exact source bytes and original clock to the receipt', () => {
    expect(validateReceipt(receipt, body, source)).toBe(receipt)
    expect(() => validateReceipt(receipt, Buffer.from('tampered'), source)).toThrow('capture receipt')
    expect(() => validateReceipt({ ...receipt, retrievedAt: '2099-01-01T00:00:00Z' }, body, source)).toThrow('clock')
    expect(() => validateReceipt({ ...receipt, url: 'https://evil.test' }, body, source)).toThrow('capture receipt')
  })
  it('excludes the entire unapproved UNODC quantity lane even if a caller marks it public', () => {
    const publicCapture = { source, receipt, normalized: { indicators: [], observations: [] } }
    const privateCapture = { source: { ...SOURCES.find(row => row.id === 'unodc-arms'), public: true }, receipt,
      normalized: { indicators: [{ id: 'secret', sourceId: 'unodc-arms' }], observations: [{ value: 987654321 }] } }
    const publicData = buildPublicDataset([publicCapture, privateCapture])
    expect(publicData.sources.map(row => row.id)).toEqual(['wb-informality'])
    expect(JSON.stringify(publicData)).not.toContain('987654321')
    expect(publicData.generatedAt).toBe(receipt.retrievedAt)
  })
})

describe('WDI units, missingness and geography', () => {
  it('does not turn a null into a zero and marks TIV as estimated', () => {
    const countries = countryMap(classification)
    const missing = normalizeWdi(wdi(null), 'wb-wdi-arms-imports', countries)
    const zero = normalizeWdi(wdi(0), 'wb-wdi-arms-imports', countries)
    expect(missing.observations[0]).toMatchObject({ value: null, status: 'unavailable' })
    expect(zero.observations[0]).toMatchObject({ value: 0, status: 'estimated', lower: null, upper: null })
    expect(zero.indicators[0].unit).toBe('SIPRI trend-indicator values (TIVs)')
    expect(zero.indicators[0].limitations.join(' ')).toContain('0.5 million TIV')
  })
  it('distinguishes world totals using the retained official country classification', () => {
    const payload = wdi(100)
    Object.assign(payload[1][0], { countryiso3code: '', country: { id: '1W', value: 'World' } })
    const result = normalizeWdi(payload, 'wb-wdi-arms-imports', countryMap(classification))
    expect(result.observations[0]).toMatchObject({ geoCode: 'WLD', geoLevel: 'world' })
    expect(result.summary.countries).toBe(0)
  })
  it('fails closed on numeric data with unverified geography', () => {
    const payload = wdi(1); payload[1][0].countryiso3code = 'XYZ'
    expect(() => normalizeWdi(payload, 'wb-wdi-arms-imports', countryMap(classification))).toThrow('geography')
  })
  it('does not accept partial pagination as complete coverage', () => {
    const payload = wdi(1); payload[0].pages = 2
    expect(() => validatePage(payload)).toThrow('truncated')
  })
  it.each([false, '100', NaN, Infinity, -1])('rejects invalid measurement %s', value => {
    expect(() => normalizeWdi(wdi(value), 'wb-wdi-arms-imports', countryMap(classification))).toThrow('measurement')
  })
  it('rejects mixed indicators and duplicated country/year grains', () => {
    const mixed = wdi(1); mixed[1][0].indicator.id = 'OTHER'
    expect(() => normalizeWdi(mixed, 'wb-wdi-arms-imports', countryMap(classification))).toThrow('series')
    const duplicate = wdi(1); duplicate[1].push(structuredClone(duplicate[1][0])); duplicate[0].total = 2
    expect(() => normalizeWdi(duplicate, 'wb-wdi-arms-imports', countryMap(classification))).toThrow('duplicate')
  })
  it('keeps source JSON pointer and stable observation identity across changed values', () => {
    const first = normalizeWdi(wdi(100), 'wb-wdi-arms-imports', countryMap(classification))
    const revision = normalizeWdi(wdi(200), 'wb-wdi-arms-imports', countryMap(classification))
    expect(first.observations[0].id).toBe(revision.observations[0].id)
    expect(first.observations[0].sourceLocator).toContain('/1/0/value')
  })
})
