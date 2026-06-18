# Ingest CONFIG reference

`ingest.js` uses a single `CONFIG` object to map canonical field names to the many possible column names used by UNODC and INCB CSV exports. Matching is case-insensitive and whitespace is trimmed.

## Price dataset (`parsePrices`)

| Canonical key     | Plausible source column names                                      |
|-------------------|---------------------------------------------------------------------|
| `drug`            | `Drug`, `Substance`, `Drug Type`, `Drug group`, `Narcotic drug`     |
| `country`         | `Country`, `Country or Territory`, `Country/Territory`              |
| `iso3`            | `ISO3`, `ISO3 Code`, `Iso3`, `Country Code`, `ISO 3166-1 alpha-3`   |
| `region`          | `Region`, `UNODC Region`, `INCB Region`, `Geographic region`        |
| `year`            | `Year`, `Year of Seizure`, `Year of Report`, `Reporting Year`       |
| `priceUsdPerGram` | `Price per gram (USD)`, `Price USD/g`, `Retail price`, `Price/g`    |
| `purityPct`       | `Purity`, `Purity (%)`, `Purity %`, `Purity Percentage`, `-`, `n/a` |

## Precursor price dataset (`parsePrecursorPrices`)

| Canonical key     | Plausible source column names                                      |
|-------------------|---------------------------------------------------------------------|
| `precursor`       | `Precursor`, `Precursor Chemical`, `Chemical`, `Substance group`    |
| `country`         | `Country`, `Country or Territory`, `Country/Territory`              |
| `iso3`            | `ISO3`, `ISO3 Code`, `Iso3`, `Country Code`, `ISO 3166-1 alpha-3`   |
| `region`          | `Region`, `UNODC Region`, `INCB Region`, `Geographic region`        |
| `year`            | `Year`, `Year of Seizure`, `Year of Report`, `Reporting Year`       |
| `priceUsdPerKg`   | `Price per kg (USD)`, `Price USD/kg`, `Bulk price`, `Price/kg`      |

## Flow dataset (`parseFlows`)

| Canonical key     | Plausible source column names                                      |
|-------------------|---------------------------------------------------------------------|
| `precursor`       | `Precursor`, `Precursor Chemical`, `Chemical`, `Substance group`    |
| `origin`          | `Origin`, `Source country`, `Country of origin`                     |
| `transit`         | `Transit`, `Transit country`, `Via`, `Countries of transit`         |
| `destination`     | `Destination`, `Destination country`, `Country of destination`      |
| `year`            | `Year`, `Year of Seizure`, `Year of Report`, `Reporting Year`       |
| `quantityKg`      | `Quantity (kg)`, `Quantity Kg`, `Weight (kg)`, `Seized (kg)`        |

## Myanmar ('Golden Triangle') region dataset (`parseMyanmarRegions`, `parseMyanmarBorderNodes`)

| Canonical key | Plausible source column names                                          |
|---------------|-------------------------------------------------------------------------|
| `id`          | `ID`, `Node ID`, `Identifier`, `Code`                                   |
| `label`       | `Label`, `Name`, `Node label`, `Town`, `Location`                       |
| `lat`         | `Lat`, `Latitude`, `Y`                                                  |
| `lng`         | `Lng`, `Longitude`, `Lon`, `Long`, `X`                                  |

## Myanmar region records (`parseMyanmarRegionRecords`)

| Canonical key | Plausible source column names                                           |
|---------------|--------------------------------------------------------------------------|
| `region`      | `Region`, `Region ID`, `Area`, `Shan`                                   |
| `year`        | `Year`, `Survey Year`, `Reporting Year`                                 |
| `opiumHa`     | `Opium ha`, `Opium Poppy Cultivation (ha)`, `Poppy Cultivation Ha`      |
| `methIndex`   | `Meth Index`, `Methamphetamine Index`, `Synthetic Drugs Index`          |

## Myanmar sub-national flow dataset (`parseMyanmarFlows`)

| Canonical key | Plausible source column names                                           |
|---------------|--------------------------------------------------------------------------|
| `from`        | `From`, `From ID`, `From Region`                                        |
| `to`          | `To`, `To ID`, `To Region`                                              |
| `year`        | `Year`, `Year of Seizure`, `Year of Report`, `Reporting Year`           |
| `quantityKg`  | `Quantity (kg)`, `Quantity Kg`, `Weight (kg)`, `Seized (kg)`            |
| `drug`        | `Drug`, `Substance`, `Drug Type`, `Drug group`                          |

## Notes for mappers

- Empty cells, `-`, and `n/a` in a purity column are coerced to `null`.
- Price and quantity columns are parsed as floats; negative values cause the row to be skipped with a warning.
- `purityPct` and `methIndex` are clamped to the range `[0, 100]`.
- Only the first matching source column is used per canonical key.
