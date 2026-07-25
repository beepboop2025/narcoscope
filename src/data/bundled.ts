// =============================================================================
// LARGE BUNDLED DATASETS — LAZY-CHUNK ONLY
// =============================================================================
//
// The CDC mortality and OFAC designation datasets are ~450 kB each. Importing
// them from `lib/dataStore.ts` would be tidier, but dataStore is reachable from
// App.tsx, so the bundler pulls both into the ENTRY chunk and every visitor
// downloads a megabyte of JSON to look at the street-prices tab.
//
// So this module is the quarantine: it is imported ONLY by the lazily-loaded
// tab components that actually render these datasets, which keeps both assets
// in their own chunks. Do not import it from dataStore, App, or anything else
// in the eager graph — the build will silently regress if you do, and the
// bundle-budget test in src/lib/bundleBudget.test.js is what catches it.
//
// Consequence for the store contract: `state.overdoseRecords` and
// `state.designationRecords` start EMPTY and mean "records loaded from a user
// CSV", not "the current dataset". Components resolve the two with
// `withBundled()` below — loaded data wins, bundled data is the fallback.

import overdoseData from './overdose.json'
import designationData from './designations.json'
import wastewaterData from './wastewater.json'
import type { DesignationRecord, OverdoseRecord, WastewaterRecord } from '../types'

// Asserted rather than inferred: TypeScript widens JSON string literals to
// `string`, which would erase the `substance` and `entityType` unions the rest
// of the app depends on. The converters in scripts/convert/ are the real
// enforcement point, and the dataset-integrity tests check the assertion holds.
export const BUNDLED_OVERDOSE_RECORDS = overdoseData.records as OverdoseRecord[]
export const BUNDLED_DESIGNATION_RECORDS = designationData.records as DesignationRecord[]
// Far smaller than the other two (~26 kB) but kept here for one reason: it is
// consumed only by the Triangulation tab, and putting it anywhere in the eager
// graph would be a precedent the next dataset follows.
export const BUNDLED_WASTEWATER_RECORDS = wastewaterData.records as WastewaterRecord[]

export const OVERDOSE_META = overdoseData.meta
export const DESIGNATION_META = designationData.meta
export const WASTEWATER_META = wastewaterData.meta

/**
 * Resolves a dataset to whichever source should win: records the analyst loaded
 * through the CSV panel, else the bundled official extract. Non-empty loaded
 * data always wins, so a deliberate override is never silently ignored.
 */
export function withBundled<T>(loaded: T[], bundled: T[]): T[] {
  return loaded.length > 0 ? loaded : bundled
}
