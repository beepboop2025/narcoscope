import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { getAtlas, getEntities } from './lib/illicit-economy.mjs'
import { dispatch, toolOutputIsValid } from './mcp.mjs'
import { createV1Handler } from './v1.mjs'

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
}

async function readRealData(domain) {
  const files = {
    organized_crime: 'src/data/organizedCrime.json',
    firearms_tracing: 'src/data/firearmsTracing.json',
    entities: 'src/data/designations.json',
  }
  return JSON.parse(await readFile(files[domain], 'utf8'))
}

function missingFile() {
  const error = new Error('missing fixture')
  error.code = 'ENOENT'
  throw error
}

describe('NarcoScope illicit-economy REST and MCP resources', () => {
  it('preserves organized-crime source caveats and null score availability', async () => {
    const atlas = await getAtlas({
      domain: 'organized_crime',
      iso3: 'afg',
      year: 2021,
      limit: 10,
    })
    expect(atlas.status).toBe('available')
    expect(atlas.query).toEqual({ domain: 'organized_crime', iso3: 'AFG', year: 2021 })
    expect(atlas.records).toHaveLength(1)
    expect(atlas.sources[0]).toMatchObject({
      domain: 'organized_crime',
      status: 'available',
      metadata: {
        schema_version: 'narcoscope.organized-crime.v1',
        unit: 'index_score',
      },
    })
    expect(atlas.records[0].meta.availability).toBe('partial')
    expect(atlas.records[0].meta.unavailable_fields).toContain('markets.extortion')
    expect(atlas.records[0].data.markets.extortion).toBeNull()
    expect(atlas.records[0].meta.caveats).toEqual(atlas.sources[0].metadata.caveats)
    expect(toolOutputIsValid('get_atlas', atlas)).toBe(true)
  })

  it('returns firearms zero as observed while preserving missing as null', async () => {
    const atlas = await getAtlas({
      domain: 'firearms_tracing',
      iso3: 'ALB',
      year: 2024,
    })
    expect(atlas.records[0].data.valuePercent).toBe(0)
    expect(atlas.records[0].meta.unavailable_fields).not.toContain('valuePercent')
    expect(atlas.sources[0].metadata).toMatchObject({
      schema_version: 'narcoscope.firearms-tracing.v1',
      series: 'VC_ARM_SZTRACE',
      unit: 'percent',
    })
  })

  it('uses deterministic filter-bound keyset cursors', async () => {
    const first = await getAtlas({ domain: 'all', limit: 3 })
    const repeated = await getAtlas({ domain: 'all', limit: 3 })
    expect(first.page.next_cursor).toBeTruthy()
    expect(repeated.page.next_cursor).toBe(first.page.next_cursor)
    expect(repeated.records).toEqual(first.records)

    const second = await getAtlas({
      domain: 'all',
      limit: 3,
      cursor: first.page.next_cursor,
    })
    const firstKeys = new Set(first.records.map((row) => JSON.stringify(row.data)))
    expect(second.records.every((row) => !firstKeys.has(JSON.stringify(row.data)))).toBe(true)
    await expect(getAtlas({
      domain: 'organized_crime',
      limit: 3,
      cursor: first.page.next_cursor,
    })).rejects.toThrow(/cursor does not match/)
    await expect(getAtlas({ cursor: 'not-a-valid-cursor' })).rejects.toThrow(/cursor/)
  })

  it.each([
    [{ domain: 'routes' }, /domain/],
    [{ iso3: 'US' }, /iso3/],
    [{ year: '20x4' }, /year/],
    [{ limit: 0 }, /limit/],
    [{ limit: '1.5' }, /limit/],
  ])('rejects invalid atlas filters: %j', async (params, error) => {
    await expect(getAtlas(params)).rejects.toThrow(error)
  })

  it('fails missing atlas files closed without converting absence to empty coverage', async () => {
    const atlas = await getAtlas({}, { readData: async () => missingFile() })
    expect(atlas).toMatchObject({ status: 'unavailable', records: [] })
    expect(atlas.sources).toHaveLength(2)
    expect(atlas.sources.every((source) => (
      source.status === 'unavailable'
      && source.record_count === null
      && source.error.code === 'source_file_missing'
    ))).toBe(true)
    expect(toolOutputIsValid('get_atlas', atlas)).toBe(true)

    const response = responseRecorder()
    await createV1Handler({ readData: async () => missingFile() })({
      method: 'GET',
      headers: {},
      url: '/api/v1/atlas?domain=all',
      query: { resource: 'atlas' },
    }, response)
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      resource: 'atlas',
      error: 'unavailable',
      data: { status: 'unavailable' },
    })
  })

  it('keeps an available atlas lane when the other generated source is missing', async () => {
    const atlas = await getAtlas({}, {
      readData: async (domain) => (
        domain === 'organized_crime' ? readRealData(domain) : missingFile()
      ),
    })
    expect(atlas.status).toBe('partial')
    expect(atlas.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'organized_crime', status: 'available' }),
      expect.objectContaining({ domain: 'firearms_tracing', status: 'unavailable' }),
    ]))
    expect(atlas.records.every((row) => row.domain === 'organized_crime')).toBe(true)
  })

  it('returns privacy-minimized administrative designation identities', async () => {
    const entities = await getEntities({
      entity_type: 'organization',
      program: 'SDNTK',
      country: 'italy',
      query: 'ndrangheta',
      limit: 10,
    })
    expect(entities.status).toBe('available')
    expect(entities.records.length).toBeGreaterThan(0)
    expect(entities.disclaimer).toMatch(/not an adjudication or proof of guilt/i)
    expect(entities.privacy.query_scope).toContain('canonical OFAC designation name')
    for (const record of entities.records) {
      expect(Object.keys(record).sort()).toEqual([
        'countries', 'entity_type', 'meta', 'name', 'ofac_entity_number', 'programs',
      ])
      expect(record.meta).toMatchObject({
        evidence_class: 'administrative_action',
        adjudication: false,
      })
    }
    const serialized = JSON.stringify(entities.records).toLocaleLowerCase('en-US')
    for (const forbidden of [
      '"aliases":', '"address":', '"addresses":', '"date_of_birth":',
      '"passport":', '"identity_document":',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(toolOutputIsValid('get_entities', entities)).toBe(true)
  })

  it('keeps entity pagination stable and bound to normalized filters', async () => {
    const first = await getEntities({ entity_type: 'individual', limit: 2 })
    const second = await getEntities({
      entity_type: 'individual',
      limit: 2,
      cursor: first.page.next_cursor,
    })
    expect(first.page.next_cursor).toBeTruthy()
    expect(new Set([
      ...first.records.map((record) => record.ofac_entity_number),
      ...second.records.map((record) => record.ofac_entity_number),
    ]).size).toBe(4)
    await expect(getEntities({
      entity_type: 'organization',
      limit: 2,
      cursor: first.page.next_cursor,
    })).rejects.toThrow(/cursor does not match/)
  })

  it.each([
    [{ entity_type: 'person' }, /entity_type/],
    [{ program: 'UNKNOWN' }, /program/],
    [{ country: '   ' }, /country/],
    [{ query: 'x'.repeat(121) }, /query/],
    [{ limit: 101 }, /limit/],
    [{ cursor: '../../secret' }, /cursor/],
  ])('rejects invalid entity filters: %j', async (params, error) => {
    await expect(getEntities(params)).rejects.toThrow(error)
  })

  it('never projects unexpected sensitive source fields', async () => {
    const payload = await readRealData('entities')
    payload.records = [{ ...payload.records[0], address: 'must not escape' }]
    const entities = await getEntities({}, { readData: async () => payload })
    expect(entities.status).toBe('unavailable')
    expect(entities.error.code).toBe('source_contract_invalid')
    expect(JSON.stringify(entities)).not.toContain('must not escape')
  })

  it('returns a schema-valid structured MCP unavailable result', async () => {
    const response = await dispatch({
      jsonrpc: '2.0',
      id: 'missing-entities',
      method: 'tools/call',
      params: { name: 'get_entities', arguments: {} },
    }, { readData: async () => missingFile() })
    expect(response.result).toMatchObject({
      isError: true,
      structuredContent: {
        schema: 'narcoscope.api.entities.v1',
        status: 'unavailable',
      },
    })
    expect(toolOutputIsValid('get_entities', response.result.structuredContent)).toBe(true)
    expect(JSON.parse(response.result.content[0].text)).toEqual(response.result.structuredContent)
  })

  it('distinguishes malformed REST filters from typed evidence unavailability', async () => {
    const response = responseRecorder()
    await createV1Handler()({
      method: 'GET',
      headers: {},
      url: '/api/v1/atlas?iso3=../../etc',
      query: { resource: 'atlas' },
    }, response)
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
  })
})
