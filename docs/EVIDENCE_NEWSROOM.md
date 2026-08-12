# Evidence newsroom

NarcoScope's evidence newsroom turns checked-in official datasets into a
deterministic machine brief, evaluates that brief against a stricter publication
gate, and emits a static, reviewable article bundle under `public/news/`. It does
not fetch sources or call a model during the build.

## Publication boundary

The checked-in article asks what the official record shows—and cannot show—about
selected China-linked precursor incidents. Its evidence lanes stay separate:

- lawful industrial trade is a missing denominator because the build has no
  public, record-level lawful shipment table;
- one INCB aggregate reports nine incidents involving nearly five tonnes with
  China as the reported origin and EU countries as destinations;
- Operation Pseudonym reports 168 seizures across four reporting countries and
  identifies China and India as origins in Australia and New Zealand, but does
  not allocate seizure count or mass by origin-and-destination pair; and
- CDC synthetic-opioid mortality is United States harm context, not a causal
  attribution to any shipment, exporter, country, or precursor.

PICS and PEN Online are recorded as unavailable capabilities. GACC and UN
Comtrade are capability-only in this build. None of those entries can count as
active corroboration merely because it exists in the registry.

## Two gates

`scripts/newsroom/build-newsroom.mjs` first creates a `machine_brief`. That brief
must retain the source grain, preserve joint China/India origins, reject causal or
culpability conclusions, omit synthesis instructions and navigable operational
details, and pin its revision and content hashes.

Promotion to `automated_evidence_analysis` requires a second gate. Every published
sentence has a stable ID, citations and a deterministic support profile:

- an attributed measurement or administrative count needs one active official
  upstream group and is not described as corroborated;
- an analytical or methodological synthesis needs at least two independent,
  active upstream groups; and
- capability-only and unavailable sources contribute zero groups.

The gate also requires a countercase, explicit limitations, separate accessible
incident and harm visuals, a banned-claim scan, 100% sentence and visual-row
citation coverage, and a structured verification receipt. The receipt is rebuilt
and compared byte-for-byte when the dossier is checked, so stored evaluation
claims cannot drift from the evidence ledger.

The gate also requires an append-only correction/update history and an explicit
right-to-reply decision. This aggregate article makes no named allegation, so its
status is `not_required` and no outreach is implied. No expert or affected-person
testimony is included; the deterministic template never simulates those voices.

## Build and review

```bash
npm run news:build   # regenerate public/news from checked-in inputs
npm run news:check   # fail if any generated artifact is stale
```

The output includes the machine brief, cited dossier, standalone HTML, JSON Feed,
Atom feed, index and content-addressed manifest. Generation stages the complete
bundle and swaps it into place as one directory; check mode also rejects stale
unmanifested files. `npm run build` runs
`news:check` before TypeScript and Vite. The quarterly data pipeline regenerates
the bundle and includes `public/news/` in its reviewable diff.

Adding a registry entry does not make it evidence. To support a published claim,
the checked-in input must actually derive that claim, and its registry entry must
be marked `active_evidence` with the correct upstream group. Availability,
licensing and redistribution constraints live in
`scripts/newsroom/source-capabilities.json`; the broader acquisition registry
remains `scripts/pipeline/sources.json`.

## Known limits

This is a bounded official-record analysis, not a complete trade reconstruction.
It has no lawful-shipment denominator, no public PICS/PEN transaction records, no
row-level joins among trade, incidents, designations, court outcomes and deaths,
and no basis to allocate operation-wide counts or mass to bilateral origin and
destination pairs. It currently has zero independently corroborated event
claims; CDC is methodological harm context, not incident corroboration. Human review is not implied:
the publication explicitly records `humanReviewStatus: not_recorded`.
