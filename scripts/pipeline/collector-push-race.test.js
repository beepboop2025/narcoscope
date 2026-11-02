import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('collector push race', () => {
  it('rebases and re-validates past a disjoint push, and refuses everything else', async () => {
    // Hermetic: a temporary bare origin, a fake npm and no network.
    const { stdout } = await execFileAsync('bash', ['deploy/collector/collect.test.sh'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })

    expect(stdout).toContain('NarcoScope collector push-race tests passed')
  }, 120_000)
})
