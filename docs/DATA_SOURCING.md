# Data-sourcing checklist

How to replace the bundled **sample** data with real, citable figures. Each
dataset maps to one parser in `src/lib/ingest.js` and one upload slot in the
footer **"Load official data (CSV)"** panel. Headers are matched
case-insensitively and flexibly (e.g. `priceUsdPerGram`, `Price per gram`, and
`PRICE_USD_PER_GRAM` all work — see `CONFIG` in `ingest.js` for every alias).

> **Golden rule:** load **one** dataset first, read the warnings report, fix
> rows, and spot-check a few numbers against the source PDF *before* moving on.
> Bad rows are reported, never silently dropped.

---

## 0. Before you touch the loader — two static tables to extend by hand

These have **no CSV parser** (they're config, not data). If you add a country
that isn't already in them, edit the files directly or it won't fully render:

| File | Table | Why it matters |
|---|---|---|
| `src/data/prices.js` | `GDP_PER_CAPITA_USD` (ISO3 → USD) | Powers the **affordability** metric. Missing country → affordability shows `n/a`. Source: World Bank `NY.GDP.PCAP.CD`. |
| `src/data/flows.js` | `COUNTRY_CENTROIDS` (name → lat/lng) | Powers the **Flow Map**. Missing country → its arcs/markers won't plot. |

---

## 1. Street prices  → loader slot "Street prices" (`parsePrices`)

- **Source:** UNODC *Drugs: prices* dataset (https://dataunodc.un.org → Drugs →
  Prices) and the World Drug Report annex price tables. For Europe, EUDA/EMCDDA
  price & purity tables (https://www.euda.europa.eu/data).
- **Required columns:** `drug, country, iso3, region, year, priceUsdPerGram`
- **Optional:** `purityPct`
- **Allowed `drug` values:** `cocaine`, `heroin`, `cannabis`, `methamphetamine`
  (lower-cased automatically).
- **Units / gotchas:**
  - `priceUsdPerGram` = **retail** price per gram, USD, year-of-record. If the
    source gives a min–max **range**, use the midpoint (or weighted average) and
    note it.
  - Convert local-currency prices to USD at the report's stated rate.
  - `iso3` is usually **not** in UNODC tables — add it yourself (e.g. `USA`,
    `DEU`). `region` is a grouping you choose (`Americas`, `Europe`, `Asia`…).
  - `purityPct` is a percent (0–100); leave blank / `n/a` where unknown
    (cannabis has none).

## 2. Precursor prices  → "Precursor prices" (`parsePrecursorPrices`)

- **Source:** INCB *Precursors* annual report (https://www.incb.org/incb/en/precursors/)
  and UNODC *Synthetic Drugs in East & Southeast Asia*. Prices here are sparse and
  often quoted as ranges — manual extraction expected.
- **Required columns:** `precursor, country, iso3, region, year, priceUsdPerKg`
- **Allowed `precursor` values:** `fentanyl_precursors`, `meth_precursors`,
  `meth_pre_precursors`, `heroin_precursors`
- **Gotchas:** `priceUsdPerKg` in USD per kilogram; midpoint of any range.

## 3. Precursor flows / seizures  → "Precursor flows" (`parseFlows`)

- **Source:** INCB **PICS** (Precursors Incident Communication System) aggregate
  statistics; UNODC seizures (dataUNODC). World Drug Report precursor chapter.
- **Required columns:** `precursor, origin, destination, year, quantityKg`
- **Optional:** `transit`
- **Gotchas:** `quantityKg` = total seized along the corridor for the year.
  `origin`/`transit`/`destination` are **country names** (must match your
  `COUNTRY_CENTROIDS` keys to plot). Same `precursor` enum as above.

## 4 & 5. Myanmar regions / border nodes  → (`parseMyanmarRegions` / `parseMyanmarBorderNodes`)

These are **reference geo tables you build once**, not annual data.

- **Required columns:** `id, label, lat, lng`
- **Source:** administrative-region centroids (regions) and named corridor-town
  coordinates (border nodes) — pick the centroid, not a precise facility.
- **`id`** = a stable snake_case slug (e.g. `shan_north`, `wa`, `muse`). The
  region/flow records below reference these ids.
- **⚠ Ethical grain:** province / named-town resolution **only**. Do not enter
  lab coordinates or anything navigable — the parser also drops any extra
  columns, but don't put them in.

## 6. Myanmar region stats  → "Myanmar region stats" (`parseMyanmarRegionRecords`)

- **Required columns:** `region, year, opiumHa, methIndex`
- **Source:** UNODC **Myanmar Opium Survey** (cultivation by region, hectares —
  this is `opiumHa`, published and citable).
- **`methIndex` is NOT published** — it's a **relative 0–100 indicator you
  construct** (e.g. normalised from regional meth-seizure / lab-dismantling
  counts). Document your method in this folder. The parser clamps it to [0,100].
- `region` must match an `id` from dataset #4.

## 7. Myanmar flows  → "Myanmar flows" (`parseMyanmarFlows`)

- **Required columns:** `from, to, year, quantityKg, drug`
- **Source:** UNODC *Synthetic Drugs in East & Southeast Asia*, Mekong/Golden
  Triangle seizure reporting.
- **Allowed `drug` values:** normalised to `Methamphetamine` or `Heroin`
  (source may say "meth", "yaba", "ice" → all become Methamphetamine).
- `from`/`to` must match `id`s from datasets #4 / #5.

---

## Recommended workflow

1. **Extend** `GDP_PER_CAPITA_USD` and `COUNTRY_CENTROIDS` for any new countries (§0).
2. Build **one** CSV (start with street prices), exact headers as above.
3. Load it in the footer panel → read the **warnings report** → fix flagged rows.
4. **Verify** 3–5 figures against the source PDF/table.
5. Repeat per dataset, in the order 1 → 7 (geo tables #4/#5 before #6/#7).
6. Keep raw downloads + a one-line provenance note per dataset in `docs/sources/`
   so every figure is traceable for citation.
7. When all real data loads cleanly, the header badge flips to **"Live data"** —
   then it's safe to make the GitHub repo public.

## Provenance hygiene

For each dataset, record: source name, exact report/table title, publication
year, URL, date accessed, and any transformation you applied (currency
conversion, range→midpoint, index construction). This is what separates an
awareness tool from a rumour.

---

## Appendix — what to delegate (and what never to)

**Division of labour.** A model — especially a censored one — must **never supply
the figures**. Asked for "cocaine prices by country," an LLM will hallucinate
plausible numbers, and for a tool whose entire value is trust, fabricated data is
worse than none. China precursor-flow facts are additionally sanitised by censored
models. So:

| Task | Delegate? | Why |
|---|---|---|
| Find / look up actual prices, flows, seizures | ❌ | Hallucination + censorship risk — source from UNODC/INCB yourself |
| Construct `methIndex` methodology | ❌ | Analytical judgement |
| Verify figures against source PDFs | ❌ | Judgement |
| Build per-dataset CSVs in the exact headers | ✅ | Mechanical, from *your* figures |
| Add `iso3` + `region` to a country list | ✅ | Uncontroversial reference facts |
| Generate `COUNTRY_CENTROIDS` for new countries | ✅ | Low-stakes (map dot position) |
| Build `GDP_PER_CAPITA_USD` from a World Bank CSV | ✅ | From a file, not from memory |

**Rule of thumb:** the model *shapes and enriches*; you *source and verify*.

### Delegation prompt — country reference enrichment (safe to delegate)

Paste into Kimi Code (or any coding model). It pulls GDP only from a CSV you
provide and is forbidden from inventing any drug-trade figures:

```
Inside the repo "drug-price-observatory", create a one-off Node ESM script
scripts/enrich-countries.mjs (no new npm deps; use only node builtins). Purpose:
help extend the two hand-maintained config tables for a given list of countries.

INPUT (all provided by me at runtime, via argv or a local file — do NOT invent data):
  1. A newline list of country names (e.g. countries.txt).
  2. A World Bank "GDP per capita (current US$)" CSV export (indicator
     NY.GDP.PCAP.CD) — for the GDP figures. Read GDP ONLY from this CSV.

The script must:
  - For each country name, resolve its ISO3 code and an approximate [lat,lng]
    centroid from a small embedded reference table you include in the script
    (cover only the input countries; if one isn't found, print a TODO line
    instead of guessing).
  - Look up the latest available GDP-per-capita value for that ISO3 from the
    World Bank CSV. If absent, emit `// TODO: GDP for <iso3>` — never fabricate.
  - Print two ready-to-paste JS blocks to stdout:
      (a) GDP_PER_CAPITA_USD entries:  USA: 70000,
      (b) COUNTRY_CENTROIDS entries:   'United States': { lat: 39.8, lng: -98.6 },
  - Print a summary of any countries it couldn't resolve.

Do NOT modify src/data/*.js directly — only print blocks for me to review and
paste. Do NOT hardcode or guess any drug prices, flows, or GDP values; GDP comes
only from the CSV I give you. Add a header comment saying this script handles
geographic/economic reference data only — no drug-trade figures.
```
