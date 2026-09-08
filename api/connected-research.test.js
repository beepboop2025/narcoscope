import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTED_FILE, connectedSha256, loadConnectedResearch, validateConnectedResearch } from '../lib/connected-research.mjs'
import { TOOLS, toolOutputIsValid } from './mcp.mjs'
import { capabilities } from './lib/narcoscope.mjs'

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
})
