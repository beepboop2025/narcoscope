import type { DesignationRecord } from '../types'

/**
 * This module summarizes facts present in the reduced OFAC extract. It does
 * not infer an entity's function from generic words in its name. The extract
 * carries the official name, entity type, program codes and countries of
 * record, but deliberately carries no allegation narrative.
 */

export interface ExplicitLaunderingDesignation {
  name: string
  countries: string[]
  programs: string[]
  matchedField: 'official_name' | 'official_alias'
}

const EXPLICIT_MONEY_LAUNDERING = /\bmoney[ -]laundering\b/i

/**
 * Returns only records whose OFAC-published name or alias literally contains
 * the phrase "money laundering". This is a string fact, not a conclusion
 * about conduct, guilt or the role of any other designated entity.
 */
export function explicitLaunderingDesignations(
  records: DesignationRecord[],
): ExplicitLaunderingDesignation[] {
  return records
    .flatMap((record): ExplicitLaunderingDesignation[] => {
      const officialNameMatches = EXPLICIT_MONEY_LAUNDERING.test(record.name)
      const officialAliasMatches = record.aliases.some((alias) => EXPLICIT_MONEY_LAUNDERING.test(alias))
      if (!officialNameMatches && !officialAliasMatches) return []
      return [{
        name: record.name,
        countries: [...record.countries],
        programs: [...record.programs],
        matchedField: officialNameMatches ? 'official_name' : 'official_alias',
      }]
    })
    .sort((a, b) => b.countries.length - a.countries.length || a.name.localeCompare(b.name))
}

export interface CrossJurisdictionDesignation {
  name: string
  countries: string[]
  programs: string[]
  reach: number
}

/**
 * OFAC records with more than one country of record. Country coverage is not
 * an entity-to-entity edge, a money flow, or evidence of a criminal network.
 */
export function crossJurisdictionDesignations(
  records: DesignationRecord[],
  minCountries = 2,
): CrossJurisdictionDesignation[] {
  return records
    .filter((record) => record.countries.length >= minCountries)
    .map((record) => ({
      name: record.name,
      countries: [...record.countries],
      programs: [...record.programs],
      reach: record.countries.length,
    }))
    .sort((a, b) => b.reach - a.reach || a.name.localeCompare(b.name))
}

export interface JurisdictionCoverage {
  country: string
  count: number
}

/** Counts OFAC country-of-record mentions without assigning a financial role. */
export function designationJurisdictionCoverage(
  records: DesignationRecord[],
  limit = 10,
): JurisdictionCoverage[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const country of record.countries) {
      counts.set(country, (counts.get(country) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
    .slice(0, limit)
}

export interface ProgramCoverage {
  program: string
  count: number
}

/** Counts records under each official OFAC program code. */
export function designationProgramCoverage(records: DesignationRecord[]): ProgramCoverage[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const program of record.programs) {
      counts.set(program, (counts.get(program) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([program, count]) => ({ program, count }))
    .sort((a, b) => b.count - a.count || a.program.localeCompare(b.program))
}

// These are external reference methods. They are not classifications of the
// designation records and do not imply that any displayed entity used them.
export interface Typology {
  id: string
  name: string
  region: string
  how: string
  source: string
}

export const TYPOLOGIES: Typology[] = [
  {
    id: 'hawala',
    name: 'Hawala',
    region: 'South Asia, Gulf and East Africa',
    how: 'A payer gives value to one broker and a counterpart pays the recipient elsewhere. Brokers settle later through offsetting balances or trade. The method can move value without a conventional cross-border bank transfer.',
    source: 'FATF guidance on money services and alternative remittance systems',
  },
  {
    id: 'fei_chien',
    name: 'Fei-ch\u2019ien (flying money)',
    region: 'China and Chinese diaspora markets',
    how: 'A historical informal value-transfer model in which brokers coordinate local collection and distant payout, with later settlement through trade or offsetting balances.',
    source: 'FATF and US Treasury public typology material',
  },
  {
    id: 'tbml',
    name: 'Trade-based money laundering',
    region: 'Global trade and free-trade zones',
    how: 'Value can be moved by misstating the price, quantity or quality of traded goods. Detecting it requires transaction and trade evidence; a company name containing "trading" or "export" is not evidence of this method.',
    source: 'FATF trade-based money-laundering risk indicators',
  },
  {
    id: 'casino',
    name: 'Casino and gaming typology',
    region: 'Cash-intensive gaming markets',
    how: 'Gaming instruments can be used to place, layer or convert value. Establishing that use requires transaction or investigative evidence; a casino name alone does not establish laundering.',
    source: 'FATF risk-based guidance for casinos',
  },
]
