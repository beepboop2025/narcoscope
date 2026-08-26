#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PALIMPSEST_BRI_OUTPUT_SCHEMA } from '../../lib/palimpsest-bri-contract.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '../..')
export const DEFAULT_OPENAPI_PATH = path.join(root, 'public/openapi.json')

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`
const cloneJson = (value) => JSON.parse(JSON.stringify(value))

export const PALIMPSEST_BRI_OPENAPI_REST_SCHEMA = Object.freeze({
  type: 'object',
  required: ['ok', 'resource', 'data'],
  properties: {
    ok: { const: true },
    resource: { const: 'palimpsest-bri' },
    data: { $ref: '#/components/schemas/PalimpsestBriContext' },
  },
  additionalProperties: false,
})

export const PALIMPSEST_BRI_OPENAPI_SUCCESS_RESPONSE = Object.freeze({
  description: 'Verified BRI response envelope whose data is the exact packaged artifact value',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/PalimpsestBriRestEnvelope' },
    },
  },
})

export function synchronizePalimpsestBriOpenApi(openapi) {
  const synchronized = cloneJson(openapi)
  const schemas = synchronized?.components?.schemas
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) {
    throw new Error('OpenAPI document is missing components.schemas')
  }
  const responses = synchronized.components.responses
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
    throw new Error('OpenAPI document is missing components.responses')
  }
  const operationResponses = synchronized?.paths?.['/palimpsest-bri']?.get?.responses
  if (!operationResponses || typeof operationResponses !== 'object' || Array.isArray(operationResponses)) {
    throw new Error('OpenAPI document is missing the Palimpsest BRI GET response contract')
  }

  // PalimpsestBriContext is the same standalone schema MCP advertises. Remove
  // the old remote-only shim so an offline OpenAPI consumer cannot silently
  // resolve a different artifact contract.
  delete schemas.PalimpsestBriArtifact
  schemas.PalimpsestBriContext = cloneJson(PALIMPSEST_BRI_OUTPUT_SCHEMA)
  schemas.PalimpsestBriRestEnvelope = cloneJson(PALIMPSEST_BRI_OPENAPI_REST_SCHEMA)
  responses.PalimpsestBriSuccess = cloneJson(PALIMPSEST_BRI_OPENAPI_SUCCESS_RESPONSE)
  operationResponses['200'] = { $ref: '#/components/responses/PalimpsestBriSuccess' }
  return synchronized
}

export async function syncPalimpsestBriContracts({
  openapiPath = DEFAULT_OPENAPI_PATH,
  check = false,
} = {}) {
  const currentRaw = await fs.readFile(openapiPath, 'utf8')
  let current
  try {
    current = JSON.parse(currentRaw)
  } catch (error) {
    throw new Error(`OpenAPI document is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }
  const expectedRaw = serialize(synchronizePalimpsestBriOpenApi(current))
  if (check) {
    if (currentRaw !== expectedRaw) {
      throw new Error('OpenAPI Palimpsest BRI contract is stale; run npm run bridge:palimpsest-bri:sync')
    }
    return { changed: false, openapiPath }
  }
  if (currentRaw !== expectedRaw) await fs.writeFile(openapiPath, expectedRaw)
  return { changed: currentRaw !== expectedRaw, openapiPath }
}

function parseCli(argv) {
  let openapiPath = DEFAULT_OPENAPI_PATH
  let check = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') check = true
    else if (arg === '--openapi') {
      const value = argv[index + 1]
      if (!value) throw new Error('--openapi requires a path')
      openapiPath = path.resolve(value)
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { check, openapiPath }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const result = await syncPalimpsestBriContracts(parseCli(process.argv.slice(2)))
    console.log(result.changed
      ? `Synchronized ${path.relative(root, result.openapiPath)}`
      : `Verified ${path.relative(root, result.openapiPath)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
