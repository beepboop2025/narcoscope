#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const INPUT_SCHEMA = 'scamshield-telegram-monitoring-summary/v1'
export const OUTPUT_SCHEMA = 'narcoscope-scamshield-private-telegram-signal/v1'

const MAX_INPUT_BYTES = 1024 * 1024
const TIERS = new Set(['CLEAN', 'WATCH', 'LIKELY_SCAM', 'CONFIRMED_PATTERN'])
const DETECTION_STATUSES = new Set(['AVAILABLE_FOR_REVIEW', 'INSUFFICIENT_COVERAGE'])
const PRIVATE_LIMITATIONS = [
  'Classifier matches are unverified analyst leads, not findings of crime or platform prevalence.',
  'Coverage is limited to configured public or operator-authorized Telegram sources.',
  'This private signal is ineligible for the public NarcoScope dataset without independent evidence and human review.',
  'The import contains aggregates only: no messages, source identifiers, exact IOCs, account identities, or Telegram credentials.',
]

function fail(message) {
  throw new Error(`invalid ScamShield summary: ${message}`)
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys do not match the ${INPUT_SCHEMA} contract`)
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`)
  return value
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    fail(`${label} must be an ISO-8601 UTC timestamp`)
  }
  if (!Number.isFinite(Date.parse(value))) fail(`${label} is not a real timestamp`)
  return value
}

function countMap(value, label, { tiers = false } = {}) {
  const input = record(value, label)
  const entries = Object.entries(input)
  if (entries.length > 100) fail(`${label} exceeds 100 entries`)
  const output = {}
  for (const [key, count] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (tiers) {
      if (!TIERS.has(key)) fail(`${label} contains an unknown tier`)
    } else if (
      key.length > 128 ||
      !/^[\p{L}\p{N}][\p{L}\p{N} ._:+/\-]{0,127}$/u.test(key) ||
      ['__proto__', 'prototype', 'constructor'].includes(key)
    ) {
      fail(`${label} contains an invalid family name`)
    }
    output[key] = nonNegativeInteger(count, `${label}.${key}`)
  }
  return output
}

export function validateScamShieldSummary(summary) {
  exactKeys(summary, [
    'schema_version', 'producer', 'data_classification', 'review_status',
    'publication_eligible', 'intended_consumers', 'window', 'sampling_frame',
    'coverage', 'detections', 'limitations',
  ], 'summary')
  if (summary.schema_version !== INPUT_SCHEMA) fail('unsupported schema_version')
  if (summary.producer !== 'ScamShield') fail('producer must be ScamShield')
  if (summary.data_classification !== 'PRIVATE_ANALYST_REVIEW') fail('classification must remain private')
  if (summary.review_status !== 'HUMAN_REVIEW_REQUIRED') fail('human review must remain required')
  if (summary.publication_eligible !== false) fail('publication_eligible must be false')
  if (
    !Array.isArray(summary.intended_consumers) ||
    !summary.intended_consumers.includes('narcoscope_analyst_import') ||
    summary.intended_consumers.some((value) => typeof value !== 'string')
  ) fail('NarcoScope is not an intended consumer')

  exactKeys(summary.window, ['start', 'end', 'complete'], 'window')
  const start = timestamp(summary.window.start, 'window.start')
  const end = timestamp(summary.window.end, 'window.end')
  if (Date.parse(end) <= Date.parse(start)) fail('window.end must follow window.start')
  if (typeof summary.window.complete !== 'boolean') fail('window.complete must be boolean')

  exactKeys(summary.sampling_frame, [
    'surface', 'universal_telegram_coverage', 'raw_messages_included',
    'exact_iocs_included', 'source_identifiers_included',
  ], 'sampling_frame')
  if (summary.sampling_frame.surface !== 'configured_public_or_operator_authorized_telegram') {
    fail('sampling surface is outside the approved Telegram boundary')
  }
  for (const field of [
    'universal_telegram_coverage', 'raw_messages_included',
    'exact_iocs_included', 'source_identifiers_included',
  ]) {
    if (summary.sampling_frame[field] !== false) fail(`sampling_frame.${field} must be false`)
  }

  exactKeys(summary.coverage, [
    'messages_observed', 'messages_flagged', 'sources_observed', 'collection_errors',
  ], 'coverage')
  const coverage = {
    messages_observed: nonNegativeInteger(summary.coverage.messages_observed, 'coverage.messages_observed'),
    messages_flagged: nonNegativeInteger(summary.coverage.messages_flagged, 'coverage.messages_flagged'),
    sources_observed: nonNegativeInteger(summary.coverage.sources_observed, 'coverage.sources_observed'),
    collection_errors: nonNegativeInteger(summary.coverage.collection_errors, 'coverage.collection_errors'),
  }
  if (coverage.messages_flagged > coverage.messages_observed) fail('flagged messages exceed observed messages')

  exactKeys(summary.detections, [
    'status', 'minimum_messages', 'minimum_sources', 'tier_counts', 'family_counts',
  ], 'detections')
  if (!DETECTION_STATUSES.has(summary.detections.status)) fail('unknown detections.status')
  const minimumMessages = positiveInteger(summary.detections.minimum_messages, 'detections.minimum_messages')
  const minimumSources = positiveInteger(summary.detections.minimum_sources, 'detections.minimum_sources')
  const tierCounts = countMap(summary.detections.tier_counts, 'detections.tier_counts', { tiers: true })
  const familyCounts = countMap(summary.detections.family_counts, 'detections.family_counts')
  const tierTotal = Object.values(tierCounts).reduce((total, value) => total + value, 0)
  if (tierTotal > coverage.messages_observed) fail('tier counts exceed observed messages')
  if (summary.detections.status === 'INSUFFICIENT_COVERAGE') {
    if (Object.keys(tierCounts).length || Object.keys(familyCounts).length) {
      fail('insufficient coverage must suppress detection counts')
    }
  } else if (
    coverage.messages_observed < minimumMessages ||
    coverage.sources_observed < minimumSources
  ) {
    fail('available detection counts do not satisfy the stated coverage gate')
  }

  if (
    !Array.isArray(summary.limitations) || summary.limitations.length < 1 ||
    summary.limitations.length > 20 ||
    summary.limitations.some((value) => typeof value !== 'string' || !value.trim() || value.length > 500)
  ) fail('limitations must be a bounded non-empty string array')

  return {
    window: { start, end, complete: summary.window.complete },
    sampling_frame: { ...summary.sampling_frame },
    coverage,
    detections: {
      status: summary.detections.status,
      minimum_messages: minimumMessages,
      minimum_sources: minimumSources,
      tier_counts: tierCounts,
      family_counts: familyCounts,
    },
  }
}

export function buildPrivateSignal(summary, { inputSha256, importedAt }) {
  const accepted = validateScamShieldSummary(summary)
  if (!/^[0-9a-f]{64}$/.test(inputSha256)) throw new Error('inputSha256 must be lowercase SHA-256')
  timestamp(importedAt, 'imported_at')
  return {
    schema_version: OUTPUT_SCHEMA,
    producer: 'NarcoScope',
    data_classification: 'PRIVATE_ANALYST_REVIEW',
    review_state: 'PENDING_HUMAN_REVIEW',
    publication_eligible: false,
    imported_at: importedAt,
    lineage: {
      producer: 'ScamShield',
      input_schema: INPUT_SCHEMA,
      input_sha256: inputSha256,
    },
    window: accepted.window,
    sampling_frame: accepted.sampling_frame,
    coverage: accepted.coverage,
    detections: accepted.detections,
    limitations: PRIVATE_LIMITATIONS,
  }
}

async function atomicWrite(target, content) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  )
  let handle
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.promises.rename(temporary, target)
    await fs.promises.chmod(target, 0o600)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await fs.promises.rm(temporary, { force: true }).catch(() => {})
  }
}

async function readCurrentHash(target) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(target, 'utf8'))
    return parsed?.lineage?.input_sha256 ?? ''
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return ''
    throw error
  }
}

async function readLastReceiptHash(target) {
  let handle
  try {
    handle = await fs.promises.open(target, 'r')
    const stat = await handle.stat()
    const size = Math.min(stat.size, 65_536)
    if (size === 0) return ''
    const buffer = Buffer.alloc(size)
    await handle.read(buffer, 0, size, stat.size - size)
    const lines = buffer.toString('utf8').trim().split('\n')
    return JSON.parse(lines.at(-1))?.input_sha256 ?? ''
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return ''
    throw error
  } finally {
    if (handle) await handle.close()
  }
}

async function appendReceipt(target, receipt) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const handle = await fs.promises.open(target, 'a', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.promises.chmod(target, 0o600)
}

async function readBoundedInput(input) {
  let handle
  try {
    handle = await fs.promises.open(
      input,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    )
  } catch (error) {
    if (error?.code === 'ELOOP' || error?.code === 'EMLINK') {
      throw new Error('input must be a regular, non-symlink file')
    }
    throw error
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('input must be a regular, non-symlink file')
    if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) {
      throw new Error('input size is outside the accepted bound')
    }
    const bytes = await handle.readFile()
    if (bytes.length < 2 || bytes.length > MAX_INPUT_BYTES) {
      throw new Error('input size is outside the accepted bound')
    }
    return bytes
  } finally {
    await handle.close()
  }
}

export async function importScamShieldSummary({ input, stateDir, now = new Date() }) {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error('now must be a valid Date')
  const bytes = await readBoundedInput(input)
  const inputSha256 = createHash('sha256').update(bytes).digest('hex')
  let summary
  try {
    summary = JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('input is not valid JSON')
  }
  const importedAt = now.toISOString()
  const signal = buildPrivateSignal(summary, { inputSha256, importedAt })
  const currentPath = path.join(stateDir, 'current.json')
  const receiptsPath = path.join(stateDir, 'receipts.jsonl')
  await fs.promises.mkdir(path.join(stateDir, 'hourly'), { recursive: true, mode: 0o700 })
  await fs.promises.chmod(stateDir, 0o700)
  await fs.promises.chmod(path.join(stateDir, 'hourly'), 0o700)

  const currentHash = await readCurrentHash(currentPath)
  const lastReceiptHash = await readLastReceiptHash(receiptsPath)
  if (currentHash === inputSha256) {
    if (lastReceiptHash !== inputSha256) {
      await appendReceipt(receiptsPath, {
        imported_at: importedAt,
        input_sha256: inputSha256,
        window_start: signal.window.start,
        window_end: signal.window.end,
        detection_status: signal.detections.status,
        recovered: true,
      })
    }
    return { changed: false, inputSha256, currentPath }
  }

  const encoded = `${JSON.stringify(signal, null, 2)}\n`
  const hourlyName = `${importedAt.slice(0, 13)}.json`
  const hourlyPath = path.join(stateDir, 'hourly', hourlyName)
  // current.json is the commit marker: if it exists with this hash, the
  // corresponding hourly snapshot must already have completed.
  await atomicWrite(hourlyPath, encoded)
  await atomicWrite(currentPath, encoded)
  await appendReceipt(receiptsPath, {
    imported_at: importedAt,
    input_sha256: inputSha256,
    window_start: signal.window.start,
    window_end: signal.window.end,
    detection_status: signal.detections.status,
    recovered: false,
  })
  return { changed: true, inputSha256, currentPath, hourlyPath }
}

function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!['--input', '--state-dir'].includes(name) || !argv[index + 1]) {
      throw new Error('usage: import-scamshield-summary.mjs --input FILE --state-dir DIR')
    }
    values[name.slice(2)] = argv[index + 1]
    index += 1
  }
  if (!values.input || !values['state-dir']) {
    throw new Error('usage: import-scamshield-summary.mjs --input FILE --state-dir DIR')
  }
  return { input: values.input, stateDir: values['state-dir'] }
}

async function main() {
  const result = await importScamShieldSummary(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify({
    changed: result.changed,
    input_sha256: result.inputSha256,
  })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
