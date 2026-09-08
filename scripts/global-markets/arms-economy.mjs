#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile, rename, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { countryMap, normalizeWdi, WDI_SERIES } from './arms-economy-wdi.mjs'
import { validateMarketDataset } from '../../lib/global-markets.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PARSER = path.join(ROOT, 'scripts/global-markets/arms-economy-xlsx.py')
const MAX_DOWNLOAD = 16 * 1024 * 1024
const MAX_STORE = 256 * 1024 * 1024
const MAX_PARSE_OUTPUT = 64 * 1024 * 1024
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const CITATION = 'Elgin, C., M. A. Kose, F. Ohnsorge, and S. Yu. 2021. Understanding Informality. CEPR Discussion Paper 16497, Centre for Economic Policy Research, London.'

// Publication permissions are reviewed per source. CLI arguments cannot promote
// the research-only captures to public datasets.
export const SOURCES = Object.freeze([
  {
    id: 'wb-informality', name: 'Informal Economy Database', publisher: 'World Bank Prospects Group',
    url: 'https://www.worldbank.org/en/research/brief/informal-economy-database',
    downloadUrl: 'https://thedocs.worldbank.org/en/doc/37511318c092e6fd4ca3c60f0af0bea3-0350012021/related/informal-economy-database.xlsx',
    license: 'CC BY 4.0 with World Bank dataset terms; attribution retained; selected World Bank model and enterprise-survey tables only',
    licenseUrl: 'https://datacatalog.worldbank.org/public-licenses', public: true,
    notes: [CITATION, 'Normalized selected worksheets into country/year observations; numerical units and missing cells retained.',
      'The World Bank reproducibility package also identifies the Informal Economy Database as CC BY 4.0: https://reproducibility.worldbank.org/index.php/catalog/330/download/1002/README.pdf',
      'Workbook period is 1990–2020. Model estimates are not measured criminal-market output. Survey coverage is sparse.',
      'Labor, pension and World Values Survey tables are not redistributed by this collector.'],
  },
  {
    id: 'wb-wdi-countries', name: 'World Bank economy classifications', publisher: 'World Bank',
    url: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups',
    downloadUrl: 'https://api.worldbank.org/v2/country?format=json&per_page=400',
    license: 'CC BY 4.0 with World Bank dataset terms', licenseUrl: 'https://datacatalog.worldbank.org/public-licenses',
    public: true, format: 'json', auxiliary: true,
    notes: ['Country and aggregate classifications bind the geography level of WDI observations. No economic measurements are drawn from this response.'],
  },
  ...Object.entries(WDI_SERIES).map(([id, spec]) => ({
    id, name: spec.label + ' — World Development Indicators', publisher: spec.market === 'arms' ? 'World Bank; source: SIPRI Arms Transfers Programme' : 'World Bank Enterprise Surveys',
    url: `https://data.worldbank.org/indicator/${spec.code}`,
    downloadUrl: `https://api.worldbank.org/v2/country/all/indicator/${spec.code}?format=json&per_page=${spec.market === 'arms' ? 20000 : 10000}&date=${spec.start}:2025`,
    license: 'CC BY 4.0, explicitly stated on the individual World Bank indicator and metadata pages',
    licenseUrl: `https://databank.worldbank.org/metadataglossary/world-development-indicators/series/${spec.code}`,
    public: true, format: 'json', notes: [
      `Source methodology and individual-series license: https://databank.worldbank.org/metadataglossary/world-development-indicators/series/${spec.code}`,
      'Normalized the official WDI API response into individual observations. Nulls and original units are retained; no currency conversion or interpolation.',
    ],
  })),
  {
    id: 'unodc-arms', name: 'Firearms trafficking administrative aggregates', publisher: 'UNODC',
    url: 'https://data.unodc.org/datareport/firearm-seizures',
    downloadUrl: 'https://data.unodc.org/sites/dataportal.unodc.org/files/2025-11/data_iafq_firearms_trafficking.xlsx',
    license: 'Public download; quantitative republication rights remain under review',
    licenseUrl: 'https://dataunodc.un.org/termsofuse', public: false,
    notes: ['Source-specific quantitative republication permission has not yet been established; retain privately.',
      'Country aggregates include arms seized/found/surrendered, ammunition, components and criminal-justice counts.',
      'Weapon type, location, marking and other cuts overlap. Seizures are an enforcement measure, not illegal-market size.'],
  },
  {
    id: 'unodc-econ-crime', name: 'Corruption and economic crime administrative aggregates', publisher: 'UNODC',
    url: 'https://data.unodc.org/datareport/econ-corruption',
    downloadUrl: 'https://data.unodc.org/sites/dataportal.unodc.org/files/2026-07/data_cts_corruption_and_economic_crime.xlsx',
    license: 'Public download; quantitative republication rights remain under review',
    licenseUrl: 'https://dataunodc.un.org/termsofuse', public: false,
    notes: ['Source-specific quantitative republication permission has not yet been established; retain privately.',
      'Recorded offences and rates reflect reporting, enforcement and legal definitions, not underlying crime prevalence.'],
  },
  {
    id: 'unodc-iffs', name: 'SDG 16.4.1 illicit financial flows', publisher: 'UNODC',
    url: 'https://data.unodc.org/datareport/sdg-16-4-1',
    downloadUrl: 'https://data.unodc.org/sites/dataportal.unodc.org/files/2026-05/sdg_dataset_0.xlsx',
    license: 'Public download; quantitative republication rights remain under review',
    licenseUrl: 'https://dataunodc.un.org/termsofuse', public: false,
    notes: ['Source-specific quantitative republication permission has not yet been established; retain privately.',
      'Only SDG 16.4.1 is parsed from the larger SDG workbook. Country/activity-specific estimates are not a global market total.'],
  },
].map(source => Object.freeze(source)))

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export class SourceAcquisitionError extends Error {
  constructor(message, options) { super(message, options); this.name = 'SourceAcquisitionError'; this.code = 'SOURCE_ACQUISITION_FAILED' }
}

export function validateDownloadUrl(url) {
  if (!SOURCES.some(source => source.downloadUrl === url)) throw new Error('download URL is not a reviewed official endpoint')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash) {
    throw new Error('invalid official download URL')
  }
  return parsed
}

export async function fetchWorkbook(url, { fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxBytes = MAX_DOWNLOAD } = {}) {
  validateDownloadUrl(url)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, {
      redirect: 'manual', signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'NarcoScope aggregate research collector/1.0 (+https://github.com/beepboop2025/narcoscope)', Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream' },
    }).catch(error => { throw new SourceAcquisitionError(`official source transport failed: ${error.message}`, { cause: error }) })
    if (RETRY_STATUSES.has(response.status) && attempt === 0) {
      await response.body?.cancel()
      await sleep(1500)
      continue
    }
    if (!response.ok) { await response.body?.cancel(); throw new SourceAcquisitionError(`official download HTTP ${response.status}`) }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      await response.body?.cancel(); throw new Error('workbook response exceeds byte limit')
    }
    const chunks = []
    let size = 0
    const reader = response.body?.getReader()
    if (!reader) throw new Error('empty workbook response')
    try {
      while (true) {
        const { done, value } = await reader.read().catch(error => { throw new SourceAcquisitionError(`official source stream failed: ${error.message}`, { cause: error }) })
        if (done) break
        size += value.byteLength
        if (size > maxBytes) throw new Error('workbook stream exceeds byte limit')
        chunks.push(value)
      }
    } catch (error) {
      await reader.cancel()
      throw error
    }
    const bytes = Buffer.concat(chunks)
    if (SOURCES.find(source => source.downloadUrl === url)?.format === 'json') {
      JSON.parse(bytes.toString('utf8'))
    } else if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw new Error('download is not an XLSX ZIP workbook')
    return bytes
  }
  throw new Error('official download retry budget exhausted')
}

export function validateReceipt(receipt, bytes, source) {
  if (!receipt || receipt.url !== source.downloadUrl || receipt.bytes !== bytes.length || receipt.sha256 !== sha256(bytes)) {
    throw new Error('raw workbook is not bound to its capture receipt')
  }
  if (typeof receipt.retrievedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(receipt.retrievedAt) || !Number.isFinite(Date.parse(receipt.retrievedAt)) || Date.parse(receipt.retrievedAt) > Date.now() + 60000) {
    throw new Error('invalid original capture clock')
  }
  return receipt
}

async function atomicJson(filename, value, mode = 0o600) {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value) + '\n', { mode })
  await rename(temporary, filename)
}

async function storeBytes(rawDir) {
  let total = 0
  for (const item of await readdir(rawDir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('raw store must not contain symlinks')
    if (item.isFile()) total += (await stat(path.join(rawDir, item.name))).size
    if (item.isDirectory() && item.name === 'immutable') {
      for (const filename of await readdir(path.join(rawDir, item.name))) {
        const entry = await stat(path.join(rawDir, item.name, filename))
        if (!entry.isFile()) throw new Error('invalid immutable store entry')
        total += entry.size
      }
    }
  }
  return total
}

async function retain(rawDir, source, bytes, originalReceipt) {
  const hash = sha256(bytes)
  const immutable = path.join(rawDir, 'immutable')
  await mkdir(immutable, { recursive: true, mode: 0o700 })
  const extension = source.format === 'json' ? 'json' : 'xlsx'
  const rawPath = path.join(immutable, `${hash}.${extension}`)
  const receiptPath = path.join(immutable, `${source.id}-${hash}.receipt.json`)
  let receipt
  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    validateReceipt(receipt, bytes, source)
    if (sha256(await readFile(rawPath)) !== hash) throw new Error('immutable capture was changed')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    receipt = originalReceipt ?? { url: source.downloadUrl, retrievedAt: new Date().toISOString(), sha256: hash, bytes: bytes.length }
    validateReceipt(receipt, bytes, source)
    if ((await storeBytes(rawDir)) + bytes.length + 4096 > MAX_STORE) throw new Error('private raw-store capacity reached; preserve existing captures')
    try { await writeFile(rawPath, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (writeError) {
      if (writeError.code !== 'EEXIST' || sha256(await readFile(rawPath)) !== hash) throw writeError
    }
    try { await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 }) }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError }
  }
  await atomicJson(path.join(rawDir, `${source.id}.latest.json`), receipt)
  return { rawPath, receipt }
}

async function capture(rawDir, source, refresh, offline = false) {
  if (!refresh) {
    try {
      const receipt = JSON.parse(await readFile(path.join(rawDir, `${source.id}.latest.json`), 'utf8'))
      if (!/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error('invalid stored capture hash')
      const rawPath = path.join(rawDir, 'immutable', `${receipt.sha256}.${source.format === 'json' ? 'json' : 'xlsx'}`)
      validateReceipt(receipt, await readFile(rawPath), source)
      return { rawPath, receipt }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    // Import the initial bounded research capture without inventing a new clock.
    try {
      const bytes = await readFile(path.join(rawDir, `${source.id}.${source.format === 'json' ? 'json' : 'xlsx'}`))
      const receipt = JSON.parse(await readFile(path.join(rawDir, `${source.id}.receipt.json`), 'utf8'))
      validateReceipt(receipt, bytes, source)
      return retain(rawDir, source, bytes, receipt)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (offline) throw new Error(`Offline capture missing for ${source.id}`)
  return retain(rawDir, source, await fetchWorkbook(source.downloadUrl))
}

export function buildPublicDataset(captures) {
  const publicCaptures = captures.filter(item => SOURCES.find(source => source.id === item.source.id)?.public === true)
  if (!publicCaptures.length) throw new Error('no validated public source available')
  const sources = publicCaptures.map(({ source, receipt, normalized }) => ({
    id: source.id, name: source.name, publisher: source.publisher, url: source.url, downloadUrl: source.downloadUrl,
    license: source.license, licenseUrl: source.licenseUrl, retrievedAt: receipt.retrievedAt,
    sha256: receipt.sha256, bytes: receipt.bytes, notes: [...source.notes,
      ...(normalized.summary?.sourceUpdated ? [`WDI source last updated: ${normalized.summary.sourceUpdated}. This is separate from the original retrieval clock.`] : [])],
  }))
  const indicators = publicCaptures.flatMap(item => item.normalized.indicators)
  const observations = publicCaptures.flatMap(item => item.normalized.observations)
  const allowedSources = new Set(sources.map(source => source.id))
  if (indicators.some(indicator => !allowedSources.has(indicator.sourceId))) throw new Error('indicator source is not public')
  const allowedIndicators = new Set(indicators.map(indicator => indicator.id))
  if (observations.some(row => !allowedIndicators.has(row.indicatorId))) throw new Error('unbound public observation')
  return {
    schema: 'narcoscope.global-markets.v1', id: 'global-arms-economy', title: 'Arms transfers, informal economies and firm-reported corruption',
    generatedAt: sources.map(source => source.retrievedAt).sort().at(-1), sources, indicators, observations,
    limitations: ['Informal economic activity includes lawful work and commerce. These indicators do not estimate the size of the drugs, arms or organized-crime markets.',
      'DGE and MIMIC provide alternative model estimates; they are not independent observations to add together.',
      'The informal-output workbook ends in 2020. WDI arms and firm-survey series have their own reported periods. Empty cells remain unavailable; sparse survey years are not interpolated.',
      'UNODC firearms, economic-crime and illicit-financial-flow workbooks were acquired for private research; their quantities remain excluded while source-specific redistribution terms are unresolved.',
      'Legal arms transfers and military spending are not used as estimates of illicit weapons markets.'],
  }
}

export async function collect({ rawDir, out = path.join(ROOT, 'public/data/global-arms-economy-v1.json'), refresh = false, publicOnly = false, offline = false } = {}) {
  if (refresh && offline) throw new Error('Offline and refresh are mutually exclusive')
  if (!rawDir) throw new Error('--raw-dir is required and must be outside the repository')
  rawDir = path.resolve(rawDir)
  if (rawDir === ROOT || rawDir.startsWith(ROOT + path.sep)) throw new Error('raw captures must remain outside the repository')
  await mkdir(rawDir, { recursive: true, mode: 0o700 })
  rawDir = await realpath(rawDir)
  if (rawDir === ROOT || rawDir.startsWith(ROOT + path.sep)) throw new Error('raw captures must remain outside the repository')
  const captures = []
  const failures = []
  let countries
  for (const source of SOURCES.filter(item => !publicOnly || item.public)) {
    try {
      const { rawPath, receipt } = await capture(rawDir, source, refresh, offline)
      let normalized
      if (source.format === 'json') {
        const payload = JSON.parse(await readFile(rawPath, 'utf8'))
        if (source.auxiliary) {
          countries = countryMap(payload)
          normalized = { indicators: [], observations: [], summary: { rows: 0, numeric: 0, classifications: countries.size } }
        } else {
          normalized = normalizeWdi(payload, source.id, countries)
        }
      } else {
        normalized = JSON.parse(execFileSync('python3', [PARSER, '--kind', source.id, '--input', rawPath], {
          encoding: 'utf8', timeout: 60000, maxBuffer: MAX_PARSE_OUTPUT,
        }))
      }
      captures.push({ source, receipt, normalized })
      if (!source.public) {
        await atomicJson(path.join(rawDir, `${source.id}.normalized.private.json`), {
          publicationStatus: 'rights-review-required', sourceId: source.id, receipt, ...normalized,
        })
      }
    } catch (error) {
      if (source.public || error.code !== 'SOURCE_ACQUISITION_FAILED') throw error
      failures.push({ sourceId: source.id, status: 'unavailable', reason: error.message.slice(0, 300) })
    }
  }
  const dataset = buildPublicDataset(captures)
  validateMarketDataset(dataset)
  await atomicJson(out, dataset, 0o644)
  const report = {
    schema: 'narcoscope.arms-economy-capture-report.v1', generatedAt: offline ? dataset.generatedAt : new Date().toISOString(),
    publicOutput: { path: out, sha256: sha256(await readFile(out)), bytes: (await stat(out)).size,
      numeric: dataset.observations.filter(row => row.value !== null).length, rows: dataset.observations.length },
    sources: captures.map(({ source, receipt, normalized }) => ({ id: source.id, publication: source.public ? 'public' : 'private-rights-review', receipt, ...normalized.summary })),
    failures,
  }
  if (!offline) await atomicJson(path.join(rawDir, 'capture-report.json'), report)
  return report
}

function args(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (item === '--raw-dir') options.rawDir = argv[++i]
    else if (item === '--out') options.out = argv[++i]
    else if (item === '--refresh') options.refresh = true
    else if (item === '--public-only') options.publicOnly = true
    else if (item === '--offline') options.offline = true
    else throw new Error(`unknown argument: ${item}`)
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collect(args(process.argv.slice(2))).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(`arms/economy collection failed: ${error.message}`)
    process.exitCode = 1
  })
}
