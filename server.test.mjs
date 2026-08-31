import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRailwayContext, project } from 'railway/iac'

import railwayConfig from './.railway/railway.ts'
import { PROTOCOL_VERSION, SERVER_VERSION } from './api/mcp.mjs'
import {
  BRI_ARTIFACT_FILE,
  BRI_HASH_FILE,
  BRI_SCHEMA_FILE,
} from './lib/palimpsest-bri-contract.mjs'
import { createNarcoscopeServer, loadFleetReleaseIdentity } from './server.mjs'

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

async function requestRaw(path, { body, headers = {}, method = 'GET' } = {}) {
  const target = new URL(baseUrl)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolveRequest({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
        status: response.statusCode,
      }))
    })
    request.on('error', rejectRequest)
    request.end(body)
  })
}

beforeAll(async () => {
  previousRevision = process.env.NARCOSCOPE_REVISION
  process.env.NARCOSCOPE_REVISION = 'a'.repeat(40)
  const distDir = await mkdtemp(join(tmpdir(), 'narcoscope-server-'))
  await mkdir(join(distDir, 'assets'))
  await mkdir(join(distDir, '.well-known'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>NarcoScope</title>')
  await writeFile(join(distDir, 'robots.txt'), 'User-agent: *\n')
  await writeFile(join(distDir, '.well-known', 'security.txt'), 'Contact: mailto:security@narcoscope.com\n')
  await copyFile(
    new URL('./public/.well-known/api-catalog', import.meta.url),
    join(distDir, '.well-known', 'api-catalog'),
  )
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
    expect(dockerfile).toContain('/app/release-manifest.json ./release-manifest.json')
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
      source_commit: 'a'.repeat(40),
      releaseIdentity: 'environment-fallback',
      briArtifact: 'verified',
    })
  })

  it('binds health to the exact immutable Hetzner fleet release manifest', async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), 'narcoscope-release-'))
    const releaseManifestPath = join(releaseDir, 'release-manifest.json')
    const manifest = {
      files: [],
      format: 'fleet-release-manifest/v1',
      product_id: 'narcoscope',
      source: {
        branch: 'main',
        commit: 'b'.repeat(40),
        repository: 'git@github-narcoscope:beepboop2025/narcoscope.git',
      },
      tree_sha256: 'c'.repeat(64),
    }
    const manifestRaw = Buffer.from(JSON.stringify(manifest))
    await writeFile(releaseManifestPath, manifestRaw)
    const identity = await loadFleetReleaseIdentity(releaseManifestPath)
    expect(identity).toEqual({
      sourceCommit: 'b'.repeat(40),
      releaseId: createHash('sha256').update(manifestRaw).digest('hex'),
      treeSha256: 'c'.repeat(64),
    })

    const priorRevision = process.env.NARCOSCOPE_REVISION
    delete process.env.NARCOSCOPE_REVISION
    const releaseServer = createNarcoscopeServer({
      distDir: fileURLToPath(new URL('./dist', import.meta.url)),
      releaseManifestPath,
      briLoader: async () => ({
        artifactRaw: Buffer.from('same'),
        artifactSha256: 'd'.repeat(64),
        schemaRaw: Buffer.from('schema'),
      }),
    })
    await new Promise((resolveListen) => releaseServer.listen(0, '127.0.0.1', resolveListen))
    const address = releaseServer.address()
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        status: 'ready',
        revision: 'b'.repeat(40),
        source_commit: 'b'.repeat(40),
        release_id: identity.releaseId,
        tree_sha256: 'c'.repeat(64),
        releaseIdentity: 'fleet-manifest',
      })
    } finally {
      await new Promise((resolveClose) => releaseServer.close(resolveClose))
      process.env.NARCOSCOPE_REVISION = priorRevision
    }
  })

  it('fails health closed when a preserved revision conflicts with the fleet manifest', async () => {
    const priorRevision = process.env.NARCOSCOPE_REVISION
    process.env.NARCOSCOPE_REVISION = 'a'.repeat(40)
    const conflictServer = createNarcoscopeServer({
      distDir: fileURLToPath(new URL('./dist', import.meta.url)),
      releaseIdentityLoader: async () => ({
        sourceCommit: 'b'.repeat(40),
        releaseId: 'c'.repeat(64),
        treeSha256: 'd'.repeat(64),
      }),
    })
    await new Promise((resolveListen) => conflictServer.listen(0, '127.0.0.1', resolveListen))
    const address = conflictServer.address()
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        status: 'unavailable',
        revision: null,
        releaseIdentity: 'unavailable',
      })
    } finally {
      await new Promise((resolveClose) => conflictServer.close(resolveClose))
      process.env.NARCOSCOPE_REVISION = priorRevision
    }
  })

  it('does not fall back to an environment revision when the fleet manifest is malformed', async () => {
    const malformedServer = createNarcoscopeServer({
      distDir: fileURLToPath(new URL('./dist', import.meta.url)),
      releaseIdentityLoader: async () => { throw new Error('invalid manifest') },
    })
    await new Promise((resolveListen) => malformedServer.listen(0, '127.0.0.1', resolveListen))
    const address = malformedServer.address()
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        status: 'unavailable',
        revision: null,
        releaseIdentity: 'unavailable',
      })
    } finally {
      await new Promise((resolveClose) => malformedServer.close(resolveClose))
    }
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
    expect(payload.result.tools.every((tool) => tool.outputSchema)).toBe(true)
    expect(response.headers.get('link')).toContain('/.well-known/api-catalog')
  })

  it('serves the MCP 2026 stateless discovery lane without session state', async () => {
    const response = await fetch(baseUrl + '/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-method': 'server/discover',
        'mcp-protocol-version': PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'railway-discover',
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientInfo': {
              name: 'narcoscope-server-test',
              version: '1.0.0',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.has('mcp-session-id')).toBe(false)
    expect(await response.json()).toMatchObject({
      result: {
        resultType: 'complete',
        supportedVersions: [PROTOCOL_VERSION],
        ttlMs: 300_000,
        cacheScope: 'public',
        _meta: {
          'io.modelcontextprotocol/serverInfo': { version: SERVER_VERSION },
        },
      },
    })
  })

  it('serves static assets and applies the SPA fallback', async () => {
    const asset = await fetch(baseUrl + '/robots.txt')
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('User-agent')

    const spa = await fetch(baseUrl + '/corridors')
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('<title>NarcoScope</title>')
  })

  it.each([
    ['GET', '/.git/config'],
    ['HEAD', '/%2Egit/config'],
    ['GET', '/scripts//bridge/palimpsest-bri-source-pin.json'],
    ['HEAD', '/ScRiPtS/bridge/source-pin'],
    ['GET', '/api/lib/palimpsest-bri.mjs'],
    ['HEAD', '/server.mjs'],
    ['GET', '/PACKAGE.JSON'],
    ['HEAD', '/public/data/narcoscope-palimpsest-bri-v1.json'],
    ['GET', '/assets/%2e%2e%2fserver.mjs'],
    ['HEAD', '/%2e%2e%2fpackage.json'],
    ['GET', '/corridors/.env'],
  ])('fails closed for protected static path %s %s', async (method, path) => {
    const response = await fetch(baseUrl + path, { method })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    if (method === 'HEAD') {
      expect(await response.text()).toBe('')
    } else {
      expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
    }
  })

  it('serves intentional public paths while keeping SPA routing intact', async () => {
    const [wellKnown, apiCatalog, apiCatalogHead, briAsset, spa, spaHead, missingWellKnown] = await Promise.all([
      fetch(baseUrl + '/.well-known/security.txt'),
      fetch(baseUrl + '/.well-known/api-catalog'),
      fetch(baseUrl + '/.well-known/api-catalog', { method: 'HEAD' }),
      fetch(baseUrl + `/data/${BRI_ARTIFACT_FILE}`),
      fetch(baseUrl + '/corridors'),
      fetch(baseUrl + '/corridors', { method: 'HEAD' }),
      fetch(baseUrl + '/.well-known/not-published'),
    ])

    expect(wellKnown.status).toBe(200)
    expect(await wellKnown.text()).toContain('security@narcoscope.com')
    expect(apiCatalog.status).toBe(200)
    expect(apiCatalog.headers.get('content-type'))
      .toBe('application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"')
    expect(apiCatalog.headers.get('link')).toContain('rel="api-catalog"')
    expect(apiCatalog.headers.get('access-control-allow-origin')).toBe('*')
    expect((await apiCatalog.json()).linkset.map((entry) => entry.anchor)).toContain(
      'https://narcoscope.com/mcp',
    )
    expect(apiCatalogHead.status).toBe(200)
    expect(await apiCatalogHead.text()).toBe('')
    expect(briAsset.status).toBe(200)
    expect((await briAsset.json()).schemaVersion).toBe('narcoscope.palimpsest.bri-context.v1')
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('<title>NarcoScope</title>')
    expect(spaHead.status).toBe(200)
    expect(spaHead.headers.get('content-type')).toContain('text/html')
    expect(await spaHead.text()).toBe('')
    expect(missingWellKnown.status).toBe(404)
    expect(missingWellKnown.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    '/../robots.txt',
    '/%2e%2e/robots.txt',
    '/foo/../../robots.txt',
    '/%2e%2e%2frobots.txt',
    '/foo/%2e%2e%5crobots.txt',
    '/foo/../healthz?probe=1',
    '/foo/%2e%2e/api/v1/palimpsest-bri',
    '/foo/../mcp',
  ])('rejects traversal in the raw HTTP request target %s', async (path) => {
    const response = await requestRaw(path)
    expect(response.status).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: 'not_found' })
  })

  it('preserves raw query and encoded-question-mark semantics for legitimate routes', async () => {
    const mcpBody = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} })
    const [api, mcp, health, spa] = await Promise.all([
      requestRaw('/api/v1?resource=palimpsest-corridors&limit=1'),
      requestRaw('/mcp?transport=http', {
        method: 'POST',
        headers: {
          'content-length': Buffer.byteLength(mcpBody),
          'content-type': 'application/json',
        },
        body: mcpBody,
      }),
      requestRaw('/healthz?probe=raw'),
      requestRaw('/corridors%3Fdetail?campaign=raw'),
    ])

    expect(api.status).toBe(200)
    expect(JSON.parse(api.body)).toMatchObject({ ok: true, resource: 'palimpsest-corridors' })
    expect(mcp.status).toBe(200)
    expect(JSON.parse(mcp.body).result.tools.map((tool) => tool.name)).toContain('get_palimpsest_bri_context')
    expect(health.status).toBe(200)
    expect(JSON.parse(health.body).status).toBe('ready')
    expect(spa.status).toBe(200)
    expect(spa.body).toContain('<title>NarcoScope</title>')
  })

  it('returns a JSON 400 for malformed percent encoding in the raw path', async () => {
    const response = await requestRaw('/corridors/%E0%A4%A?campaign=raw')
    expect(response.status).toBe(400)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(response.body)).toEqual({ ok: false, error: 'invalid_path' })
  })
})
