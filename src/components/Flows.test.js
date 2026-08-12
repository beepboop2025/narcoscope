import { describe, expect, it } from 'vitest'
import { formatFlowQuantity, isAggregationEligibleFlowRecord } from './Flows'

const flow = (quantityRelation, overrides = {}) => ({
  quantityKg: 1500,
  quantityRelation,
  recordKind: 'multi_incident_aggregate',
  ...overrides,
})

describe('Flows quantity presentation', () => {
  it('requires exactness, explicit eligibility and a canonical compatible group', () => {
    const eligible = {
      aggregationEligibility: 'eligible',
      aggregationGroup: 'pseudoephedrine_preparation_mass',
    }
    expect(isAggregationEligibleFlowRecord(flow('exact', eligible))).toBe(true)
    expect(isAggregationEligibleFlowRecord(flow('exact'))).toBe(false)
    expect(isAggregationEligibleFlowRecord(flow('exact', {
      ...eligible,
      aggregationGroup: 'unknown_mass_basis',
    }))).toBe(false)
    expect(isAggregationEligibleFlowRecord(flow('exact', {
      ...eligible,
      recordKind: 'derived_subtotal',
    }))).toBe(false)
    expect(isAggregationEligibleFlowRecord(flow('approx', eligible))).toBe(false)
    expect(isAggregationEligibleFlowRecord(flow('less_than', eligible))).toBe(false)
    expect(isAggregationEligibleFlowRecord(flow('greater_than', eligible))).toBe(false)
    expect(isAggregationEligibleFlowRecord(flow(undefined, eligible))).toBe(false)
  })

  it('preserves qualifiers and labels missing qualifiers instead of implying exactness', () => {
    expect(formatFlowQuantity(flow('exact'))).toBe('1,500 kg')
    expect(formatFlowQuantity(flow('approx'))).toBe('≈ 1,500 kg')
    expect(formatFlowQuantity(flow('less_than'))).toBe('< 1,500 kg')
    expect(formatFlowQuantity(flow('greater_than'))).toBe('> 1,500 kg')
    expect(formatFlowQuantity(flow(undefined))).toBe('Qualifier missing (1,500 kg reported)')
  })
})
