// =============================================================================
// RUNTIME DATA STORE
// =============================================================================
// Holds the datasets the UI renders. Starts on the bundled sample data; calling
// loadData() with CSV strings runs the ingest.js parsers and swaps in real data,
// then notifies subscribers so every tab re-renders. External-mutable state +
// useSyncExternalStore = tear-free updates without a Context provider.

import { useSyncExternalStore } from 'react'
import { PRICE_RECORDS } from '../data/prices.js'
import { FLOW_RECORDS, PRECURSOR_PRICE_RECORDS } from '../data/flows.js'
import { MM_REGIONS, MM_BORDER_NODES, MM_REGION_RECORDS, MM_FLOW_RECORDS } from '../data/myanmar.js'
import * as ingest from './ingest.js'

let state = {
  isSample: true,
  priceRecords: PRICE_RECORDS,
  precursorPriceRecords: PRECURSOR_PRICE_RECORDS,
  flowRecords: FLOW_RECORDS,
  mmRegions: MM_REGIONS,
  mmBorderNodes: MM_BORDER_NODES,
  mmRegionRecords: MM_REGION_RECORDS,
  mmFlowRecords: MM_FLOW_RECORDS,
}

const listeners = new Set()
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
const getSnapshot = () => state

/** React hook — returns the current datasets and re-renders on loadData(). */
export function useData() {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Ingest real CSV exports and swap them in for the sample data.
 *
 * @param {object} bundle - any subset of CSV strings, keyed by dataset:
 *   { prices, precursorPrices, flows,
 *     mmRegions, mmBorderNodes, mmRegionRecords, mmFlows }
 *   Omitted keys keep their current data, so you can load one file at a time.
 * @returns {{ ok: boolean, loaded: object, warnings: string[], errors: string[] }}
 *   A report — loaded counts per dataset, plus any per-row warnings/errors the
 *   parser surfaced. Nothing is changed if a parser throws.
 */
export function loadData(bundle = {}) {
  const report = { ok: true, loaded: {}, warnings: [], errors: [] }
  const next = { ...state }

  // Run one parser, fold its records into `next`, collect its warnings.
  // Parsers may return either an array or { records, warnings } — we accept both.
  const apply = (stateKey, parserName, csv, extraArg) => {
    if (csv == null || csv === '') return
    const parser = ingest[parserName]
    if (typeof parser !== 'function') {
      report.errors.push(`ingest.js is missing export ${parserName}()`)
      return
    }
    try {
      const out = parser(csv, extraArg)
      const records = Array.isArray(out) ? out : (out?.records ?? [])
      const warnings = Array.isArray(out) ? [] : (out?.warnings ?? [])
      next[stateKey] = records
      report.loaded[stateKey] = records.length
      warnings.forEach((w) => report.warnings.push(`[${stateKey}] ${w}`))
    } catch (err) {
      report.errors.push(`[${stateKey}] ${err.message}`)
    }
  }

  // Global datasets.
  apply('priceRecords', 'parsePrices', bundle.prices)
  apply('precursorPriceRecords', 'parsePrecursorPrices', bundle.precursorPrices)
  apply('flowRecords', 'parseFlows', bundle.flows)

  // Myanmar node tables FIRST — the records below reference their ids.
  apply('mmRegions', 'parseMyanmarRegions', bundle.mmRegions)
  apply('mmBorderNodes', 'parseMyanmarBorderNodes', bundle.mmBorderNodes)

  // Referential integrity: pass the known node ids so the parser can flag any
  // region/flow that points at a node we don't have.
  const knownIds = new Set(
    [...(next.mmRegions ?? []), ...(next.mmBorderNodes ?? [])].map((n) => n.id),
  )
  apply('mmRegionRecords', 'parseMyanmarRegionRecords', bundle.mmRegionRecords, knownIds)
  apply('mmFlowRecords', 'parseMyanmarFlows', bundle.mmFlows, knownIds)

  report.ok = report.errors.length === 0
  // Only commit + notify if at least one dataset actually parsed.
  if (Object.keys(report.loaded).length > 0) {
    next.isSample = false
    state = next
    listeners.forEach((l) => l())
  }
  return report
}
