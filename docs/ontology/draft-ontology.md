# NarcoScope draft ontology

Generated 2026-07-26 by `scripts/ontology/derive-ontology.mjs`. **Draft for review — not auto-applied.**

Induced by observation over the bundled datasets and source registry. No language model is involved: the corpus is already structured, so the schema can be observed rather than generated, which removes the hallucination risk that ontology-constraint layers exist to suppress.

## Entity types

| Type | Instances | Identifier | Description |
| --- | --- | --- | --- |
| `Country` | 164 | ISO-3166 alpha-3 where available, publisher country string otherwise | A sovereign jurisdiction. The primary spatial key across supply-side datasets. |
| `SubnationalJurisdiction` | 54 | CDC two-letter jurisdiction code | US state or equivalent. The finest geography any bundled dataset carries, by policy. |
| `Region` | 6 | snake_case region id | Sub-national production or conflict region (Myanmar focus layer). |
| `CorridorNode` | 4 | snake_case node id | Border or exit town through which outbound volume is reported. |
| `Drug` | 4 | closed enum in src/types.ts | Finished drug tracked at retail. |
| `SubstanceClass` | 6 | closed enum derived from CDC indicator labels | ICD-10 substance class used by mortality reporting. Deliberately a SEPARATE type from Drug — the vocabularies are not interchangeable, and the mapping between them is explicit in src/lib/triangulate.ts. |
| `Precursor` | 6 | closed enum in src/types.ts | Precursor chemical class, identified by end-drug and INCB control status. Logistics only: no chemistry, routes or yields. |
| `DesignatedEntity` | 2638 | OFAC entity number | Named party on an official sanctions list under a stated legal authority. NOT an adjudication of guilt. |
| `SanctionsProgram` | 4 | OFAC program code | The legal authority under which a designation was made. |
| `ConflictActor` | n/a | free-text actor name | Armed actor named in conflict-event reporting. |
| `Source` | 40 | canonicalSourceId() family key | A publisher of evidence, resolved to an independent source family so name variants of one organisation do not inflate corroboration. |

## Relation types

| Relation | Domain → Range | Instances | Side | Attributes |
| --- | --- | --- | --- | --- |
| `seizedIn` | Drug → Country | 11,198 | supply | year, quantityKg |
| `retailPricedIn` | Drug → Country | 208 | supply | year, priceUsdPerGram, purityPct |
| `traffickedFromTo` | Precursor → Country -> Country | 8 | supply | year, quantityKg, sourceName, sourceUrl |
| `causedDeathsIn` | SubstanceClass → SubnationalJurisdiction | 3,077 | demand | year, periodEndMonth, deaths, percentComplete |
| `designatedUnder` | DesignatedEntity → SanctionsProgram | 2,663 | enforcement | — |
| `recordedInCountry` | DesignatedEntity → Country | 2,583 | enforcement | — |
| `aliasOf` | DesignatedEntity → DesignatedEntity name variant | 1,509 | enforcement | — |

### Modelling notes

- **`recordedInCountry`** — The only edge behind the jurisdiction graph in src/lib/designationNetwork.ts. There is deliberately NO DesignatedEntity -> DesignatedEntity relation: OFAC publishes none, so any such edge would be invented.
- **`aliasOf`** — Published by OFAC, so these equivalences are ground truth rather than inferred entity resolution.

## Provenance

- 40 registered sources, 10 fully automated
- 14 sources in the governed scraper work queue
- Work-queue tiers: official 5, research 6, journalism 3

> A named individual or company may only reach a bundled dataset if that entity also appears on an official designation list (see scripts/pipeline/sources.json: ofac-sdn, un-consolidated-sanctions). Anything named only by journalism or a crowd-sourced tracker stays in the queue as a lead. This is the line between reporting a government's published action and republishing an allegation.

