<!-- textura-banner -->
<div align="center">
  <a href="https://github.com/beepboop2025/drug-price-observatory"><img src="./banner.svg" width="100%" alt="drug-price-observatory" /></a>
</div>

# 🌍 Global Drug Price Observatory

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

> Showing sample/illustrative data (the in-app badge flips to "Live data" once real official figures are loaded).

A dark, motion-led interface: a WebGL globe traces precursor corridors out of their
source hubs (coral) toward transit and destination nodes (cyan), headings reveal
letter-by-letter, and sections spring in as you scroll. The immersive layer is fully
gated behind `prefers-reduced-motion` and falls back to a lightweight 2D canvas on
mobile / WebGL-less devices.

![Global Drug Price Observatory — WebGL hero globe](docs/screenshots/hero.png)

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

## Data provenance

⚠️ **The bundled figures are illustrative samples**, shaped to the structure of the
official datasets but **not authoritative**. Replace them with real exports before
presenting anything as factual:

- UNODC — Drugs: prices & World Drug Report — https://dataunodc.un.org
- INCB — Precursors annual report & PICS — https://www.incb.org/incb/en/precursors/
- EUDA (EMCDDA) — price & purity — https://www.euda.europa.eu/data
- World Bank — GDP per capita — https://data.worldbank.org
- ACLED / International Crisis Group — Myanmar civil-war context

Load real data through the **"Load official data (CSV)"** panel in the footer; each
file is parsed by `src/lib/ingest.js` and bad rows are reported, not silently dropped.
See `src/lib/ingest-config-reference.md` for the column mapping.

Myanmar conflict and precursor-flow source triage can be prepared with the
Palimpsest-style governed scraper:

```bash
npm run scrape:myanmar -- --out docs/sources/myanmar-observations.csv --pretty
```

That output is an analyst work queue with excerpts and content fingerprints, not
direct app data; verify and code rows into the Myanmar civil-war / precursor CSV
schemas before loading them.

The new **Enterprise Intel** tab adds an event/entity evidence graph, regional
risk scores, confidence/source-diversity indicators, and an evidence ledger for
analyst review. See `docs/ENTERPRISE_HARDENING.md` for the paper-backed design.

## Tech

React 18 · Vite 5 · TypeScript · Recharts · react-simple-maps (world-atlas bundled
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
npm run build      # type-check (tsc) + production build → dist/
npm run preview    # preview the build
npm run typecheck  # tsc --noEmit
npm test           # run unit tests (Vitest)
```

## Deploy (Vercel)

The repo is Vercel-ready (`vercel.json` pins the Vite framework). Either:

- **Dashboard:** import the Git repo at vercel.com — zero config, auto-detected.
- **CLI:** `npx vercel` (preview) / `npx vercel --prod` (production).

## Status / TODO

- `purityAdjustedPrice()` in `src/lib/metrics.js` is an intentional stub — the
  null-purity policy is an editorial choice left to the maintainer.
- Load and **verify** real UNODC/INCB data (the main remaining step).
