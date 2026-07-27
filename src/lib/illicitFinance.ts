// =============================================================================
// ILLICIT FINANCE — the money-laundering infrastructure inside the OFAC data
// =============================================================================
// Drug proceeds do not vanish; they move through a financial plumbing of
// hawala networks, exchange houses, trade-based front companies and casinos.
// That plumbing is not hypothetical here — OFAC has designated much of it BY
// NAME (the Khanani hawala network, the Barakat TCO, Chams money-laundering
// organisation, dozens of Gulf exchange houses and trading fronts). This module
// reframes the bundled designation records around that FUNCTION, so the
// infrastructure the drug trade runs on is legible.
//
// Every entity here is officially designated — this reports a government's
// published action, exactly like the Designations tab, and never an allegation
// this tool invented. The actual laundering FLOWS (which are unobservable, and
// therefore modelled as scenarios) live in a separate private analysis; this
// public layer shows only what has been designated.

import type { DesignationRecord } from '../types'

/** Functional role, inferred from the designated entity's name and programme. */
export type FinanceFunction =
  | 'laundering_org'    // a named money-laundering organisation / network
  | 'exchange_hawala'   // exchange house, remittance, hawala / casa de cambio
  | 'front_company'     // trading / import-export / general-trading front
  | 'casino'            // casino / gaming (a classic cash-laundering channel)
  | 'other'             // designated, but not a financial facilitator by name

/** Name patterns for each function. Order matters — first match wins. */
const RULES: Array<{ fn: FinanceFunction; match: RegExp }> = [
  { fn: 'laundering_org', match: /money laundering organization|laundering network|\bML[O]?\b/i },
  { fn: 'casino', match: /\bcasino|\bgaming\b|\bcasas de juego/i },
  { fn: 'exchange_hawala', match: /\bexchange\b|\bhawala\b|remittance|remesa|casa de cambio|money service|money transfer|\bMSB\b/i },
  { fn: 'front_company', match: /\btrading\b|import|export|\bgeneral trading\b|\bFZCO?\b|\bFZE\b|\btrade\b|comercializadora|importadora/i },
]

export function classifyFunction(record: DesignationRecord): FinanceFunction {
  for (const rule of RULES) {
    if (rule.match.test(record.name)) return rule.fn
  }
  return 'other'
}

export interface FacilitatorGroup {
  fn: FinanceFunction
  label: string
  description: string
  count: number
  /** A few named examples, most-connected first. */
  examples: Array<{ name: string; countries: string[]; programs: string[] }>
}

export const FUNCTION_LABEL: Record<FinanceFunction, string> = {
  laundering_org: 'Named money-laundering networks',
  exchange_hawala: 'Exchange houses & hawala / money-service businesses',
  front_company: 'Trade-based front companies',
  casino: 'Casinos & gaming',
  other: 'Other designated entities',
}

const FUNCTION_DESC: Record<FinanceFunction, string> = {
  laundering_org: 'Organisations OFAC designated specifically as laundering operations — the wholesale layer that washes proceeds for multiple trafficking groups.',
  exchange_hawala: 'The value-transfer layer: exchange houses and hawala / money-service businesses that move proceeds across borders outside the banking system.',
  front_company: 'Import-export and general-trading companies used to move value through mis-invoiced goods — trade-based money laundering.',
  casino: 'Cash-intensive gaming businesses that convert and layer illicit cash.',
  other: 'Designated under a narcotics or transnational-crime authority but not a financial facilitator by name.',
}

/** Groups the designated financial facilitators by function, with examples. */
export function facilitatorGroups(records: DesignationRecord[]): FacilitatorGroup[] {
  const byFn = new Map<FinanceFunction, DesignationRecord[]>()
  for (const r of records) {
    const fn = classifyFunction(r)
    if (fn === 'other') continue
    if (!byFn.has(fn)) byFn.set(fn, [])
    byFn.get(fn)!.push(r)
  }
  const order: FinanceFunction[] = ['laundering_org', 'exchange_hawala', 'front_company', 'casino']
  return order
    .filter((fn) => byFn.has(fn))
    .map((fn) => {
      const list = byFn.get(fn)!.sort((a, b) => b.countries.length - a.countries.length)
      return {
        fn,
        label: FUNCTION_LABEL[fn],
        description: FUNCTION_DESC[fn],
        count: list.length,
        examples: list.slice(0, 6).map((r) => ({ name: r.name, countries: r.countries, programs: r.programs })),
      }
    })
}

export interface LaunderingNetwork {
  name: string
  countries: string[]
  programs: string[]
  /** Cross-border reach = number of jurisdictions the network is recorded in. */
  reach: number
}

/**
 * The named, multi-jurisdiction laundering / transnational-crime networks — the
 * ones whose designation spans several countries, i.e. the cross-border money
 * infrastructure (Khanani, Barakat, and the rest). Ranked by reach.
 */
export function launderingNetworks(records: DesignationRecord[], minReach = 2): LaunderingNetwork[] {
  return records
    .filter((r) => {
      const fn = classifyFunction(r)
      const isNetwork = fn === 'laundering_org'
        || (r.programs.includes('TCO') && /organization|network|group|cartel/i.test(r.name))
      return isNetwork && r.countries.length >= minReach
    })
    .map((r) => ({ name: r.name, countries: r.countries, programs: r.programs, reach: r.countries.length }))
    .sort((a, b) => b.reach - a.reach)
}

/**
 * Jurisdictions ranked by how many designated financial facilitators they hold
 * — the laundering hubs. The Gulf (UAE especially) dominates, which matches the
 * betweenness the designation network already surfaces.
 */
export function launderingHubs(records: DesignationRecord[]): Array<{ country: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of records) {
    if (classifyFunction(r) === 'other') continue
    for (const c of r.countries) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
}

// -----------------------------------------------------------------------------
// TYPOLOGIES — how the money actually moves. Reference layer, FATF-grounded.
// -----------------------------------------------------------------------------
// These are laundering METHODS, not datasets — the flows are deliberately
// invisible. Each links to the kind of designated entity that exemplifies it,
// so the typology is anchored to something real rather than left abstract.

export interface Typology {
  id: string
  name: string
  region: string
  how: string
  /** A search term that finds exemplifying designated entities on the Designations tab. */
  exemplar: string
  source: string
}

export const TYPOLOGIES: Typology[] = [
  {
    id: 'hawala',
    name: 'Hawala',
    region: 'South Asia, Gulf, East Africa',
    how: 'Value moves without money crossing a border: a payer hands cash to a hawaladar in one country, who instructs a counterpart to pay out in another, settling later through trade or offsetting balances. No transaction record, no bank. The Khanani network is the designated archetype.',
    exemplar: 'Khanani',
    source: 'FATF — money laundering through money service / alternative remittance',
  },
  {
    id: 'fei_chien',
    name: 'Fei-ch’ien (Chinese "flying money")',
    region: 'China & the Chinese diaspora',
    how: 'The centuries-old Chinese underground-banking analogue of hawala: proceeds are handed to a broker and "flown" to a distant payout via a network of merchants, increasingly netted against trade flows and, lately, cross-border Chinese money brokers who now launder cartel drug proceeds out of the Americas. Value transfers; cash does not.',
    exemplar: 'trading',
    source: 'FATF / US Treasury — Chinese money-laundering organisations (CMLOs)',
  },
  {
    id: 'tbml',
    name: 'Trade-based laundering (TBML)',
    region: 'Global; Gulf & free-trade zones',
    how: 'Value is moved by mis-pricing goods — over- or under-invoicing a shipment so the payment carries laundered value inside a legitimate-looking trade. The designated import-export and general-trading "FZCO/FZE" front companies are its vehicles.',
    exemplar: 'trading',
    source: 'FATF — trade-based money laundering typologies',
  },
  {
    id: 'casino',
    name: 'Casino & SEZ laundering',
    region: 'Mekong SEZs, Latin America',
    how: 'Cash is bought into chips, played briefly, and cashed out as "winnings" — clean on paper. In the Mekong Special Economic Zones the same compounds host drug transit, scam centres and casinos, so the casino is the laundering front for the whole convergence.',
    exemplar: 'Casino',
    source: 'FATF / GI-TOC — casinos and junkets in Southeast Asia',
  },
]
