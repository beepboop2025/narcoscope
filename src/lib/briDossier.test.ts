import { describe, expect, it } from 'vitest'
import artifact from '../../public/data/narcoscope-palimpsest-bri-v1.json'
import { parseBriEnvelope, selectBriDossier } from './briDossier'

function envelope(data: unknown = artifact): unknown {
  return {
    ok: true,
    resource: 'palimpsest-bri',
    data: {
      schema: 'narcoscope.api.palimpsest-bri-envelope.v1',
      data,
    },
  }
}

describe('BRI dossier contract', () => {
  it('selects each tab from the same sealed context without cross-lane inference', () => {
    const context = parseBriEnvelope(envelope())
    const bri = selectBriDossier(context, 'bri')
    const balochistan = selectBriDossier(context, 'balochistan')
    const pakistan = selectBriDossier(context, 'pakistan-gwadar')
    const myanmar = selectBriDossier(context, 'myanmar')

    expect(bri.areas.map((area) => area.areaId)).toEqual(['cpec', 'gwadar', 'cmec', 'kyaukpyu', 'balochistan'])
    expect(bri.targetCount).toBe(8)
    expect(bri.sourceCount).toBe(43)
    expect(bri.buildReadySourceCount).toBe(11)
    expect(bri.economicTotals).toEqual({ sourceRows: 3564, observedRows: 1940, forecastRows: 0, unavailableRows: 1624 })
    expect(balochistan.areas.map((area) => area.areaId)).toEqual(['balochistan'])
    expect(pakistan.areas.map((area) => area.areaId)).toEqual(['cpec', 'gwadar'])
    expect(pakistan.countries[0]).toMatchObject({ countryCode: 'PAK', unavailableRowCount: 481 })
    expect(myanmar.areas.map((area) => area.areaId)).toEqual(['cmec', 'kyaukpyu'])
    expect(myanmar.countries[0]).toMatchObject({ countryCode: 'MMR', unavailableRowCount: 668 })
  })

  it('fails closed when the envelope weakens the non-join policy', () => {
    const weakened: any = structuredClone(artifact)
    weakened.usePolicy.crossLaneJoinPolicy = 'allowed'
    expect(() => parseBriEnvelope(envelope(weakened))).toThrow(/prohibited cross-lane join/i)
  })

  it('fails closed when bounded economic coverage is missing', () => {
    const incomplete: any = structuredClone(artifact)
    delete incomplete.economicContext.coverage
    expect(() => parseBriEnvelope(envelope(incomplete))).toThrow(/economicContext\.coverage must be an object/i)
  })

  it('fails closed on malformed nested source metadata before rendering', () => {
    const incomplete: any = structuredClone(artifact)
    delete incomplete.targetCoverage[0].targets[0].sources[0].claimClasses
    expect(() => parseBriEnvelope(envelope(incomplete))).toThrow(/claimClasses must be a string array/i)
  })
})
