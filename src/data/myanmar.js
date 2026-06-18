// =============================================================================
// MYANMAR FOCUS — sub-national (Golden Triangle) granularity
// =============================================================================
//
// ⚠️ DATA PROVENANCE: ILLUSTRATIVE samples in the SHAPE of public data.
// Replace with official, citable sources:
//   • UNODC — Myanmar Opium Survey (cultivation by region, hectares)
//       https://www.unodc.org/unodc/en/crop-monitoring/index.html
//   • UNODC — Synthetic Drugs in East & Southeast Asia (annual)
//   • UNODC — Mekong / Golden Triangle seizure reporting
//
// ETHICAL GRAIN (the one rule that makes this safe):
//   Region = administrative unit (state / self-administered division) and
//   border = named corridor TOWN that appears in published reports. That is the
//   resolution UNODC publishes. We do NOT store lab sites, GPS points, routes a
//   person could follow, or any chemistry. Province-level awareness, nothing
//   navigable.
// =============================================================================

// Production / source regions inside Myanmar (administrative grain).
export const MM_REGIONS = [
  { id: 'shan_north', label: 'Shan State (North)', lat: 23.2, lng: 98.0 },
  { id: 'shan_east',  label: 'Shan State (East)',  lat: 21.2, lng: 99.6 },
  { id: 'shan_south', label: 'Shan State (South)', lat: 20.5, lng: 97.6 },
  { id: 'wa',         label: 'Wa Self-Administered Division', lat: 22.4, lng: 99.2 },
  { id: 'kachin',     label: 'Kachin State', lat: 26.0, lng: 97.6 },
  { id: 'kayah',      label: 'Kayah State',  lat: 19.3, lng: 97.2 },
]

// Named cross-border corridor towns (all appear by name in UNODC reporting).
export const MM_BORDER_NODES = [
  { id: 'muse',      label: 'Muse (→ China / Yunnan)',     lat: 23.98, lng: 97.90 },
  { id: 'tachileik', label: 'Tachileik (→ Thailand)',      lat: 20.45, lng: 99.88 },
  { id: 'mekong',    label: 'Mekong / Golden Triangle SEZ', lat: 20.35, lng: 100.08 },
  { id: 'kachin_in', label: 'Kachin border (→ NE India)',  lat: 25.6, lng: 95.3 },
]

const NODE = Object.fromEntries(
  [...MM_REGIONS, ...MM_BORDER_NODES].map((n) => [n.id, n]),
)
export const mmCoord = (id) => {
  const n = NODE[id]
  return n ? [n.lng, n.lat] : null
}
export const mmLabel = (id) => NODE[id]?.label ?? id

// Region activity by year. opiumHa = opium poppy cultivation (hectares);
// methIndex = relative synthetic-drug activity indicator (0–100, not a volume).
// { region, year, opiumHa, methIndex }
export const MM_REGION_RECORDS = [
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
// quantityKg = aggregate seized along the corridor for the year.
// { from, to, year, quantityKg, drug }
export const MM_FLOW_RECORDS = [
  { from: 'shan_north', to: 'muse',      year: 2020, quantityKg: 2400, drug: 'Methamphetamine' },
  { from: 'shan_north', to: 'muse',      year: 2022, quantityKg: 4100, drug: 'Methamphetamine' },
  { from: 'wa',         to: 'mekong',    year: 2022, quantityKg: 6800, drug: 'Methamphetamine' },
  { from: 'shan_east',  to: 'tachileik', year: 2020, quantityKg: 3000, drug: 'Methamphetamine' },
  { from: 'shan_east',  to: 'tachileik', year: 2022, quantityKg: 5200, drug: 'Methamphetamine' },
  { from: 'shan_south', to: 'tachileik', year: 2022, quantityKg: 1800, drug: 'Methamphetamine' },
  { from: 'kachin',     to: 'kachin_in', year: 2022, quantityKg: 700,  drug: 'Heroin' },
]
