import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const WORKFLOW = readFileSync('.github/workflows/registry-publish.yml', 'utf8')

describe('MCP Registry release gate', () => {
  it('requires a caller-supplied exact origin/main commit', () => {
    expect(WORKFLOW).toContain('commit:')
    expect(WORKFLOW).toContain('ref: main')
    expect(WORKFLOW).toContain('[[ "$REQUESTED_COMMIT" =~ ^[0-9a-f]{40}$ ]]')
    expect(WORKFLOW).toContain('MAIN_SHA="$(git rev-parse origin/main)"')
    expect(WORKFLOW).toContain('test "$HEAD_SHA" = "$GITHUB_SHA"')
    expect(WORKFLOW).toContain('test "$HEAD_SHA" = "$REQUESTED_COMMIT"')
  })

  it('validates matching source and hosted cards before publishing', () => {
    const cardMatch = WORKFLOW.indexOf('cmp server.json public/server.json')
    const validate = WORKFLOW.indexOf('./mcp-publisher validate server.json')
    const liveMatch = WORKFLOW.indexOf('cmp server.json "$LIVE_CARD"')
    const publish = WORKFLOW.indexOf('./mcp-publisher publish server.json')
    expect(cardMatch).toBeGreaterThan(-1)
    expect(validate).toBeGreaterThan(cardMatch)
    expect(liveMatch).toBeGreaterThan(validate)
    expect(publish).toBeGreaterThan(liveMatch)
  })

  it('proves the live 2026 discovery version before publication', () => {
    const discover = WORKFLOW.indexOf("--header 'Mcp-Method: server/discover'")
    const liveVersion = WORKFLOW.indexOf(
      '.result._meta["io.modelcontextprotocol/serverInfo"].version == $version',
    )
    const publish = WORKFLOW.indexOf('./mcp-publisher publish server.json')
    expect(WORKFLOW).toContain("--header 'MCP-Protocol-Version: 2026-07-28'")
    expect(WORKFLOW).toContain('io.modelcontextprotocol/clientCapabilities')
    expect(WORKFLOW).toContain("grep -qi '^Mcp-Session-Id:'")
    expect(WORKFLOW).toContain('MCP 2026 response unexpectedly created a protocol session')
    expect(discover).toBeGreaterThan(-1)
    expect(liveVersion).toBeGreaterThan(discover)
    expect(publish).toBeGreaterThan(liveVersion)
  })

  it('verifies the exact Registry version is active and latest after publishing', () => {
    const publish = WORKFLOW.indexOf('./mcp-publisher publish server.json')
    const exact = WORKFLOW.indexOf('/versions/${RELEASE_VERSION}')
    const latest = WORKFLOW.indexOf('/versions/latest')
    const active = WORKFLOW.lastIndexOf('.status == "active"')
    const isLatest = WORKFLOW.lastIndexOf('.isLatest == true')
    expect(exact).toBeGreaterThan(publish)
    expect(latest).toBeGreaterThan(publish)
    expect(active).toBeGreaterThan(latest)
    expect(isLatest).toBeGreaterThan(active)
  })
})
