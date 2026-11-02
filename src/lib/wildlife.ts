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

/**
 * English common names for the taxa in the extract, so no row needs a dash.
 *
 * Names follow CITES, the authority whose records these are:
 *  - species: the English convention-language name in Species+, the CITES and
 *    UNEP-WCMC database of record (https://speciesplus.net/), read 2026-11-02;
 *  - "spp." entries for a family or order: the reference name the CITES
 *    Appendices print beside that family or order
 *    (https://cites.org/eng/app/appendices.php, as published 2026-03-05);
 *  - "spp." entries for a genus: the family's CITES reference name, marked with
 *    the genus where the family holds other genera.
 * Every name was checked against those two sources; none is invented here.
 */
const TAXON_COMMON: Record<string, string> = {
  // Species+ English names.
  'Saussurea costus': 'Costus root (medicinal)',
  'Loxodonta africana': 'African elephant',
  'Panax quinquefolius': 'American ginseng',
  'Alligator mississippiensis': 'American alligator',
  'Crocodylus niloticus': 'Nile crocodile',
  'Malayopython reticulatus': 'Reticulated python',
  'Python reticulatus': 'Reticulated python',
  'Python sebae': 'African rock python',
  'Chelonia mydas': 'Green turtle',
  'Eretmochelys imbricata': 'Hawksbill turtle',
  'Caiman crocodilus': 'Spectacled caiman',
  'Strombus gigas': 'Queen conch',
  'Panthera pardus': 'Leopard',
  'Panthera tigris': 'Tiger',
  'Ursus americanus': 'American black bear',
  'Varanus salvator': 'Water monitor',
  // CITES Appendices reference names for orders and families.
  'Scleractinia spp.': 'Stony corals',
  'Tridacnidae spp.': 'Giant clams',
  'Cheloniidae spp.': 'Sea turtles',
  'Elephantidae spp.': 'Elephants',
  'Crocodylidae spp.': 'Crocodiles (family)',
  'Orchidaceae spp.': 'Orchids',
  'Cactaceae spp.': 'Cacti',
  // Genera: Moschus is the only musk deer genus, Varanus the only monitor
  // lizard genus and Hippocampus the seahorses of the pipefish family.
  'Moschus spp.': 'Musk deer',
  'Varanus spp.': 'Monitor lizards',
  'Hippocampus spp.': 'Seahorses',
  'Crocodylus spp.': 'Crocodiles (genus Crocodylus)',
  'Python spp.': 'Pythons (genus Python)',
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
