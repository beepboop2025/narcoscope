import { describe, expect, it } from 'vitest'
import { formatFlowQuantity, isExactFlowRecord } from './Flows'

const flow = (quantityRelation) => ({ quantityKg: 1500, quantityRelation })

describe('Flows quantity presentation', () => {
  it('admits only an explicit exact qualifier into exact-only subtotals', () => {
    expect(isExactFlowRecord(flow('exact'))).toBe(true)
    expect(isExactFlowRecord(flow('approx'))).toBe(false)
    expect(isExactFlowRecord(flow('less_than'))).toBe(false)
    expect(isExactFlowRecord(flow('greater_than'))).toBe(false)
    expect(isExactFlowRecord(flow(undefined))).toBe(false)
  })

  it('preserves qualifiers and labels missing qualifiers instead of implying exactness', () => {
    expect(formatFlowQuantity(flow('exact'))).toBe('1,500 kg')
    expect(formatFlowQuantity(flow('approx'))).toBe('≈ 1,500 kg')
    expect(formatFlowQuantity(flow('less_than'))).toBe('< 1,500 kg')
    expect(formatFlowQuantity(flow('greater_than'))).toBe('> 1,500 kg')
    expect(formatFlowQuantity(flow(undefined))).toBe('Qualifier missing (1,500 kg reported)')
  })
})
