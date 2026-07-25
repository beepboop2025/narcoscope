// =============================================================================
// RUNTIME DATA STORE
// =============================================================================
// Holds the datasets the UI renders. Starts on bundled sample data; loadData()
// runs the ingest parsers and swaps in real data, then notifies subscribers.
// External-mutable state + useSyncExternalStore = tear-free updates, no Context.

import { useSyncExternalStore } from 'react'
import { PRICE_RECORDS } from '../data/prices'
import { FLOW_RECORDS, PRECURSOR_PRICE_RECORDS } from '../data/flows'
import {
  MM_BORDER_NODES,
  MM_CONFLICT_EVENTS,
  MM_FLOW_RECORDS,
  MM_PRECURSOR_FLOWS,
  MM_REGIONS,
  MM_REGION_RECORDS,
} from '../data/myanmar'
import * as ingest from './ingest'
import type { DataState, LoadBundle, LoadReport, MmNode } from '../types'

/** Dataset keys (everything in DataState except the isSample flag). */
type RecordKey = Exclude<keyof DataState, 'isSample'>

let state: DataState = {
  isSample: true,
  priceRecords: PRICE_RECORDS,
  precursorPriceRecords: PRECURSOR_PRICE_RECORDS,
  flowRecords: FLOW_RECORDS,
  // Empty by design, and it does NOT mean "no data". The CDC mortality and
  // OFAC designation extracts are ~450 kB each and live in src/data/bundled.ts,
  // imported only from lazy tab chunks so they stay out of the entry bundle.
  // These fields therefore mean "loaded from a user CSV"; components resolve
  // loaded-vs-bundled with `withBundled()`.
  overdoseRecords: [],
  designationRecords: [],
  // Same convention as the two above: empty means "loaded from a user CSV".
  // The bundled default is Statistics Canada's wastewater series, resolved via
  // withBundled() in the Triangulation tab. EUDA and ACIC still cannot be
  // automated (403 / PDF-only), so Europe and Australia remain CSV-load only.
  wastewaterRecords: [],
  // Never bundled: message evidence is per-investigation, consent-scoped, and
  // has no business shipping inside a public static site.
  messageEvidence: [],
  mmRegions: MM_REGIONS,
  mmBorderNodes: MM_BORDER_NODES,
  mmRegionRecords: MM_REGION_RECORDS,
  mmFlowRecords: MM_FLOW_RECORDS,
  mmConflictEvents: MM_CONFLICT_EVENTS,
  mmPrecursorFlows: MM_PRECURSOR_FLOWS,
}

const listeners = new Set<() => void>()
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const getSnapshot = (): DataState => state

/** React hook — returns the current datasets and re-renders on loadData(). */
export function useData(): DataState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ingest.js is plain JS; type its parser surface loosely at the boundary.
type Parser = (csv: string, extra?: unknown) => unknown
const parsers = ingest as unknown as Record<string, Parser | undefined>

/**
 * Ingest real CSV exports and swap them in for the sample data.
 * Omitted bundle keys keep their current data. Nothing changes if a parser throws.
 */
export function loadData(bundle: LoadBundle = {}): LoadReport {
  const report: LoadReport = { ok: true, loaded: {}, warnings: [], errors: [] }
  const next: DataState = { ...state }

  const apply = (stateKey: RecordKey, parserName: string, csv?: string, extraArg?: unknown): void => {
    if (csv == null || csv === '') return
    const parser = parsers[parserName]
    if (typeof parser !== 'function') {
      report.errors.push(`ingest.js is missing export ${parserName}()`)
      return
    }
    try {
      const out = parser(csv, extraArg) as { records?: unknown[]; warnings?: string[] } | unknown[]
      const records = (Array.isArray(out) ? out : out?.records ?? []) as never[]
      const warnings = Array.isArray(out) ? [] : out?.warnings ?? []
      next[stateKey] = records
      report.loaded[stateKey] = records.length
      warnings.forEach((w) => report.warnings.push(`[${stateKey}] ${w}`))
    } catch (err) {
      report.errors.push(`[${stateKey}] ${(err as Error).message}`)
    }
  }

  apply('priceRecords', 'parsePrices', bundle.prices)
  apply('precursorPriceRecords', 'parsePrecursorPrices', bundle.precursorPrices)
  apply('flowRecords', 'parseFlows', bundle.flows)
  apply('overdoseRecords', 'parseOverdoseDeaths', bundle.overdose)
  apply('wastewaterRecords', 'parseWastewater', bundle.wastewater)
  apply('designationRecords', 'parseDesignations', bundle.designations)
  apply('messageEvidence', 'parseMessageEvidence', bundle.messageEvidence)

  // Myanmar node tables FIRST — the records below reference their ids.
  apply('mmRegions', 'parseMyanmarRegions', bundle.mmRegions)
  apply('mmBorderNodes', 'parseMyanmarBorderNodes', bundle.mmBorderNodes)

  const knownIds = new Set<string>(
    [...(next.mmRegions as MmNode[]), ...(next.mmBorderNodes as MmNode[])].map((n) => n.id),
  )
  apply('mmRegionRecords', 'parseMyanmarRegionRecords', bundle.mmRegionRecords, knownIds)
  apply('mmFlowRecords', 'parseMyanmarFlows', bundle.mmFlows, knownIds)
  apply('mmConflictEvents', 'parseMyanmarConflictEvents', bundle.mmConflictEvents, knownIds)
  apply('mmPrecursorFlows', 'parseMyanmarPrecursorFlows', bundle.mmPrecursorFlows, knownIds)

  report.ok = report.errors.length === 0
  if (Object.keys(report.loaded).length > 0) {
    next.isSample = false
    state = next
    listeners.forEach((l) => l())
  }
  return report
}
