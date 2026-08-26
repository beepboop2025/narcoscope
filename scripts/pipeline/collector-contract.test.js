import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const tempDirs = []

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  ...options,
})

const runOk = (command, args, options = {}) => {
  const result = run(command, args, options)
  expect(result.status, `${command} ${args.join(' ')}\n${result.stderr}`).toBe(0)
  return result
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const derivedPublicArtifacts = [
  'public/data/narcoscope-palimpsest-v1.json',
  'public/data/narcoscope-palimpsest-corridors-v2.json',
  'public/news',
]

describe('automated refresh publication contract', () => {
  it('stages the derived public artifact with its source data on Hetzner', () => {
    const collector = read('deploy/collector/collect.sh')

    for (const artifact of derivedPublicArtifacts) expect(collector).toContain(`"${artifact}"`)
    expect(collector).toMatch(/git status --porcelain -- "\$\{GENERATED_PATHS\[@\]\}"/)
    expect(collector).toMatch(/git add -- "\$\{GENERATED_PATHS\[@\]\}"/)
    expect(collector).toMatch(/git -C "\$REPO" worktree add --quiet --detach/)
    expect(collector).toMatch(/git -C "\$REPO" worktree remove --force/)
    expect(collector).not.toMatch(/git (?:-[^ ]+ )*reset/)
    expect(collector).not.toMatch(/git (?:-[^ ]+ )*clean/)
  })

  it('includes the derived public artifact in quarterly refresh PRs', () => {
    const workflow = read('.github/workflows/data-refresh.yml')

    for (const artifact of derivedPublicArtifacts) expect(workflow).toContain(`            ${artifact}\n`)
  })

  it('publishes only validated output while preserving and isolating a dirty service checkout', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'narcoscope-collector-contract-'))
    tempDirs.push(fixture)
    const origin = path.join(fixture, 'origin.git')
    const serviceRepo = path.join(fixture, 'service-repo')
    const runRoot = path.join(fixture, 'runs')
    const stateDir = path.join(fixture, 'state')
    const lockDir = path.join(fixture, 'collector.lock')
    const binDir = path.join(fixture, 'bin')

    fs.mkdirSync(serviceRepo)
    fs.mkdirSync(runRoot)
    fs.mkdirSync(binDir)
    runOk('git', ['init', '--bare', origin])
    runOk('git', ['init', '-b', 'main'], { cwd: serviceRepo })
    runOk('git', ['config', 'user.name', 'Collector Contract'], { cwd: serviceRepo })
    runOk('git', ['config', 'user.email', 'collector-contract@example.invalid'], { cwd: serviceRepo })

    for (const dir of ['src/data', 'public/data', 'public/news']) {
      fs.mkdirSync(path.join(serviceRepo, dir), { recursive: true })
    }
    fs.writeFileSync(path.join(serviceRepo, 'src/data/sample.json'), '{"version":"accepted"}\n')
    fs.writeFileSync(path.join(serviceRepo, 'public/data/narcoscope-palimpsest-v1.json'), '{}\n')
    fs.writeFileSync(path.join(serviceRepo, 'public/data/narcoscope-palimpsest-corridors-v2.json'), '{}\n')
    fs.writeFileSync(path.join(serviceRepo, 'public/news/index.json'), '{}\n')
    fs.writeFileSync(path.join(serviceRepo, 'package.json'), '{"private":true}\n')
    runOk('git', ['add', '.'], { cwd: serviceRepo })
    runOk('git', ['commit', '-m', 'fixture'], { cwd: serviceRepo })
    runOk('git', ['remote', 'add', 'origin', origin], { cwd: serviceRepo })
    runOk('git', ['push', '-u', 'origin', 'main'], { cwd: serviceRepo })

    fs.writeFileSync(path.join(serviceRepo, 'src/data/sample.json'), '{"version":"failed-live-output"}\n')
    fs.writeFileSync(path.join(serviceRepo, 'public/news/live-only.json'), '{"preserve":true}\n')
    const statusBefore = runOk('git', ['status', '--porcelain'], { cwd: serviceRepo }).stdout

    const npmStub = path.join(binDir, 'npm')
    fs.writeFileSync(npmStub, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "ci" ]]; then exit 0; fi
if [[ "\${1:-}" == "run" && "\${2:-}" == "data:refresh" ]]; then
  printf '{"version":"unvalidated"}\\n' > src/data/sample.json
  exit 42
fi
exit 64
`)
    fs.chmodSync(npmStub, 0o755)

    const result = run('bash', [path.join(root, 'deploy/collector/collect.sh')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        NARCOSCOPE_REPO: serviceRepo,
        NARCOSCOPE_DEPLOY_KEY: path.join(fixture, 'unused-deploy-key'),
        NARCOSCOPE_BRANCH: 'main',
        NARCOSCOPE_RUN_ROOT: runRoot,
        NARCOSCOPE_STATE_DIR: stateDir,
        NARCOSCOPE_LOCK_DIR: lockDir,
      },
    })

    expect(result.status).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/did not pass validation; nothing pushed/)
    expect(runOk('git', ['status', '--porcelain'], { cwd: serviceRepo }).stdout).toBe(statusBefore)
    expect(fs.readFileSync(path.join(serviceRepo, 'src/data/sample.json'), 'utf8'))
      .toBe('{"version":"failed-live-output"}\n')
    expect(fs.readFileSync(path.join(serviceRepo, 'public/news/live-only.json'), 'utf8'))
      .toBe('{"preserve":true}\n')
    expect(runOk('git', ['worktree', 'list', '--porcelain'], { cwd: serviceRepo }).stdout.match(/^worktree /gm))
      .toHaveLength(1)
    expect(fs.readdirSync(runRoot)).toEqual([])
    expect(runOk('git', [`--git-dir=${origin}`, 'show', 'main:src/data/sample.json']).stdout)
      .toBe('{"version":"accepted"}\n')

    const alert = run('bash', [path.join(root, 'deploy/collector/alert.sh')], {
      env: { ...process.env, NARCOSCOPE_STATE_DIR: stateDir, NARCOSCOPE_ALERT_WEBHOOK_URL: '' },
    })
    expect(alert.status, `${alert.stdout}\n${alert.stderr}`).toBe(0)
    const failureReceipt = fs.readFileSync(path.join(stateDir, 'last-failure.json'), 'utf8')
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'status.json'), 'utf8'))).toMatchObject({
      schemaVersion: 'narcoscope.collector.status.v1',
      status: 'failed',
    })

    fs.mkdirSync(lockDir)
    const overlapping = run('bash', [path.join(root, 'deploy/collector/collect.sh')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        NARCOSCOPE_REPO: serviceRepo,
        NARCOSCOPE_DEPLOY_KEY: path.join(fixture, 'unused-deploy-key'),
        NARCOSCOPE_BRANCH: 'main',
        NARCOSCOPE_RUN_ROOT: runRoot,
        NARCOSCOPE_STATE_DIR: stateDir,
        NARCOSCOPE_LOCK_DIR: lockDir,
      },
    })
    expect(overlapping.status).toBe(75)
    expect(`${overlapping.stdout}\n${overlapping.stderr}`).toMatch(/another collector run holds/)
    expect(fs.statSync(lockDir).isDirectory()).toBe(true)
    fs.rmdirSync(lockDir)

    fs.writeFileSync(npmStub, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "ci" ]]; then exit 0; fi
if [[ "\${1:-}" == "run" && "\${2:-}" == "data:refresh" ]]; then
  printf '{"version":"validated"}\\n' > src/data/sample.json
  exit 0
fi
exit 64
`)
    fs.chmodSync(npmStub, 0o755)
    const successful = run('bash', [path.join(root, 'deploy/collector/collect.sh')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        NARCOSCOPE_REPO: serviceRepo,
        NARCOSCOPE_DEPLOY_KEY: path.join(fixture, 'unused-deploy-key'),
        NARCOSCOPE_BRANCH: 'main',
        NARCOSCOPE_RUN_ROOT: runRoot,
        NARCOSCOPE_STATE_DIR: stateDir,
        NARCOSCOPE_LOCK_DIR: lockDir,
      },
    })

    expect(successful.status, `${successful.stdout}\n${successful.stderr}`).toBe(0)
    expect(runOk('git', ['status', '--porcelain'], { cwd: serviceRepo }).stdout).toBe(statusBefore)
    expect(runOk('git', ['worktree', 'list', '--porcelain'], { cwd: serviceRepo }).stdout.match(/^worktree /gm))
      .toHaveLength(1)
    expect(fs.readdirSync(runRoot)).toEqual([])
    expect(runOk('git', [`--git-dir=${origin}`, 'show', 'main:src/data/sample.json']).stdout)
      .toBe('{"version":"validated"}\n')
    expect(fs.existsSync(lockDir)).toBe(false)
    expect(fs.readFileSync(path.join(stateDir, 'last-failure.json'), 'utf8')).toBe(failureReceipt)
    const successReceipt = JSON.parse(fs.readFileSync(path.join(stateDir, 'last-success.json'), 'utf8'))
    expect(successReceipt).toMatchObject({
      schemaVersion: 'narcoscope.collector.success.v1',
      outcome: 'pushed',
    })
    expect(successReceipt.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'status.json'), 'utf8'))).toMatchObject({
      schemaVersion: 'narcoscope.collector.status.v1',
      status: 'ok',
      outcome: 'pushed',
      revision: successReceipt.revision,
    })
    expect(fs.statSync(path.join(stateDir, 'status.json')).mode & 0o777).toBe(0o600)

    const unchanged = run('bash', [path.join(root, 'deploy/collector/collect.sh')], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        NARCOSCOPE_REPO: serviceRepo,
        NARCOSCOPE_DEPLOY_KEY: path.join(fixture, 'unused-deploy-key'),
        NARCOSCOPE_BRANCH: 'main',
        NARCOSCOPE_RUN_ROOT: runRoot,
        NARCOSCOPE_STATE_DIR: stateDir,
        NARCOSCOPE_LOCK_DIR: lockDir,
      },
    })
    expect(unchanged.status, `${unchanged.stdout}\n${unchanged.stderr}`).toBe(0)
    expect(`${unchanged.stdout}\n${unchanged.stderr}`).toMatch(/no data changes/)
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'status.json'), 'utf8'))).toMatchObject({
      status: 'ok',
      outcome: 'no_changes',
      revision: successReceipt.revision,
    })
  })

  it('records failures locally and wires a bounded optional HTTPS alert', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'narcoscope-alert-contract-'))
    tempDirs.push(fixture)
    const stateDir = path.join(fixture, 'state')
    const alert = run('bash', [path.join(root, 'deploy/collector/alert.sh')], {
      env: { ...process.env, NARCOSCOPE_STATE_DIR: stateDir, NARCOSCOPE_ALERT_WEBHOOK_URL: '' },
    })

    expect(alert.status).toBe(0)
    const markerPath = path.join(stateDir, 'last-failure.json')
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    expect(marker).toMatchObject({
      schemaVersion: 'narcoscope.collector.failure.v1',
      service: 'narcoscope-collector.service',
    })
    expect(marker.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(fs.statSync(markerPath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'status.json'), 'utf8'))).toMatchObject({
      schemaVersion: 'narcoscope.collector.status.v1',
      status: 'failed',
      failedAt: marker.failedAt,
    })

    const collectorUnit = read('deploy/collector/narcoscope-collector.service')
    const alertUnit = read('deploy/collector/narcoscope-collector-alert.service')
    const alertScript = read('deploy/collector/alert.sh')
    const installer = read('deploy/collector/install.sh')
    expect(collectorUnit).toContain('OnFailure=narcoscope-collector-alert.service')
    expect(collectorUnit).toContain('StateDirectory=narcoscope-collector')
    expect(collectorUnit).toContain('NARCOSCOPE_LOCK_DIR=/run/lock/narcoscope-collector')
    expect(alertUnit).toContain('EnvironmentFile=-/etc/narcoscope/collector-alert.env')
    expect(alertUnit).toContain('StateDirectory=narcoscope-collector')
    expect(alertScript).toContain('[[ "$WEBHOOK_URL" != https://* ]]')
    expect(alertScript).toContain('--connect-timeout 5')
    expect(alertScript).toContain('--max-time 15')
    expect(installer).toContain('narcoscope-collector-alert.service')
    expect(installer).toContain('NARCOSCOPE_ENABLE_TIMER')
  })
})
