import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTICLE_SLUG,
  MAX_INPUT_BYTES,
  assertAutomatedEvidenceAnalysis,
  assertCapabilityRegistry,
  assertMachineBrief,
  buildEvidenceAnalysis,
  buildMachineBrief,
  buildNewsroomArtifacts,
  buildVerificationReceipt,
  canonicalJson,
  generateNewsroomArtifacts,
  loadNewsroomInputs,
  readJsonInput,
  renderArticleHtml,
  renderAtomFeed,
  renderJsonFeed,
  serializeJson,
} from './build-newsroom.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicNews = path.join(root, 'public/news')
const tempDirs = []
let inputs
let machineBrief
let dossier
let built

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const rehash = (value) => {
  const { contentHash: _oldHash, ...base } = value
  return { ...base, contentHash: sha256(canonicalJson(base)) }
}

const addUtcDays = (isoDate, days) => {
  const value = new Date(`${isoDate}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const inputsForRevision = (baseInputs, { previousDossier, asOf, hashSeed }) => {
  const changed = structuredClone(baseInputs)
  changed.previousDossier = { data: previousDossier }
  changed.bridge.data.dataAsOf = asOf
  changed.overdose.data.meta.downloaded = asOf
  changed.capabilities.data.asOf = asOf
  changed.bridge.descriptor.sha256 = sha256(`${hashSeed}:bridge`)
  changed.overdose.descriptor.sha256 = sha256(`${hashSeed}:overdose`)
  changed.capabilities.descriptor.sha256 = sha256(`${hashSeed}:capabilities`)
  return changed
}

beforeAll(async () => {
  inputs = await loadNewsroomInputs(root)
  machineBrief = buildMachineBrief(inputs)
  dossier = buildEvidenceAnalysis(machineBrief, inputs)
  built = buildNewsroomArtifacts(inputs)
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('NarcoScope deterministic evidence newsroom', () => {
  it('builds byte-identical offline artifacts and keeps the checked-in output current', async () => {
    const again = buildNewsroomArtifacts(inputs)
    expect(again.files).toEqual(built.files)

    for (const [file, expected] of Object.entries(built.files)) {
      expect(await fs.readFile(path.join(publicNews, file), 'utf8')).toBe(expected)
    }
    await expect(generateNewsroomArtifacts({ root, check: true })).resolves.toMatchObject({ checked: true })
  })

  it('can generate the complete publication bundle without network access', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-newsroom-'))
    tempDirs.push(outputDir)
    const result = await generateNewsroomArtifacts({ root, outputDir })
    const files = (await fs.readdir(outputDir)).sort()

    expect(result.checked).toBe(false)
    expect(files).toEqual(Object.keys(built.files).sort())
    await expect(generateNewsroomArtifacts({ root, outputDir, check: true })).resolves.toMatchObject({ checked: true })
  })

  it('caps offline input bytes and rejects JSON numbers that parse outside the finite range', async () => {
    const inputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-newsroom-input-'))
    tempDirs.push(inputRoot)
    await fs.writeFile(path.join(inputRoot, 'non-finite.json'), '{"quantity":1e400}\n', 'utf8')
    await fs.writeFile(path.join(inputRoot, 'oversize.json'), Buffer.alloc(MAX_INPUT_BYTES + 1, 0x20))

    await expect(readJsonInput(inputRoot, 'non-finite.json')).rejects.toThrow(/non-finite JSON number at \$\.quantity/)
    await expect(readJsonInput(inputRoot, 'oversize.json')).rejects.toThrow(/input exceeds .* byte limit/)
    expect(machineBrief.inputArtifacts.every((item) => item.bytes > 0 && item.bytes <= MAX_INPUT_BYTES)).toBe(true)
  })

  it('registers official trade, incident, harm, action and court capabilities with explicit access and licensing limits', () => {
    expect(() => assertCapabilityRegistry(inputs.capabilities.data)).not.toThrow()
    const byId = Object.fromEntries(inputs.capabilities.data.capabilities.map((item) => [item.id, item]))

    expect(byId['gacc-customs-statistics'].availability).toMatchObject({
      status: 'public_aggregate',
      publicRecordLevelShipments: false,
    })
    expect(byId['gacc-customs-statistics']).toMatchObject({ newsroomRole: 'capability_only', upstreamGroup: 'cn-gacc' })
    expect(byId['un-comtrade']).toMatchObject({
      url: 'https://comtradeplus.un.org/',
      licensing: { status: 'usage_agreement_and_redistribution_limits' },
    })
    for (const id of ['incb-pics', 'incb-pen-online']) {
      expect(byId[id].availability).toMatchObject({
        status: 'restricted_non_public',
        automation: 'unavailable',
      })
      expect(byId[id].newsroomUse.status).toBe('unavailable')
      expect(byId[id].newsroomRole).toBe('unavailable')
    }
    expect(byId['uscourts-pacer'].availability.status).toBe('account_and_fee_restricted')
    expect(byId).not.toHaveProperty('doj-precursor-case-releases')
    expect(byId).not.toHaveProperty('dea-ndta')
  })

  it('preserves qualified source grain and refuses the invalid bilateral subtotal', () => {
    expect(() => assertMachineBrief(machineBrief)).not.toThrow()
    const incidents = machineBrief.evidenceLanes.officialEnforcementIncidents

    expect(incidents.chinaEuAggregate).toMatchObject({
      reportedQuantityKg: 5000,
      quantityRelation: 'less_than',
      recordKind: 'multi_incident_aggregate',
      transit: null,
      seizureLocation: null,
      aggregationEligibility: 'ineligible_non_exact',
      aggregationGroup: 'meth_pre_precursor_substance_mass',
      incidentCount: 9,
      sourceLocator: { paragraph: 94 },
    })
    expect(incidents.operationPseudonymContext).toMatchObject({
      allocationStatus: 'not_reported_by_origin_destination_pair',
      operationReportedSeizureCount: 168,
      countScope: 'four_reporting_countries_operation_total',
      quantityKg: null,
      incidentCountByOriginDestinationPair: null,
      sourceLocator: { paragraph: 46 },
    })
    expect(incidents.quantityAggregation).toMatchObject({
      status: 'not_computed_non_exact_inputs',
      eligibleRecordCount: 0,
      excludedRecordCount: 1,
      aggregationGroup: null,
      summedQuantityKg: null,
    })
    expect(incidents.bilateralSubtotalComputed).toBe(false)
    expect(dossier.keyFigures.find((item) => item.id === 'operation-pseudonym-count')?.value)
      .toBe(incidents.operationPseudonymContext.operationReportedSeizureCount)
    expect(machineBrief.evidenceLanes.lawfulIndustrialTrade.denominatorAvailable).toBe(false)
    expect(machineBrief.missingRecordLevelJoins.every((join) => join.available === false)).toBe(true)
  })

  it('keeps CDC harm measurements separate from origin and causal attribution', () => {
    const harm = machineBrief.evidenceLanes.harmTrend
    const expectedFromSnapshot = inputs.overdose.data.records
      .filter((record) => record.jurisdiction === 'US'
        && record.substance === 'synthetic_opioids'
        && record.periodEndMonth === 12
        && record.partialYear === false)
      .map((record) => ({
        year: record.year,
        periodEndMonth: record.periodEndMonth,
        provisionalDeaths: record.deaths,
        predictedDeaths: record.predictedDeaths,
        percentComplete: record.percentComplete,
      }))
      .sort((a, b) => a.year - b.year)

    expect(harm.observations).toEqual(expectedFromSnapshot)
    expect(harm.observations.length).toBeGreaterThanOrEqual(2)
    expect(harm.observations.every((point) => point.periodEndMonth === 12)).toBe(true)
    expect(harm.observations.every((point) => Number.isInteger(point.provisionalDeaths) && point.provisionalDeaths > 0)).toBe(true)

    const fixtureInputs = structuredClone(inputs)
    fixtureInputs.previousDossier = undefined
    fixtureInputs.overdose.data.meta.downloaded = '2030-01-02'
    fixtureInputs.overdose.descriptor.sha256 = 'f'.repeat(64)
    fixtureInputs.overdose.data.records = [
      { jurisdiction: 'US', substance: 'synthetic_opioids', year: 2029, periodEndMonth: 12, partialYear: false, deaths: 120, predictedDeaths: 121, percentComplete: 99.9 },
      { jurisdiction: 'CA', substance: 'synthetic_opioids', year: 2030, periodEndMonth: 12, partialYear: false, deaths: 999, predictedDeaths: null, percentComplete: 100 },
      { jurisdiction: 'US', substance: 'cocaine', year: 2030, periodEndMonth: 12, partialYear: false, deaths: 888, predictedDeaths: null, percentComplete: 100 },
      { jurisdiction: 'US', substance: 'synthetic_opioids', year: 2030, periodEndMonth: 11, partialYear: false, deaths: 777, predictedDeaths: null, percentComplete: 100 },
      { jurisdiction: 'US', substance: 'synthetic_opioids', year: 2030, periodEndMonth: 3, partialYear: true, deaths: 666, predictedDeaths: null, percentComplete: 80 },
      { jurisdiction: 'US', substance: 'synthetic_opioids', year: 2028, periodEndMonth: 12, partialYear: false, deaths: 100, predictedDeaths: null, percentComplete: 100 },
    ]
    const fixtureHarm = buildMachineBrief(fixtureInputs).evidenceLanes.harmTrend
    expect(fixtureHarm.observations).toEqual([
      { year: 2028, periodEndMonth: 12, provisionalDeaths: 100, predictedDeaths: null, percentComplete: 100 },
      { year: 2029, periodEndMonth: 12, provisionalDeaths: 120, predictedDeaths: 121, percentComplete: 99.9 },
    ])
    expect(harm).not.toHaveProperty('percentChange2022To2025')
    expect(harm.measure).toContain('excluding methadone (T40.4)')
    expect(harm.revisionsExpected).toBe(true)
    expect(harm.containsOriginOrShipmentFields).toBe(false)
    expect(harm.causalAttributionAvailable).toBe(false)
  })

  it('requires a distinct analysis gate, sentence citations, countercase and limitations', () => {
    expect(() => assertAutomatedEvidenceAnalysis(
      dossier,
      machineBrief,
      inputs.capabilities.data,
      inputs.previousDossier?.data,
    )).not.toThrow()
    const sentences = [
      ...dossier.sections.flatMap((section) => section.sentences),
      ...dossier.countercase.sentences,
      ...dossier.limitations,
    ]
    const sourceIds = new Set(dossier.sources.map((source) => source.id))

    expect(dossier.contentClass).toBe('automated_evidence_analysis')
    expect(dossier.promotion.machineBriefContentHash).toBe(machineBrief.contentHash)
    expect(dossier.countercase.sentences.length).toBeGreaterThanOrEqual(2)
    expect(dossier.limitations.length).toBeGreaterThanOrEqual(5)
    expect(new Set(sentences.map((item) => item.id)).size).toBe(sentences.length)
    expect(sentences.every((item) => item.citationIds.length > 0)).toBe(true)
    expect(sentences.flatMap((item) => item.citationIds).every((id) => sourceIds.has(id))).toBe(true)
    expect(dossier.editorialStatus).toMatchObject({
      humanReviewStatus: 'not_recorded',
      causalAttribution: 'not_established',
      adjudicatedGuilt: 'not_assessed',
      independentlyCorroboratedEventClaimCount: 0,
    })
    expect(dossier.publicationRecord).toMatchObject({
      corrections: { status: 'none_recorded' },
      rightToReply: {
        status: 'not_required',
        outreachPerformed: false,
      },
      testimony: {
        expertTestimonyIncluded: false,
        affectedPersonTestimonyIncluded: false,
        simulatedHumanVoicesIncluded: false,
      },
      updateHistory: expect.arrayContaining([
        expect.objectContaining({ eventType: 'initial_publication' }),
      ]),
    })
    expect(dossier.verificationReceipt).toMatchObject({
      citationCoverage: { totalSentenceCount: 28, citedSentenceCount: 28, percent: 100 },
      visualCitationCoverage: {
        totalDataRowCount: dossier.visuals.flatMap((visual) => visual.items).length,
        citedDataRowCount: dossier.visuals.flatMap((visual) => visual.items).length,
        percent: 100,
      },
      sourceInventory: {
        activeEvidenceSourceCount: 2,
        capabilityOnlySourceCount: 2,
        unavailableSourceCount: 3,
        activeIndependenceGroupCount: 2,
        independentlyCorroboratedEventClaimCount: 0,
      },
      synthesisEvaluation: {
        synthesisSentenceCount: 8,
        passedSentenceCount: 8,
        minimumObservedActiveGroupCount: 2,
      },
      bannedClaimScan: { matches: [], passed: true },
      editorialCompleteness: {
        correctionsStatus: 'none_recorded',
        rightToReplyStatus: 'not_required',
        initialPublicationRecorded: true,
        expertTestimonyIncluded: false,
        affectedPersonTestimonyIncluded: false,
        simulatedHumanVoicesIncluded: false,
        passed: true,
      },
      passed: true,
    })
    expect(dossier.verificationReceipt.claimSupport
      .filter((item) => item.supportProfile === 'multi_source_methodological_context')
      .every((item) => item.activeGroupCount >= 2)).toBe(true)
    expect(dossier.verificationReceipt.claimSupport.every((item) => item.corroborationClaimed === false)).toBe(true)
    expect(dossier.verificationReceipt.claimSupport
      .every((item) => item.capabilitySourcesCountTowardCorroboration === false
        && item.unavailableSourcesCountTowardCorroboration === false)).toBe(true)
    expect(dossier.publicationRecord.updateHistory.at(-1).revisionHash).toBe(dossier.revisionHash)
  })

  it('preserves immutable publication history across a changed source revision', () => {
    const changedInputs = inputsForRevision(inputs, {
      previousDossier: dossier,
      asOf: addUtcDays(machineBrief.dataAsOf, 1),
      hashSeed: 'a',
    })

    const changedBrief = buildMachineBrief(changedInputs)
    const changedDossier = buildEvidenceAnalysis(changedBrief, changedInputs)
    expect(() => assertAutomatedEvidenceAnalysis(
      changedDossier,
      changedBrief,
      changedInputs.capabilities.data,
      dossier,
    )).not.toThrow()
    expect(changedDossier.publishedAt).toBe(dossier.publishedAt)
    expect(changedDossier.publicationRecord.updateHistory.slice(0, -1))
      .toEqual(dossier.publicationRecord.updateHistory)
    expect(changedDossier.publicationRecord.updateHistory.at(-1)).toMatchObject({
      eventType: 'data_refresh',
      date: changedBrief.dataAsOf,
      revisionHash: changedBrief.revisionHash,
    })
    const capabilityLocators = changedDossier.sections
      .flatMap((section) => section.sentences)
      .flatMap((sentence) => sentence.citationLocators)
      .filter((citation) => citation.locator.startsWith('registered '))
    expect(capabilityLocators.length).toBeGreaterThan(0)
    expect(capabilityLocators.every((citation) => citation.locator.endsWith(`as of ${changedBrief.dataAsOf}`))).toBe(true)

    const stableInputs = structuredClone(changedInputs)
    stableInputs.previousDossier = { data: changedDossier }
    expect(buildEvidenceAnalysis(changedBrief, stableInputs)).toEqual(changedDossier)
  })

  it('rejects invalid prior history, revision replay and backwards publication time', () => {
    const invalidPrior = structuredClone(dossier)
    invalidPrior.publicationRecord.updateHistory[0].summary = 'Rewritten initial publication.'
    const invalidInputs = structuredClone(inputs)
    invalidInputs.previousDossier = { data: rehash(invalidPrior) }
    expect(() => buildEvidenceAnalysis(machineBrief, invalidInputs))
      .toThrow(/checked-in prior dossier is invalid|initial publication summary is invalid/)

    const advancedInputs = inputsForRevision(inputs, {
      previousDossier: dossier,
      asOf: addUtcDays(machineBrief.dataAsOf, 1),
      hashSeed: 'a',
    })
    const advancedBrief = buildMachineBrief(advancedInputs)
    const advancedDossier = buildEvidenceAnalysis(advancedBrief, advancedInputs)

    const replayInputs = structuredClone(inputs)
    replayInputs.previousDossier = { data: advancedDossier }
    expect(() => buildEvidenceAnalysis(machineBrief, replayInputs))
      .toThrow(/prior revision hash cannot be replayed/)

    const backwardsInputs = inputsForRevision(inputs, {
      previousDossier: advancedDossier,
      asOf: machineBrief.dataAsOf,
      hashSeed: 'd',
    })
    const backwardsBrief = buildMachineBrief(backwardsInputs)
    expect(() => buildEvidenceAnalysis(backwardsBrief, backwardsInputs))
      .toThrow(/cannot move updatedAt backwards/)
  })

  it('does not let capability-only citations satisfy a synthesis claim', () => {
    const changed = structuredClone(dossier)
    const synthesis = changed.sections[0].sentences[0]
    synthesis.citationIds = ['SRC-GACC-STATS', 'SRC-UN-COMTRADE']
    changed.verificationReceipt = buildVerificationReceipt(changed, inputs.capabilities.data)
    const rehashed = rehash(changed)

    expect(changed.verificationReceipt.claimSupport[0]).toMatchObject({
      activeGroupCount: 0,
      capabilitySourcesCountTowardCorroboration: false,
      passed: false,
    })
    expect(() => assertAutomatedEvidenceAnalysis(rehashed, machineBrief, inputs.capabilities.data))
      .toThrow(/requires 2 independent active group\(s\), found 0/)
  })

  it('rejects a quantity injected into the unallocated Operation Pseudonym context', () => {
    const changed = structuredClone(machineBrief)
    changed.evidenceLanes.officialEnforcementIncidents.operationPseudonymContext.quantityKg = 2200
    expect(() => assertMachineBrief(rehash(changed))).toThrow(/cannot acquire a quantity/)
  })

  it('rejects unsupported causal or culpability language even when the dossier is re-hashed', () => {
    const changed = structuredClone(dossier)
    changed.sections[4].sentences[1].text = 'China-linked supply chains fueled these American deaths.'
    expect(() => assertAutomatedEvidenceAnalysis(rehash(changed), machineBrief, inputs.capabilities.data)).toThrow(/banned-claim scan/)
  })

  it('scans every public string and rejects unknown or private dossier fields', () => {
    const unsafeDek = structuredClone(dossier)
    unsafeDek.dek = 'A step-by-step laboratory protocol and conversion ratio is included here.'
    expect(() => assertAutomatedEvidenceAnalysis(rehash(unsafeDek), machineBrief, inputs.capabilities.data)).toThrow(/banned-claim scan/)

    const privateAppendix = structuredClone(dossier)
    privateAppendix.privateAppendix = { subjects: [{ fullName: 'Private Person', email: 'private@example.test', phone: '+1 555 0100' }] }
    expect(() => assertAutomatedEvidenceAnalysis(rehash(privateAppendix), machineBrief, inputs.capabilities.data)).toThrow(/forbidden|typed deterministic claim templates/)
  })

  it('rejects unexpected files in the generated public directory', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'narcoscope-newsroom-extra-'))
    tempDirs.push(outputDir)
    await generateNewsroomArtifacts({ root, outputDir })
    await fs.writeFile(path.join(outputDir, 'stale-unmanifested-article.html'), 'stale\n', 'utf8')

    await expect(generateNewsroomArtifacts({ root, outputDir, check: true }))
      .rejects.toThrow(/unexpected generated artifact/)
  })

  it('publishes hashes and machine-readable JSON and Atom feeds', () => {
    const html = renderArticleHtml(dossier)
    const jsonFeed = renderJsonFeed(dossier)
    const atom = renderAtomFeed(dossier)

    expect(html).toContain(dossier.revisionHash)
    expect(html).toContain(dossier.contentHash)
    expect(html).toContain('Lawful industrial trade: the missing denominator')
    expect(html).toContain('no human review recorded')
    expect(html).toContain('aria-label="Verification receipt summary"')
    expect(html).toContain('aria-labelledby="china-eu-aggregate-title"')
    expect(html).toContain('aria-labelledby="operation-pseudonym-context-title"')
    expect(html).toContain('<caption>China-to-EU aggregate retained at source precision in tonnes, upper bound</caption>')
    expect(html).toContain('.citation-locator { position:absolute;')
    expect(html).toContain('aria-labelledby="cdc-harm-trend-title"')
    expect(html).toContain('This revisable mortality series has no exporter, shipment, precursor or origin field')
    expect(html).toContain('paragraph 94; PDF page 44; printed page 26')
    expect(html).toContain('Right to reply: not required.')
    expect(html).toContain('No expert or affected-person testimony is included')
    expect(html).toContain('Corrections and update history')
    expect(html).toContain('initial publication')
    expect(html).toContain('<meta property="og:type" content="article">')
    expect(html).toContain(`<meta property="article:modified_time" content="${dossier.updatedAt}">`)
    expect(jsonFeed.items[0]._narcoscope).toMatchObject({
      contentClass: 'automated_evidence_analysis',
      revisionHash: dossier.revisionHash,
      contentHash: dossier.contentHash,
      correctionsStatus: 'none_recorded',
      rightToReplyStatus: 'not_required',
      testimonyIncluded: false,
      simulatedHumanVoicesIncluded: false,
    })
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(atom).toContain('<author><name>NarcoScope automated evidence desk</name></author>')
    expect(atom).toContain(`<id>https://drug-price-observatory.vercel.app/news/${ARTICLE_SLUG}.html</id>`)
    expect(atom).toContain('PICS and PEN Online are restricted')
    expect(serializeJson(jsonFeed)).toBe(built.files['feed.json'])
  })

  it('names every generated artifact in a content-addressed manifest', () => {
    const filesExceptManifest = Object.keys(built.files).filter((file) => file !== 'manifest.json').sort()
    expect(built.manifest.artifacts.map((item) => item.file)).toEqual(filesExceptManifest)
    expect(built.manifest.gates.map((gate) => gate.status)).toEqual(['passed', 'passed', 'passed'])
    expect(built.manifest.gates.every((gate) => Number.isInteger(gate.assertionCount) && gate.assertionCount > 0)).toBe(true)
    expect(built.manifest.revisionHash).toBe(machineBrief.revisionHash)
    expect(built.manifest.contentHash).toBe(dossier.contentHash)
    expect(built.manifest.verificationReceipt).toMatchObject({
      citationCoverage: { percent: 100 },
      visualCitationCoverage: { percent: 100 },
      synthesisEvaluation: { minimumObservedActiveGroupCount: 2 },
      bannedClaimScan: { matches: [], passed: true },
      editorialCompleteness: { rightToReplyStatus: 'not_required', passed: true },
      deterministicHashes: { dossierContentHash: dossier.contentHash },
    })
    expect(built.manifest.articleId).toContain(ARTICLE_SLUG)
  })
})
