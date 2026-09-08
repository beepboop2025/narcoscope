import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { refreshGlobalMarkets, secureStateDirectory, WEEK_MS, RETRY_MS } from './refresh-global-markets.mjs'
import { SourceAcquisitionError } from '../global-markets/arms-economy.mjs'

const temporary = []
const NOW = Date.parse('2026-09-08T12:00:00Z')
const ID = 'global-arms-economy'
const json = () => ({ schema: 'narcoscope.global-markets.v1', id: ID, title: 'Fixture', generatedAt: '2026-01-01T00:00:00Z',
  sources: [{ id: 'source', name: 'Fixture source', publisher: 'Fixture publisher', url: 'https://data.worldbank.org/fixture', downloadUrl: 'https://api.worldbank.org/fixture',
    license: 'CC BY 4.0', licenseUrl: 'https://datacatalog.worldbank.org/public-licenses', retrievedAt: '2026-01-01T00:00:00Z', sha256: 'a'.repeat(64), bytes: 100, notes: [] }],
  indicators: [{ id: 'indicator', sourceId: 'source', market: 'economy', label: 'Fixture', unit: 'percent', measureType: 'reported', description: 'Fixture', limitations: [] }],
  observations: [{ id: 'cell', indicatorId: 'indicator', geoCode: 'CHN', geoName: 'China', geoLevel: 'country', period: '2024', category: '', subgroup: '', value: 1, lower: null, upper: null, status: 'reported', sourceLocator: 'sheet!A1' }], limitations: [] })

async function fixture(existing = true) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-global-refresh-'))
  temporary.push(parent)
  const root = path.join(parent, 'checkout'), stateDir = path.join(parent, 'state')
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true })
  const out = path.join(root, 'public/data', ID + '-v1.json')
  if (existing) await fs.writeFile(out, JSON.stringify(json()) + '\n')
  const lane = { id: ID, directory: 'arms-economy', marker: 'manifest.json', processorSha256: 'b'.repeat(64),
    collect: vi.fn(async (store, target) => { await fs.writeFile(path.join(store, 'manifest.json'), '{}'); await fs.writeFile(target, JSON.stringify(json()) + '\n'); return {} }) }
  const options = { root, stateDir, now: NOW, lanes: [lane], catalog: vi.fn() }
  return { root, stateDir, out, lane, options, receipt: path.join(stateDir, lane.directory, 'refresh.json') }
}

afterEach(async () => { for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

describe('weekly global-market acquisition and durable replay', () => {
  it('acquires once per week and preserves public bytes and cadence clocks during daily reuse', async () => {
    const f = await fixture()
    await refreshGlobalMarkets(f.options)
    const metadata = await fs.readFile(f.receipt, 'utf8'), before = await fs.readFile(f.out, 'utf8')
    const daily = await refreshGlobalMarkets({ ...f.options, now: NOW + 12 * 3600000 })
    expect(f.lane.collect).toHaveBeenCalledTimes(1)
    expect(daily.results[0].outcome).toBe('retained-within-week')
    expect(await fs.readFile(f.receipt, 'utf8')).toBe(metadata)
    expect(await fs.readFile(f.out, 'utf8')).toBe(before)
    await refreshGlobalMarkets({ ...f.options, now: NOW + WEEK_MS })
    expect(f.lane.collect).toHaveBeenCalledTimes(2)
  })
  it('retains a dated valid snapshot after a transport outage with a bounded retry cooldown', async () => {
    const f = await fixture(), before = await fs.readFile(f.out, 'utf8')
    f.lane.collect.mockRejectedValue(new SourceAcquisitionError('timeout'))
    const failed = await refreshGlobalMarkets(f.options)
    expect(failed.results[0]).toMatchObject({ outcome: 'retained-after-acquisition-failure', generatedAt: '2026-01-01T00:00:00Z' })
    expect(JSON.parse(await fs.readFile(f.receipt, 'utf8')).status).toBe('acquisition-failed')
    await refreshGlobalMarkets({ ...f.options, now: NOW + RETRY_MS - 1 })
    expect(f.lane.collect).toHaveBeenCalledTimes(1)
    await refreshGlobalMarkets({ ...f.options, now: NOW + RETRY_MS })
    expect(f.lane.collect).toHaveBeenCalledTimes(2)
    expect(await fs.readFile(f.out, 'utf8')).toBe(before)
  })
  it('does not repeat all public downloads daily because a private research source was unavailable', async () => {
    const f = await fixture()
    const collect = f.lane.collect.getMockImplementation()
    f.lane.collect.mockImplementation(async (...args) => { await collect(...args); return { failures: [{ sourceId: 'private', status: 'unavailable' }] } })
    const first = await refreshGlobalMarkets(f.options)
    expect(first.results[0].outcome).toBe('updated-with-private-source-gaps')
    await refreshGlobalMarkets({ ...f.options, now: NOW + 2 * RETRY_MS })
    expect(f.lane.collect).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await fs.readFile(f.receipt, 'utf8')).status).toBe('partial')
    await refreshGlobalMarkets({ ...f.options, now: NOW + WEEK_MS })
    expect(f.lane.collect).toHaveBeenCalledTimes(2)
  })
  it('does not downgrade schema/hash/parser failures into transport fallback', async () => {
    const f = await fixture()
    f.lane.collect.mockRejectedValue(new Error('raw hash mismatch'))
    await expect(refreshGlobalMarkets(f.options)).rejects.toThrow('hash mismatch')
    await expect(fs.stat(f.receipt)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.options.catalog).not.toHaveBeenCalled()
  })
  it('rejects an invalid existing snapshot even inside the no-fetch weekly window', async () => {
    const f = await fixture()
    await refreshGlobalMarkets(f.options)
    const invalid = json(); invalid.observations[0].value = null
    await fs.writeFile(f.out, JSON.stringify(invalid))
    await expect(refreshGlobalMarkets({ ...f.options, now: NOW + 1 })).rejects.toThrow('unavailable')
    expect(f.lane.collect).toHaveBeenCalledTimes(1)
  })
  it('cannot report a successful bootstrap when no valid fallback exists', async () => {
    const f = await fixture(false)
    f.lane.collect.mockRejectedValue(new SourceAcquisitionError('HTTP 503'))
    await expect(refreshGlobalMarkets(f.options)).rejects.toThrow('503')
    expect(f.options.catalog).not.toHaveBeenCalled()
  })
  it('offline reuse without captures is deterministic and never manufactures timestamps or downloads', async () => {
    const f = await fixture()
    const a = await refreshGlobalMarkets({ ...f.options, offline: true })
    const b = await refreshGlobalMarkets({ ...f.options, offline: true, now: NOW + WEEK_MS })
    expect(a).toEqual(b)
    expect(a.results[0].outcome).toBe('retained-offline')
    expect(f.lane.collect).not.toHaveBeenCalled()
    await expect(fs.stat(f.receipt)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('offline raw replay preserves the last live acquisition receipt', async () => {
    const f = await fixture()
    await refreshGlobalMarkets(f.options)
    const metadata = await fs.readFile(f.receipt, 'utf8')
    await refreshGlobalMarkets({ ...f.options, offline: true, now: NOW + WEEK_MS })
    expect(f.lane.collect.mock.calls.at(-1)[2]).toBe(true)
    expect(await fs.readFile(f.receipt, 'utf8')).toBe(metadata)
  })
  it('reparses changed collector code from retained bytes once without a gratuitous acquisition', async () => {
    const f = await fixture()
    await refreshGlobalMarkets(f.options)
    const previous = JSON.parse(await fs.readFile(f.receipt, 'utf8'))
    f.lane.processorSha256 = 'c'.repeat(64)
    await refreshGlobalMarkets({ ...f.options, now: NOW + 1 })
    expect(f.lane.collect.mock.calls.at(-1)[2]).toBe(true)
    expect(JSON.parse(await fs.readFile(f.receipt, 'utf8'))).toMatchObject({ lastAttemptAt: previous.lastAttemptAt, lastSuccessAt: previous.lastSuccessAt, processorSha256: 'c'.repeat(64) })
    await refreshGlobalMarkets({ ...f.options, now: NOW + 2 })
    expect(f.lane.collect).toHaveBeenCalledTimes(2)
  })
  it.each(['older', 'missing'])('recovers an acquired snapshot into a %s checkout after interrupted publication', async state => {
    const f = await fixture(), older = await fs.readFile(f.out, 'utf8')
    const acquired = json(); acquired.observations[0].value = 2
    f.lane.collect.mockImplementation(async (store, target) => {
      await fs.writeFile(path.join(store, 'manifest.json'), '{}')
      await fs.writeFile(target, JSON.stringify(acquired) + '\n')
      return {}
    })
    await refreshGlobalMarkets(f.options)
    const expected = await fs.readFile(f.out, 'utf8'), metadata = await fs.readFile(f.receipt, 'utf8')
    if (state === 'missing') await fs.unlink(f.out)
    else await fs.writeFile(f.out, older)
    const recovered = await refreshGlobalMarkets({ ...f.options, now: NOW + 1 })
    expect(recovered.results[0].outcome).toBe('replayed-offline')
    expect(f.lane.collect.mock.calls.at(-1)[2]).toBe(true)
    expect(await fs.readFile(f.out, 'utf8')).toBe(expected)
    expect(await fs.readFile(f.receipt, 'utf8')).toBe(metadata)
  })
  it('rejects concurrent writers without removing the other lock', async () => {
    const f = await fixture()
    await fs.mkdir(path.join(f.stateDir, 'refresh.lock'), { recursive: true })
    await expect(refreshGlobalMarkets(f.options)).rejects.toMatchObject({ code: 'EEXIST' })
    expect((await fs.stat(path.join(f.stateDir, 'refresh.lock'))).isDirectory()).toBe(true)
  })
  it('keeps state outside the checkout with restrictive ownership and no symlink destination', async () => {
    const f = await fixture()
    await expect(secureStateDirectory(path.join(f.root, 'private'), f.root)).rejects.toThrow('outside')
    await secureStateDirectory(f.stateDir, f.root)
    expect((await fs.stat(f.stateDir)).mode & 0o777).toBe(0o700)
    const link = path.join(path.dirname(f.stateDir), 'linked')
    await fs.symlink(f.stateDir, link)
    await expect(secureStateDirectory(link, f.root)).rejects.toThrow('ownership or type')
  })
})
