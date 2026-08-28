import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  BRI_ARTIFACT_FILE,
  BRI_HASH_FILE,
  BRI_SCHEMA_FILE,
} from '../lib/palimpsest-bri-contract.mjs'
import {
  loadVerifiedPalimpsestBriArtifact,
  verifiedPalimpsestBriEnvelope,
} from './lib/palimpsest-bri.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const canonicalDataDir = path.join(root, 'public/data')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const serialize = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')

async function fixtureDataDir() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-bri-loader-'))
  await Promise.all([
    fs.copyFile(path.join(canonicalDataDir, BRI_ARTIFACT_FILE), path.join(dataDir, BRI_ARTIFACT_FILE)),
    fs.copyFile(path.join(canonicalDataDir, BRI_HASH_FILE), path.join(dataDir, BRI_HASH_FILE)),
    fs.copyFile(path.join(canonicalDataDir, BRI_SCHEMA_FILE), path.join(dataDir, BRI_SCHEMA_FILE)),
  ])
  return dataDir
}

async function writeArtifact(dataDir, artifact) {
  const raw = serialize(artifact)
  await Promise.all([
    fs.writeFile(path.join(dataDir, BRI_ARTIFACT_FILE), raw),
    fs.writeFile(path.join(dataDir, BRI_HASH_FILE), `${sha256(raw)}  ${BRI_ARTIFACT_FILE}\n`),
  ])
}

async function mutateArtifact(mutate) {
  const dataDir = await fixtureDataDir()
  const artifact = JSON.parse(await fs.readFile(path.join(dataDir, BRI_ARTIFACT_FILE), 'utf8'))
  mutate(artifact)
  await writeArtifact(dataDir, artifact)
  return dataDir
}

describe('verified Palimpsest BRI runtime loader', () => {
  it('verifies raw bytes, sidecar, metaschema, artifact schema, and semantic boundary', async () => {
    const loaded = await loadVerifiedPalimpsestBriArtifact()
    expect(loaded.artifactSha256).toBe(sha256(loaded.artifactRaw))
    expect(loaded.artifact).toEqual(JSON.parse(loaded.artifactRaw.toString('utf8')))
    expect(loaded.artifact.usePolicy.prohibitions).toMatchObject({
      projectAttributionFromNationalSeries: 'prohibited',
      tacticalOrNavigableUse: 'prohibited',
    })
  })

  it('returns an envelope whose data is exactly the artifact value and whose links are separate', async () => {
    const [envelope, loaded] = await Promise.all([
      verifiedPalimpsestBriEnvelope(),
      loadVerifiedPalimpsestBriArtifact(),
    ])
    expect(envelope.data).toEqual(loaded.artifact)
    expect(JSON.stringify(envelope.data)).toBe(JSON.stringify(JSON.parse(loaded.artifactRaw.toString('utf8'))))
    expect(envelope.data).not.toHaveProperty('canonicalUrl')
    expect(envelope.data).not.toHaveProperty('hashUrl')
    expect(envelope.links).toMatchObject({
      canonical: 'https://narcoscope.com/data/narcoscope-palimpsest-bri-v1.json',
      sha256: 'https://narcoscope.com/data/narcoscope-palimpsest-bri-v1.json.sha256',
    })
  })

  it('fails closed on a malformed or mismatched SHA-256 sidecar', async () => {
    const malformedDir = await fixtureDataDir()
    await fs.writeFile(path.join(malformedDir, BRI_HASH_FILE), `${'0'.repeat(64)} ${BRI_ARTIFACT_FILE}\n`)
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir: malformedDir })).rejects.toThrow(/sidecar is malformed/)

    const mismatchDir = await fixtureDataDir()
    await fs.writeFile(path.join(mismatchDir, BRI_HASH_FILE), `${'0'.repeat(64)}  ${BRI_ARTIFACT_FILE}\n`)
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir: mismatchDir })).rejects.toThrow(/does not match/)
  })

  it('caches one successful verification and clears rejected cache entries for a safe retry', async () => {
    const validDir = await fixtureDataDir()
    const [first, second] = await Promise.all([
      loadVerifiedPalimpsestBriArtifact({ dataDir: validDir }),
      loadVerifiedPalimpsestBriArtifact({ dataDir: validDir }),
    ])
    expect(first).toBe(second)

    const retryDir = await fixtureDataDir()
    await fs.writeFile(path.join(retryDir, BRI_HASH_FILE), `${'0'.repeat(64)}  ${BRI_ARTIFACT_FILE}\n`)
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir: retryDir })).rejects.toThrow(/does not match/)
    await fs.copyFile(path.join(canonicalDataDir, BRI_HASH_FILE), path.join(retryDir, BRI_HASH_FILE))
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir: retryDir })).resolves.toMatchObject({
      artifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('fails closed when the packaged schema is not metaschema-valid', async () => {
    const dataDir = await fixtureDataDir()
    const [artifactRaw, schemaRaw] = await Promise.all([
      fs.readFile(path.join(dataDir, BRI_ARTIFACT_FILE)),
      fs.readFile(path.join(dataDir, BRI_SCHEMA_FILE)),
    ])
    const artifact = JSON.parse(artifactRaw.toString('utf8'))
    const schema = JSON.parse(schemaRaw.toString('utf8'))
    schema.type = 42
    const invalidSchemaRaw = serialize(schema)
    artifact.provenance.schema.bytes = invalidSchemaRaw.length
    artifact.provenance.schema.sha256 = sha256(invalidSchemaRaw)
    await Promise.all([
      fs.writeFile(path.join(dataDir, BRI_SCHEMA_FILE), invalidSchemaRaw),
      writeArtifact(dataDir, artifact),
    ])
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir })).rejects.toThrow(/not metaschema-valid/)
  })

  it('fails closed on schema-invalid unknown fields even with a matching artifact sidecar', async () => {
    const dataDir = await fixtureDataDir()
    const artifact = JSON.parse(await fs.readFile(path.join(dataDir, BRI_ARTIFACT_FILE), 'utf8'))
    artifact.economicContext.actors = [{ id: 'forbidden' }]
    await writeArtifact(dataDir, artifact)
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir })).rejects.toThrow(/does not satisfy its JSON Schema/)
  })

  it('runs the independent semantic boundary after schema validation', async () => {
    const dataDir = await fixtureDataDir()
    const [artifactRaw, schemaRaw] = await Promise.all([
      fs.readFile(path.join(dataDir, BRI_ARTIFACT_FILE)),
      fs.readFile(path.join(dataDir, BRI_SCHEMA_FILE)),
    ])
    const artifact = JSON.parse(artifactRaw.toString('utf8'))
    const schema = JSON.parse(schemaRaw.toString('utf8'))
    schema.$defs.usePolicy.properties.prohibitions.properties.projectAttributionFromNationalSeries = {
      enum: ['prohibited', 'allowed'],
    }
    const weakenedSchemaRaw = serialize(schema)
    artifact.provenance.schema.bytes = weakenedSchemaRaw.length
    artifact.provenance.schema.sha256 = sha256(weakenedSchemaRaw)
    artifact.usePolicy.prohibitions.projectAttributionFromNationalSeries = 'allowed'
    await Promise.all([
      fs.writeFile(path.join(dataDir, BRI_SCHEMA_FILE), weakenedSchemaRaw),
      writeArtifact(dataDir, artifact),
    ])
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir })).rejects.toThrow(/required inference prohibition/)
  })

  it('rejects non-canonical duplicate-friendly byte rewrites even with a matching sidecar', async () => {
    const dataDir = await fixtureDataDir()
    const raw = await fs.readFile(path.join(dataDir, BRI_ARTIFACT_FILE))
    const rewritten = Buffer.concat([raw, Buffer.from('\n')])
    await Promise.all([
      fs.writeFile(path.join(dataDir, BRI_ARTIFACT_FILE), rewritten),
      fs.writeFile(path.join(dataDir, BRI_HASH_FILE), `${sha256(rewritten)}  ${BRI_ARTIFACT_FILE}\n`),
    ])
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir })).rejects.toThrow(/deterministic canonical serialization/)
  })

  it.each([
    {
      name: 'duplicate target source identities',
      mutate(artifact) {
        const target = artifact.targetCoverage.flatMap((area) => area.targets)
          .find((candidate) => candidate.sources.length > 1)
        target.sources[1].sourceId = target.sources[0].sourceId
      },
      error: /duplicate sourceId/,
    },
    {
      name: 'rights-status totals that contradict sourceCount',
      mutate(artifact) {
        artifact.sourceReadiness.rightsStatusCounts.attribution += 1
      },
      error: /rights-status counts do not sum/,
    },
    {
      name: 'claim-semantics source totals that contradict readiness',
      mutate(artifact) {
        artifact.claimSemantics.sourceClassCounts.research += 1
        artifact.claimSemantics.authorityRoleCounts.analytical_estimate += 1
      },
      error: /source-class counts do not sum to source readiness/,
    },
    {
      name: 'a non-exclusive claim-class count larger than the source population',
      mutate(artifact) {
        artifact.claimSemantics.claimClassCounts.allegation = artifact.sourceReadiness.sourceCount + 1
      },
      error: /claimClassCounts\.allegation exceeds the source population/,
    },
    {
      name: 'official source IDs that contradict derivable source-class counts',
      mutate(artifact) {
        artifact.claimSemantics.officialOrAdministrativeSourceIds.pop()
      },
      error: /officialOrAdministrativeSourceIds does not match/,
    },
    {
      name: 'independent source IDs that contradict the authority-role count',
      mutate(artifact) {
        artifact.claimSemantics.independentObservationSourceIds.pop()
      },
      error: /independentObservationSourceIds does not match/,
    },
    {
      name: 'modeled or analytical IDs outside non-exclusive count bounds',
      mutate(artifact) {
        artifact.claimSemantics.claimClassCounts.modeled_estimate = 0
      },
      error: /modeledOrAnalyticalSourceIds is inconsistent/,
    },
    {
      name: 'modeled or analytical union larger than the source population',
      mutate(artifact) {
        const { sourceCount } = artifact.sourceReadiness
        artifact.claimSemantics.claimClassCounts.modeled_estimate = sourceCount
        artifact.claimSemantics.claimClassCounts.analytical_estimate = sourceCount
        artifact.claimSemantics.modeledOrAnalyticalSourceIds = Array.from(
          { length: sourceCount + 1 },
          (_, index) => `review_fixture_${index}`,
        )
      },
      error: /modeledOrAnalyticalSourceIds is inconsistent/,
    },
    {
      name: 'repeated source identities with inconsistent target metadata',
      mutate(artifact) {
        const sources = artifact.targetCoverage.flatMap((area) => area.targets)
          .flatMap((target) => target.sources)
        const firstIndex = sources.findIndex((source, index) => (
          sources.findIndex((candidate) => candidate.sourceId === source.sourceId) < index
        ))
        const repeated = sources[firstIndex]
        repeated.rightsStatus = repeated.rightsStatus === 'attribution' ? 'public_domain' : 'attribution'
      },
      error: /repeats sourceId .* with inconsistent metadata/,
    },
    {
      name: 'unavailable reason counts that contradict unavailable years',
      mutate(artifact) {
        const indicator = artifact.economicContext.coverage.countries
          .flatMap((country) => country.indicators)
          .find((candidate) => candidate.unavailable.yearCount > 0)
        indicator.unavailable.reasonCounts.source_value_null += 1
      },
      error: /reasonCounts do not sum/,
    },
    {
      name: 'coverage counts that exceed their inclusive year span',
      mutate(artifact) {
        const indicator = artifact.economicContext.coverage.countries[0].indicators
          .find((candidate) => candidate.annualCoverage.yearCount > 1)
        indicator.annualCoverage.toYear = indicator.annualCoverage.fromYear
      },
      error: /yearCount exceeds its inclusive year span/,
    },
    {
      name: 'country state aggregates that contradict indicator windows',
      mutate(artifact) {
        const country = artifact.economicContext.coverage.countries
          .find((candidate) => candidate.unavailableRowCount > 0)
        country.observedRowCount += 1
        country.unavailableRowCount -= 1
        artifact.economicContext.coverage.totals.observedRows += 1
        artifact.economicContext.coverage.totals.unavailableRows -= 1
      },
      error: /observedRowCount does not match indicator windows/,
    },
    {
      name: 'duplicate series IDs within one country',
      mutate(artifact) {
        const indicators = artifact.economicContext.coverage.countries[0].indicators
        indicators[1].seriesId = indicators[0].seriesId
        indicators[1].indicatorId = indicators[0].indicatorId
        indicators[1].unit = indicators[0].unit
      },
      error: /contains duplicate seriesId values/,
    },
    {
      name: 'different same-sized series sets across countries',
      mutate(artifact) {
        artifact.economicContext.coverage.countries[0].indicators[0].seriesId = 'bri.context.wdi.review_fixture'
        artifact.economicContext.coverage.totals.indicators += 1
      },
      error: /does not contain the exact shared series set/,
    },
  ])('fails the semantic boundary on $name despite valid JSON Schema and sidecar bytes', async ({ mutate, error }) => {
    const dataDir = await mutateArtifact(mutate)
    await expect(loadVerifiedPalimpsestBriArtifact({ dataDir })).rejects.toThrow(error)
  })
})
