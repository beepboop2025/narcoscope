// =============================================================================
// WILDLIFE SEIZURES — reading the CITES confiscation extract
// =============================================================================
// src/data/wildlifeSeizures.json is the Source='I' (confiscation) slice of the
// CITES trade database, pre-aggregated by the one-time converter. This module
// only decorates it for display: ISO-2 country names, plain-language taxon
// labels, and the trailing-year truncation that keeps the trend honest.
//
// It invents nothing. Every number is a count of CITES-reported confiscation
// records; the framing everywhere is "reported confiscations of listed
// species", a partial and reporting-dependent view, never "all trafficking".

import data from '../data/wildlifeSeizures.json'

export interface WildlifeData {
  meta: {
    source: string; url: string; downloaded: string; unit: string; grain: string
    yearRange: [number, number]; totalRecords: number; caveat: string
  }
  byClass: Array<{ class: string; records: number }>
  byYear: Array<{ year: number; records: number }>
  topTaxa: Array<{ taxon: string; class: string; records: number }>
  topExporters: Array<{ country: string; records: number }>
  topImporters: Array<{ country: string; records: number }>
  byTerm: Array<{ term: string; records: number }>
  byAppendix: Array<{ appendix: string; records: number }>
}

export const WILDLIFE = data as WildlifeData

/** ISO-2 → display name for the codes that actually appear in the extract. */
const COUNTRY: Record<string, string> = {
  MX: 'Mexico', CN: 'China', FJ: 'Fiji', US: 'United States', ID: 'Indonesia',
  AU: 'Australia', CK: 'Cook Islands', CA: 'Canada', TH: 'Thailand', HK: 'Hong Kong',
  NG: 'Nigeria', IT: 'Italy', GB: 'United Kingdom', VN: 'Vietnam', NZ: 'New Zealand',
  ES: 'Spain', NL: 'Netherlands', DK: 'Denmark', PL: 'Poland', NO: 'Norway',
  MT: 'Malta', PT: 'Portugal', AT: 'Austria', CZ: 'Czechia',
  XX: 'Unknown / unreported', 'X?': 'Unknown / unreported',
}

export const countryName = (code: string): string => COUNTRY[code] ?? code

/** A few high-signal taxa mapped to what a non-specialist would recognise. */
const TAXON_COMMON: Record<string, string> = {
  'Scleractinia spp.': 'Stony corals',
  'Tridacnidae spp.': 'Giant clams',
  'Cheloniidae spp.': 'Sea turtles',
  'Saussurea costus': 'Costus root (medicinal)',
  'Loxodonta africana': 'African elephant',
  'Panax quinquefolius': 'American ginseng',
  'Moschus spp.': 'Musk deer',
  'Alligator mississippiensis': 'American alligator',
  'Crocodylus niloticus': 'Nile crocodile',
  'Python reticulatus': 'Reticulated python',
  'Acropora spp.': 'Staghorn coral',
  'Strombus gigas': 'Queen conch',
  'Panthera pardus': 'Leopard',
  'Ursus americanus': 'American black bear',
  'Varanus salvator': 'Water monitor lizard',
}

export const taxonCommon = (taxon: string): string | null => TAXON_COMMON[taxon] ?? null

/**
 * The confiscation trend, dropping trailing years whose reporting is obviously
 * incomplete. CITES annual reports arrive with a long lag, so the final year or
 * two collapse to a fraction of their true value — plotting them would draw a
 * false cliff. We cut any trailing year under a third of the prior year until
 * the series stabilises. Returns the kept points plus the last full year shown.
 */
export function trendYears(rows: Array<{ year: number; records: number }>) {
  const s = [...rows].sort((a, b) => a.year - b.year)
  while (s.length > 2) {
    const last = s[s.length - 1]
    const prev = s[s.length - 2]
    if (last.records < prev.records * 0.33) s.pop()
    else break
  }
  return { series: s, lastFullYear: s.length ? s[s.length - 1].year : null }
}

/** Records under the most-endangered CITES tier (Appendix I). */
export function appendixIShare(rows: Array<{ appendix: string; records: number }>) {
  const total = rows.reduce((sum, r) => sum + r.records, 0)
  const one = rows.find((r) => r.appendix === 'I')?.records ?? 0
  return { count: one, pct: total ? one / total : 0 }
}
