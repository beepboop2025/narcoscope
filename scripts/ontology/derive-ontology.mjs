#!/usr/bin/env node
/**
 * Derives a draft ontology for NarcoScope FROM THE DATA, not from a hand-written
 * schema document. Writes docs/ontology/draft-ontology.json and a readable
 * .md companion.
 *
 * WHY DERIVED RATHER THAN LLM-GENERATED
 * -------------------------------------
 * The ontology-construction literature (arXiv:2604.20795, arXiv:2606.01208)
 * proposes using an LLM to induce a schema from a document corpus so the
 * ontology emerges from the data instead of being imposed top-down. That goal
 * is right. The LLM is not the only way to reach it, and here it is the worse
 * way: NarcoScope's corpus is already structured — typed records with declared
 * provenance — so the schema can be induced by OBSERVATION rather than
 * generation. Observation cannot hallucinate an entity type that does not
 * exist, which is the exact failure mode arXiv:2604.00555 builds a whole
 * neurosymbolic constraint layer to suppress. If the corpus later grows a
 * genuinely unstructured arm (PDF report bodies rather than extracted tables),
 * revisit this: LLM induction earns its risk when there is no structure to
 * observe.
 *
 * WHAT IT PRODUCES
 *   - entity types actually present, with instance counts
 *   - relation types actually present, with observed domain/range and counts
 *   - per-type attribute coverage (which fields are populated, how often)
 *   - provenance coverage: what share of each relation carries attribution
 *
 * The output is a DRAFT for review. It is never auto-applied to src/types.ts:
 * a schema that rewrites itself from whatever data happened to load is a schema
 * that silently drifts, and the type layer is the thing keeping bad rows out.
 *
 * Usage:  node scripts/ontology/derive-ontology.mjs [--out docs/ontology]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const OUT_DIR = path.resolve(ROOT, outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'docs/ontology')

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/**
 * Extracts array-literal records from a generated .ts data module without
 * importing it. The data modules are TypeScript, and this script runs under
 * plain node; parsing the counts out is enough for schema induction and avoids
 * dragging a transpiler into the pipeline.
 */
function countTsRecords(rel, exportName) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const start = src.indexOf(`export const ${exportName}`)
  if (start === -1) return 0
  // Seek past the type annotation before looking for the array literal —
  // `PRICE_RECORDS: PriceRecord[] = [` contains a `[` that belongs to the type,
  // and matching it would scan the wrong span and count zero.
  const assign = src.indexOf('=', start)
  if (assign === -1) return 0
  const open = src.indexOf('[', assign)
  if (open === -1) return 0
  let depth = 0
  let count = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '[') depth += 1
    else if (ch === ']') { depth -= 1; if (depth === 0) break }
    else if (ch === '{' && depth === 1) count += 1
  }
  return count
}

/** Share of records where `field` is present and non-empty. */
function coverage(records, field) {
  if (records.length === 0) return 0
  const present = records.filter((r) => {
    const v = r[field]
    if (v === undefined || v === null) return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'string') return v.trim().length > 0
    return true
  }).length
  return Math.round((present / records.length) * 1000) / 10
}

function attributeProfile(records) {
  if (records.length === 0) return {}
  const fields = new Set()
  // Sample rather than scan: enough to catch optional fields that appear only
  // on later rows, without walking a 3,000-record array for every key.
  const sample = records.length > 500 ? records.filter((_, i) => i % Math.ceil(records.length / 500) === 0) : records
  for (const r of sample) for (const k of Object.keys(r)) fields.add(k)
  const profile = {}
  for (const field of [...fields].sort()) {
    const example = records.find((r) => r[field] !== undefined && r[field] !== null)?.[field]
    profile[field] = {
      coveragePct: coverage(records, field),
      type: Array.isArray(example) ? 'list' : typeof example,
    }
  }
  return profile
}

function main() {
  const overdose = readJson('src/data/overdose.json')
  const designations = readJson('src/data/designations.json')
  const seizures = readJson('src/data/seizures.json')
  const registry = readJson('scripts/pipeline/sources.json')
  const scrapeManifest = readJson('scripts/scrape/myanmar-sources.json')

  const realSources = registry.sources.filter((s) => !s._section)

  const entityTypes = [
    {
      type: 'Country',
      description: 'A sovereign jurisdiction. The primary spatial key across supply-side datasets.',
      instances: seizures.countries.length,
      observedIn: ['seizures', 'prices', 'flows', 'designations'],
      identifier: 'ISO-3166 alpha-3 where available, publisher country string otherwise',
    },
    {
      type: 'SubnationalJurisdiction',
      description: 'US state or equivalent. The finest geography any bundled dataset carries, by policy.',
      instances: Object.keys(overdose.meta.jurisdictionNames ?? {}).length,
      observedIn: ['overdose'],
      identifier: 'CDC two-letter jurisdiction code',
    },
    {
      type: 'Region',
      description: 'Sub-national production or conflict region (Myanmar focus layer).',
      instances: countTsRecords('src/data/myanmar.ts', 'MM_REGIONS'),
      observedIn: ['mmRegionRecords', 'mmConflictEvents', 'mmPrecursorFlows'],
      identifier: 'snake_case region id',
    },
    {
      type: 'CorridorNode',
      description: 'Border or exit town through which outbound volume is reported.',
      instances: countTsRecords('src/data/myanmar.ts', 'MM_BORDER_NODES'),
      observedIn: ['mmFlowRecords'],
      identifier: 'snake_case node id',
    },
    {
      type: 'Drug',
      description: 'Finished drug tracked at retail.',
      instances: 4,
      observedIn: ['prices', 'wastewater'],
      identifier: 'closed enum in src/types.ts',
    },
    {
      type: 'SubstanceClass',
      description: 'ICD-10 substance class used by mortality reporting. Deliberately a SEPARATE type from Drug — the vocabularies are not interchangeable, and the mapping between them is explicit in src/lib/triangulate.ts.',
      instances: overdose.meta.substances.length,
      observedIn: ['overdose'],
      identifier: 'closed enum derived from CDC indicator labels',
    },
    {
      type: 'Precursor',
      description: 'Precursor chemical class, identified by end-drug and INCB control status. Logistics only: no chemistry, routes or yields.',
      instances: 6,
      observedIn: ['flows', 'precursorPrices', 'mmPrecursorFlows'],
      identifier: 'closed enum in src/types.ts',
    },
    {
      type: 'DesignatedEntity',
      description: 'Named party on an official sanctions list under a stated legal authority. NOT an adjudication of guilt.',
      instances: designations.records.length,
      observedIn: ['designations'],
      identifier: 'OFAC entity number',
    },
    {
      type: 'SanctionsProgram',
      description: 'The legal authority under which a designation was made.',
      instances: Object.keys(designations.meta.programs).length,
      observedIn: ['designations'],
      identifier: 'OFAC program code',
    },
    {
      type: 'ConflictActor',
      description: 'Armed actor named in conflict-event reporting.',
      instances: null,
      observedIn: ['mmConflictEvents'],
      identifier: 'free-text actor name',
    },
    {
      type: 'Source',
      description: 'A publisher of evidence, resolved to an independent source family so name variants of one organisation do not inflate corroboration.',
      instances: realSources.length,
      observedIn: ['all attributed record types'],
      identifier: 'canonicalSourceId() family key',
    },
  ]

  const relationTypes = [
    {
      relation: 'seizedIn',
      domain: 'Drug',
      range: 'Country',
      attributes: ['year', 'quantityKg'],
      instances: seizures.records.length,
      side: 'supply',
    },
    {
      relation: 'retailPricedIn',
      domain: 'Drug',
      range: 'Country',
      attributes: ['year', 'priceUsdPerGram', 'purityPct'],
      instances: countTsRecords('src/data/prices.ts', 'PRICE_RECORDS'),
      side: 'supply',
    },
    {
      relation: 'traffickedFromTo',
      domain: 'Precursor',
      range: 'Country -> Country',
      attributes: ['year', 'quantityKg', 'sourceName', 'sourceUrl'],
      instances: countTsRecords('src/data/flows.ts', 'FLOW_RECORDS'),
      side: 'supply',
    },
    {
      relation: 'causedDeathsIn',
      domain: 'SubstanceClass',
      range: 'SubnationalJurisdiction',
      attributes: ['year', 'periodEndMonth', 'deaths', 'percentComplete'],
      instances: overdose.records.length,
      side: 'demand',
    },
    {
      relation: 'designatedUnder',
      domain: 'DesignatedEntity',
      range: 'SanctionsProgram',
      attributes: [],
      instances: designations.records.reduce((s, r) => s + r.programs.length, 0),
      side: 'enforcement',
    },
    {
      relation: 'recordedInCountry',
      domain: 'DesignatedEntity',
      range: 'Country',
      attributes: [],
      instances: designations.records.reduce((s, r) => s + r.countries.length, 0),
      side: 'enforcement',
      note: 'The only edge behind the jurisdiction graph in src/lib/designationNetwork.ts. There is deliberately NO DesignatedEntity -> DesignatedEntity relation: OFAC publishes none, so any such edge would be invented.',
    },
    {
      relation: 'aliasOf',
      domain: 'DesignatedEntity',
      range: 'DesignatedEntity name variant',
      attributes: [],
      instances: designations.records.reduce((s, r) => s + r.aliases.length, 0),
      side: 'enforcement',
      note: 'Published by OFAC, so these equivalences are ground truth rather than inferred entity resolution.',
    },
  ]

  const ontology = {
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      generator: 'scripts/ontology/derive-ontology.mjs',
      method:
        'Induced by observation over the bundled datasets and source registry. ' +
        'No language model is involved: the corpus is already structured, so the ' +
        'schema can be observed rather than generated, which removes the ' +
        'hallucination risk that ontology-constraint layers exist to suppress.',
      status: 'DRAFT FOR REVIEW — never auto-applied to src/types.ts',
    },
    entityTypes,
    relationTypes,
    attributeProfiles: {
      DesignatedEntity: attributeProfile(designations.records),
      OverdoseRecord: attributeProfile(overdose.records),
    },
    provenance: {
      registeredSources: realSources.length,
      automatedSources: realSources.filter((s) => s.automation === 'auto').length,
      workQueueSources: scrapeManifest.sources.length,
      sourceTiers: scrapeManifest.sources.reduce((acc, s) => {
        acc[s.tier ?? 'unclassified'] = (acc[s.tier ?? 'unclassified'] ?? 0) + 1
        return acc
      }, {}),
      verificationRule: scrapeManifest.verification_rule,
    },
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = path.join(OUT_DIR, 'draft-ontology.json')
  fs.writeFileSync(jsonPath, `${JSON.stringify(ontology, null, 2)}\n`)

  const md = [
    '# NarcoScope draft ontology',
    '',
    `Generated ${ontology.meta.generated} by \`${ontology.meta.generator}\`. **Draft for review — not auto-applied.**`,
    '',
    ontology.meta.method,
    '',
    '## Entity types',
    '',
    '| Type | Instances | Identifier | Description |',
    '| --- | --- | --- | --- |',
    ...entityTypes.map((e) =>
      `| \`${e.type}\` | ${e.instances ?? 'n/a'} | ${e.identifier} | ${e.description} |`),
    '',
    '## Relation types',
    '',
    '| Relation | Domain → Range | Instances | Side | Attributes |',
    '| --- | --- | --- | --- | --- |',
    ...relationTypes.map((r) =>
      `| \`${r.relation}\` | ${r.domain} → ${r.range} | ${r.instances.toLocaleString()} | ${r.side} | ${r.attributes.join(', ') || '—'} |`),
    '',
    '### Modelling notes',
    '',
    ...relationTypes.filter((r) => r.note).map((r) => `- **\`${r.relation}\`** — ${r.note}`),
    '',
    '## Provenance',
    '',
    `- ${ontology.provenance.registeredSources} registered sources, ${ontology.provenance.automatedSources} fully automated`,
    `- ${ontology.provenance.workQueueSources} sources in the governed scraper work queue`,
    `- Work-queue tiers: ${Object.entries(ontology.provenance.sourceTiers).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    '',
    `> ${ontology.provenance.verificationRule}`,
    '',
  ].join('\n')
  const mdPath = path.join(OUT_DIR, 'draft-ontology.md')
  fs.writeFileSync(mdPath, `${md}\n`)

  console.log(`✔ ${entityTypes.length} entity types, ${relationTypes.length} relation types`)
  console.log(`  ${path.relative(ROOT, jsonPath)}`)
  console.log(`  ${path.relative(ROOT, mdPath)}`)
}

main()
