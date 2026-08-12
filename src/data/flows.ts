// =============================================================================
// PRECURSOR CHEMICAL FLOWS, PRICES & SEIZURES  (the "upstream" awareness layer)
// =============================================================================
//
// DATA PROVENANCE:
//   • FLOW_RECORDS — OFFICIAL. Corridor statements extracted from the INCB
//     Precursors Report 2025 (published Feb 2026). Every row preserves the
//     exact PDF, document hash, retrieval time, paragraph and physical/printed
//     page locator. Approximate values and bounds remain machine-readable and
//     must never be silently added as exact quantities.
//   • PRECURSOR_PRICE_RECORDS — ILLUSTRATIVE. INCB does not publish precursor
//     prices; pending a citable source, these remain labelled samples.
//
// ETHICAL GRAIN (hard rule): LOGISTICS ONLY — what chemical class, end-drug,
// INCB scheduling, how much seized, and the country-to-country corridor. NO
// chemistry fields: no synthesis routes, no conversion ratios, no yields.
// (The INCB report's manufacturing-method annex was deliberately NOT ingested.)
// =============================================================================

import type {
  PrecursorMeta, AuditedFlowRecord, FlowContextRecord,
  PrecursorPriceRecord, Centroid,
} from '../types'

export const PRECURSORS: PrecursorMeta[] = [
  { id: 'fentanyl_precursors', label: 'Fentanyl-class precursors', endDrug: 'Fentanyl & analogues', incbScheduled: true },
  { id: 'meth_precursors', label: 'Methamphetamine precursors (incl. ephedrines)', endDrug: 'Methamphetamine', incbScheduled: true },
  { id: 'meth_pre_precursors', label: 'Meth "designer" pre-precursors', endDrug: 'Methamphetamine', incbScheduled: false },
  { id: 'heroin_precursors', label: 'Heroin precursors (acetylating agents)', endDrug: 'Heroin', incbScheduled: true },
  { id: 'mdma_precursors', label: 'MDMA ("ecstasy") precursors', endDrug: 'MDMA', incbScheduled: true },
  { id: 'cocaine_precursors', label: 'Cocaine precursors (oxidizers)', endDrug: 'Cocaine', incbScheduled: true },
]

export const INCB_REPORT_2025 = {
  sourceName: 'INCB Precursors Report 2025',
  sourceUrl: 'https://www.incb.org/incb/uploads/documents/Publications/AnnualReports/AR2025/Precursors_Report/E_INCB_2025_4_eng.pdf',
  sourceDocumentSha256: '8397f2799116fe33ce6851ec2c7e03a042886fb9c048f72cdb259724de5ddd6e',
  sourceRetrievedAt: '2026-08-12T13:50:25Z',
} as const

// Quantitative corridor records. A row may represent a single incident, an
// incident aggregate, an annual aggregate or a transparent derived subtotal;
// `recordKind`, `incidentCount`, `quantityRelation`, `quantityBasis` and the
// explicit aggregation contract retain those distinctions rather than forcing
// unlike source statements together.
export const FLOW_RECORDS: AuditedFlowRecord[] = [
  // ¶92: six PICS seizures of 3,4-MDP-2-P ethyl glycidate totalling <1,500 kg
  // in the first 10 months of 2025. Two thirds of the amount was in the first
  // Thailand incident and was destined for Myanmar, so the derived corridor
  // value is a strict upper bound, not an exact 1,000 kg observation.
  {
    precursor: 'mdma_precursors', origin: 'Not reported', transit: null,
    destination: 'Myanmar', seizureLocation: 'Thailand', year: 2025, quantityKg: 1000,
    quantityRelation: 'less_than',
    quantityBasis: 'Derived upper bound for the amount seized in Thailand: two thirds of a six-seizure aggregate reported as less than 1,500 kg of substance.',
    recordKind: 'single_incident', incidentCount: 1,
    aggregationEligibility: 'ineligible_non_exact',
    aggregationGroup: 'mdma_precursor_substance_mass',
    sourceLocator: { pdfPage: 43, printedPage: 25, paragraph: 92 },
    ...INCB_REPORT_2025,
  },
  // ¶94: nine incidents, nearly 5 tons of 4-phenylacetoacetic acid esters (new meth
  // pre-precursors), mislabelled, "originated in China and were destined for
  // countries in the European Union".
  {
    precursor: 'meth_pre_precursors', origin: 'China', transit: null,
    destination: 'European Union', seizureLocation: null, year: 2025, quantityKg: 5000,
    quantityRelation: 'less_than',
    quantityBasis: 'Combined substance mass across nine PICS incidents; the source reports nearly 5 tons, retained as a less-than 5,000 kg bound.',
    recordKind: 'multi_incident_aggregate', incidentCount: 9,
    aggregationEligibility: 'ineligible_non_exact',
    aggregationGroup: 'meth_pre_precursor_substance_mass',
    sourceLocator: { pdfPage: 44, printedPage: 26, paragraph: 94 },
    ...INCB_REPORT_2025,
  },
  // ¶47: >15 tons GROSS WEIGHT of a pseudoephedrine preparation, originated
  // in Morocco, transiting Türkiye, destined for Iran; no pre-export
  // notification; far exceeded Iran's annual legitimate requirement.
  {
    precursor: 'meth_precursors', origin: 'Morocco', transit: 'Türkiye',
    destination: 'Iran', seizureLocation: null, year: 2025, quantityKg: 15000,
    quantityRelation: 'greater_than',
    quantityBasis: 'Gross weight of a pharmaceutical preparation containing pseudoephedrine, not net pseudoephedrine mass.',
    recordKind: 'single_incident', incidentCount: 1,
    aggregationEligibility: 'ineligible_non_exact',
    aggregationGroup: 'pseudoephedrine_preparation_gross_mass',
    sourceLocator: { pdfPage: 31, printedPage: 13, paragraph: 47 },
    ...INCB_REPORT_2025,
  },
  // ¶112: Ecuador reported ~2 t of potassium permanganate seized in 2024,
  // all as a transit country "with consignments destined for Colombia".
  {
    precursor: 'cocaine_precursors', origin: 'Not reported', transit: 'Ecuador',
    destination: 'Colombia', seizureLocation: 'Ecuador', year: 2024, quantityKg: 2000,
    quantityRelation: 'approx',
    quantityBasis: 'Annual potassium permanganate seizure mass reported by Ecuador; the source reports about 2 tons.',
    recordKind: 'annual_aggregate', incidentCount: null,
    aggregationEligibility: 'ineligible_non_exact',
    aggregationGroup: 'potassium_permanganate_substance_mass',
    sourceLocator: { pdfPage: 47, printedPage: 29, paragraph: 112 },
    ...INCB_REPORT_2025,
  },
  // ¶74: DR Congo's first form-D submission: 110 kg ephedrine + 240 kg
  // pseudoephedrine preparations, "originated in India".
  {
    precursor: 'meth_precursors', origin: 'India', transit: null,
    destination: 'Democratic Republic of the Congo',
    seizureLocation: 'Democratic Republic of the Congo', year: 2024, quantityKg: 350,
    quantityRelation: 'exact',
    quantityBasis: 'Derived subtotal of 110 kg of ephedrine preparations and 240 kg of pseudoephedrine preparations reported as originating in India.',
    recordKind: 'derived_subtotal', incidentCount: null,
    aggregationEligibility: 'ineligible_derived', aggregationGroup: null,
    sourceLocator: { pdfPage: 39, printedPage: 21, paragraph: 74 },
    ...INCB_REPORT_2025,
  },
  // ¶76: Germany, six incidents, 40 kg of pseudoephedrine preparations
  // "originating in Egypt ... concealed in coffee bags".
  {
    precursor: 'meth_precursors', origin: 'Egypt', transit: null,
    destination: 'Germany', seizureLocation: 'Germany', year: 2024, quantityKg: 40,
    quantityRelation: 'exact',
    quantityBasis: 'Combined pseudoephedrine-preparation mass across six incidents.',
    recordKind: 'multi_incident_aggregate', incidentCount: 6,
    aggregationEligibility: 'eligible',
    aggregationGroup: 'pseudoephedrine_preparation_mass',
    sourceLocator: { pdfPage: 39, printedPage: 21, paragraph: 76 },
    ...INCB_REPORT_2025,
  },
]

// Operation Pseudonym cannot be represented as a quantitative bilateral
// corridor. Paragraph 46 reports a four-country operation total and names two
// origins for Australian/New Zealand seizures, but never allocates count or
// mass by origin/destination pair. Keep the statement as non-summable context.
export const FLOW_CONTEXT_RECORDS: FlowContextRecord[] = [
  {
    contextId: 'operation-pseudonym-australia-new-zealand-origins-2024',
    precursor: 'meth_precursors',
    origins: ['China', 'India'],
    destinations: ['Australia', 'New Zealand'],
    year: 2024,
    recordKind: 'qualitative_context',
    allocationStatus: 'not_reported_by_origin_destination_pair',
    operationReportedSeizureCount: 168,
    countScope: 'four_reporting_countries_operation_total',
    summary: 'INCB reports that four participating countries recorded 168 seizures during Operation Pseudonym, most in Australia and New Zealand, and that origins for substances in both countries were reported as China and India. The report does not allocate seizure count or mass by origin-and-destination pair.',
    sourceLocator: { pdfPage: 31, printedPage: 13, paragraph: 46 },
    ...INCB_REPORT_2025,
  },
]

// Precursor PRICES — aggregate, country + year, USD per kilogram. A spiking
// precursor price is a leading indicator of enforcement pressure on the chain.
// ILLUSTRATIVE: INCB publishes no precursor price series; labelled pending a
// citable source.
export const PRECURSOR_PRICE_RECORDS: PrecursorPriceRecord[] = [
  { precursor: 'fentanyl_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2020, priceUsdPerKg: 2500 },
  { precursor: 'fentanyl_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2022, priceUsdPerKg: 4200 },
  { precursor: 'fentanyl_precursors', country: 'Mexico', iso3: 'MEX', region: 'Americas', year: 2022, priceUsdPerKg: 9000 },
  { precursor: 'meth_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2021, priceUsdPerKg: 1200 },
  { precursor: 'meth_pre_precursors', country: 'China', iso3: 'CHN', region: 'Asia', year: 2022, priceUsdPerKg: 600 },
  { precursor: 'meth_precursors', country: 'Mexico', iso3: 'MEX', region: 'Americas', year: 2021, priceUsdPerKg: 3800 },
  { precursor: 'heroin_precursors', country: 'India', iso3: 'IND', region: 'Asia', year: 2021, priceUsdPerKg: 950 },
  { precursor: 'heroin_precursors', country: 'Afghanistan', iso3: 'AFG', region: 'Asia', year: 2021, priceUsdPerKg: 1500 },
]

// Approximate lat/lng centroids for the map view. 'European Union' is a
// display anchor (Brussels) for corridors INCB reports at EU grain.
export const COUNTRY_CENTROIDS: Record<string, Centroid> = {
  'China': { lat: 35.9, lng: 104.2 },
  'India': { lat: 22.0, lng: 79.0 },
  'Mexico': { lat: 23.6, lng: -102.5 },
  'United States': { lat: 39.8, lng: -98.6 },
  'Myanmar': { lat: 21.9, lng: 95.9 },
  'Australia': { lat: -25.3, lng: 133.8 },
  'Afghanistan': { lat: 33.9, lng: 67.7 },
  'Thailand': { lat: 15.9, lng: 100.9 },
  'Laos': { lat: 19.9, lng: 102.5 },
  'Netherlands': { lat: 52.1, lng: 5.3 },
  'Germany': { lat: 51.2, lng: 10.4 },
  'European Union': { lat: 50.85, lng: 4.35 },
  'Morocco': { lat: 31.8, lng: -7.1 },
  'Türkiye': { lat: 39.0, lng: 35.2 },
  'Iran': { lat: 32.4, lng: 53.7 },
  'New Zealand': { lat: -41.5, lng: 172.8 },
  'Ecuador': { lat: -1.8, lng: -78.2 },
  'Colombia': { lat: 4.6, lng: -74.1 },
  'Democratic Republic of the Congo': { lat: -2.9, lng: 23.7 },
  'Egypt': { lat: 26.8, lng: 30.8 },
}
