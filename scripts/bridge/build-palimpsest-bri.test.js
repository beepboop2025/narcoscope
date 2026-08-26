import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
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
  buildPalimpsestBriArtifact,
  serializePalimpsestBriArtifact,
} from './build-palimpsest-bri.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicDir = path.join(root, 'public/data')
const pinPath = path.join(root, 'scripts/bridge/palimpsest-bri-source-pin.json')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

let artifact
let pin

beforeAll(async () => {
  pin = JSON.parse(await fs.readFile(pinPath, 'utf8'))
  artifact = buildPalimpsestBriArtifact(pin)
})

describe('Palimpsest Belt and Road parallel-context bridge', () => {
  it('is deterministic and byte-identical to the checked-in artifact and hash sidecar', async () => {
    const first = serializePalimpsestBriArtifact(buildPalimpsestBriArtifact(pin))
    const second = serializePalimpsestBriArtifact(buildPalimpsestBriArtifact(pin))
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
      status: 'production_verified_at_release',
      canonicalBaseUrl: 'https://palimpsest.info',
    })
    expect(artifact.provenance.release.railwayMirrorBaseUrl).toMatch(/^https:\/\/.*\.railway\.app$/)
    expect(artifact.provenance.release.sourceRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(artifact.provenance.release.artifactTreeSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifact.provenance.sourceArtifacts.economics.sha256)
      .toBe(pin.sourceArtifacts.economics.sha256)
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
    expect(() => assertPalimpsestBriPin(detailed)).toThrow(/forbidden detail fields/)
  })
})
