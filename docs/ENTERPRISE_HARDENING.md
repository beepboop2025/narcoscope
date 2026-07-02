# Enterprise hardening architecture

This pass turns the Myanmar module from a visualization into an auditable OSINT
intelligence workflow. The design is based on recent literature patterns:

| Pattern | Papers that motivate it | Product implementation |
|---|---|---|
| Event/entity knowledge graphs | EventRAG (ACL 2025); GraphRAG survey (arXiv:2408.08921); temporal-causal entity-event KGs (arXiv:2506.05939) | `src/lib/intelligence.ts` builds event/entity evidence nodes and edges for conflict actors, source countries, regions, sources, precursor inflows, and drug outflows. |
| Uncertainty and source reliability | LLM uncertainty survey (arXiv:2412.05563); misinformation-source webgraphs (arXiv:2401.02379) | The Enterprise Intel tab exposes confidence scores, source diversity, evidence counts, and downweights estimated precursor records. `src/lib/sourceReliability.ts` grades each named source into a `high` / `medium` / `low` reliability tier (name rules for known intergovernmental/OSINT bodies, domain rules as fallback) and that weight now feeds precursor-pressure aggregation, fused-mean conflict detection, region confidence scoring, and evidence-graph edge weights — not just the raw `official`/`reported`/`estimated` confidence tag. |
| Multi-source verification gates | Conflict-driven evidence summarization / CARE-RAG (arXiv:2507.01281); probabilistic cross-source entity resolution (Splink-based OSINT pipelines) | Each region profile carries an explicit `verificationTier` (multi-source / single-source / unverified). Precursor-inflow reports from independent sources that materially disagree from the **reliability-weighted** fused mean (>50% relative deviation) are flagged as a cross-source conflict and the confidence score is penalized rather than silently averaged away — a low-tier outlier source can no longer drag the fused estimate toward itself and dodge being flagged. |
| Human-in-the-loop OSINT review | OSINT Research Studios (arXiv:2401.00928); AIDE human validation for data extraction (arXiv:2501.11840) | Scraper output remains an analyst work queue with excerpts and hashes; it is not directly loaded as factual app data. |
| Supply-chain visibility via KGs | Supply-chain KG + LLM paper (arXiv:2408.07705); GNN/federated supply-chain analytics (arXiv:2503.07231) | Country-to-region precursor inflow records can be fused with conflict pressure and outbound seizure records to surface hidden dependency risk. |
| Provenance and crawler governance | Blockchain/federated provenance architecture (arXiv:2505.24675); crawler policy study (arXiv:2411.15091); SSRF taint-analysis work (arXiv:2502.21026) | The scraper has a source manifest, host allowlist, DNS/private-IP refusal, robots.txt checks, per-host rate budgets, cache, and hash-chained JSONL audit logs. |
| Crawler resilience & idempotency | Crawler policy study (arXiv:2411.15091); large-scale web-crawl reliability practice | Transient failures (network errors, timeouts, 5xx) are retried with exponential backoff + jitter; policy failures (blocked address, robots disallow, host not allowlisted, 4xx) never retry. Repeat scrapes can dedupe against a prior observation CSV so re-running the same manifest doesn't grow the review queue with identical rows. |
| Temporal trend / momentum signal | Time-series risk-trajectory practice in OSINT triage tooling | `src/lib/intelligence.ts` computes a `trajectory` (`rising`/`falling`/`stable`/`insufficient-data`) per region from a momentum index (cultivation + synthetic-drug activity + outbound seizures) versus the nearest earlier data year, so two regions with the same point-in-time score can still be ranked by whether pressure is climbing or easing. |
| Geographic spillover / contagion risk | Spatiotemporal spillover & carryover causal inference for conflict data (arXiv:2504.03464); grid-resolution neural conflict forecasting learning spatial contagion (arXiv:2506.14817) | `src/lib/intelligence.ts` runs a second pass over already-scored regions using a public administrative-adjacency map (`MM_REGION_ADJACENCY` in `src/data/myanmar.ts`) to flag `spilloverWatch`: a region whose own evidence looks calm but borders a high-risk region, per research finding conflict spillover concentrated at shared borders. Never affects a region's own `riskScore` — it's a distinct early-warning signal. |
| Evidence recency / temporal-credibility decay | Staleness-aware evidence fusion (arXiv:2506.05780); temporal credibility decay in OSINT entity correlation | `src/lib/intelligence.ts` computes `mostRecentEvidenceYear`/`evidenceAgeYears`/`evidenceStaleness` (`current` / `aging` / `stale` / `no-data`) per region from the freshest record across all evidence types, and applies a confidence-score penalty once evidence is 1+ (aging) or 3+ (stale) report-years old, so uncorroborated old reporting doesn't carry current-year confidence. |
| Supply-chain corridor-concentration risk | HHI concentration methodology (US DOJ/FTC Horizontal Merger Guidelines thresholds) applied to trafficking corridors instead of market share | `src/lib/intelligence.ts` computes an HHI (0-10000) for each region's *inbound* precursor-corridor sourcing and *outbound* seized-drug exit-corridor sourcing, tiering each `diversified` / `moderate` / `concentrated`. A region whose supply/export runs through one corridor is both more fragile and a sharper interdiction target than one with diversified routing. |
| Source-independence discounting | Non-independence bias in multi-source/Dempster-Shafer evidence fusion; trust-weighted source reliability (arXiv:2401.02379) | `src/lib/sourceReliability.ts` adds `canonicalSourceId`, resolving free-text `sourceName`/`sourceUrl` variants of the *same* organisation (e.g. "UNODC" vs. "UNODC Myanmar Opium Survey 2024") to one stable source-identity family. `sourceDiversity`, `verificationTier`, the confidence score's source-count term, and the cross-source disagreement gate are all keyed on independent families rather than raw name strings, so name-string duplication of one source can no longer masquerade as multi-source corroboration. `rawSourceNameCount` and `enterpriseReadiness.duplicateSourceNameRegions` expose the raw-vs-family gap as an actionable upstream data-quality signal. |
| Armed-actor network contagion | Bipartite armed-actor/territory network analysis of conflict diffusion (arXiv:2508.09051) | `src/lib/intelligence.ts` runs an `actorNetworkWatch` pass alongside geographic spillover: it groups `MM_CONFLICT_EVENTS` by shared `actor` name and flags a calm region as linked to a high-risk region when they share a conflict actor — even when the two regions aren't administratively adjacent (e.g. an armed group with an administered zone plus reported influence pockets elsewhere). A distinct early-warning path from `spilloverWatch`'s geographic-adjacency signal; never affects a region's own `riskScore`. |
| Ensemble/multi-signal corroboration | Ensembling independently-derived conflict-forecast models increases reliability over any single model (ViEWS-style ensemble forecasting practice) | `src/lib/intelligence.ts` computes `compoundEarlyWarning`: true only when a region's `spilloverWatch` (geographic-adjacency evidence) **and** `actorNetworkWatch` (shared-actor evidence) both fire. The two signals are derived from independent evidence (administrative-border geometry vs. actor-attribution records), so agreement between them is a materially stronger, corroborated warning than either alone — surfaced separately from each individual flag so analysts can distinguish single-signal hints from cross-validated ones. |
| Supply-chain chokepoint/bottleneck centrality | Network-centrality-driven chokepoint/bottleneck detection over supply-chain knowledge graphs (arXiv:2510.01115) | `src/lib/intelligence.ts` computes `enterpriseReadiness.chokepoints`: groups all outbound seizure corridors (border/exit towns) network-wide, independent of any single region, and flags a corridor `systemicChokepoint` when it either serves 2+ distinct source regions or alone carries an outsized share (≥40%) of total network volume. Complements the per-region outbound-corridor HHI — a region can look diversified on its own HHI while still routing through a node that other regions also depend on, and that node is the higher-leverage, network-wide interdiction target. |

## Enterprise Intel tab

The tab computes deterministic, explainable profiles per Myanmar region:

- **Risk score** blends conflict pressure, inbound precursor pressure, outbound
  seizure pressure, synthetic-drug activity, and opium-cultivation pressure.
- **Confidence score** rewards evidence count, source diversity (weighted by
  average source reliability, `avgSourceReliability`), and availability of
  region statistics, and is penalized when independent sources disagree on the
  same precursor inflow (see verification gate below) or when the region's
  freshest evidence is aging/stale (see evidence recency below).
- **Verification tier** — `multi-source`, `single-source`, or `unverified` —
  states plainly whether a region's evidence has been corroborated by more than
  one independent source family, following multi-source verification gate
  practice from open OSINT pipelines. Source *families* — not raw name
  strings — decide this: two records citing the same organisation under
  different name-string variants collapse to one family via
  `canonicalSourceId`, so name-string duplication can't inflate a region to
  `multi-source` on its own (see `rawSourceNameCount` vs. `sourceDiversity`
  and `enterpriseReadiness.duplicateSourceNameRegions` for the audit trail).
- **Cross-source conflict flag** — when two or more independent sources report
  materially different quantities for the same region/precursor/year, the
  region is flagged with a conflict note instead of quietly blending the
  numbers together (conflict-driven summarization pattern). The disagreement
  check now compares each report against a **reliability-weighted fused mean**
  (`src/lib/sourceReliability.ts`) rather than a naive average, so a single
  low-tier or unrecognised source can't silently pull the "consensus" figure
  toward itself and escape being flagged as the outlier.
- **Evidence graph ledger** lists the strongest event/entity relations so an
  analyst can trace why a score changed, and tags each cited source with its
  reliability tier (`high` / `medium` / `low`) in-app; the CSV export additionally
  resolves each source to its independent source family (`canonicalSourceId`).
- **Risk trajectory** (`rising` / `falling` / `stable` / `insufficient-data`)
  shows whether a region's momentum is climbing or easing versus the nearest
  earlier year with data, so two regions tied on point-in-time score can still
  be prioritized by trend.
- **Spillover watch** flags a region whose own evidence is currently calm but
  whose administrative neighbor has crossed the high-risk threshold, using a
  public region-adjacency map — a distinct early-warning signal from the
  region's own `riskScore`, grounded in conflict spatial-diffusion research.
- **Actor-network watch** flags a region whose own evidence is currently calm
  but that shares a reported conflict actor with a high-risk region, even
  when the two regions don't border each other — grounded in bipartite
  armed-actor/territory network research (arXiv:2508.09051). Complements
  spillover watch's purely geographic signal with a shared-combatant/
  administered-zone signal; never affects the region's own `riskScore`.
- **Evidence staleness** (`current` / `aging` / `stale` / `no-data`) tracks how
  old a region's freshest evidence is relative to the reporting year, applying
  a graduated confidence penalty so old, uncorroborated reporting doesn't
  carry the same weight as current-year data.
- **Corridor concentration** (inbound precursor and outbound seizure) reports
  an HHI (0-10000) and DOJ/FTC-style tier per region, plus the dominant
  corridor and its share, surfacing single-corridor dependency as both a
  fragility signal and an interdiction-priority target.
- **Compound early warning** flags a region only when both `spilloverWatch`
  and `actorNetworkWatch` fire together — the two are derived from
  independent evidence, so their agreement is a corroborated signal rather
  than two separate low-confidence hints, following ensemble-forecasting
  practice from conflict early-warning systems. Never affects the region's
  own `riskScore`.
- **Corridor chokepoints** rank outbound corridor towns network-wide (not
  per-region) by total seized volume, flagging a corridor `systemicChokepoint`
  when it serves multiple regions or alone carries an outsized share of total
  network volume, per network-centrality chokepoint-detection research
  (arXiv:2510.01115) applied to trafficking corridors instead of a generic
  supply-chain graph.

Scores are triage indicators, not ground truth. They prioritize analyst review
and preserve the evidence trail needed to challenge or revise a claim.

## Governed scraper workflow

Run:

```bash
npm run scrape:myanmar -- \
  --cache-dir .cache/myanmar-scrape \
  --audit-log docs/sources/myanmar-audit.jsonl \
  --out docs/sources/myanmar-observations.csv \
  --dedupe-against docs/sources/myanmar-observations.csv \
  --pretty
```

The scraper:

1. validates `scripts/scrape/myanmar-sources.json` before any outbound request;
2. fetches only manifest-listed HTTP(S) hosts;
3. rejects loopback, private, link-local, multicast, and reserved DNS results;
4. checks `robots.txt` unless `--no-robots` is explicitly passed for tests;
5. enforces per-host request spacing;
6. retries only transient network/5xx/timeout failures with exponential
   backoff + jitter (`--max-retries`, `--retry-base-ms`) — policy failures
   (blocked address, robots disallow, allowlist miss, 4xx) never retry;
7. caches source bodies by URL hash;
8. optionally suppresses observations already present in a prior run's CSV via
   `--dedupe-against`, keeping repeat scrapes idempotent for the analyst queue;
9. writes hash-chained JSONL audit events with `previousHash` and `auditHash`;
10. emits keyword excerpts and content fingerprints for analyst review.

The observation CSV is intentionally **not** an app dataset. Analysts verify
source passages, then code curated rows into the Myanmar conflict / precursor CSV
schemas described in `docs/DATA_SOURCING.md`.
