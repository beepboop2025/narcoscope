import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  BRI_ARTIFACT_FILE,
  BRI_HASH_FILE,
  BRI_PIN_SCHEMA_VERSION,
  BRI_SCHEMA_FILE,
  BRI_SCHEMA_VERSION,
  assertPalimpsestBriBoundary,
  assertPalimpsestBriPin,
  assertPagesPublicationReceipt,
  assertRailwayFleetReleaseReceipt,
  assertRailwayReleaseManifest,
  buildPalimpsestBriArtifact,
  generatePalimpsestBriArtifact,
  readTrackedJsonAtCommit,
  serializePalimpsestBriArtifact,
} from './build-palimpsest-bri.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicDir = path.join(root, 'public/data')
const pinPath = path.join(root, 'scripts/bridge/palimpsest-bri-source-pin.json')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const execFile = promisify(execFileCallback)
const commitFixture = 'a'.repeat(40)
const hashFixture = (character) => character.repeat(64)

function railwayReceiptFixture(schemaVersion = 'palimpsest.railway-fleet-deployment-receipt.v1') {
  return {
    schema_version: schemaVersion,
    generated_at: '2026-08-26T17:58:17Z',
    deployment_transport: 'railway-cli-local-upload',
    github_required: false,
    workspace: {},
    services: {
      palimpsest: {
        project_id: 'project',
        service_id: 'service',
        environment_id: 'environment',
        deployment_id: 'deployment',
        deployment_status: 'SUCCESS',
        image_digest: `sha256:${hashFixture('b')}`,
        source_commit: commitFixture,
        artifact_tree_sha256: hashFixture('c'),
        wire_archive_sha256: hashFixture('d'),
        artifact_file_count: 10,
        artifact_total_bytes: 100,
        railway_url: 'https://palimpsest-production.up.railway.app',
        health_status: 'ready',
        verification: {
          test_count: 1,
          critical_files_byte_identical: 9,
          release_manifest_byte_identical: true,
          key_routes_http_200: 1,
          hidden_source_http_404: true,
          successful_access_log_level: 'info',
          successful_access_log_error_match_count: 0,
          wdi_bundle_sha256: hashFixture('e'),
        },
        custom_domains: { 'palimpsest.info': 'pending', 'www.palimpsest.info': 'pending' },
      },
    },
    dns_cutover: {},
    stateful_migration: {},
    operations: {},
  }
}

function pagesReceiptFixture() {
  const runId = 11
  const capturedAt = '2026-08-26T15:55:34Z'
  const job = (id, name) => ({
    api_url: `https://api.github.com/jobs/${id}`,
    conclusion: 'success',
    head_sha: commitFixture,
    html_url: `https://github.com/jobs/${id}`,
    id,
    name,
    run_attempt: 1,
    run_id: runId,
  })
  const resources = [
    ['config/bri_wdi_series.json', hashFixture('1')],
    ['protocol/bri-economic-observations-v1.schema.json', hashFixture('2')],
    ['readings/bri-economic-observations-latest.json', hashFixture('3')],
  ].map(([resourcePath, hash]) => ({
    bytes: 10,
    http_status: 200,
    path: resourcePath,
    sha256: hash,
    url: `https://palimpsest.info/${resourcePath}?sha256=${hash}`,
  }))
  return {
    archived_size_receipt: {
      archive_bytes: 10,
      artifact_api_url: 'https://api.github.com/artifacts/2',
      artifact_id: 2,
      artifact_name: `pages-artifact-size-${commitFixture}`,
      bytes: 10,
      checked_in_path: `.well-known/receipts/pages-artifact-size-${commitFixture}.json`,
      digest_sha256: hashFixture('4'),
      parsed: {
        artifact_bytes: 60,
        artifact_name: 'github-pages/artifact.tar',
        artifact_sha256: hashFixture('5'),
        headroom_bytes: 40,
        limit_bytes: 100,
        publication_sha: commitFixture,
        schema_version: 'palimpsest.pages-artifact-size.v1',
        status: 'within-limit',
      },
      public_url: 'https://palimpsest.info/size.json',
      sha256: hashFixture('6'),
      workflow_run_head_sha: commitFixture,
      workflow_run_id: runId,
    },
    collection_id: hashFixture('7'),
    dataset_id: 'bri-economic-context-world-bank-wdi',
    deployment: {
      deployed_at: '2026-08-26T15:53:46Z',
      deployment_api_url: 'https://api.github.com/deployments/1',
      deployment_id: 1,
      environment: 'github-pages',
      environment_url: 'https://palimpsest.info/',
      log_url: 'https://github.com/jobs/21',
      ref: 'main',
      sha: commitFixture,
      state_at_verification: 'success',
      success_status_api_url: 'https://api.github.com/statuses/1',
      success_status_deployment_url: 'https://api.github.com/deployments/1',
      success_status_id: 1,
    },
    pages_artifact: {
      api_url: 'https://api.github.com/artifacts/1',
      archive_bytes: 10,
      captured_at: capturedAt,
      created_at: '2026-08-26T15:52:46Z',
      digest_sha256: hashFixture('8'),
      expires_at: '2026-08-27T15:52:40Z',
      id: 1,
      name: 'github-pages',
      workflow_run_head_sha: commitFixture,
      workflow_run_id: runId,
    },
    schema_version: 'palimpsest.bri-wdi-pages-publication.v1',
    served_verification: { method: 'cache_busted_https_get', resources, verified_at: capturedAt },
    source_id: 'world_bank_wdi',
    status: 'production_verified',
    workflow: {
      branch: 'main',
      conclusion: 'success',
      event: 'repository_dispatch',
      pages_deploy_job: job(21, 'Deploy exact complete Pages edition'),
      pages_deploy_job_id: 21,
      pages_package_job: job(22, 'Package exact complete Pages edition'),
      pages_package_job_id: 22,
      publication_sha: commitFixture,
      repository: 'beepboop2025/palimpsest',
      run_api_url: 'https://api.github.com/runs/11',
      run_attempt: 1,
      run_id: runId,
      run_url: 'https://github.com/runs/11',
      workflow_path: '.github/workflows/tests.yml',
    },
  }
}

function railwayManifestFixture(release) {
  const criticalPaths = [
    '.well-known/ai-catalog.json',
    'belt-and-road/index.html',
    'index.html',
    'openapi.json',
    'protocol/bri-economic-observations-v1.schema.json',
    'protocol/bri-wdi-pages-publication-v1.schema.json',
    'readings/belt-and-road-observatory-latest.json',
    'readings/bri-economic-observations-latest.json',
    'server.json',
  ]
  return {
    built_at: '2026-08-26T17:53:14Z',
    critical_files: Object.fromEntries(criticalPaths.map((criticalPath) => [
      criticalPath,
      { bytes: 1, sha256: hashFixture('9') },
    ])),
    deployment_source: 'local-git-archive',
    file_count: release.artifact_file_count,
    github_required: false,
    schema_version: 'palimpsest.railway-static-release.v1',
    source_commit: release.source_commit,
    state: 'artifact_ready',
    total_bytes: release.artifact_total_bytes,
    tree_sha256: release.artifact_tree_sha256,
  }
}

let artifact
let pin
let pinRaw
let schemaRaw

beforeAll(async () => {
  ;[pinRaw, schemaRaw] = await Promise.all([
    fs.readFile(pinPath),
    fs.readFile(path.join(publicDir, BRI_SCHEMA_FILE)),
  ])
  pin = JSON.parse(pinRaw.toString('utf8'))
  artifact = buildPalimpsestBriArtifact(pin, { pinRaw, schemaRaw })
})

const build = (value = pin, options = {}) => buildPalimpsestBriArtifact(value, {
  pinRaw: options.pinRaw ?? Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
  schemaRaw: options.schemaRaw ?? schemaRaw,
})

describe('Palimpsest Belt and Road parallel-context bridge', () => {
  it('is deterministic and byte-identical to the checked-in artifact and hash sidecar', async () => {
    const first = serializePalimpsestBriArtifact(build())
    const second = serializePalimpsestBriArtifact(build())
    const checkedIn = await fs.readFile(path.join(publicDir, BRI_ARTIFACT_FILE), 'utf8')
    const hashSidecar = await fs.readFile(path.join(publicDir, BRI_HASH_FILE), 'utf8')
    expect(first).toBe(second)
    expect(checkedIn).toBe(first)
    expect(hashSidecar).toBe(`${sha256(first)}  ${BRI_ARTIFACT_FILE}\n`)
    expect(Buffer.byteLength(first)).toBeLessThan(100_000)
  })

  it('binds the artifact, refresh pin, schema, and exact release descriptors', async () => {
    const schema = JSON.parse(await fs.readFile(path.join(publicDir, BRI_SCHEMA_FILE), 'utf8'))
    expect(pin.schemaVersion).toBe(BRI_PIN_SCHEMA_VERSION)
    expect(artifact.schemaVersion).toBe(BRI_SCHEMA_VERSION)
    expect(schema.properties.schemaVersion.const).toBe(BRI_SCHEMA_VERSION)
    expect(artifact.provenance.sourcePin.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifact.provenance.release).toMatchObject({
      verificationState: 'release_receipt_validated',
      canonicalBaseUrl: 'https://palimpsest.info',
    })
    expect(artifact.provenance.release.railwayMirrorBaseUrl).toMatch(/^https:\/\/.*\.railway\.app$/)
    expect(artifact.provenance.release.sourceRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(artifact.provenance.release.artifactTreeSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifact.provenance.release.sourceTreeOid).toMatch(/^[0-9a-f]{40}$/)
    expect(artifact.provenance.sourcePin).toMatchObject({
      bytes: pinRaw.length,
      sha256: sha256(pinRaw),
    })
    expect(artifact.provenance.schema).toMatchObject({
      bytes: schemaRaw.length,
      sha256: sha256(schemaRaw),
    })
    expect(artifact.provenance.sourceArtifacts.economics.sha256)
      .toBe(pin.sourceArtifacts.economics.sha256)
  })

  it('accepts additive v1/v2 fleet receipts but preserves every required Palimpsest gate', () => {
    const receipt = railwayReceiptFixture()
    const release = assertRailwayFleetReleaseReceipt(receipt).release
    expect(() => assertRailwayReleaseManifest(railwayManifestFixture(release), release)).not.toThrow()
    const v2 = railwayReceiptFixture('palimpsest.railway-fleet-deployment-receipt.v2')
    v2.receipt_extension = { future: true }
    v2.services.palimpsest.release_extension = 'retained but not trusted'
    expect(() => assertRailwayFleetReleaseReceipt(v2)).not.toThrow()

    const weakened = railwayReceiptFixture()
    weakened.services.palimpsest.verification.release_manifest_byte_identical = false
    expect(() => assertRailwayFleetReleaseReceipt(weakened)).toThrow(/every release-verification gate/)

    const unknownMajor = railwayReceiptFixture('palimpsest.railway-fleet-deployment-receipt.v3')
    expect(() => assertRailwayFleetReleaseReceipt(unknownMajor)).toThrow(/unsupported Railway receipt schema/)

    const wrongTree = railwayManifestFixture(release)
    wrongTree.tree_sha256 = hashFixture('f')
    expect(() => assertRailwayReleaseManifest(wrongTree, release)).toThrow(/same commit and artifact tree/)
  })

  it('fully validates Pages receipt identity and the exact served-resource set', () => {
    const receipt = pagesReceiptFixture()
    expect(assertPagesPublicationReceipt(receipt).resources.map((item) => item.path)).toEqual([
      'config/bri_wdi_series.json',
      'protocol/bri-economic-observations-v1.schema.json',
      'readings/bri-economic-observations-latest.json',
    ])

    const missing = pagesReceiptFixture()
    missing.served_verification.resources.pop()
    expect(() => assertPagesPublicationReceipt(missing)).toThrow(/exactly three served-resource entries/)

    const forged = pagesReceiptFixture()
    forged.served_verification.resources[0].url = 'https://palimpsest.info/config/bri_wdi_series.json'
    expect(() => assertPagesPublicationReceipt(forged)).toThrow(/not exact and cache-busted/)

    const staleJob = pagesReceiptFixture()
    staleJob.workflow.pages_deploy_job.head_sha = 'b'.repeat(40)
    expect(() => assertPagesPublicationReceipt(staleJob)).toThrow(/exact Pages revision and run/)
  })

  it('retains all implementation states without promoting readiness into evidence', () => {
    expect(artifact.sourceReadiness).toEqual(pin.sourceSnapshot.readiness)
    expect(Object.keys(artifact.sourceReadiness.implementationStates)).toEqual([
      'adapter_ready', 'blocked', 'link_only', 'live', 'planned',
    ])
    expect(Object.values(artifact.sourceReadiness.implementationStates)
      .reduce((total, count) => total + count, 0)).toBe(artifact.sourceReadiness.sourceCount)
    expect(artifact.sourceReadiness.buildReadySourceCount).toBe(
      artifact.sourceReadiness.implementationStates.adapter_ready
        + artifact.sourceReadiness.implementationStates.live,
    )
    const targets = Object.fromEntries(artifact.targetCoverage.flatMap((area) => (
      area.targets.map((target) => [target.targetId, target])
    )))
    expect(Object.keys(targets).sort()).toEqual([
      'balochistan_movement_history',
      'balochistan_resources_revenue',
      'cmec_portfolio',
      'cpec_portfolio',
      'gwadar_connectivity',
      'gwadar_port_free_zone',
      'gwadar_public_services',
      'kyaukpyu_port_sez',
    ])
    for (const target of Object.values(targets)) {
      expect(target.evidenceStatus).toMatch(/^[a-z0-9_]+$/)
      expect(Object.values(target.sourceReadiness.implementationStates)
        .reduce((total, count) => total + count, 0)).toBe(target.sourceReadiness.sourceCount)
      expect(target.sourceReadiness.buildReadySourceCount).toBe(
        target.sources.filter((source) => ['adapter_ready', 'live'].includes(source.implementationState)).length,
      )
    }
  })

  it('preserves official, independent, and modeled claim semantics as non-exclusive classes', () => {
    expect(artifact.claimSemantics.classificationRule).toContain('separate, non-exclusive')
    expect(Object.values(artifact.claimSemantics.sourceClassCounts)
      .reduce((total, count) => total + count, 0)).toBe(artifact.sourceReadiness.sourceCount)
    expect(artifact.claimSemantics.authorityRoleCounts).toHaveProperty('independent_observation')
    expect(artifact.claimSemantics.claimClassCounts).toHaveProperty('modeled_estimate')
    expect(artifact.claimSemantics.officialOrAdministrativeSourceIds).toContain('cpec_project_portal')
    expect(artifact.claimSemantics.independentObservationSourceIds).toContain('world_bank_wdi')
    expect(artifact.claimSemantics.modeledOrAnalyticalSourceIds).toContain('world_bank_wdi')
  })

  it('publishes only country-indicator-year coverage and preserves unavailable rows', () => {
    const totals = artifact.economicContext.coverage.totals
    expect(totals.countries).toBe(3)
    expect(totals.indicators).toBe(18)
    expect(totals.sourceRows).toBe(totals.observedRows + totals.forecastRows + totals.unavailableRows)
    expect(artifact.economicContext.coverage.countries.map((country) => country.countryCode))
      .toEqual(['CHN', 'MMR', 'PAK'])
    for (const country of artifact.economicContext.coverage.countries) {
      expect(country.indicatorCount).toBe(totals.indicators)
      expect(country.observedRowCount + country.forecastRowCount + country.unavailableRowCount)
        .toBe(country.sourceRowCount)
      for (const indicator of country.indicators) {
        expect(indicator.annualCoverage.fromYear).toBeLessThanOrEqual(indicator.annualCoverage.toYear)
        expect(indicator.annualCoverage.yearCount).toBeGreaterThan(0)
        expect(indicator.observed.yearCount + indicator.forecast.yearCount + indicator.unavailable.yearCount)
          .toBe(indicator.sourceRowCount)
      }
    }
    expect(JSON.stringify(artifact)).not.toMatch(/"(?:observations|value|latitude|longitude|coordinates)":/)
  })

  it('makes every prohibited drug-conflict-infrastructure inference machine-readable', () => {
    expect(artifact.usePolicy).toMatchObject({
      lane: 'parallel_context_only',
      crossLaneJoinPolicy: 'prohibited',
      prohibitions: {
        drugConflictInfrastructureCausalJoin: 'prohibited',
        actorClassification: 'prohibited',
        bilateralRouteInference: 'prohibited',
        guiltInference: 'prohibited',
        politicalMovementClassification: 'prohibited',
        projectAttributionFromNationalSeries: 'prohibited',
        tacticalOrNavigableUse: 'prohibited',
      },
    })
    expect(artifact.limitations.join(' ')).toContain('No person, organization, community, party, movement or armed actor is classified')
    expect(() => assertPalimpsestBriBoundary(artifact)).not.toThrow()
  })

  it('fails closed if a consumer weakens the join policy or injects row-level values', () => {
    const weakened = structuredClone(artifact)
    weakened.usePolicy.crossLaneJoinPolicy = 'country_and_time'
    expect(() => assertPalimpsestBriBoundary(weakened)).toThrow(/cross-lane joins prohibited/)

    const detailed = structuredClone(pin)
    detailed.economicSnapshot.coverage.countries[0].indicators[0].value = 123
    expect(() => assertPalimpsestBriPin(detailed)).toThrow(/unknown fields|forbidden detail fields/)
  })

  it('rejects every weakened prohibition, including project attribution and tactical use', () => {
    const keys = [
      'drugConflictInfrastructureCausalJoin',
      'actorClassification',
      'bilateralRouteInference',
      'guiltInference',
      'politicalMovementClassification',
      'projectAttributionFromNationalSeries',
      'tacticalOrNavigableUse',
    ]
    expect(Object.keys(artifact.usePolicy.prohibitions)).toEqual(keys)
    for (const key of keys) {
      const weakened = structuredClone(artifact)
      weakened.usePolicy.prohibitions[key] = 'allowed'
      expect(() => assertPalimpsestBriBoundary(weakened), key).toThrow(/required inference prohibition/)
    }
  })

  it('rejects unknown fields exhaustively instead of relying on an exact-name denylist', () => {
    const injectedPin = structuredClone(pin)
    injectedPin.economicSnapshot.actors = [{ name: 'not publishable' }]
    injectedPin.economicSnapshot.coverage.countries[0].geometry = { type: 'Point' }
    injectedPin.sourceSnapshot.targetCoverage[0].targets[0].tacticalDetails = ['not publishable']
    expect(() => assertPalimpsestBriPin(injectedPin)).toThrow(/unknown fields/)
    expect(() => build(injectedPin)).toThrow(/unknown fields/)

    const injectedArtifact = structuredClone(artifact)
    injectedArtifact.targetCoverage[0].targets[0].sources[0].actors = []
    expect(() => assertPalimpsestBriBoundary(injectedArtifact)).toThrow(/unknown fields/)
  })

  it('hashes the exact raw pin and schema bytes rather than reserialized objects', () => {
    const whitespacePin = Buffer.concat([pinRaw, Buffer.from('\n')])
    const fromWhitespacePin = build(pin, { pinRaw: whitespacePin })
    expect(fromWhitespacePin.provenance.sourcePin.sha256).toBe(sha256(whitespacePin))
    expect(fromWhitespacePin.provenance.sourcePin.sha256).not.toBe(artifact.provenance.sourcePin.sha256)

    const whitespaceSchema = Buffer.concat([schemaRaw, Buffer.from('\n')])
    const fromWhitespaceSchema = build(pin, { schemaRaw: whitespaceSchema })
    expect(fromWhitespaceSchema.provenance.schema.sha256).toBe(sha256(whitespaceSchema))
    expect(fromWhitespaceSchema.provenance.schema.sha256).not.toBe(artifact.provenance.schema.sha256)
  })

  it('makes deterministic check cover pin, schema, artifact, and sidecar bytes', async () => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-bri-check-'))
    const fixturePin = path.join(fixture, 'pin.json')
    const fixtureSchema = path.join(fixture, BRI_SCHEMA_FILE)
    const fixtureArtifact = path.join(fixture, BRI_ARTIFACT_FILE)
    const fixtureHash = path.join(fixture, BRI_HASH_FILE)
    await Promise.all([
      fs.writeFile(fixturePin, pinRaw),
      fs.writeFile(fixtureSchema, schemaRaw),
      fs.copyFile(path.join(publicDir, BRI_ARTIFACT_FILE), fixtureArtifact),
      fs.copyFile(path.join(publicDir, BRI_HASH_FILE), fixtureHash),
    ])
    await expect(generatePalimpsestBriArtifact({
      pinPath: fixturePin,
      schemaPath: fixtureSchema,
      output: fixtureArtifact,
      hashOutput: fixtureHash,
      check: true,
    })).resolves.toMatchObject({ sha256: sha256(await fs.readFile(fixtureArtifact)) })

    await fs.writeFile(fixturePin, Buffer.concat([pinRaw, Buffer.from('\n')]))
    await expect(generatePalimpsestBriArtifact({
      pinPath: fixturePin,
      schemaPath: fixtureSchema,
      output: fixtureArtifact,
      hashOutput: fixtureHash,
      check: true,
    })).rejects.toThrow(/is stale/i)

    await fs.writeFile(fixturePin, pinRaw)
    await fs.writeFile(fixtureSchema, Buffer.concat([schemaRaw, Buffer.from('\n')]))
    await expect(generatePalimpsestBriArtifact({
      pinPath: fixturePin,
      schemaPath: fixtureSchema,
      output: fixtureArtifact,
      hashOutput: fixtureHash,
      check: true,
    })).rejects.toThrow(/is stale/i)

    await fs.writeFile(fixtureSchema, schemaRaw)
    const artifactRaw = await fs.readFile(path.join(publicDir, BRI_ARTIFACT_FILE))
    await fs.writeFile(fixtureArtifact, Buffer.concat([artifactRaw, Buffer.from('\n')]))
    await expect(generatePalimpsestBriArtifact({
      pinPath: fixturePin,
      schemaPath: fixtureSchema,
      output: fixtureArtifact,
      hashOutput: fixtureHash,
      check: true,
    })).rejects.toThrow(/json.*stale/i)

    await fs.writeFile(fixtureArtifact, artifactRaw)
    await fs.writeFile(fixtureHash, `${'0'.repeat(64)}  ${BRI_ARTIFACT_FILE}\n`)
    await expect(generatePalimpsestBriArtifact({
      pinPath: fixturePin,
      schemaPath: fixtureSchema,
      output: fixtureArtifact,
      hashOutput: fixtureHash,
      check: true,
    })).rejects.toThrow(/sha256.*stale/i)
  })

  it('reads tracked source bytes from the exact commit even when the checkout is tampered', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-bri-git-'))
    const trackedPath = path.join(repository, 'readings', 'fixture.json')
    await fs.mkdir(path.dirname(trackedPath), { recursive: true })
    await execFile('git', ['init', '-q', repository])
    await execFile('git', ['-C', repository, 'config', 'user.name', 'NarcoScope Test'])
    await execFile('git', ['-C', repository, 'config', 'user.email', 'test@narcoscope.invalid'])
    await fs.writeFile(trackedPath, '{"state":"committed"}\n')
    await execFile('git', ['-C', repository, 'add', 'readings/fixture.json'])
    await execFile('git', ['-C', repository, 'commit', '-q', '-m', 'fixture'])
    const { stdout } = await execFile('git', ['-C', repository, 'rev-parse', 'HEAD'])
    const revision = stdout.trim()
    await fs.writeFile(trackedPath, '{"state":"tampered-working-tree"}\n')

    const input = await readTrackedJsonAtCommit(repository, revision, 'readings/fixture.json')
    expect(input.data).toEqual({ state: 'committed' })
    expect(input.raw.toString('utf8')).toBe('{"state":"committed"}\n')
    expect(input.descriptor.gitBlobOid).toMatch(/^[0-9a-f]{40}$/)
    expect(input.sourceRevision).toBe(revision)
  })
})
