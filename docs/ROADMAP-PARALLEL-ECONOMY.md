# Roadmap — parallel-economy and convergence layers

Status: **planned, not built.** Written up here so the design decisions are
recorded rather than rediscovered, and so `scripts/pipeline/sources.json` has
somewhere to point when it registers a source that no current tab consumes.

Everything below was scoped during the July 2026 expansion that added the
Triangulation and Designations tabs. What shipped then is listed in the README;
what did not, and why, is here.

---

## 1. What shipped, for context

| Layer | Status |
| --- | --- |
| Demand-side mortality (CDC VSRR) | **shipped** — `src/data/overdose.json`, automated |
| Cross-modality triangulation | **shipped** — `src/lib/triangulate.ts` |
| Official designations (OFAC SDN) | **shipped** — `src/data/designations.json`, automated |
| Jurisdiction network analysis | **shipped** — `src/lib/designationNetwork.ts` |
| Derived ontology | **shipped** — `scripts/ontology/derive-ontology.mjs` |
| Message-evidence schema | **removed 2026-07-26** — see below |
| Wastewater consumption | **schema only** — publishers block automated collection |

---

## 2. Parallel-economy monitor

The idea: run illicit and licit economic models side by side, map the injection
points where criminal proceeds enter the formal economy, and simulate the
downstream distortion.

**This is a separate product, not a NarcoScope tab.** Three reasons.

**It is a liquidity-lab build.** The contagion machinery it needs — network
propagation, systemic-risk scoring, scenario counterfactuals — already exists in
LiquiLens (institution-level failure), Seiche (funding stress) and Undertow
(market-level liquidity). Rebuilding it inside a drug-trade explorer would fork
that work rather than extend it. If this gets built, it should consume
NarcoScope as a data source and live where the contagion models already are.

**The inputs do not exist at the grain the model needs.** An input-output table
over illicit sectors requires sector-level revenue and inter-sectoral transfer
estimates. What is actually published is seizure volume, retail price, and a
handful of point estimates in NGO reports with incompatible methodologies. The
gap gets filled by assumption, and an IO model is exactly the structure that
makes assumptions invisible: the number comes out the far end with the
authority of a matrix inversion behind it and no way for a reader to see which
cell was a guess.

**Estimating the black economy is the whole problem, not a preliminary step.**
The opaque-measurement literature is honest about producing wide intervals from
indirect traces. A monitor built on point estimates of something nobody can
observe would be more confident than the method supports.

**If it is built anyway**, the minimum honest version carries interval
estimates end to end (never point estimates), reports which cells are measured
versus assumed, and refuses to run a scenario when assumed cells dominate the
result. The triangulation layer's modality-coverage output is the pattern:
coverage is a first-class result, not a footnote.

Registered inputs already in the source registry: `global-financial-integrity`
(trade misinvoicing), `ocindex` (criminality/resilience scores).

---

## 3. Convergence layers — wildlife, arms, scam compounds

The Myanmar border zones run drugs, wildlife, arms and scam compounds through
the same militias and the same laundering infrastructure. NarcoScope covers one
of the four.

Sources for the other three are **registered but not consumed**: `traffic-wildlife`,
`eia-international`, `conflict-armament-research`, `small-arms-survey`,
`un-panel-of-experts-myanmar`, `gaso`. They are in the registry so the
convergence is documented, and so a later build starts from a vetted list with
licence and reliability tiers already assigned.

The blocker is not data availability, it is **grain**. NarcoScope publishes
aggregate statistics at country and province level. Most convergence reporting
is entity-level and allegation-based: this commander runs that compound. Adding
those sources without changing the grain policy would quietly convert an
aggregate statistics explorer into an allegation database, which is a different
product with different legal exposure and a different duty of care.

Any convergence build needs the grain policy decided **first**, in the README's
ethical-scope section, before a line of ingestion code.

---

## 4. Methods considered and deliberately excluded

Recorded so they are not re-proposed each time the research literature is swept.

**Cross-platform authorship attribution for account linking.** Stylometric
deanonymisation is capability-symmetric: the same model that links a vendor
account to a recruitment ad links a pseudonymous activist to their legal name.
Excluded on portfolio grounds as much as ethical ones — Palimpsest exists to
defend against this class of attack.

**Optimal-disruption node targeting against individuals.** Genetic-algorithm
node-removal over a criminal network assumes the graph is correct. The
robustness literature (arXiv:2501.01508) shows covert-network graphs built from
incomplete data systematically mis-rank nodes. On a public site, a mis-ranked
node is a named private individual publicly labelled a trafficking broker, with
no due process and no correction mechanism.

The same mathematics **is** applied where the objection does not hold:
`designationNetwork.ts` runs betweenness and articulation-point analysis over
jurisdictions, whose edges are OFAC-published facts and none of whom are people.

**Intercepted-communications ingestion.** No lawful-intercept authority exists
here to produce such data legitimately, so the schema would be a surveillance
capability with no legitimate input.

A consent-scoped version *was* built — `MessageEvidenceRecord`, storing indicator
categories and counts but never message text, with a closed three-value
`provenance` enum (victim-provided / public channel / published by investigator)
that deliberately had no value admitting intercept product. **It was removed on
2026-07-26** as unused: no data source, no UI surface, no consumer, no analysis
layer. It was scope creep into a drug-data explorer, and 293 lines of schema is
not worth carrying for a capability with neither an input nor an output path.

The design constraints are recorded here rather than in code so they do not have
to be re-derived. If scam-compound recruitment ever becomes an actual layer with
an actual data source, `git log -S MessageEvidenceRecord` recovers the
implementation.

**Entity-to-entity edges in the designation graph.** OFAC publishes none. Any
such edge would be generated by our join condition, and centrality computed over
it would measure the join, not the network.

**LLM-induced ontology.** The proposal is sound where a corpus is unstructured.
This corpus is typed records with declared provenance, so the schema is
observable and `scripts/ontology/derive-ontology.mjs` observes it. Revisit if
the corpus grows a genuinely unstructured arm — report bodies rather than
extracted tables. LLM induction earns its hallucination risk only when there is
no structure to read.

---

## 5. Nearest-term work, in order

1. ~~**UN Consolidated Sanctions List**~~ **evaluated 2026-07-27, dead end.** It
   is reachable, but it is a counter-terrorism / non-proliferation list, not a
   narcotics one: zero opium/meth/fentanyl entries, and the only 12 drug-related
   entities are Taliban figures where the opium economy is a *funding* mention,
   not the designation basis. Adding it would import ~1,000 terrorism
   designations to gain ~12 relevant rows and dilute a narcotics + TCO tab. The
   real second-authority gap stays open — **EU Sanctions Map** is the better
   candidate (genuine EU narcotics designations, with alias cross-references).
2. **EU Sanctions Map** (`eu-sanctions-map`) — the actual smallest-increment win
   for a second designating authority, now that the UN list is ruled out.
3. **Wastewater ingestion (Europe/Australia)** — the modality now ships for
   Canada; one verified EUDA or ACIC export extends divergence detection past
   North America. Both publishers block automated collection, so it is CSV-load.
4. **CDC WONDER final mortality** — replaces provisional VSRR counts for closed
   years, tightening the back-series triangulation runs against.
5. **EUDA price and purity tables** — densifies the retail-price modality across
   Europe, which currently drops out of triangulation for most EU countries.
