# Open-data pipeline

How official open data flows into this product. One command regenerates every
automatable dataset; everything else is a documented once-a-year step.

```
sources.json  ──►  run.mjs fetches (data-raw/, gitignored)
                        │
                        ▼
              scripts/convert/* transforms
                        │
                        ▼
        src/data/*.{ts,json}  (bundled, versioned, PR-reviewable)
                        │
                        ▼
        tsc + vitest (dataset-integrity tests = validation gate)
```

**Design rule: data changes are commits, not runtime mutations.** The app stays
a static bundle; every refresh lands as a reviewable git diff with the test
suite as gatekeeper. `scripts/pipeline/sources.json` is the single registry of
where every number comes from.

## Run it

```bash
node scripts/pipeline/run.mjs             # fetch + transform + validate
node scripts/pipeline/run.mjs --offline   # reuse data-raw/ (no network)
```

The GitHub Action `.github/workflows/data-refresh.yml` runs this quarterly and
opens a PR only when the regenerated data differs.

## Fully automated today (no credentials)

| Source | Feeds | Converter |
|---|---|---|
| UNODC WDR Annex 8.1 prices + purities | Street Prices tab | `wdr-prices-to-ts.mjs` |
| UNODC WDR Annex 7.1 seizures | Seizure globe | `wdr-seizures-to-json.mjs` |
| World Bank GDP per capita | affordability lens | fetched inline with prices |
| Natural Earth (India-POV) | all map boundaries | `gen-country-geo.mjs` (atlas refresh is manual, see below) |

**Annual WDR bump:** each June UNODC publishes a new edition. Update the two
`WDR_2025` URLs (and the seizures filename years) in `sources.json`, run the
pipeline, review the diff.

## Automatable with a free API key

**ACLED (Myanmar conflict events)** — replaces the illustrative
`mmConflictEvents`. Register (free, research use) at acleddata.com, then:
1. `export ACLED_KEY=… ACLED_EMAIL=…`
2. Build `scripts/convert/acled-to-mm-conflict.mjs`: query the API URL in
   `sources.json`, map `admin1` → the app's Myanmar region ids
   (`src/data/myanmar.ts`), derive `intensity` from event counts + fatalities
   (document the formula in the converter), emit the `mmConflictEvents` CSV
   schema, load via the in-app loader or bundle.
Attribution "Data: ACLED" is a licence condition — keep it in SOURCES.

## Manual once-a-cycle (converter already exists)

- **UNODC Myanmar Opium Survey** (annual PDF): state-level cultivation → run
  `scripts/convert/from-pdf.mjs`, target the `mmRegionRecords` schema. This is
  the missing piece that makes Myanmar Focus fully official.
- **INCB Precursors Annual Report** (annual PDF, ~March): corridor and
  shipment tables → `from-pdf.mjs`, `flows` schema. Replaces the illustrative
  precursor corridors.
- **UNODC Synthetic Drugs in East & Southeast Asia** (annual PDF): meth
  seizure/price tables by country → enriches Myanmar Focus context.
- **EUDA statistical bulletin** (annual xlsx per table): dense European
  price/purity → `from-spreadsheet.mjs`, `prices` schema merge.
- **Natural Earth atlas refresh** (rare): download
  `ne_10m_admin_0_countries_ind.{shp,dbf,shx,prj}`, then
  `npx mapshaper ne10_ind.shp -simplify visvalingam 3% keep-shapes -filter-fields ADM0_A3,NAME -rename-fields name=NAME -rename-layers countries -o format=topojson quantization=100000 id-field=ADM0_A3 src/data/countries-ind.json`
  and re-run `gen-country-geo.mjs`.

## Registration-gated (the big unlock)

**UNODC Individual Drug Seizures (dmp.unodc.org)** — per-seizure origin,
transit and destination. This is the dataset that turns the illustrative
corridor arcs into official ones. Request export access; when granted,
aggregate to corridor + year grain before bundling (the ethical grain guard
in `ingest.ts` stays the boundary: no event-level or navigable detail ships).

## Ethical grain guard (unchanged, non-negotiable)

Whatever the source: country/province + year aggregates only, logistics only
for precursors (no chemistry), nothing point-of-sale, real-time or navigable.
`ingest.ts` enforces this at the parser layer; new converters must too.
