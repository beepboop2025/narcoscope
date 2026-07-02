// =============================================================================
// MYANMAR FOCUS — sub-national (Golden Triangle) granularity
// =============================================================================
//
// ⚠️ DATA PROVENANCE: ILLUSTRATIVE samples in the SHAPE of public data.
// Replace with official, citable sources:
//   • UNODC — Myanmar Opium Survey (cultivation by region, hectares)
//   • UNODC — Synthetic Drugs in East & Southeast Asia (annual)
//
// ETHICAL GRAIN: Region = administrative unit; border = named corridor TOWN that
// appears in published reports. NO lab sites, GPS points, routes, or chemistry.
// =============================================================================

import type {
  MmConflictEventRecord,
  MmFlowRecord,
  MmNode,
  MmPrecursorFlowRecord,
  MmRegionRecord,
} from '../types'

export const MM_REGIONS: MmNode[] = [
  { id: 'shan_north', label: 'Shan State (North)', lat: 23.2, lng: 98.0 },
  { id: 'shan_east',  label: 'Shan State (East)',  lat: 21.2, lng: 99.6 },
  { id: 'shan_south', label: 'Shan State (South)', lat: 20.5, lng: 97.6 },
  { id: 'wa',         label: 'Wa Self-Administered Division', lat: 22.4, lng: 99.2 },
  { id: 'kachin',     label: 'Kachin State', lat: 26.0, lng: 97.6 },
  { id: 'kayah',      label: 'Kayah State',  lat: 19.3, lng: 97.2 },
]

export const MM_BORDER_NODES: MmNode[] = [
  { id: 'muse',      label: 'Muse (→ China / Yunnan)',     lat: 23.98, lng: 97.90 },
  { id: 'tachileik', label: 'Tachileik (→ Thailand)',      lat: 20.45, lng: 99.88 },
  { id: 'mekong',    label: 'Mekong / Golden Triangle SEZ', lat: 20.35, lng: 100.08 },
  { id: 'kachin_in', label: 'Kachin border (→ NE India)',  lat: 25.6, lng: 95.3 },
]

const NODE: Record<string, MmNode> = Object.fromEntries(
  [...MM_REGIONS, ...MM_BORDER_NODES].map((n) => [n.id, n]),
)
export const mmCoord = (id: string): [number, number] | null => {
  const n = NODE[id]
  return n ? [n.lng, n.lat] : null
}
export const mmLabel = (id: string): string => NODE[id]?.label ?? id

// Administrative-unit adjacency only (which region shares a border with which),
// sourced from public administrative maps of Shan/Kachin/Kayah States — no
// operational or sub-region-of-region granularity. Used to model geographic
// spillover risk: a region with calm current indicators but a high-risk
// neighbor deserves an early-warning flag, per spatial-diffusion conflict
// research (armed-conflict spillover/contagion literature).
export const MM_REGION_ADJACENCY: Record<string, string[]> = {
  shan_north: ['shan_east', 'kachin'],
  shan_east: ['shan_north', 'shan_south', 'wa'],
  shan_south: ['shan_east', 'kayah'],
  wa: ['shan_east'],
  kachin: ['shan_north'],
  kayah: ['shan_south'],
}

// opiumHa = opium poppy cultivation (hectares);
// methIndex = relative synthetic-drug activity indicator (0–100, not a volume).
export const MM_REGION_RECORDS: MmRegionRecord[] = [
  { region: 'shan_north', year: 2020, opiumHa: 11000, methIndex: 70 },
  { region: 'shan_north', year: 2022, opiumHa: 16000, methIndex: 85 },
  { region: 'shan_east',  year: 2020, opiumHa: 9000,  methIndex: 80 },
  { region: 'shan_east',  year: 2022, opiumHa: 13500, methIndex: 95 },
  { region: 'shan_south', year: 2020, opiumHa: 7000,  methIndex: 55 },
  { region: 'shan_south', year: 2022, opiumHa: 9500,  methIndex: 65 },
  { region: 'wa',         year: 2020, opiumHa: 3000,  methIndex: 90 },
  { region: 'wa',         year: 2022, opiumHa: 3800,  methIndex: 98 },
  { region: 'kachin',     year: 2020, opiumHa: 4200,  methIndex: 30 },
  { region: 'kachin',     year: 2022, opiumHa: 5100,  methIndex: 35 },
  { region: 'kayah',      year: 2020, opiumHa: 1200,  methIndex: 20 },
  { region: 'kayah',      year: 2022, opiumHa: 1600,  methIndex: 25 },
]

// Cross-border corridors: source region → border town → out of country.
export const MM_FLOW_RECORDS: MmFlowRecord[] = [
  { from: 'shan_north', to: 'muse',      year: 2020, quantityKg: 2400, drug: 'Methamphetamine' },
  { from: 'shan_north', to: 'muse',      year: 2022, quantityKg: 4100, drug: 'Methamphetamine' },
  { from: 'wa',         to: 'mekong',    year: 2022, quantityKg: 6800, drug: 'Methamphetamine' },
  { from: 'shan_east',  to: 'tachileik', year: 2020, quantityKg: 3000, drug: 'Methamphetamine' },
  { from: 'shan_east',  to: 'tachileik', year: 2022, quantityKg: 5200, drug: 'Methamphetamine' },
  { from: 'shan_south', to: 'tachileik', year: 2022, quantityKg: 1800, drug: 'Methamphetamine' },
  { from: 'kachin',     to: 'kachin_in', year: 2022, quantityKg: 700,  drug: 'Heroin' },
]

// Conflict-pressure layer: public, aggregate observations only. "intensity" is a
// 0-100 analytical index built from source-coded event counts/severity, not a claim
// about exact battlefield activity.
export const MM_CONFLICT_EVENTS: MmConflictEventRecord[] = [
  {
    region: 'shan_north',
    year: 2022,
    actor: 'Myanmar military / border-aligned militias',
    actorType: 'military',
    eventType: 'territorial_control',
    intensity: 78,
    sourceName: 'International Crisis Group',
    sourceUrl: 'https://www.crisisgroup.org/asia/south-east-asia/myanmar',
  },
  {
    region: 'wa',
    year: 2022,
    actor: 'United Wa State Army-administered area',
    actorType: 'eao',
    eventType: 'territorial_control',
    intensity: 62,
    sourceName: 'UNODC Synthetic Drugs in East and Southeast Asia',
    sourceUrl: 'https://www.unodc.org/roseap/en/what-we-do/toc/synthetic-drugs.html',
  },
  {
    region: 'shan_east',
    year: 2022,
    actor: 'Border armed groups and trafficking networks',
    actorType: 'militia',
    eventType: 'clash',
    intensity: 70,
    sourceName: 'ACLED Myanmar event data',
    sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
  },
  {
    region: 'kachin',
    year: 2022,
    actor: 'Kachin conflict actors',
    actorType: 'eao',
    eventType: 'clash',
    intensity: 48,
    sourceName: 'ACLED Myanmar event data',
    sourceUrl: 'https://acleddata.com/asia-pacific/myanmar/',
  },
]

// Inbound precursor corridors feeding Myanmar production regions. These are
// country/province-level seizure/reporting records; they deliberately exclude
// recipes, conversion ratios, lab sites, or operational route detail.
export const MM_PRECURSOR_FLOWS: MmPrecursorFlowRecord[] = [
  {
    originCountry: 'China',
    transitCountry: null,
    to: 'shan_north',
    year: 2022,
    precursor: 'meth_pre_precursors',
    quantityKg: 4200,
    sourceName: 'INCB Precursors report',
    sourceUrl: 'https://www.incb.org/incb/en/precursors/',
    confidence: 'reported',
  },
  {
    originCountry: 'China',
    transitCountry: 'Laos',
    to: 'wa',
    year: 2022,
    precursor: 'meth_precursors',
    quantityKg: 3600,
    sourceName: 'UNODC Synthetic Drugs in East and Southeast Asia',
    sourceUrl: 'https://www.unodc.org/roseap/en/what-we-do/toc/synthetic-drugs.html',
    confidence: 'estimated',
  },
  {
    originCountry: 'India',
    transitCountry: null,
    to: 'kachin',
    year: 2022,
    precursor: 'heroin_precursors',
    quantityKg: 900,
    sourceName: 'INCB Precursors report',
    sourceUrl: 'https://www.incb.org/incb/en/precursors/',
    confidence: 'reported',
  },
  {
    originCountry: 'Thailand',
    transitCountry: null,
    to: 'shan_east',
    year: 2022,
    precursor: 'meth_precursors',
    quantityKg: 1700,
    sourceName: 'UNODC Mekong seizure reporting',
    sourceUrl: 'https://www.unodc.org/roseap/en/what-we-do/toc/synthetic-drugs.html',
    confidence: 'reported',
  },
]
