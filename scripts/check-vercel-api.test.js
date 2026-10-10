import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { checkVercelApi } from './check-vercel-api.mjs'

let fixture
afterEach(() => { if (fixture) rmSync(fixture, { recursive: true, force: true }) })

it('keeps the deployed API limited to the MCP and REST handlers', () => {
  expect(checkVercelApi()).toEqual(['api/mcp.mjs', 'api/v1.mjs'])
})

it('rejects an accidental helper endpoint before deployment', () => {
  fixture = mkdtempSync(path.join(os.tmpdir(), 'narcoscope-api-'))
  mkdirSync(path.join(fixture, 'api/_lib'), { recursive: true })
  writeFileSync(path.join(fixture, 'vercel.json'), JSON.stringify({ functions: { 'api/v1.mjs': {} } }))
  writeFileSync(path.join(fixture, 'api/v1.mjs'), '')
  writeFileSync(path.join(fixture, 'api/_lib/helper.mjs'), '')
  writeFileSync(path.join(fixture, 'api/_fixture.test.js'), '')
  expect(checkVercelApi(fixture)).toEqual(['api/v1.mjs'])
  writeFileSync(path.join(fixture, 'api/fixture.test.js'), '')
  expect(() => checkVercelApi(fixture)).toThrow('api/fixture.test.js')
})
