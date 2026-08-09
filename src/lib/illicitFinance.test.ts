import { describe, expect, it } from 'vitest'
import type { DesignationRecord } from '../types'
import {
  crossJurisdictionDesignations,
  designationJurisdictionCoverage,
  designationProgramCoverage,
  explicitLaunderingDesignations,
} from './illicitFinance'

const record = (overrides: Partial<DesignationRecord>): DesignationRecord => ({
  entityNumber: 1,
  name: 'EXAMPLE ENTITY',
  entityType: 'organization',
  programs: ['TCO'],
  countries: ['Exampleland'],
  aliases: [],
  ...overrides,
})

describe('designation fact summaries', () => {
  it('never infers laundering or facilitation from generic business words', () => {
    const genericNames = [
      'EXAMPLE TRADING FZCO',
      'EXAMPLE EXCHANGE HOUSE',
      'EXAMPLE CASINO GROUP',
      'EXAMPLE IMPORT EXPORT COMPANY',
      'EXAMPLE TRANSNATIONAL CRIMINAL ORGANIZATION',
    ].map((name, index) => record({ entityNumber: index + 1, name }))

    expect(explicitLaunderingDesignations(genericNames)).toEqual([])
  })

  it('reports only a literal money-laundering phrase in an official name or alias', () => {
    const records = [
      record({ name: 'EXAMPLE MONEY LAUNDERING ORGANIZATION' }),
      record({ entityNumber: 2, name: 'EXAMPLE TWO', aliases: ['EXAMPLE MONEY-LAUNDERING NETWORK'] }),
      record({ entityNumber: 3, name: 'EXAMPLE TRADING COMPANY' }),
    ]

    expect(explicitLaunderingDesignations(records)).toEqual([
      expect.objectContaining({ name: 'EXAMPLE MONEY LAUNDERING ORGANIZATION', matchedField: 'official_name' }),
      expect.objectContaining({ name: 'EXAMPLE TWO', matchedField: 'official_alias' }),
    ])
  })

  it('keeps program, country and cross-jurisdiction counts as separate facts', () => {
    const records = [
      record({ programs: ['TCO', 'SDNTK'], countries: ['A', 'B'] }),
      record({ entityNumber: 2, programs: ['TCO'], countries: ['A'] }),
    ]

    expect(designationProgramCoverage(records)).toEqual([
      { program: 'TCO', count: 2 },
      { program: 'SDNTK', count: 1 },
    ])
    expect(designationJurisdictionCoverage(records)).toEqual([
      { country: 'A', count: 2 },
      { country: 'B', count: 1 },
    ])
    expect(crossJurisdictionDesignations(records)).toEqual([
      expect.objectContaining({ name: 'EXAMPLE ENTITY', reach: 2 }),
    ])
  })
})
