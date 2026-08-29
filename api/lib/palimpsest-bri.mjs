import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BRI_ARTIFACT_FILE,
  BRI_ENVELOPE_SCHEMA_VERSION,
  BRI_HASH_FILE,
  BRI_SCHEMA_FILE,
  BRI_SCHEMA_ID,
  PALIMPSEST_BRI_OUTPUT_SCHEMA,
  assertPalimpsestBriBoundary,
  compilePalimpsestBriSchema,
} from '../../lib/palimpsest-bri-contract.mjs'

export { PALIMPSEST_BRI_OUTPUT_SCHEMA }

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))
const SIDECAR_RE = new RegExp(`^([0-9a-f]{64})  ${BRI_ARTIFACT_FILE.replaceAll('.', '\\.')}\\n$`, 'u')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const verifiedArtifactCache = new Map()

function parseJson(raw, label) {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }
}

async function loadUncachedPalimpsestBriArtifact(dataDir) {
  const [artifactRaw, sidecarRaw, schemaRaw] = await Promise.all([
    readFile(path.join(dataDir, BRI_ARTIFACT_FILE)),
    readFile(path.join(dataDir, BRI_HASH_FILE)),
    readFile(path.join(dataDir, BRI_SCHEMA_FILE)),
  ])
  const sidecar = sidecarRaw.toString('utf8')
  const match = SIDECAR_RE.exec(sidecar)
  if (!match) throw new Error('Palimpsest BRI SHA-256 sidecar is malformed or names the wrong artifact')
  const artifactSha256 = sha256(artifactRaw)
  if (match[1] !== artifactSha256) throw new Error('Palimpsest BRI artifact does not match its SHA-256 sidecar')

  const schema = parseJson(schemaRaw, 'Palimpsest BRI JSON Schema')
  const artifact = parseJson(artifactRaw, 'Palimpsest BRI artifact')
  const canonicalRaw = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  if (!canonicalRaw.equals(artifactRaw)) {
    throw new Error('Palimpsest BRI artifact bytes are not the deterministic canonical serialization')
  }
  const schemaDescriptor = artifact?.provenance?.schema
  if (schemaDescriptor?.path !== `public/data/${BRI_SCHEMA_FILE}`
    || schemaDescriptor?.id !== BRI_SCHEMA_ID
    || schemaDescriptor?.bytes !== schemaRaw.length
    || schemaDescriptor?.sha256 !== sha256(schemaRaw)) {
    throw new Error('Palimpsest BRI artifact does not bind the packaged JSON Schema bytes')
  }
  const validateSchema = compilePalimpsestBriSchema(schema)
  validateSchema(artifact)
  assertPalimpsestBriBoundary(artifact)
  return Object.freeze({
    artifact,
    artifactRaw,
    artifactSha256,
    schema,
    schemaRaw,
  })
}

export async function loadVerifiedPalimpsestBriArtifact({
  dataDir = DEFAULT_DATA_DIR,
  cache = true,
} = {}) {
  const cacheKey = path.resolve(dataDir)
  if (!cache) return loadUncachedPalimpsestBriArtifact(cacheKey)

  let pending = verifiedArtifactCache.get(cacheKey)
  if (!pending) {
    pending = loadUncachedPalimpsestBriArtifact(cacheKey)
    verifiedArtifactCache.set(cacheKey, pending)
  }
  try {
    return await pending
  } catch (error) {
    if (verifiedArtifactCache.get(cacheKey) === pending) verifiedArtifactCache.delete(cacheKey)
    throw error
  }
}

export function clearVerifiedPalimpsestBriArtifactCache(dataDir) {
  if (dataDir === undefined) {
    verifiedArtifactCache.clear()
    return
  }
  verifiedArtifactCache.delete(path.resolve(dataDir))
}

export async function verifiedPalimpsestBriEnvelope({
  dataDir,
  siteUrl = 'https://drug-price-observatory.vercel.app',
} = {}) {
  const verified = await loadVerifiedPalimpsestBriArtifact(dataDir ? { dataDir } : undefined)
  const baseUrl = siteUrl.replace(/\/$/, '')
  return {
    schema: BRI_ENVELOPE_SCHEMA_VERSION,
    data: verified.artifact,
    links: {
      canonical: `${baseUrl}/data/${BRI_ARTIFACT_FILE}`,
      sha256: `${baseUrl}/data/${BRI_HASH_FILE}`,
      schema: BRI_SCHEMA_ID,
    },
    interpretation: 'Parallel Palimpsest source-readiness and national-economic context only. It must never be mixed into NarcoScope drug-market inference, actor classification, bilateral route inference, guilt, political classification, project attribution from national series, tactical use, or causal claims.',
  }
}
