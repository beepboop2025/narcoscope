import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTED_FILE, connectedSha256, loadConnectedResearch, validateConnectedResearch } from '../lib/connected-research.mjs'
import { TOOLS, toolOutputIsValid } from './mcp.mjs'
import { capabilities } from './lib/narcoscope.mjs'
import { observatoryFixture } from './observatory-fixture.js'

describe('shared economic and regional research', () => {
  it('returns evidence from the same hash-bound snapshot through MCP discovery', async () => {
    const data = await TOOLS.get_connected_research.call({})
    expect(toolOutputIsValid('get_connected_research', data)).toBe(true)
    expect(capabilities().api.resources).toContain('connected-research')
    expect(capabilities().mcp.tools).toContain('get_connected_research')
    expect(data.data.regions.find(r => r.region === 'balochistan').national_indicators.every(r => r.country_code === 'PAK')).toBe(true)
  })

  it.each(['rights', 'missing', 'scope', 'source', 'clock', 'inputs'])('rejects damaged %s evidence before exposure', async issue => {
    const data = structuredClone((await loadConnectedResearch()).data)
    const region = data.regions.find(r => r.region === 'balochistan')
    if (issue === 'rights') region.national_indicators.find(r => r.latest_available).latest_available.rights.redistribution_status = 'unknown'
    if (issue === 'missing') region.economic_findings[0].evidence[0].value = null
    if (issue === 'scope') region.country = 'CHN'
    if (issue === 'source') region.economic_findings[0].evidence[0].source_url = 'https://example.com/'
    if (issue === 'clock') delete data.source_clocks.china_analysis
    if (issue === 'inputs') { data.input_sha256.extra = data.input_sha256.china; delete data.input_sha256.china }
    expect(() => validateConnectedResearch(data)).toThrow()
  })

  it('rejects content changes even when the JSON remains well formed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narcoscope-research-'))
    try {
      const raw = await readFile(new URL(`../public/data/${CONNECTED_FILE}`, import.meta.url))
      await writeFile(join(directory, CONNECTED_FILE), Buffer.concat([raw, Buffer.from(' ')]))
      await writeFile(join(directory, `${CONNECTED_FILE}.sha256`), `${connectedSha256(raw)}  ${CONNECTED_FILE}\n`)
      await expect(loadConnectedResearch({ dataDir: directory })).rejects.toThrow('hash mismatch')
    } finally { await rm(directory, { recursive: true }) }
  })

  async function withObservatory() {
    const data = structuredClone((await loadConnectedResearch()).data)
    data.observatory = observatoryFixture()
    data.input_sha256.observatory = data.observatory.input_sha256
    data.source_clocks.observatory = data.observatory.generated_at
    return data
  }

  it('accepts both legacy four-input snapshots and the bound optional observatory', async () => {
    const data = await withObservatory()
    expect(validateConnectedResearch(data)).toBe(data)
    expect(toolOutputIsValid('get_connected_research', { schema: 'narcoscope.connected-research-envelope.v1', data, sha256: 'd'.repeat(64), source_url: 'https://www.palimpsest.info/readings/connected-research-latest.json' })).toBe(true)
    delete data.observatory; delete data.input_sha256.observatory; delete data.source_clocks.observatory
    expect(validateConnectedResearch(data)).toBe(data)
  })

  it.each(['hash', 'policy', 'source', 'path', 'download', 'coverage-key', 'coverage-value', 'private-numeric', 'private-field', 'private-finding', 'finding-source', 'clock', 'case-capture', 'dataset-id', 'unbound-summary', 'orphan-input', 'series-values', 'nested-dataset-metadata', 'nested-case-metadata', 'nested-finding-metadata'])('rejects hostile observatory %s before REST or MCP exposure', async issue => {
    const data = await withObservatory(), summary = data.observatory
    if (issue === 'hash') summary.input_sha256 = 'c'.repeat(64)
    if (issue === 'policy') summary.use_policy.concealment_inference = 'proven_by_gaps'
    if (issue === 'source') summary.source_url = 'https://example.com/china/evidence/'
    if (issue === 'path') summary.datasets[0].path = '//example.com/private'
    if (issue === 'download') summary.datasets[3].download = '/readings/private-safe-values.csv'
    if (issue === 'coverage-key') summary.datasets[3].coverage.actual_balance = 100000
    if (issue === 'coverage-value') summary.datasets[3].coverage.workbooks_retained = [{ value: 100000 }]
    if (issue === 'private-numeric') summary.datasets[3].coverage.public_numeric_observations = 1
    if (issue === 'private-field') summary.datasets[3].rows = [{ value: 100000 }]
    if (issue === 'private-finding') summary.findings[0].evidence_class = 'private_safe_balance'
    if (issue === 'finding-source') summary.findings[0].source_urls = ['https://www.stats.gov.cn.evil.test/']
    if (issue === 'clock') summary.generated_at = '2026-09-09T14:00:00Z'
    if (issue === 'case-capture') summary.methodology_cases[0].capture_ids = [null]
    if (issue === 'dataset-id') summary.datasets[0].id = 'extra-source'
    if (issue === 'unbound-summary') delete data.input_sha256.observatory
    if (issue === 'orphan-input') delete data.observatory
    if (issue === 'series-values') summary.findings[1].evidence_series = [{ id: 'series', value: 100000 }]
    if (issue === 'nested-dataset-metadata') summary.datasets[3].description = { balance: 100000 }
    if (issue === 'nested-case-metadata') summary.methodology_cases[0].claim = { value: 100000 }
    if (issue === 'nested-finding-metadata') summary.findings[0].interpretation = { value: 100000 }
    expect(() => validateConnectedResearch(data)).toThrow()
  })
})
