import { describe,it,expect } from 'vitest'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { download,parseArguments,DRUG_SOURCES,SourceAcquisitionError,collectionOutputClock,assertRawStoreCapacity,MAX_RAW_STORE_BYTES } from './drugs.mjs'
import { validateMarketDataset } from '../../lib/global-markets.mjs'
describe('fixed-source drugs collector',()=>{
  it('rejects a private store inside the repository',()=>{
    expect(()=>parseArguments(['--store',process.cwd()])).toThrow('private')
    expect(()=>parseArguments(['--unknown','x'])).toThrow('Usage')
  })
  it('does not follow an official-site redirect to another host',async()=>{
    let calls=0
    await expect(download(DRUG_SOURCES[0],async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://attacker.invalid/a.zip'}})})).rejects.toThrow('redirect')
    expect(calls).toBe(1)
  })
  it('rejects HTTP denial and oversized or HTML payloads',async()=>{
    await expect(download(DRUG_SOURCES[0],async()=>new Response('blocked',{status:403}))).rejects.toBeInstanceOf(SourceAcquisitionError)
    await expect(download(DRUG_SOURCES[0],async()=>new Response('x',{headers:{'content-length':String(20*1024*1024)}}))).rejects.toThrow('byte limit')
    await expect(download(DRUG_SOURCES[0],async()=>new Response('<html>not data</html>'))).rejects.toThrow('XLSX/ZIP')
  })
  it('classifies transport errors separately from malformed source evidence',async()=>{
    await expect(download(DRUG_SOURCES[0],async()=>{throw new Error('connection reset')})).rejects.toMatchObject({code:'SOURCE_ACQUISITION_FAILED'})
    try {await download(DRUG_SOURCES[0],async()=>new Response('not a workbook'))}catch(error){expect(error).not.toBeInstanceOf(SourceAcquisitionError)}
    expect(parseArguments(['--store','/tmp/private-drugs-fixture','--offline']).offline).toBe(true)
  })
  it('uses original captures for changed offline output, independent of prior output or current time',()=>{
    const sources=[{retrievedAt:'2025-04-01T09:00:00Z'},{retrievedAt:'2025-04-03T10:00:00Z'}]
    expect(collectionOutputClock(true,sources,'2026-09-08T12:00:00Z')).toBe('2025-04-03T10:00:00.000Z')
    expect(collectionOutputClock(false,sources,'2026-09-08T12:00:00Z')).toBe('2026-09-08T12:00:00Z')
  })
  it('halts acquisition at the retained raw byte cap without deleting immutable vintages',()=>{
    expect(()=>assertRawStoreCapacity(MAX_RAW_STORE_BYTES-4,4)).not.toThrow()
    expect(()=>assertRawStoreCapacity(MAX_RAW_STORE_BYTES-4,5)).toThrow('store byte limit')
    expect(()=>assertRawStoreCapacity(-1,0)).toThrow('store byte limit')
  })
  it('passes source parser regressions for suppression, intervals, source years and duplicate ambiguity',()=>{
    const result=spawnSync('python3',['-B','scripts/global-markets/drugs_workbooks_test.py'],{encoding:'utf8'})
    expect(result.status,result.stderr).toBe(0)
  })
  it('validates the actual retained educational dataset and separates observed from unavailable cells',()=>{
    const dataset=JSON.parse(fs.readFileSync('public/data/global-drugs-v1.json','utf8'))
    expect(()=>validateMarketDataset(dataset)).not.toThrow()
    expect(dataset.observations.some(r=>r.period==='2024'&&r.indicatorId==='wdr2026-seizures-kg')).toBe(true)
    expect(dataset.observations.some(r=>r.value===null&&r.status==='unavailable')).toBe(true)
    expect(dataset.sources.filter(s=>s.id.startsWith('wdr2026-')).every(s=>s.license.includes('commercial'))).toBe(true)
  })
})
