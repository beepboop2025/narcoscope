import { describe,it,expect } from 'vitest'
import { DRUG_MAP,isPerGram,resolvePrice,reviewedEdition,retainedGdpSnapshot,refreshGdpSnapshot } from './wdr-price-rules.mjs'
describe('reviewed WDR price vocabulary',()=>{
  it('retains later-year Grams without accepting kg, tablets or bulk amounts',()=>{
    expect(['Gram','Grams','Kilograms','Tablets','100 Grams',''].map(isPerGram)).toEqual([true,true,false,false,false,false])
  })
  it('maps only reviewed substance forms and keeps crack/tablets separate',()=>{
    expect(DRUG_MAP['Cocaine hydrochloride']).toBe('cocaine')
    expect(DRUG_MAP['Cannabis herb (marijuana)']).toBe('cannabis')
    expect(DRUG_MAP['Methamphetamine powder']).toBe('methamphetamine')
    expect(DRUG_MAP['“Crack” cocaine']).toBeUndefined()
    expect(DRUG_MAP['Methamphetamine tablets']).toBeUndefined()
  })
  it('preserves zeros and refuses one-sided, reversed, nonfinite or negative ranges',()=>{
    expect(resolvePrice(0,2,4)).toBe(0)
    expect(resolvePrice(null,2,4)).toBe(3)
    for(const values of [[null,null,4],[null,4,2],[NaN,-2,4],[Infinity,2,undefined]])expect(resolvePrice(...values)).toBeNull()
  })
  it('binds provenance to reviewed source-title periods',()=>{
    expect(reviewedEdition('Prices of drugs, 2020-2024')).toBe(2026)
    expect(reviewedEdition('Prices of drugs, 2019-2023')).toBe(2025)
    expect(()=>reviewedEdition('Prices of drugs, 2021-2025')).toThrow()
  })
})

describe('independent World Bank GDP snapshot',()=>{
  const prior=`// World Bank GDP per capita, current US$ (NY.GDP.PCAP.CD), latest available
// year per country, fetched 2025-08-12. Rounded to whole dollars.
export const GDP_PER_CAPITA_USD: Record<string, number> = {
  PAK: 1479, // 2024
  USA: 86170, // 2024
}`
  it('retains values and the original clock when a price refresh has no usable GDP response',()=>{
    const retained=retainedGdpSnapshot(prior)
    for(const response of [[],[{},[]],[{},null],[{},[{countryiso3code:'USA',date:'2024',value:null}]]]) {
      expect(()=>refreshGdpSnapshot(retained,response,'2026-09-08',['USA'])).toThrow(/no .*GDP observations/)
      expect(retained.block).toBe(prior)
      expect(retained.entries.get('USA')).toEqual({value:86170,year:2024,fetchedAt:'2025-08-12'})
    }
  })
  it('preserves countries absent from the new price edition and clocks for unrefreshed entries',()=>{
    const result=refreshGdpSnapshot(retainedGdpSnapshot(prior),[{},[{countryiso3code:'USA',date:'2024',value:86170.49}]],'2026-09-08',['USA'])
    expect(result.entries.get('PAK')).toEqual({value:1479,year:2024,fetchedAt:'2025-08-12'})
    expect(result.entries.get('USA')).toEqual({value:86170,year:2024,fetchedAt:'2026-09-08'})
    expect(retainedGdpSnapshot(result.block).entries).toEqual(result.entries)
  })
  it('refuses malformed GDP values and an empty retained snapshot',()=>{
    expect(()=>refreshGdpSnapshot(retainedGdpSnapshot(prior),[{},[{countryiso3code:'USA',date:'2024',value:NaN}]],'2026-09-08',['USA'])).toThrow(/Invalid/)
    expect(()=>retainedGdpSnapshot(prior.replace(/  [A-Z]{3}: [^\n]+\n/g,''))).toThrow(/empty/)
  })
})
