// =============================================================================
// RETAIL ("STREET") PRICE DATASET
// =============================================================================
//
// ⚠️ DATA PROVENANCE — READ THIS:
// The figures below are ILLUSTRATIVE/REPRESENTATIVE samples shaped to match the
// structure of official public datasets. They sit within the broad ranges
// reported publicly but are NOT authoritative and MUST be replaced with the
// real source files before this is presented as factual.
//
// Replace with official, citable, aggregate (country + annual) data from:
//   • UNODC — "Drugs: prices" dataset  → https://dataunodc.un.org
//   • EUDA (formerly EMCDDA) — price & purity → https://www.euda.europa.eu/data
//   • UNODC World Drug Report (annual)  → https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report.html
//
// GRAIN (deliberate guardrail): country + year + annual average ONLY.
// No sub-national, no real-time, no point-of-sale data. Awareness, not a guide.
//
// Units: priceUsdPerGram = retail price per gram in nominal USD (year-of-record).
//        purityPct       = typical retail purity %, where reported (null if N/A).
// =============================================================================

export const DRUGS = [
  { id: 'cocaine', label: 'Cocaine', unit: 'gram' },
  { id: 'heroin', label: 'Heroin', unit: 'gram' },
  { id: 'cannabis', label: 'Cannabis (herbal)', unit: 'gram' },
  { id: 'methamphetamine', label: 'Methamphetamine', unit: 'gram' },
]

// Flat, tidy records — easy to swap for a CSV → JSON import later.
// { drug, country, iso3, region, year, priceUsdPerGram, purityPct }
export const PRICE_RECORDS = [
  // --- Cocaine ---
  { drug: 'cocaine', country: 'United States', iso3: 'USA', region: 'Americas', year: 2018, priceUsdPerGram: 112, purityPct: 61 },
  { drug: 'cocaine', country: 'United States', iso3: 'USA', region: 'Americas', year: 2021, priceUsdPerGram: 120, purityPct: 65 },
  { drug: 'cocaine', country: 'Germany', iso3: 'DEU', region: 'Europe', year: 2018, priceUsdPerGram: 88, purityPct: 70 },
  { drug: 'cocaine', country: 'Germany', iso3: 'DEU', region: 'Europe', year: 2021, priceUsdPerGram: 92, purityPct: 76 },
  { drug: 'cocaine', country: 'Colombia', iso3: 'COL', region: 'Americas', year: 2018, priceUsdPerGram: 6, purityPct: 80 },
  { drug: 'cocaine', country: 'Colombia', iso3: 'COL', region: 'Americas', year: 2021, priceUsdPerGram: 7, purityPct: 82 },
  { drug: 'cocaine', country: 'Australia', iso3: 'AUS', region: 'Oceania', year: 2021, priceUsdPerGram: 230, purityPct: 57 },

  // --- Heroin ---
  { drug: 'heroin', country: 'United States', iso3: 'USA', region: 'Americas', year: 2018, priceUsdPerGram: 150, purityPct: 33 },
  { drug: 'heroin', country: 'United States', iso3: 'USA', region: 'Americas', year: 2021, priceUsdPerGram: 145, purityPct: 30 },
  { drug: 'heroin', country: 'Germany', iso3: 'DEU', region: 'Europe', year: 2021, priceUsdPerGram: 55, purityPct: 22 },
  { drug: 'heroin', country: 'India', iso3: 'IND', region: 'Asia', year: 2021, priceUsdPerGram: 18, purityPct: 20 },
  { drug: 'heroin', country: 'Afghanistan', iso3: 'AFG', region: 'Asia', year: 2021, priceUsdPerGram: 3, purityPct: 48 },

  // --- Cannabis (herbal) ---
  { drug: 'cannabis', country: 'United States', iso3: 'USA', region: 'Americas', year: 2021, priceUsdPerGram: 10, purityPct: null },
  { drug: 'cannabis', country: 'Germany', iso3: 'DEU', region: 'Europe', year: 2021, priceUsdPerGram: 12, purityPct: null },
  { drug: 'cannabis', country: 'India', iso3: 'IND', region: 'Asia', year: 2021, priceUsdPerGram: 2, purityPct: null },

  // --- Methamphetamine ---
  { drug: 'methamphetamine', country: 'United States', iso3: 'USA', region: 'Americas', year: 2021, priceUsdPerGram: 65, purityPct: 90 },
  { drug: 'methamphetamine', country: 'Australia', iso3: 'AUS', region: 'Oceania', year: 2021, priceUsdPerGram: 320, purityPct: 78 },
  { drug: 'methamphetamine', country: 'Thailand', iso3: 'THA', region: 'Asia', year: 2021, priceUsdPerGram: 25, purityPct: 85 },
]

// Context data for the "affordability" lens — approximate nominal GDP per capita
// (USD), used to express price as a share of average daily income. Replace with
// World Bank figures (NY.GDP.PCAP.CD) for accuracy.
export const GDP_PER_CAPITA_USD = {
  USA: 70000,
  DEU: 51000,
  COL: 6600,
  AUS: 60000,
  IND: 2400,
  AFG: 370,
  THA: 7200,
}

export const SOURCES = [
  { name: 'UNODC — Drugs: prices', url: 'https://dataunodc.un.org' },
  { name: 'EUDA (EMCDDA) — price & purity data', url: 'https://www.euda.europa.eu/data' },
  { name: 'UNODC World Drug Report', url: 'https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report.html' },
  { name: 'World Bank — GDP per capita', url: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD' },
]
