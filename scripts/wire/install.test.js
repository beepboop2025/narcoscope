import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('wire timer installation', () => {
  it('re-arms the timer and rejects enabled but elapsed systemd state', async () => {
    const { stdout, stderr } = await execFileAsync('bash', ['deploy/wire/install.test.sh'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    })

    expect(stderr).toBe('')
    expect(stdout).toContain('NarcoScope wire timer install tests passed')
  })
})
