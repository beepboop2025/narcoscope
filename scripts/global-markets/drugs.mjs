#!/usr/bin/env node
/** Fixed-source aggregate collector for NarcoScope's educational data explorer. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateMarketDataset } from '../../lib/global-markets.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PARSER = fileURLToPath(new URL('./drugs-workbooks.py', import.meta.url))
export const WDR_LICENSE = 'Educational/non-profit reproduction with source acknowledgement is permitted by UNODC World Drug Report 2026. No resale or other commercial use without prior written permission from UNODC. Copyright remains United Nations; this dataset is not sublicensed under the repository MIT licence.'
const WDR_PAGE = 'https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report-2026-annex.html'
const WDR_RIGHTS = 'https://www.unodc.org/documents/data-and-analysis/WDR_2026/WDR26_Highlights.pdf'
const WDR_BASE = 'https://www.unodc.org/documents/data-and-analysis/WDR_2026/Annex/'
export const DRUG_SOURCES = Object.freeze([
  ['wdr2026-seizures','7.1_Drug_seizures_2015-2024.xlsx','Drug seizures, 2015–2024'],
  ['wdr2026-prices','8.1_Prices_and_purities_of_drugs.xlsx','Drug prices and purity, 2020–2024'],
  ['wdr2026-treatment','5.1_treatment_by_primary_drug_of_use.xlsx','Treatment by primary drug of use, 2020–2024'],
  ['wdr2026-labs','9.1_clandestine_laboratories_detected_and_dismantled.xlsx','Detected/dismantled drug laboratories and sites'],
].map(([id,file,title])=>({id,file,artifactFile:'wdr2026-'+file,downloadUrl:WDR_BASE+file,
  name:'UNODC World Drug Report 2026 — '+title,publisher:'United Nations Office on Drugs and Crime',url:WDR_PAGE,
  license:WDR_LICENSE,licenseUrl:WDR_RIGHTS,notes:[
    'Source: UNODC, World Drug Report 2026 (United Nations publication, 2026), statistical annex. Numeric tables are normalized for NarcoScope’s educational, public-good explorer; no United Nations endorsement is implied.',
    'The educational/non-profit reproduction grant is on page 2 of World Drug Report 2026 Highlights. Commercial reuse has not been granted. Source licence overrides the repository software licence for these observations.',
    'Download/retrieval year and economic reference year are separate. Missing observations are not zero; the release can revise historical values.',
  ]})).concat(['13100820','13100871'].map(id=>({id:'statcan-'+id,file:id+'.zip',artifactFile:id+'.zip',
  downloadUrl:`https://www150.statcan.gc.ca/n1/tbl/csv/${id}-eng.zip`,
  name:`Statistics Canada table ${id} — Monthly drug residues in wastewater`,publisher:'Statistics Canada',
  url:`https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${id}01`,
  license:'Statistics Canada Open Licence; reproduction and distribution permitted with source acknowledgement.',
  licenseUrl:'https://www.statcan.gc.ca/en/reference/licence',notes:[
    'Source: Statistics Canada, Canadian Wastewater Survey; tables 13-10-0820-01 and 13-10-0871-01. Normalized monthly estimates and 95% confidence intervals; no Statistics Canada endorsement is implied.',
    'Source dates end in 2020 or 2023. This is additional analyte and monthly granularity, not a claim of new 2026 wastewater sampling.',
  ]}))))

export const hash = raw => createHash('sha256').update(raw).digest('hex')
export const MAX_RAW_STORE_BYTES = 512*1024*1024
export function assertRawStoreCapacity(retainedBytes,newBytes) {
  if(!Number.isSafeInteger(retainedBytes)||!Number.isSafeInteger(newBytes)||retainedBytes<0||newBytes<0||retainedBytes+newBytes>MAX_RAW_STORE_BYTES)throw new Error('Private raw store byte limit; preserve and archive reviewed vintages before further acquisition')
}
export function collectionOutputClock(offline,sources,now=new Date().toISOString()) {
  return offline?new Date(Math.max(...sources.map(source=>Date.parse(source.retrievedAt)))).toISOString():now
}
export class SourceAcquisitionError extends Error {
  constructor(message,cause) {super(message,{cause});this.name='SourceAcquisitionError';this.code='SOURCE_ACQUISITION_FAILED'}
}
export function parseArguments(args) {
  const options={out:path.join(ROOT,'public/data/global-drugs-v1.json')}
  for(let i=0;i<args.length;i++) {
    const key=args[i]
    if(key==='--offline'){options.offline=true;continue}
    if(!['--store','--offline-dir','--out'].includes(key)||!args[i+1]||args[i+1].startsWith('--')) throw new Error('Usage: drugs.mjs --store <private directory> [--offline-dir <captured files>] [--out <public JSON>]')
    options[key.slice(2)]=path.resolve(args[++i])
  }
  if(!options.store||options.store===ROOT||options.store.startsWith(ROOT+path.sep)) throw new Error('A private --store outside the repository is required')
  return options
}

export async function download(source,fetchImpl=globalThis.fetch) {
  let current=source.downloadUrl
  for(let redirects=0;redirects<=2;redirects++) {
    const url=new URL(current), original=new URL(source.downloadUrl)
    if(url.protocol!=='https:'||url.hostname!==original.hostname||url.username||url.password||url.port) throw new Error('Unexpected source redirect')
    let response
    try {response=await fetchImpl(current,{redirect:'manual',signal:AbortSignal.timeout(45000),headers:{'User-Agent':'NarcoScope educational data collector (+https://github.com/beepboop2025/narcoscope)'}})}catch(error){throw new SourceAcquisitionError('Official source request failed',error)}
    if([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel(); current=new URL(response.headers.get('location'),current).href;continue
    }
    if(!response.ok) {await response.body?.cancel();throw new SourceAcquisitionError(`Official source HTTP ${response.status}`)}
    const declared=Number(response.headers.get('content-length'))
    if(declared>16*1024*1024) {await response.body?.cancel();throw new Error('Source byte limit')}
    const chunks=[];let size=0
    if(!response.body)throw new Error('Missing official source response body')
    try {for await(const chunk of response.body) {size+=chunk.length;if(size>16*1024*1024) {throw new Error('Source byte limit')}chunks.push(chunk)}}catch(error){if(error.message==='Source byte limit')throw error;throw new SourceAcquisitionError('Official source stream failed',error)}
    const raw=Buffer.concat(chunks)
    if(raw.length<4||raw.readUInt32LE(0)!==0x04034b50) throw new Error('Expected XLSX/ZIP source bytes')
    return raw
  }
  throw new Error('Source redirect limit')
}

function python(args) {
  const result=spawnSync('python3',['-B',PARSER,...args],{encoding:'utf8',maxBuffer:96*1024*1024,timeout:120000})
  if(result.status!==0) throw new Error((result.stderr||result.error?.message||'Source parser failed').slice(0,2000))
  return JSON.parse(result.stdout)
}
async function atomic(target,raw,mode=0o600) {
  await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700})
  const temp=target+`.tmp-${process.pid}`
  try {await fs.writeFile(temp,raw,{mode,flag:'wx'});await fs.rename(temp,target)} finally {await fs.rm(temp,{force:true})}
}
async function readOptional(file) {try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}

export async function collect(options) {
  await fs.mkdir(options.store,{recursive:true,mode:0o700})
  const lock=path.join(options.store,'collection.lock')
  await fs.mkdir(lock,{mode:0o700})
  try {
    const prior=await readOptional(path.join(options.store,'manifest.json'))
    const rawDir=path.join(options.store,'raw')
    await fs.mkdir(rawDir,{recursive:true,mode:0o700})
    const rawNames=await fs.readdir(rawDir)
    if(rawNames.length>4096)throw new Error('Private raw store file limit')
    const retainedRaw=new Set();let retainedBytes=0
    for(const name of rawNames) {
      const info=await fs.lstat(path.join(rawDir,name))
      if(!/^[a-f0-9]{64}\.zip$/.test(name)||!info.isFile()||info.size>16*1024*1024)throw new Error('Invalid private raw store entry')
      retainedRaw.add(name);retainedBytes+=info.size
    }
    assertRawStoreCapacity(retainedBytes,0)
    const sources=[],captures={},files={},audits={}
    for(const spec of DRUG_SOURCES) {
      let raw,imported
      if(options.offline) {
        imported=prior?.captures?.[spec.id]
        if(!imported||!/^([a-f0-9]{64})$/.test(imported.sha256)||imported.url!==spec.downloadUrl)throw new Error('Missing or invalid retained source manifest')
        const rawFile=path.join(options.store,'raw',imported.sha256+'.zip')
        if(!(await fs.lstat(rawFile)).isFile())throw new Error('Retained source must be a regular file')
        raw=await fs.readFile(rawFile)
        if(hash(raw)!==imported.sha256||raw.length!==imported.bytes||!Number.isFinite(Date.parse(imported.retrievedAt)))throw new Error('Retained source hash/receipt mismatch')
      } else if(options['offline-dir']) {
        const file=path.join(options['offline-dir'],spec.artifactFile)
        if(!(await fs.lstat(file)).isFile()) throw new Error('Offline source must be a regular file')
        raw=await fs.readFile(file)
        const receiptFile=spec.id.startsWith('statcan-')?file+'.receipt.json':file+'.receipt.json'
        imported=await readOptional(receiptFile)
        if(!imported||imported.url!==spec.downloadUrl||imported.sha256!==hash(raw)||imported.bytes!==raw.length||!Number.isFinite(Date.parse(imported.retrievedAt))) throw new Error('Offline receipt/hash/source mismatch')
      } else raw=await download(spec)
      if(raw.length>16*1024*1024||raw.length<4||raw.readUInt32LE(0)!==0x04034b50) throw new Error('Archive byte bound/signature')
      const sha256=hash(raw), previous=prior?.captures?.[spec.id]
      const retrievedAt=previous?.sha256===sha256?previous.retrievedAt:(imported?.retrievedAt??new Date().toISOString())
      const rawFile=path.join(options.store,'raw',sha256+'.zip')
      if(!retainedRaw.has(sha256+'.zip'))assertRawStoreCapacity(retainedBytes,raw.length)
      try {await fs.writeFile(rawFile,raw,{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST')throw error;if(hash(await fs.readFile(rawFile))!==sha256)throw new Error('Immutable raw source changed')}
      if(!retainedRaw.has(sha256+'.zip')){retainedRaw.add(sha256+'.zip');retainedBytes+=raw.length}
      files[spec.id]=rawFile
      captures[spec.id]={sha256,bytes:raw.length,retrievedAt,url:spec.downloadUrl}
      const {id,name,publisher,url,downloadUrl,license,licenseUrl,notes}=spec
      sources.push({id,name,publisher,url,downloadUrl,license,licenseUrl,retrievedAt,sha256,bytes:raw.length,notes:[...notes]})
    }
    const countries=python(['--kind','country-map','--input',files['wdr2026-seizures'],'--related',files['wdr2026-treatment'],files['wdr2026-labs']])
    const countryFile=path.join(options.store,'country-map.json');await atomic(countryFile,JSON.stringify(countries))
    const indicators=[],observations=[]
    for(const source of sources) {
      const normalized=python(['--kind',source.id,'--input',files[source.id],'--countries',countryFile])
      indicators.push(...normalized.indicators);observations.push(...normalized.observations);audits[source.id]=normalized.audit
      source.notes.push(`Parser audit: ${normalized.audit.omittedRows} source rows omitted for missing units/nonannual reference periods or ambiguous treatment counts; ${normalized.audit.identicalDuplicates} identical duplicate cells collapsed; ${normalized.audit.ambiguousGrains??0} treatment grains with conflicting counts excluded.`)
      if(source.id==='wdr2026-treatment')source.notes.push('Although the worksheet title specifies 2020–2024, it also contains older observations back to 2015. Each row retains its actual reference year; no year is inferred from the title.')
      if(normalized.audit.correctedSourceLabels)source.notes.push(`${normalized.audit.correctedSourceLabels} DOC seizure labels include an extraneous numeric token in source column G. The exact clean substance name is corroborated by source column K and is used as the category; sourceLocator retains the original label/cells. Kilograms always come from column I, never from the label.`)
    }
    indicators.sort((a,b)=>a.id.localeCompare(b.id));observations.sort((a,b)=>a.id.localeCompare(b.id));sources.sort((a,b)=>a.id.localeCompare(b.id))
    const old=await readOptional(options.out)
    const generatedAt=collectionOutputClock(options.offline,sources)
    const dataset={schema:'narcoscope.global-markets.v1',id:'global-drugs',title:'Drug markets: global reported supply, treatment, prices and monthly wastewater',
      generatedAt,sources,indicators,observations,limitations:[
        'UNODC WDR observations are reproduced for this educational, public-good explorer under the publication’s educational/non-profit grant. They are not licensed for resale or other commercial use; obtain written UNODC permission before such reuse.',
        'Country-reported drug seizures, treatment and detected laboratories do not reveal all hidden-market activity. Enforcement, service access, legal definitions and reporting affect these series.',
        'Native units, sale levels, substances and source statistics remain separate. No synthetic global market size, trafficking route or causal effect is calculated.',
        'Price/purity source entries can contain multiple observations for a country, substance and year. Entries are retained separately; source minimum/maximum are not confidence intervals, and no missing typical value is imputed.',
        'Monthly wastewater loads measure residues during sampled weeks, not numbers of users. Parent substances, metabolites, licit prescriptions and direct disposal have different interpretations.',
        'This dataset expands historical coverage and dimensions. Retrieval dates are not reference periods. Canada wastewater ends in 2023 and the reviewed WDR annexes generally end in 2024.',
      ]}
    if(old&&JSON.stringify({...old,generatedAt:null})===JSON.stringify({...dataset,generatedAt:null})) dataset.generatedAt=old.generatedAt
    validateMarketDataset(dataset)
    if(!options.offline)await atomic(path.join(options.store,'manifest.json'),JSON.stringify({schema:'narcoscope.drug-captures.v1',checkedAt:new Date().toISOString(),captures,audits},null,2))
    await atomic(options.out,JSON.stringify(dataset)+'\n',0o644)
    return {sources:sources.length,indicators:indicators.length,observations:observations.length,numericObservations:observations.filter(x=>x.value!==null).length,sha256:hash(await fs.readFile(options.out)),out:options.out,audits}
  } finally {await fs.rmdir(lock)}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await collect(parseArguments(process.argv.slice(2)))))}catch(error){console.error(error.message);process.exitCode=1}
}
