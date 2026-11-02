# WDR public publication boundary

The UNODC World Drug Report families are metadata-only in the hosted NarcoScope product until documented permission for that product is established. This is an application publication policy; public access and the code repository licence are not data permission.

The policy covers WDR prices/purity, seizures, treatment, detected laboratories and legacy WDR price/seizure histories. It withholds raw measurements, bounds, rankings, totals and derivatives. It retains source and indicator identities, publisher links, native units, source editions, capture identities and an explicit reason. It does not substitute numerical zero for withheld data. Independently qualified StatCan observations remain byte-for-byte intact.

`lib/publication-rights.mjs` is applied before REST and both MCP serialization channels, before catalog summaries/cache, to old static JSON at the native server, to generated China/corridor bridges, and to production JSON/JavaScript builds. Mixed datasets carry `publication.status: partial`; a wholly restricted query carries `metadata_only`, null pagination totals, exact source metadata and no observation rows. Counts marked `published_rows_only` describe only the permitted projection. Dataset SHA256 values identify deterministic served projection bytes; upstream source capture hashes retain their separate meaning.

The production build projects public data after Vite copies it and scans the completed app/workspace assets for retained WDR rows and numeric derivatives. Legacy UI routes show a rights notice rather than zero charts or numeric downloads. The catalog continues to identify WDR sources without advertising our raw GitHub files as plugin downloads. Every normal refresh is followed by the same mandatory build projection; a newly collected original cannot bypass it.

## Public repository

This repository is public, so it now follows the same boundary. The four legacy generators write each original to `data-private/withheld/` (gitignored, mode 0600) and only the publishable projection to its tracked path: `src/data/prices.ts`, `src/data/priceSeries.json`, `src/data/seizures.json` and `src/data/overview.json`. The weekly drug-market lane replays its private capture store and writes only the projection to `public/data/global-drugs-v1.json`; its refresh receipt binds the projected bytes. The daily collector and the quarterly refresh commit only those tracked paths. `lib/withheld-originals.mjs` holds the rule; `scripts/publication/tracked-projection.test.js` and the build verifier fail if a tracked file carries a withheld value.

Originals exist during a pipeline run, regenerated from `data-raw/` downloads and the private market capture store, or on an owner's machine after `npm run data:refresh`. Tests that need real WDR values read them through a test-only resolver and skip on a clone that holds only projections. The China and corridor bridges refuse to regenerate without the originals, and their `input` descriptors hash the original bytes they read, which are no longer the tracked bytes.

Commits before this change still contain the values in Git history. Rewriting that history is an owner decision and has not been done.

Existing public GitHub history is deliberately unchanged. The serving fix does not retract prior public copies, validate every other source licence, or provide a blanket marketplace rights attestation. Publisher provenance links do not grant reuse rights. Do not remove the restriction based on reachability, attribution, an educational-only grant or a changed source identifier.

Validation: `npm test`, `npm run build`, and `node scripts/publication/verify-public-build.mjs`. The regression tests include a retained raw source, cache reuse, native HTTP aliases, stale static copies, MCP text and structuredContent, source/indicator discovery, allowed-source controls and UI export withholding. Live source/deployment identities and independent native/provider/gateway readbacks remain required before release acceptance.
