import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRailwayContext, project } from 'railway/iac'

import railwayConfig from './.railway/railway.ts'
import {
  BRI_ARTIFACT_FILE,
  BRI_HASH_FILE,
  BRI_SCHEMA_FILE,
} from './lib/palimpsest-bri-contract.mjs'
import { createNarcoscopeServer } from './server.mjs'

let baseUrl
let previousRevision
let server

async function copyBriData(distDir) {
  const dataDir = join(distDir, 'data')
  await mkdir(dataDir, { recursive: true })
  await Promise.all([BRI_ARTIFACT_FILE, BRI_HASH_FILE, BRI_SCHEMA_FILE].map((file) => (
    copyFile(new URL(`./public/data/${file}`, import.meta.url), join(dataDir, file))
  )))
  return dataDir
}

beforeAll(async () => {
  previousRevision = process.env.NARCOSCOPE_REVISION
  process.env.NARCOSCOPE_REVISION = 'a'.repeat(40)
  const distDir = await mkdtemp(join(tmpdir(), 'narcoscope-server-'))
  await mkdir(join(distDir, 'assets'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>NarcoScope</title>')
  await writeFile(join(distDir, 'robots.txt'), 'User-agent: *\n')
  await copyBriData(distDir)
  server = createNarcoscopeServer({ distDir })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  baseUrl = 'http://127.0.0.1:' + address.port
})

afterAll(async () => {
  if (server) await new Promise((resolveClose) => server.close(resolveClose))
  if (previousRevision === undefined) delete process.env.NARCOSCOPE_REVISION
  else process.env.NARCOSCOPE_REVISION = previousRevision
})

describe('Railway HTTP server', () => {
  it('builds the container frontend with production React semantics', async () => {
    const [dockerfile, packageJsonRaw] = await Promise.all([
      readFile(new URL('./Dockerfile.railway', import.meta.url), 'utf8'),
      readFile(new URL('./package.json', import.meta.url), 'utf8'),
    ])
    const packageJson = JSON.parse(packageJsonRaw)
    const install = dockerfile.indexOf('RUN NPM_CONFIG_PRODUCTION=false npm ci')
    const production = dockerfile.indexOf('ENV NODE_ENV=production', install)
    const build = dockerfile.indexOf('RUN npm run build', production)
    expect(install).toBeGreaterThan(-1)
    expect(production).toBeGreaterThan(install)
    expect(build).toBeGreaterThan(production)
    expect(dockerfile).not.toContain('NODE_ENV=development')
    expect(dockerfile).toContain('RUN npm prune --omit=dev')
    expect(dockerfile).toContain('/app/node_modules ./node_modules')
    expect(dockerfile).toContain('COPY --chown=node:node lib ./lib')
    expect(packageJson.scripts.build).toMatch(/^npm run bridge:palimpsest-bri:check &&/)
  })

  it('preserves the local-upload Railway infrastructure contract', async () => {
    const context = createRailwayContext({
      command: 'plan',
      environment: 'production',
      projectName: 'narcoscope',
    })
    const definition = await railwayConfig(context, project)

    expect(definition.name).toBe('narcoscope')
    expect(definition.resources).toHaveLength(1)
    expect(definition.resources[0]).toEqual({
      address: 'service.narcoscope-web',
      type: 'service',
      kind: 'empty',
      name: 'narcoscope-web',
      build: {
        builder: 'DOCKERFILE',
        dockerfilePath: 'Dockerfile.railway',
      },
      deploy: {
        healthcheckPath: '/healthz',
        healthcheckTimeout: 180,
        numReplicas: 1,
        restartPolicyMaxRetries: 5,
      },
      networking: {
        customDomains: {
          'narcoscope.com': { port: 8080 },
          'www.narcoscope.com': { port: 8080 },
        },
      },
      variables: {
        NARCOSCOPE_REVISION: { type: 'preserve' },
      },
    })
    await expect(readFile(new URL('./railway.json', import.meta.url), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('exposes a no-store liveness endpoint', async () => {
    const response = await fetch(baseUrl + '/healthz')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      status: 'ready',
      service: 'narcoscope',
      revision: 'a'.repeat(40),
      briArtifact: 'verified',
    })
  })

  it('fails health closed without an exact source revision', async () => {
    const revision = process.env.NARCOSCOPE_REVISION
    delete process.env.NARCOSCOPE_REVISION
    try {
      const response = await fetch(baseUrl + '/healthz')
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        status: 'unavailable',
        service: 'narcoscope',
        revision: null,
      })
    } finally {
      process.env.NARCOSCOPE_REVISION = revision
    }
  })

  it('fails readiness closed when the packaged BRI trust chain is unavailable', async () => {
    const isolatedDist = await mkdtemp(join(tmpdir(), 'narcoscope-server-unavailable-'))
    await writeFile(join(isolatedDist, 'index.html'), '<!doctype html><title>NarcoScope</title>')
    const unavailableServer = createNarcoscopeServer({
      distDir: isolatedDist,
      briLoader: async () => { throw new Error('invalid BRI artifact') },
    })
    await new Promise((resolveListen) => unavailableServer.listen(0, '127.0.0.1', resolveListen))
    const address = unavailableServer.address()
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        status: 'unavailable',
        revision: 'a'.repeat(40),
        briArtifact: 'unavailable',
      })
    } finally {
      await new Promise((resolveClose) => unavailableServer.close(resolveClose))
    }
  })

  it('fails readiness closed when the built static BRI bytes drift from the packaged bytes', async () => {
    const driftDist = await mkdtemp(join(tmpdir(), 'narcoscope-server-drift-'))
    await writeFile(join(driftDist, 'index.html'), '<!doctype html><title>NarcoScope</title>')
    const dataDir = await copyBriData(driftDist)
    const artifact = JSON.parse(await readFile(join(dataDir, BRI_ARTIFACT_FILE), 'utf8'))
    artifact.limitations[0] = `${artifact.limitations[0]} Served-copy drift fixture.`
    const raw = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    const digest = createHash('sha256').update(raw).digest('hex')
    await Promise.all([
      writeFile(join(dataDir, BRI_ARTIFACT_FILE), raw),
      writeFile(join(dataDir, BRI_HASH_FILE), `${digest}  ${BRI_ARTIFACT_FILE}\n`),
    ])
    const driftServer = createNarcoscopeServer({ distDir: driftDist })
    await new Promise((resolveListen) => driftServer.listen(0, '127.0.0.1', resolveListen))
    const address = driftServer.address()
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        status: 'unavailable',
        revision: 'a'.repeat(40),
        briArtifact: 'unavailable',
      })
    } finally {
      await new Promise((resolveClose) => driftServer.close(resolveClose))
    }
  })

  it('adapts the REST handler without a Vercel runtime', async () => {
    const response = await fetch(baseUrl + '/api/v1/palimpsest-corridors')
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ ok: true, resource: 'palimpsest-corridors' })
    expect(payload.data).toHaveProperty('geographies')
    expect(payload.data.geographies).toHaveLength(3)
  })

  it('serves the bounded Palimpsest BRI context without a Vercel runtime', async () => {
    const response = await fetch(baseUrl + '/api/v1/palimpsest-bri')
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ ok: true, resource: 'palimpsest-bri' })
    expect(payload.data.data.usePolicy.crossLaneJoinPolicy).toBe('prohibited')
    expect(payload.data.data.economicContext.coverage.totals.countries).toBe(3)
  })

  it('adapts the MCP handler without a Vercel runtime', async () => {
    const response = await fetch(baseUrl + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.result.tools.map((tool) => tool.name)).toContain('get_palimpsest_corridors')
    expect(payload.result.tools.map((tool) => tool.name)).toContain('get_palimpsest_bri_context')
  })

  it('serves static assets and applies the SPA fallback', async () => {
    const asset = await fetch(baseUrl + '/robots.txt')
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('User-agent')

    const spa = await fetch(baseUrl + '/corridors')
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('<title>NarcoScope</title>')
  })
})
