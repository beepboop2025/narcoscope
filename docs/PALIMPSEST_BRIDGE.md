# Palimpsest bridge

NarcoScope publishes two deterministic, read-only aggregates for Palimpsest:
the stable China v1 contract and an additive China-Pakistan-Myanmar v2 country
overlay. They are public handoff artifacts, not a shared database and not a
runtime dependency.

```text
Official NarcoScope inputs
          |
          v
Deterministic aggregate builder
          |
          v
Versioned JSON artifact + public JSON Schema
          |
          v
Palimpsest verifies hashes, reviews and imports
```

## Public files

- Artifact: `public/data/narcoscope-palimpsest-v1.json`
- Schema: `public/data/narcoscope-palimpsest-v1.schema.json`
- Builder: `scripts/bridge/build-palimpsest-china.mjs`
- Corridor artifact: `public/data/narcoscope-palimpsest-corridors-v2.json`
- Corridor schema: `public/data/narcoscope-palimpsest-corridors-v2.schema.json`
- Corridor builder: `scripts/bridge/build-palimpsest-corridors.mjs`

Vite copies `public/data` to the deployment root, so the deployed artifact is
available at `/data/narcoscope-palimpsest-v1.json` and its schema is available
at `/data/narcoscope-palimpsest-v1.schema.json`. The v2 pair is published under
the corresponding `narcoscope-palimpsest-corridors-v2` names.

Run `npm run bridge:palimpsest` after changing a covered dataset. The normal
data refresh also regenerates the artifact before its validation gate. A test
compares the checked-in artifact byte for byte with a fresh build, so data and
the public handoff cannot drift silently.

## Contract

The root is a JSON object. `schemaVersion` is
`narcoscope.palimpsest.china-aggregate.v1`. A breaking field or meaning change
requires a new schema version and file name. Array order, object insertion order
and numeric rounding are deterministic. `dataAsOf` is the newest retained local
data date, never the wall-clock build time.

Every dataset envelope contains:

| Field | Meaning |
| --- | --- |
| `datasetId` | Stable topic identifier |
| `sourceStatus` | Always `official` in this bridge |
| `measurement` | Epistemic status, value type, method, unit and grain |
| `temporalCoverage` | Year range or snapshot date |
| `provenance` | Publisher, source, edition, local date and SHA-256 of the NarcoScope input |
| `data` | Topic-specific aggregate payload |
| `limitations` | Interpretation constraints that travel with the values |

The v1 topic payloads are:

- `retailDrugPrices`: country-year prices and reported purity for the four
  retained drug classes.
- `drugSeizures`: China source-row count and quantities by year and drug group.
- `precursorCorridorIncidents`: official country-level incidents whose reported
  origin is China or the joint origin China / India. Joint origin is never
  allocated to China.
- `ofacDesignations`: counts by entity type and program plus a multi-country
  record count. There are no subject records.
- `wildlifeConfiscations`: China exporter-of-record and importer-of-record
  counts and ranks. The two roles are not additive.

## Corridor v2

The additive `narcoscope.palimpsest.corridor-aggregate.v2` contract covers
China (`CHN`), Myanmar (`MMR`) and Pakistan (`PAK`). It does not replace or
change v1. It widens the official aggregate price, seizure, precursor,
designation and wildlife coverage while retaining three hard boundaries:

1. **Geography and time only.** A consumer may align country and period but may
   not infer that records concern the same actor, event, route or causal chain.
2. **Missing is not zero.** `not_in_retained_top_table` and
   `no_matching_rows_in_snapshot` preserve the exact reason a value is absent.
3. **No political classification.** No party, civil-society movement, armed
   organization, community or person is classified with drug-market data.

The audited precursor extract contains a Myanmar-destination record whose
origin is explicitly *not reported* and a separate China-to-EU record. It
contains no China-Myanmar bilateral record. The artifact carries that absence
as `crossTargetBilateralRecordCount: 0` and refuses to sum qualified quantities.

## Disclosure boundary

The artifact contains no designation subject name, alias, entity number, exact
address, identity document, private lead or message content. Publisher names
and country names remain because they are provenance and geography, not subject
entities. The governed scraper work queue never enters the bridge.

Illustrative precursor prices, illustrative Myanmar flows, constructed Myanmar
meth activity and illustrative Myanmar precursor inflows are listed as
exclusions rather than being relabeled as official. Licensed conflict rows are
also excluded. Neither bridge carries a relationship graph, political label,
guilt claim, laundering classification, market-size estimate, tactical
location, chemistry, yield, or composite risk score.

## Consumer rules

Palimpsest should treat NarcoScope as the source of this aggregate, pin the file
and input hashes, and run its own review before publication. It should not write
back into NarcoScope or infer subject identities from these counts. A changed
hash is a new evidence input, not automatic permission to promote a claim.

If the exchange grows, revisit transport and signing. Keep the same one-way,
versioned and aggregate boundary unless a separately reviewed use case requires
more detail.
