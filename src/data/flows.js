// =============================================================================
// PRECURSOR CHEMICAL FLOWS & SEIZURES  (the "upstream" awareness layer)
// =============================================================================
//
// ⚠️ DATA PROVENANCE: ILLUSTRATIVE samples shaped to the structure of public
// enforcement reporting. Replace with official, citable, aggregate data from:
//   • INCB — Precursors annual report & PICS  → https://www.incb.org/incb/en/precursors/
//   • UNODC — World Drug Report (precursor chapter) & Synthetic Drugs Strategy
//   • UNODC dataUNODC — seizures           → https://dataunodc.un.org
//
// ETHICAL GRAIN (hard rule): this layer stores LOGISTICS ONLY —
//   what chemical, the end-drug it serves, its INCB scheduling, how much was
//   seized, and the country-to-country corridor. There are deliberately NO
//   chemistry fields: no synthesis routes, no conversion ratios, no yields.
//   Awareness of the supply chain — not a manual for it.
// =============================================================================

// Precursors tracked by INCB, identified by the finished drug they enable and
// their international control status. (Category labels only — no how-to.)
export const PRECURSORS = [
  { id: 'fentanyl_precursors', label: 'Fentanyl-class precursors', endDrug: 'Fentanyl & analogues', incbScheduled: true },
  { id: 'meth_precursors', label: 'Methamphetamine precursors', endDrug: 'Methamphetamine', incbScheduled: true },
  { id: 'meth_pre_precursors', label: 'Meth "designer" pre-precursors', endDrug: 'Methamphetamine', incbScheduled: false },
  { id: 'heroin_precursors', label: 'Heroin precursors (acetylating agents)', endDrug: 'Heroin', incbScheduled: true },
]

// Aggregate corridor records. quantityKg = total seized along the corridor for
// the year (kilograms). A corridor is origin → transit (optional) → destination,
// all at COUNTRY grain.
// { precursor, origin, transit, destination, year, quantityKg }
export const FLOW_RECORDS = [
  // China as a source hub — the emerging-problem thesis you flagged.
  { precursor: 'fentanyl_precursors', origin: 'China', transit: 'Mexico', destination: 'United States', year: 2020, quantityKg: 1800 },
  { precursor: 'fentanyl_precursors', origin: 'China', transit: 'Mexico', destination: 'United States', year: 2022, quantityKg: 3100 },
  { precursor: 'meth_pre_precursors', origin: 'China', transit: 'Myanmar', destination: 'Australia', year: 2022, quantityKg: 5400 },
  { precursor: 'meth_precursors', origin: 'China', transit: null, destination: 'Mexico', year: 2021, quantityKg: 12000 },

  // India as a secondary source the reports increasingly flag.
  { precursor: 'fentanyl_precursors', origin: 'India', transit: null, destination: 'Mexico', year: 2022, quantityKg: 900 },
  { precursor: 'heroin_precursors', origin: 'India', transit: null, destination: 'Afghanistan', year: 2021, quantityKg: 4200 },

  // The "Golden Triangle" meth surge.
  { precursor: 'meth_pre_precursors', origin: 'China', transit: 'Thailand', destination: 'Myanmar', year: 2021, quantityKg: 7600 },

  // European nexus.
  { precursor: 'meth_precursors', origin: 'China', transit: 'Netherlands', destination: 'Germany', year: 2022, quantityKg: 2100 },
]

// Precursor PRICES — aggregate, country + year, in USD per kilogram.
// Same provenance + grain rules as everything else. A spiking precursor price
// is a leading indicator of enforcement pressure on the supply chain, which is
// exactly the kind of signal an awareness tool should surface.
// { precursor, country, iso3, region, year, priceUsdPerKg }
export const PRECURSOR_PRICE_RECORDS = [
  { precursor: 'fentanyl_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2020, priceUsdPerKg: 2500 },
  { precursor: 'fentanyl_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2022, priceUsdPerKg: 4200 },
  { precursor: 'fentanyl_precursors', country: 'Mexico', iso3: 'MEX', region: 'Americas', year: 2022, priceUsdPerKg: 9000 },
  { precursor: 'meth_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2021, priceUsdPerKg: 1200 },
  { precursor: 'meth_pre_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2022, priceUsdPerKg: 600 },
  { precursor: 'meth_precursors', country: 'Mexico', iso3: 'MEX', region: 'Americas', year: 2021, priceUsdPerKg: 3800 },
  { precursor: 'heroin_precursors', country: 'India', iso3: 'IND', region: 'Asia', year: 2021, priceUsdPerKg: 950 },
  { precursor: 'heroin_precursors', country: 'Afghanistan', iso3: 'AFG', region: 'Asia', year: 2021, priceUsdPerKg: 1500 },
]

// Approximate lat/lng centroids for the map view. Replace with a proper
// country-centroid table when wiring real data.
export const COUNTRY_CENTROIDS = {
  'China': { lat: 35.9, lng: 104.2 },
  'India': { lat: 22.0, lng: 79.0 },
  'Mexico': { lat: 23.6, lng: -102.5 },
  'United States': { lat: 39.8, lng: -98.6 },
  'Myanmar': { lat: 21.9, lng: 95.9 },
  'Australia': { lat: -25.3, lng: 133.8 },
  'Afghanistan': { lat: 33.9, lng: 67.7 },
  'Thailand': { lat: 15.9, lng: 100.9 },
  'Netherlands': { lat: 52.1, lng: 5.3 },
  'Germany': { lat: 51.2, lng: 10.4 },
}
