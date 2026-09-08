// Explicit reviewed UNODC vocabulary variants; never infer units from magnitude.
export const DRUG_MAP = Object.freeze({
  'Cocaine salts':'cocaine', 'Cocaine hydrochloride':'cocaine',
  'Heroin':'heroin', 'Marijuana (herb)':'cannabis', 'Cannabis herb (marijuana)':'cannabis',
  'Methamphetamine':'methamphetamine', 'Methamphetamine powder':'methamphetamine',
  'Methamphetamine crystall':'methamphetamine',
})
export const isPerGram = unit => unit === 'Gram' || unit === 'Grams'
export function reviewedEdition(title) {
  const editions={'Prices of drugs, 2019-2023':2025,'Prices of drugs, 2020-2024':2026}
  if(!editions[title])throw new Error('Unreviewed UNODC price workbook title/period')
  return editions[title]
}
export function resolvePrice(typical,min,max) {
  const numeric = x => typeof x === 'number' && Number.isFinite(x) && x >= 0
  if(numeric(typical))return typical
  if(numeric(min)&&numeric(max)&&min<=max)return (min+max)/2
  return null
}

// GDP is a separately sourced snapshot. A price refresh must never erase it or
// relabel retained values with the clock of an unsuccessful World Bank request.
export function retainedGdpSnapshot(source) {
  const block=source.match(/\/\/ World Bank GDP per capita,[\s\S]*?export const GDP_PER_CAPITA_USD: Record<string, number> = \{\n([\s\S]*?)\}/)
  if(!block)throw new Error('Retained GDP provenance block is missing')
  const defaultDate=block[0].match(/fetched (\d{4}-\d{2}-\d{2})/)?.[1]
  const entries=new Map()
  for(const line of block[1].split('\n').filter(line=>line.trim())) {
    const match=line.match(/^  ([A-Z]{3}): (\d+), \/\/ (\d{4})(?:; fetched (\d{4}-\d{2}-\d{2}))?$/)
    if(!match||!Number.isSafeInteger(Number(match[2]))||Number(match[2])<=0||!(match[4]||defaultDate))throw new Error('Invalid retained GDP value or provenance')
    entries.set(match[1],{value:Number(match[2]),year:Number(match[3]),fetchedAt:match[4]||defaultDate})
  }
  if(!entries.size)throw new Error('Retained GDP snapshot is empty')
  return {block:block[0],entries}
}

export function refreshGdpSnapshot(retained,payload,fetchedAt,isoList) {
  if(!Array.isArray(payload)||!Array.isArray(payload[1])||!payload[1].length)throw new Error('World Bank response contains no GDP observations')
  const wanted=new Set([...retained.entries.keys(),...isoList])
  const fresh=new Map()
  for(const row of payload[1]) {
    if(!wanted.has(row?.countryiso3code)||row.value==null)continue
    if(typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<=0||!/^20\d{2}$/.test(String(row.date)))throw new Error('Invalid World Bank GDP observation')
    const year=Number(row.date),prior=fresh.get(row.countryiso3code)
    if(!prior||year>prior.year)fresh.set(row.countryiso3code,{value:Math.round(row.value),year,fetchedAt})
  }
  if(!fresh.size)throw new Error('World Bank response contains no usable GDP observations')
  const entries=new Map(retained.entries)
  for(const [iso3,row] of fresh)if(!entries.has(iso3)||row.year>=entries.get(iso3).year)entries.set(iso3,row)
  const lines=[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([iso3,row])=>`  ${iso3}: ${row.value}, // ${row.year}; fetched ${row.fetchedAt}`)
  return {entries,block:`// World Bank GDP per capita, current US$ (NY.GDP.PCAP.CD), latest available\n// year per country. Rounded to whole dollars; original retrieval dates retained per row.\nexport const GDP_PER_CAPITA_USD: Record<string, number> = {\n${lines.join('\n')}\n}`}
}
