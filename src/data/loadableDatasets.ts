// =============================================================================
// LOADABLE DATASETS — one source of truth for the CSV loader
// =============================================================================
// Every dataset a user can replace through the CSV panel is listed here, once.
// The DataLoader renders this list; `loadData()` in dataStore.ts applies each
// key; and the render + budget tests check both against it. Before this list
// existed the three had drifted — the loader offered 9 pickers while the store
// ingested 12, so three parsers were unreachable and the Triangulation tab's
// own "load a CSV" instruction was false. Adding a dataset now means adding one
// row here, and the tests fail until the loader and the store both honour it.

import type { LoadBundle } from '../types'

export interface LoadableDataset {
  /** Must be a key of LoadBundle — the compiler enforces it below. */
  key: keyof LoadBundle
  label: string
}

export const LOADABLE_DATASETS: LoadableDataset[] = [
  { key: 'prices', label: 'Street prices' },
  { key: 'precursorPrices', label: 'Precursor prices' },
  { key: 'flows', label: 'Precursor flows' },
  // Wastewater matters most here: the Triangulation tab tells users to load a
  // CSV export to switch the modality on for their country (EUDA and ACIC both
  // block automated collection), and that instruction is only true because
  // there is a picker for it.
  { key: 'wastewater', label: 'Wastewater loads (EUDA / ACIC export)' },
  { key: 'overdose', label: 'Overdose mortality (CDC WONDER export)' },
  { key: 'designations', label: 'Sanctions designations (OFAC / UN export)' },
  { key: 'mmRegions', label: 'Myanmar regions' },
  { key: 'mmBorderNodes', label: 'Myanmar border nodes' },
  { key: 'mmRegionRecords', label: 'Myanmar region stats' },
  { key: 'mmFlows', label: 'Myanmar flows' },
  { key: 'mmConflictEvents', label: 'Myanmar civil-war events' },
  { key: 'mmPrecursorFlows', label: 'Myanmar precursor inflows' },
]

/** Just the keys, for tests and completeness checks. */
export const LOADABLE_DATASET_KEYS: Array<keyof LoadBundle> = LOADABLE_DATASETS.map((d) => d.key)
