<!-- textura-banner -->
<div align="center">
  <a href="https://github.com/beepboop2025/narcoscope"><img src="./banner.svg" width="100%" alt="narcoscope" /></a>
</div>

![tests](https://github.com/beepboop2025/narcoscope/actions/workflows/tests.yml/badge.svg)
![coverage](https://img.shields.io/badge/coverage-86%25-brightgreen)

# 🌍 NarcoScope

**Live: [narcoscope.com](https://narcoscope.com)** · evidence newsroom: **[narcoscope.com/#newsroom](https://narcoscope.com/#newsroom)**

An educational, public-good **data explorer** that makes the world's drug-trade
data *legible*. UNODC, INCB, and EUDA already publish street (retail) prices,
precursor-chemical prices, and trafficking-flow/seizure data — but it's buried in
dense PDFs and CSVs most people can't read. This app is a **translation layer** on
top of that public data: clean charts, maps, and plain-English explanations.

> **Mission:** democratize hard-to-read official drug data. Not a new data source —
> a way to *understand* the existing one.

## What it shows

- **Street Prices** — retail price trends by country, with a purity-adjusted view
  and an *affordability* lens (price expressed as days of average local income).
- **Precursor Flows & Prices** — trafficking corridors and precursor-chemical
  prices, with source hubs (notably China) highlighted.
- **Flow Map** — an Equal-Earth world map of corridor arcs, animated over time.
- **Triangulation** — reads seizures against modalities that interdiction
  agencies do *not* collect. Seizure volume moves with enforcement capacity at
  least as much as with trafficking volume, and nothing inside the seizure data
  separates the two; overdose mortality (vital-statistics registrars) and
  wastewater load (environmental chemists) can. Where the modalities agree the
  reading is credible; where they diverge, the divergence is the finding —
  seizures up with consumption flat reads as an enforcement effect, consumption
  up with seizures flat reads as expansion interdiction missed. Every verdict
  reports how many independent modalities backed it and whether it survives
  dropping any one of them. **Validation case:** Canadian cannabis 2019→2023
  reads seizures −94% against measured wastewater consumption +69%. Canada
  legalised cannabis in 2018, so the seizure collapse is enforcement stopping,
  not demand stopping — and the tool says so rather than reporting a shrinking
  market.
- **Designations** — the ~2,600 entities on the OFAC SDN list under the
  narcotics and transnational-crime authorities, searchable by name *or* by
  OFAC-published alias, plus a jurisdiction network built from the countries
  Treasury records each entity in. Betweenness and articulation-point analysis
  show which jurisdictions hold the designated networks together.
- **Evidence Newsroom** — a deterministic, offline-capable publication pipeline
  with sentence-level citations and independent-source gates. Its first bounded
  analysis keeps lawful trade, selected official incidents and US harm data in
  separate evidence lanes, and states what cannot be joined or causally
  attributed from the public record.
- **Palimpsest BRI context** — a pinned, bounded source-readiness and national
  economic context lane for CPEC, Gwadar, CMEC, Kyaukpyu and Balochistan. It
  preserves official, independent and modeled claim classes plus unavailable
  WDI coverage, but cannot enter drug-market, actor, route, guilt, political or
  causal inference.
- **Myanmar Focus** — province-level (Golden Triangle) detail: production regions,
  civil-war conflict pressure, China/third-country precursor inflows, cross-border
  corridor towns, and seized volumes. The intelligence layer fuses multi-source
  evidence into per-region risk/confidence scores, flags cross-source
  disagreement, weights sources by reliability tier, computes a
  year-over-year risk trajectory (rising/falling/stable) so analysts see
  momentum, flags a geographic **spillover watch** when a calm region
  borders one that has already crossed the high-risk threshold, flags
  **evidence staleness** (current/aging/stale) when a region's freshest
  record predates the reporting year, discounting confidence accordingly,
  and scores **precursor-corridor concentration** with a Herfindahl-Hirschman
  Index (diversified/moderate/concentrated) to flag single-source supply
  dependency — both a fragility signal and an interdiction priority.
  Risk profiles and the evidence-graph ledger can be exported as CSV directly
  from the briefing for offline analyst review.

Every view carries an auto-generated *"In plain English"* sentence and hover
tooltips that explain each figure in human terms.

## Screenshots

> **Street Prices now ships official data**: UNODC World Drug Report 2025, Statistical Annex 8.1 (retail per-gram prices + purities, 2019–2023, 208 records across 69 countries), with World Bank GDP-per-capita (2024) powering the affordability lens. Flow-map, precursor and Myanmar figures remain illustrative pending ingestion — the in-app badge states exactly which is which.

A dark, motion-led interface: a WebGL globe traces precursor corridors out of their
source hubs (coral) toward transit and destination nodes (cyan), headings reveal
letter-by-letter, and sections spring in as you scroll. The immersive layer is fully
gated behind `prefers-reduced-motion` and falls back to a lightweight 2D canvas on
mobile / WebGL-less devices.

![NarcoScope — WebGL hero globe](docs/screenshots/hero.png)

**Street Prices** — price trends + affordability lens, with a plain-English summary:

![Street Prices](docs/screenshots/street-prices.png)

**Flow Map** — Equal-Earth world map of precursor corridors, animated by year:

![Flow Map](docs/screenshots/flow-map.png)

**Myanmar Focus** — province-level Golden Triangle detail:

![Myanmar Focus](docs/screenshots/myanmar-focus.png)

## Ethical scope (please read)

This tool reports **aggregate, published statistics** — country-level, annual, and
(for focus regions) province-level — strictly for **awareness, education, and
research**. By design it does **not** provide point-of-sale, real-time, sub-street,
or navigable location data, and the precursor layer stores **logistics only** (what,
how much, where, control status) with **no chemistry, synthesis routes, or yields**.
It is not, and must not be used as, a guide to obtaining any substance.

### Private ScamShield signal

The Hetzner analyst environment can ingest ScamShield's privacy-minimized
Telegram aggregate for private review. This does not enter the website or its
Git-backed datasets. A strict schema firewall rejects raw messages, exact IOCs,
source identifiers, universal-coverage claims, public-eligibility claims, and
anything that drops the human-review requirement. The importer has no network
access and retains only aggregate counts, a source-file hash, hourly snapshots,
and an append-only receipt ledger under `/var/lib/narcoscope-analyst/`.

See [`deploy/private-import/README.md`](deploy/private-import/README.md) for the
trust boundary and production service.

### Named entities

The Designations tab names people and companies, which every other layer avoids.
The line it holds:

- A **designation** is a published act of a government — an entity placed on a
  list under a stated legal authority on a stated date. NarcoScope reports what
  the government did. It does not characterise what the entity did, carries no
  free-text allegation field, and a designation is **not** an adjudication of
  guilt. OFAC delists; check the live list before relying on any row.
- Addresses, passport and national-ID numbers and dates of birth are present in
  the upstream OFAC file and are **deliberately not extracted**.
- **Journalism and crowd-sourced trackers are leads, not records.** C4ADS,
  InSight Crime, EIA, GASO and the rest are registered in the source registry
  and read by the governed scraper into an analyst work queue. A named entity
  reaches a bundled dataset only if it *also* appears on an official designation
  list. The rule is written into `scripts/scrape/myanmar-sources.json` as
  `verification_rule`.
- The designation graph has **no entity-to-entity edges**, because OFAC
  publishes none. Inventing them and running centrality over the result would
  produce confident rankings of private individuals from a graph this tool made
  up. `docs/ROADMAP-PARALLEL-ECONOMY.md` records the methods excluded on these
  grounds, and why.

## Data provenance

Most bundled figures are now **official extracts**, regenerated by the pipeline
from the sources below. What is still illustrative is named explicitly: the
Myanmar region-level flow volumes and the precursor price series (INCB publishes
no precursor prices). The in-app badge states which is which, and every
generated dataset carries a provenance header naming its source, retrieval date
and extraction rules.

- UNODC — Drugs: prices & World Drug Report — https://dataunodc.un.org
- INCB — Precursors Report 2025 (exact audited PDF) — https://www.incb.org/incb/uploads/documents/Publications/AnnualReports/AR2025/Precursors_Report/E_INCB_2025_4_eng.pdf
- CDC NCHS — VSRR provisional drug overdose death counts — https://data.cdc.gov/NCHS/VSRR-Provisional-Drug-Overdose-Death-Counts/xkb8-kh2a
- Statistics Canada — drug metabolites in municipal wastewater — https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1310087101
- US Treasury OFAC — Specially Designated Nationals — https://sanctionslist.ofac.treas.gov/Home/SdnList
- EUDA (EMCDDA) — price, purity & wastewater — https://www.euda.europa.eu/data
- World Bank — GDP per capita — https://data.worldbank.org
- ACLED / International Crisis Group — Myanmar civil-war context

The full registry spans automated datasets,
manual-step datasets, and investigative reports that feed the analyst work queue
rather than the app — in [`scripts/pipeline/sources.json`](./scripts/pipeline/sources.json).
Each entry records its licence, cadence, automation tier, and what it feeds.
Two entries are registered specifically so the reasoning is not relitigated:
OpenSanctions publishes **no licence** on its bulk artifacts and is therefore a
lookup pointer rather than a bundled dataset, and OCCRP Aleph's per-collection
licences forbid redistribution.

**Wastewater comes from Canada, not Europe.** EUDA returns HTTP 403 to
non-browser clients (on the current URL, the legacy one, and the copy linked
from data.europa.eu) and ACIC ships PDFs, so neither of the famous programmes
can be automated. Statistics Canada publishes the same measurement, at the same
grain, in the same SCORE unit, through a keyless API under an open licence — so
that is the bundled default, and Canada is the second fully-triangulated
country. European and Australian coverage still needs a verified export through
the CSV panel.

Load real data through the **"Load official data (CSV)"** panel in the footer; each
file is parsed by `src/lib/ingest.ts` and bad rows are reported, not silently dropped.
See `src/lib/ingest-config-reference.md` for the column mapping.

Myanmar conflict and precursor-flow source triage can be prepared with the
Palimpsest-style governed scraper:

```bash
npm run scrape:myanmar -- --out docs/sources/myanmar-observations.csv --pretty
```

That output is an analyst work queue with excerpts and content fingerprints, not
direct app data; verify and code rows into the Myanmar civil-war / precursor CSV
schemas before loading them.

A **derived ontology** of every entity and relation type actually present in the
data is regenerated by `npm run ontology` into `docs/ontology/`. It is induced by
observation over the bundled datasets rather than generated by a language model:
the corpus is already typed and provenance-tagged, so the schema can be read off
it directly, which removes the hallucination risk entirely. It is a draft for
review and is never auto-applied to `src/types.ts`.

The new **Enterprise Intel** tab adds an event/entity evidence graph, regional
risk scores, confidence/source-diversity indicators, and an evidence ledger for
analyst review. See `docs/ENTERPRISE_HARDENING.md` for the paper-backed design.

The **Evidence Newsroom** tab reads a checked-in dossier and receipt generated
without network access or model calls. Publication requires sentence and visual
citations, active upstream-source independence for synthesis, a countercase,
limitations and causal/culpability safety checks. See
[`docs/EVIDENCE_NEWSROOM.md`](./docs/EVIDENCE_NEWSROOM.md).

### Evidence newsroom publication contract

The newsroom is visibly labelled **automated evidence analysis**, with
`humanReviewStatus: not_recorded`. No generative model participates in its build,
no expert or affected-person testimony is included, and it never simulates those
human voices. Its initial article makes no named allegation, records right to
reply as `not_required`, and publishes a correction/update history with stable
revision and content hashes.

An official record used by the build can support an attributed observation. An
analytical or methodological synthesis requires at least two independent,
actively used official upstream groups; merely registering an available,
capability-only or unavailable source contributes zero corroboration. When the
inputs lack a lawful-trade denominator, record-level join, adjudicated outcome or
defensible country allocation, the newsroom abstains. It does not turn origin
labels, administrative designations or a separate mortality trend into guilt or
causal attribution.

Publication surfaces are:

- app route: `/#newsroom`;
- standalone HTML: `/news/china-linked-precursor-incidents-official-record.html`;
- machine brief: `/news/china-linked-precursor-incidents-official-record.machine-brief.json`;
- cited dossier: `/news/china-linked-precursor-incidents-official-record.dossier.json`;
- JSON Feed: `/news/feed.json`; and
- Atom feed: `/news/feed.xml`.

Run `npm run news:build` to regenerate the offline bundle and
`npm run news:check` to verify every checked-in byte. The production build runs
the stale-artifact check before TypeScript and Vite.

## Tech

React 18 · Vite 8 · TypeScript · Recharts · react-simple-maps (world-atlas bundled
locally). The interface layer adds **Three.js / React Three Fiber** (a lazy-loaded
hero globe with bloom post-processing — kept out of the initial bundle),
**@react-spring/web** (physics-based letter/section reveals and animated counters),
and **Lenis** (global smooth scroll) — all behind a `prefers-reduced-motion` guard.
Runtime data store (`src/lib/dataStore.ts`) swaps sample → real data on load.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run scrape:myanmar -- --pretty
npm run ontology   # regenerate docs/ontology/draft-ontology.{json,md}
npm run news:build # regenerate the deterministic evidence newsroom
npm run news:check # verify that checked-in newsroom artifacts are current
npm run bridge:palimpsest-bri:check # verify the pinned BRI artifact + hash
npm run build      # type-check (tsc) + production build → dist/
npm run preview    # preview the build
npm run typecheck  # tsc --noEmit
npm test           # run unit tests (Vitest)
```

## Deploy (Vercel)

The repo is Vercel-ready (`vercel.json` pins the Vite framework). Either:

- **Dashboard:** import the Git repo at vercel.com — zero config, auto-detected.
- **CLI:** `npx vercel` (preview) / `npx vercel --prod` (production).

## Data pipeline

`npm run data:refresh` fetches the automatable open sources (UNODC WDR
annexes, World Bank GDP, CDC VSRR mortality, OFAC SDN designations),
regenerates the bundled datasets, and validates
them against the test suite. Individual refreshes: `npm run data:overdose`,
`npm run data:designations`. A quarterly GitHub Action does the same and
opens a PR when the data changes. The full source registry (including the
manual and API-key sources not yet wired in) lives in
[`scripts/pipeline/sources.json`](./scripts/pipeline/sources.json); the
playbook is [`docs/DATA_PIPELINE.md`](./docs/DATA_PIPELINE.md).

## Status / TODO

- ~~`purityAdjustedPrice()` is an intentional stub~~ **done** — it now returns
  price per pure gram and refuses to adjust when purity is unknown (an honest
  `n/a` beats comparing a cut street price against a pure one). See the editorial
  note in `src/lib/metrics.ts`.
- ~~Load and **verify** real UNODC/INCB data~~ **Street prices and qualified
  precursor-flow records: done** (WDR 2025 Annex 8.1 and the paragraph-located
  INCB 2025 precursor report). Remaining: a citable precursor-price series and
  the Myanmar dataset.
- **Wastewater now ships (Canada).** Extending it to Europe or Australia still
  needs a manually-fetched EUDA or ACIC export — both publishers block
  automation. Each one added is another country where divergence detection works.
- A **second designating authority** for the Designations tab (it is OFAC-only
  today). The UN Consolidated list was evaluated and ruled out — it is a
  counter-terrorism instrument with almost no narcotics designations; EU
  Sanctions Map is the live candidate. See [`docs/ROADMAP-PARALLEL-ECONOMY.md`](./docs/ROADMAP-PARALLEL-ECONOMY.md)
  for the ordered backlog and for the methods excluded on ethical or
  data-quality grounds.

## License

[MIT](./LICENSE) — free to use, adapt, and build on, with attribution.
