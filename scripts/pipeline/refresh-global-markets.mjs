#!/usr/bin/env node
/** Weekly acquisition, deterministic replay, and fail-closed public validation. */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateMarketDataset } from '../../lib/global-markets.mjs'
import { collect as collectArms } from '../global-markets/arms-economy.mjs'
import { collect as collectDrugs } from '../global-markets/drugs.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const RETRY_MS = 24 * 60 * 60 * 1000
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const MAX_PUBLIC_BYTES = 128 * 1024 * 1024

const LANES = [
  { id: 'global-arms-economy', directory: 'arms-economy', marker: 'wb-informality.latest.json',
    files: ['arms-economy.mjs', 'arms-economy-wdi.mjs', 'arms-economy-xlsx.py'],
    collect: (store, out, offline) => collectArms({ rawDir: store, out, offline, publicOnly: offline, refresh: !offline }) },
  { id: 'global-drugs', directory: 'drugs', marker: 'manifest.json',
    files: ['drugs.mjs', 'drugs-workbooks.py', 'arms-economy-xlsx.py'],
    collect: (store, out, offline) => collectDrugs({ store, out, offline }) },
]

async function optionalJson(filename) {
  try {
    const info = await fs.lstat(filename)
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid private refresh metadata file')
    return JSON.parse(await fs.readFile(filename, 'utf8'))
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function atomicJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await fs.rename(temporary, filename)
}

export async function secureStateDirectory(directory, root = ROOT) {
  if (!path.isAbsolute(directory) || directory === path.parse(directory).root) throw new Error('Private market state must be an absolute non-root directory')
  const resolved = path.resolve(directory)
  if (resolved === root || resolved.startsWith(root + path.sep)) throw new Error('Private market state must be outside the checkout')
  await fs.mkdir(resolved, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(resolved)
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error('Private market state has unsafe ownership or type')
  const real = await fs.realpath(resolved)
  const realRoot = await fs.realpath(root)
  if (real === realRoot || real.startsWith(realRoot + path.sep)) throw new Error('Private market state resolves inside the checkout')
  await fs.chmod(real, 0o700)
  return real
}

export function validateSchedule(receipt, id, now) {
  if (receipt === null) return null
  if (receipt.schema !== 'narcoscope.market-refresh.v1' || receipt.id !== id || !['updated', 'partial', 'acquisition-failed'].includes(receipt.status)) throw new Error('Invalid global-market refresh receipt')
  for (const key of ['lastAttemptAt', 'lastSuccessAt']) {
    if (receipt[key] === null && key === 'lastSuccessAt') continue
    if (typeof receipt[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(receipt[key]) || !Number.isFinite(Date.parse(receipt[key])) || Date.parse(receipt[key]) > now + 60000) throw new Error('Invalid global-market schedule clock')
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.processorSha256) || !/^[a-f0-9]{64}$/.test(receipt.snapshotSha256)) throw new Error('Invalid global-market schedule hash')
  return receipt
}

async function snapshot(filename, id) {
  try {
    const info = await fs.lstat(filename)
    if (!info.isFile() || info.size > MAX_PUBLIC_BYTES) throw new Error('Global-market snapshot is not a bounded regular file')
    const raw = await fs.readFile(filename)
    const dataset = validateMarketDataset(JSON.parse(raw), id)
    return { raw, dataset, sha256: hash(raw) }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export async function refreshLane(lane, { root, stateDir, offline, now }) {
  const store = await secureStateDirectory(path.join(stateDir, lane.directory), root)
  const out = path.join(root, 'public/data', lane.id + '-v1.json')
  const before = await snapshot(out, lane.id) // Invalid public input is never a fallback.
  const processorSha256 = lane.processorSha256 ?? hash(Buffer.concat(await Promise.all(lane.files.map(name => fs.readFile(path.join(root, 'scripts/global-markets', name))))))
  const receiptPath = path.join(store, 'refresh.json')
  const receipt = validateSchedule(await optionalJson(receiptPath), lane.id, now)
  const marker = await fs.lstat(path.join(store, lane.marker)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  const cached = marker?.isFile() === true
  if (marker && !cached) throw new Error('Invalid retained capture marker')
  const withinWeek = receipt && ['updated', 'partial'].includes(receipt.status) && receipt.lastSuccessAt && now - Date.parse(receipt.lastSuccessAt) < WEEK_MS
  const coolingDown = receipt?.status === 'acquisition-failed' && now - Date.parse(receipt.lastAttemptAt) < RETRY_MS
  const processorChanged = receipt && receipt.processorSha256 !== processorSha256
  const replay = offline || (processorChanged && cached && withinWeek)
  if (replay) {
    if (cached) await lane.collect(store, out, true)
    else if (!before) throw new Error(`Offline captures and public snapshot are both missing for ${lane.id}`)
    const current = await snapshot(out, lane.id)
    if (!current) throw new Error(`Offline replay produced no ${lane.id} snapshot`)
    if (!offline && receipt) await atomicJson(receiptPath, { ...receipt, processorSha256, snapshotSha256: current.sha256 })
    return { id: lane.id, outcome: cached ? 'replayed-offline' : 'retained-offline', generatedAt: current.dataset.generatedAt, sha256: current.sha256 }
  }
  if (before && (withinWeek || coolingDown)) {
    return { id: lane.id, outcome: coolingDown ? 'retained-during-retry-cooldown' : 'retained-within-week', generatedAt: before.dataset.generatedAt, sha256: before.sha256 }
  }
  const attemptedAt = new Date(now).toISOString()
  try {
    const result = await lane.collect(store, out, false)
    const current = await snapshot(out, lane.id)
    if (!current) throw new Error(`Collector produced no ${lane.id} snapshot`)
    const partial = Array.isArray(result?.failures) && result.failures.length > 0
    await atomicJson(receiptPath, {
      schema: 'narcoscope.market-refresh.v1', id: lane.id, status: partial ? 'partial' : 'updated',
      lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, processorSha256, snapshotSha256: current.sha256,
      failures: partial ? result.failures.map(failure => ({ sourceId: failure.sourceId, status: failure.status })) : [],
    })
    return { id: lane.id, outcome: partial ? 'updated-with-private-source-gaps' : 'updated', generatedAt: current.dataset.generatedAt, sha256: current.sha256 }
  } catch (error) {
    if (error.code !== 'SOURCE_ACQUISITION_FAILED' || error.name !== 'SourceAcquisitionError' || !before) throw error
    const current = await snapshot(out, lane.id)
    if (!current || current.sha256 !== before.sha256) throw new Error('Failed acquisition modified the previously validated snapshot', { cause: error })
    await atomicJson(receiptPath, {
      schema: 'narcoscope.market-refresh.v1', id: lane.id, status: 'acquisition-failed',
      lastAttemptAt: attemptedAt, lastSuccessAt: receipt?.lastSuccessAt ?? null,
      processorSha256, snapshotSha256: before.sha256, failures: [{ status: 'transport-unavailable' }],
    })
    return { id: lane.id, outcome: 'retained-after-acquisition-failure', generatedAt: before.dataset.generatedAt, sha256: before.sha256 }
  }
}

export async function refreshGlobalMarkets({ root = ROOT, stateDir, offline = false, now = Date.now(), lanes = LANES, catalog } = {}) {
  stateDir ??= process.env.NARCOSCOPE_MARKET_STATE_DIR ?? path.join(process.env.NARCOSCOPE_STATE_DIR ?? path.join(os.homedir(), '.local/state/narcoscope'), 'global-markets')
  stateDir = await secureStateDirectory(stateDir, root)
  const lock = path.join(stateDir, 'refresh.lock')
  await fs.mkdir(lock, { mode: 0o700 })
  try {
    const results = []
    for (const lane of lanes) results.push(await refreshLane(lane, { root, stateDir, offline, now }))
    if (catalog) await catalog()
    else {
      const built = spawnSync('node', ['scripts/global-markets/build-catalog.mjs'], { cwd: root, stdio: 'inherit', timeout: 120000 })
      if (built.status !== 0) throw new Error('Global-market catalog validation/build failed')
    }
    return { schema: 'narcoscope.market-refresh-summary.v1', offline, results }
  } finally { await fs.rmdir(lock) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2)
  if (flags.some(flag => flag !== '--offline')) throw new Error('Usage: refresh-global-markets.mjs [--offline]')
  refreshGlobalMarkets({ offline: flags.includes('--offline') }).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(`global-market refresh failed: ${error.message}`); process.exitCode = 1
  })
}
