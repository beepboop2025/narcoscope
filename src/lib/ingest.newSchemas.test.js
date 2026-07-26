import { describe, it, assert } from 'vitest'
import {
  parseOverdoseDeaths,
  parseWastewater,
  parseDesignations,
} from './ingest'

describe('parseOverdoseDeaths', () => {
  it('parses a CDC-shaped export using the publisher\'s own column names', () => {
    const csv = [
      'state,year,month,indicator,data_value,percent_complete,predicted_value',
      'US,2023,December,"Synthetic opioids, excl. methadone (T40.4)",74702,100,74800',
      'CA,2023,December,Cocaine (T40.5),3000,100,',
    ].join('\n')
    const { records, warnings } = parseOverdoseDeaths(csv)
    assert.lengthOf(records, 2)
    assert.lengthOf(warnings, 0)
    assert.equal(records[0].substance, 'synthetic_opioids')
    assert.equal(records[0].deaths, 74702)
    assert.equal(records[0].periodEndMonth, 12)
    assert.isFalse(records[0].partialYear)
  })

  it('maps psychostimulants to its own class rather than to methamphetamine', () => {
    const csv = [
      'state,year,month,indicator,data_value',
      'US,2023,December,Psychostimulants with abuse potential (T43.6),35000',
    ].join('\n')
    const { records } = parseOverdoseDeaths(csv)
    assert.equal(records[0].substance, 'psychostimulants')
  })

  it('tests the narrow synthetic-opioid label before the broad opioid one', () => {
    // If order were wrong, "Synthetic opioids, excl. methadone" would fall
    // through to opioids_all and the fentanyl series would vanish silently.
    const csv = [
      'state,year,month,indicator,data_value',
      'US,2023,December,"Opioids (T40.0-T40.4,T40.6)",81000',
      'US,2023,December,"Synthetic opioids, excl. methadone (T40.4)",74000',
    ].join('\n')
    const { records } = parseOverdoseDeaths(csv)
    assert.deepEqual(records.map((r) => r.substance), ['opioids_all', 'synthetic_opioids'])
  })

  it('skips a suppressed cell instead of reading it as zero deaths', () => {
    const csv = [
      'state,year,month,indicator,data_value',
      'AK,2015,December,Cocaine (T40.5),',
    ].join('\n')
    const { records, warnings } = parseOverdoseDeaths(csv)
    assert.lengthOf(records, 0)
    assert.include(warnings[0], 'suppressed')
  })

  it('flags a non-December window as a partial year', () => {
    const csv = [
      'state,year,month,indicator,data_value',
      'US,2026,February,Cocaine (T40.5),22000',
    ].join('\n')
    const { records } = parseOverdoseDeaths(csv)
    assert.equal(records[0].periodEndMonth, 2)
    assert.isTrue(records[0].partialYear)
  })

  it('accepts a column literally headed "substance" despite the drug-schema collision', () => {
    const csv = [
      'jurisdiction,year,substance,deaths',
      'US,2023,cocaine,29000',
    ].join('\n')
    const { records } = parseOverdoseDeaths(csv)
    assert.lengthOf(records, 1)
    assert.equal(records[0].substance, 'cocaine')
  })

  it('rejects a layout that is missing required columns rather than half-parsing it', () => {
    const { records, warnings } = parseOverdoseDeaths('foo,bar\n1,2')
    assert.lengthOf(records, 0)
    assert.include(warnings[0], 'missing columns')
  })
})

describe('parseWastewater', () => {
  const header = 'site,country,iso3,year,drug,mg per 1000 per day,source name,source url'

  it('parses a SCORE-shaped row', () => {
    const csv = `${header}\nBarcelona,Spain,ESP,2023,cocaine,900.5,EUDA SCORE,https://www.euda.europa.eu/`
    const { records, warnings } = parseWastewater(csv)
    assert.lengthOf(records, 1)
    assert.lengthOf(warnings, 0)
    assert.equal(records[0].mgPer1000PerDay, 900.5)
    assert.equal(records[0].drug, 'cocaine')
  })

  it('refuses a negative mass load', () => {
    const csv = `${header}\nBarcelona,Spain,ESP,2023,cocaine,-5,EUDA,https://x.org`
    const { records, warnings } = parseWastewater(csv)
    assert.lengthOf(records, 0)
    assert.include(warnings[0], 'negative')
  })

  it('requires attribution on every row', () => {
    const csv = `${header}\nBarcelona,Spain,ESP,2023,cocaine,900,,`
    const { records } = parseWastewater(csv)
    assert.lengthOf(records, 0)
  })
})

describe('parseDesignations', () => {
  const header = 'entity number,entity name,sdn type,programs,countries,aliases'

  it('parses OFAC\'s bracket-separated programme list', () => {
    const csv = `${header}\n23647,"WEI, Zhao",individual,"SDNTK] [TCO","Hong Kong","WEI, Chao;SAECHOU, Thanchai"`
    const { records } = parseDesignations(csv)
    assert.lengthOf(records, 1)
    assert.deepEqual(records[0].programs, ['SDNTK', 'TCO'])
    assert.deepEqual(records[0].aliases, ['WEI, Chao', 'SAECHOU, Thanchai'])
  })

  it('refuses a row that cites no legal authority', () => {
    // A named entity with no programme is an accusation, not a designation.
    const csv = `${header}\n1,"SOME COMPANY",,,Mexico,`
    const { records, warnings } = parseDesignations(csv)
    assert.lengthOf(records, 0)
    assert.include(warnings[0], 'authority')
  })

  it('defaults an unrecognised entity type to organization and says so', () => {
    const csv = `${header}\n1,"A CO",widget,SDNTK,Mexico,`
    const { records, warnings } = parseDesignations(csv)
    assert.equal(records[0].entityType, 'organization')
    assert.include(warnings[0], 'unknown entity type')
  })
})
