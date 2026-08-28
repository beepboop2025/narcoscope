#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PALIMPSEST_BRI_OUTPUT_SCHEMA,
  REQUIRED_PROHIBITIONS,
} from '../../lib/palimpsest-bri-contract.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '../..')
export const DEFAULT_OPENAPI_PATH = path.join(root, 'public/openapi.json')
export const DEFAULT_PRODUCT_CARD_PATH = path.join(root, 'public/product-card.json')

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

export const PALIMPSEST_BRI_PRODUCT_PROHIBITIONS = Object.freeze(
  Object.fromEntries(REQUIRED_PROHIBITIONS.map((key) => [key, 'prohibited'])),
)

const PRODUCT_CARD_BRI_BOUNDARY = 'Belt and Road context never enters drug-market inference: drug-conflict-infrastructure causal joins, actor classification, bilateral route inference, guilt inference, political-movement classification, project attribution from national series, and tactical or navigable use are prohibited.'

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

export function synchronizePalimpsestBriProductCard(productCard) {
  const synchronized = cloneJson(productCard)
  if (!Array.isArray(synchronized.boundaries)) {
    throw new Error('Product card is missing boundaries')
  }
  const boundaryIndex = synchronized.boundaries.findIndex((boundary) => (
    typeof boundary === 'string' && boundary.startsWith('Belt and Road context ')
  ))
  if (boundaryIndex < 0) throw new Error('Product card is missing the Palimpsest BRI boundary')
  synchronized.boundaries[boundaryIndex] = PRODUCT_CARD_BRI_BOUNDARY
  synchronized.palimpsest_bri_prohibitions = cloneJson(PALIMPSEST_BRI_PRODUCT_PROHIBITIONS)
  return synchronized
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`)
  }
}

export async function syncPalimpsestBriContracts({
  openapiPath = DEFAULT_OPENAPI_PATH,
  productCardPath = DEFAULT_PRODUCT_CARD_PATH,
  check = false,
} = {}) {
  const [currentOpenApiRaw, currentProductCardRaw] = await Promise.all([
    fs.readFile(openapiPath, 'utf8'),
    fs.readFile(productCardPath, 'utf8'),
  ])
  const currentOpenApi = parseJson(currentOpenApiRaw, 'OpenAPI document')
  const currentProductCard = parseJson(currentProductCardRaw, 'Product card')
  const expectedOpenApiRaw = serialize(synchronizePalimpsestBriOpenApi(currentOpenApi))
  const expectedProductCardRaw = serialize(synchronizePalimpsestBriProductCard(currentProductCard))
  const openApiChanged = currentOpenApiRaw !== expectedOpenApiRaw
  const productCardChanged = currentProductCardRaw !== expectedProductCardRaw
  if (check) {
    if (openApiChanged || productCardChanged) {
      throw new Error('Palimpsest BRI public contracts are stale; run npm run bridge:palimpsest-bri:sync')
    }
    return { changed: false, openapiPath, productCardPath }
  }
  await Promise.all([
    ...(openApiChanged ? [fs.writeFile(openapiPath, expectedOpenApiRaw)] : []),
    ...(productCardChanged ? [fs.writeFile(productCardPath, expectedProductCardRaw)] : []),
  ])
  return { changed: openApiChanged || productCardChanged, openapiPath, productCardPath }
}

function parseCli(argv) {
  let openapiPath = DEFAULT_OPENAPI_PATH
  let productCardPath = DEFAULT_PRODUCT_CARD_PATH
  let check = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') check = true
    else if (arg === '--openapi') {
      const value = argv[index + 1]
      if (!value) throw new Error('--openapi requires a path')
      openapiPath = path.resolve(value)
      index += 1
    } else if (arg === '--product-card') {
      const value = argv[index + 1]
      if (!value) throw new Error('--product-card requires a path')
      productCardPath = path.resolve(value)
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { check, openapiPath, productCardPath }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const result = await syncPalimpsestBriContracts(parseCli(process.argv.slice(2)))
    console.log(result.changed
      ? 'Synchronized Palimpsest BRI OpenAPI and product-card contracts'
      : 'Verified Palimpsest BRI OpenAPI and product-card contracts')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
