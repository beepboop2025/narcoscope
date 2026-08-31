export type TabId =
  | 'atlas'
  | 'wire'
  | 'overview'
  | 'newsroom'
  | 'intel'
  | 'prices'
  | 'pricehistory'
  | 'flows'
  | 'map'
  | 'seizuretrends'
  | 'states'
  | 'triangulate'
  | 'designations'
  | 'illicitfinance'
  | 'wildlife'
  | 'bri'
  | 'balochistan'
  | 'pakistan-gwadar'
  | 'myanmar'

export type LensItem = {
  id: TabId
  label: string
  shortLabel: string
  description: string
}

export type LensGroup = {
  id: string
  label: string
  eyebrow: string
  items: readonly LensItem[]
}

/**
 * The product's public information architecture. Keeping this separate from
 * App.tsx makes navigation labels, descriptions and group membership one
 * contract instead of three lists that can quietly drift apart.
 */
export const LENS_GROUPS: readonly LensGroup[] = [
  {
    id: 'briefing',
    label: 'Briefing',
    eyebrow: 'Start here',
    items: [
      { id: 'atlas', label: 'Illicit-economy atlas', shortLabel: 'Atlas', description: 'Compare drug, arms, wildlife, raw-material and shadow-economy evidence one source-grained measure at a time.' },
      { id: 'wire', label: 'Live evidence wire', shortLabel: 'Live wire', description: 'Follow newly retrieved official releases and reporting leads with rights, clocks and verification state attached.' },
      { id: 'overview', label: 'Global overview', shortLabel: 'Overview', description: 'The highest-signal official aggregates, trend breaks and data freshness in one view.' },
      { id: 'newsroom', label: 'Evidence newsroom', shortLabel: 'Newsroom', description: 'Citation-gated analysis with countercases, limitations and a machine-readable receipt.' },
      { id: 'intel', label: 'Enterprise intelligence', shortLabel: 'Intel', description: 'Multi-source risk cards that keep verification tier, staleness and conflicts visible.' },
    ],
  },
  {
    id: 'markets',
    label: 'Markets',
    eyebrow: 'Price + movement',
    items: [
      { id: 'prices', label: 'Street prices', shortLabel: 'Prices', description: 'Rank reported retail prices across countries with affordability and purity boundaries.' },
      { id: 'pricehistory', label: 'Price history · 30 years', shortLabel: '30-year history', description: 'Trace long-run price change without flattening gaps in the official series.' },
      { id: 'flows', label: 'Precursor flows + prices', shortLabel: 'Precursors', description: 'Read published precursor corridors beside price context and source precision.' },
      { id: 'map', label: 'Global flow map', shortLabel: 'Flow map', description: 'Explore country-level seizure records and published corridor relationships spatially.' },
    ],
  },
  {
    id: 'harm',
    label: 'Harm',
    eyebrow: 'Outcome record',
    items: [
      { id: 'seizuretrends', label: 'Seizure trends', shortLabel: 'Seizures', description: 'Compare annual world totals and country movers while preserving reporting lag.' },
      { id: 'states', label: 'US overdose map', shortLabel: 'US overdose', description: 'Inspect provisional state mortality by substance, year and population-adjusted rate.' },
    ],
  },
  {
    id: 'networks',
    label: 'Networks',
    eyebrow: 'Cross-record joins',
    items: [
      { id: 'triangulate', label: 'Triangulation', shortLabel: 'Triangulation', description: 'Find places where supply, price and harm move together—or visibly disagree.' },
      { id: 'designations', label: 'Entity and action register', shortLabel: 'Entities', description: 'Search privacy-minimized public legal actions while keeping designation, charge, sanction and conviction states distinct.' },
      { id: 'illicitfinance', label: 'Finance typologies', shortLabel: 'Finance', description: 'Keep public designation facts separate from reference typologies and inference.' },
      { id: 'wildlife', label: 'Wildlife seizures', shortLabel: 'Wildlife', description: 'Inspect the adjacent confiscation record without treating correlation as a shared cause.' },
    ],
  },
  {
    id: 'regions',
    label: 'BRI + regions',
    eyebrow: 'Corridor evidence',
    items: [
      { id: 'bri', label: 'BRI and corridors', shortLabel: 'BRI & Corridors', description: 'Inspect the complete CPEC, Gwadar, CMEC, Kyaukpyu and Balochistan readiness ledger beside bounded national economics.' },
      { id: 'balochistan', label: 'Balochistan evidence', shortLabel: 'Balochistan', description: 'Keep political economy, civic, electoral, armed, state, legal, rights and humanitarian evidence in separate lanes.' },
      { id: 'pakistan-gwadar', label: 'Pakistan and Gwadar', shortLabel: 'Pakistan & Gwadar', description: 'Read CPEC, port, connectivity and public-service targets with Pakistan national context and visible coverage gaps.' },
      { id: 'myanmar', label: 'Myanmar focus', shortLabel: 'Myanmar', description: 'Read CMEC and Kyaukpyu readiness beside a separate aggregate opium, conflict and precursor evidence lane.' },
    ],
  },
] as const

export const TABS = LENS_GROUPS.flatMap((group) => group.items)

/** First-class dossiers that remain visible regardless of the open research group. */
export const PRIMARY_DOSSIER_IDS = [
  'bri',
  'balochistan',
  'pakistan-gwadar',
  'myanmar',
] as const satisfies readonly TabId[]

export const PRIMARY_DOSSIERS = PRIMARY_DOSSIER_IDS.map((id) => {
  const item = TABS.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`Missing primary dossier navigation contract: ${id}`)
  return item
})

export function groupForTab(tab: string): LensGroup | undefined {
  return LENS_GROUPS.find((group) => group.items.some((item) => item.id === tab))
}

export function lensForTab(tab: string): LensItem | undefined {
  return TABS.find((item) => item.id === tab)
}
