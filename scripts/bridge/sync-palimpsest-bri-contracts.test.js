import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PALIMPSEST_BRI_OPENAPI_REST_SCHEMA,
  PALIMPSEST_BRI_OPENAPI_SUCCESS_RESPONSE,
  syncPalimpsestBriContracts,
  synchronizePalimpsestBriOpenApi,
} from './sync-palimpsest-bri-contracts.mjs'

describe('Palimpsest BRI public contract synchronization', () => {
  it('fails check mode on OpenAPI drift and deterministically repairs it', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-bri-contract-'))
    try {
      const openapiPath = path.join(tempDir, 'openapi.json')
      const source = JSON.parse(await fs.readFile('public/openapi.json', 'utf8'))
      source.components.schemas.PalimpsestBriContext.properties.interpretation.minLength = 2
      source.components.schemas.PalimpsestBriRestEnvelope.properties.resource.const = 'wrong-resource'
      source.components.responses.PalimpsestBriSuccess.description = 'imprecise response'
      source.paths['/palimpsest-bri'].get.responses['200'] = { description: 'drifted' }
      await fs.writeFile(openapiPath, `${JSON.stringify(source, null, 2)}\n`)

      await expect(syncPalimpsestBriContracts({ openapiPath, check: true }))
        .rejects.toThrow(/contract is stale/)
      await expect(syncPalimpsestBriContracts({ openapiPath }))
        .resolves.toMatchObject({ changed: true })
      await expect(syncPalimpsestBriContracts({ openapiPath, check: true }))
        .resolves.toMatchObject({ changed: false })

      const repaired = JSON.parse(await fs.readFile(openapiPath, 'utf8'))
      expect(repaired).toEqual(synchronizePalimpsestBriOpenApi(repaired))
      expect(repaired.components.schemas.PalimpsestBriContext.properties.interpretation.minLength)
        .toBe(1)
      expect(repaired.components.schemas.PalimpsestBriRestEnvelope)
        .toEqual(PALIMPSEST_BRI_OPENAPI_REST_SCHEMA)
      expect(repaired.components.responses.PalimpsestBriSuccess)
        .toEqual(PALIMPSEST_BRI_OPENAPI_SUCCESS_RESPONSE)
      expect(repaired.paths['/palimpsest-bri'].get.responses['200'])
        .toEqual({ $ref: '#/components/responses/PalimpsestBriSuccess' })
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
