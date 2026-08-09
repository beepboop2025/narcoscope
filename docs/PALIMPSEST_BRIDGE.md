# Palimpsest bridge

NarcoScope publishes one deterministic, read-only China aggregate for
Palimpsest. It is a public handoff artifact, not a shared database and not a
runtime API.

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

Vite copies `public/data` to the deployment root, so the deployed artifact is
available at `/data/narcoscope-palimpsest-v1.json` and its schema is available
at `/data/narcoscope-palimpsest-v1.schema.json`.

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

## Disclosure boundary

The artifact contains no designation subject name, alias, entity number, exact
address, identity document, private lead or message content. Publisher names
and country names remain because they are provenance and geography, not subject
entities. The governed scraper work queue never enters the bridge.

Illustrative precursor prices, illustrative Myanmar flows, constructed Myanmar
meth activity and illustrative Myanmar precursor inflows are listed as
exclusions rather than being relabeled as official. The bridge also carries no
relationship graph, guilt claim, laundering classification, market-size
estimate or composite risk score.

## Consumer rules

Palimpsest should treat NarcoScope as the source of this aggregate, pin the file
and input hashes, and run its own review before publication. It should not write
back into NarcoScope or infer subject identities from these counts. A changed
hash is a new evidence input, not automatic permission to promote a claim.

If the exchange grows, revisit transport and signing. Keep the same one-way,
versioned and aggregate boundary unless a separately reviewed use case requires
more detail.
