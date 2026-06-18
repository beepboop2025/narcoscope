/**
 * Data ingestion module for drug-price-observatory.
 *
 * Parses official CSV exports (INCB/UNODC) into fixed JavaScript schemas.
 * Pure functions only: no network calls, no filesystem writes, no console spam.
 */

/**
 * Header-name mapping configuration.
 * Each key is our canonical field name; the array lists possible source
 * column names (case-insensitive, whitespace-trimmed) that UNODC or INCB
 * exports may use.
 */
export const CONFIG = {
  id: ['id', 'node id', 'node_id', 'code'],
  label: ['label', 'name', 'node label', 'node_label', 'town', 'location'],
  lat: ['lat', 'latitude', 'y', 'lat_wgs84'],
  lng: ['lng', 'lon', 'longitude', 'x', 'lng_wgs84'],
  drug: ['drug', 'substance', 'drug type', 'drug_name', 'drug name', 'narcotic', 'product type'],
  precursor: ['precursor', 'chemical', 'precursor_name', 'precursor name', 'substance group'],
  country: ['country', 'nation', 'state', 'territory', 'country_name', 'country name'],
  iso3: ['iso3', 'iso', 'iso code', 'country code', 'iso3 code'],
  region: [
    'region',
    'area',
    'regional group',
    'region_name',
    'region name',
    'region id',
    'region_id',
    'subregion',
  ],
  year: ['year', 'yr', 'date', 'year_text'],
  priceUsdPerGram: [
    'price usd per gram',
    'priceusdpergram',
    'price per gram',
    'retail price usd/g',
    'price_usd_per_gram',
  ],
  priceUsdPerKg: [
    'price usd per kg',
    'priceusdperkg',
    'price per kg',
    'price usd/kg',
    'price_usd_per_kg',
  ],
  purityPct: ['purity pct', 'purity', 'purity percent', 'purity %', 'purity_pct'],
  origin: ['origin', 'source', 'originating country', 'origin_country', 'origin country'],
  transit: ['transit', 'transit country', 'transiting country', 'via'],
  destination: ['destination', 'dest', 'destination country', 'destination_country'],
  from: ['from', 'from id', 'from_id'],
  to: ['to', 'to id', 'to_id'],
  quantityKg: [
    'quantity kg',
    'quantity',
    'quantity_kg',
    'amount kg',
    'weight kg',
    'seized kg',
    'seizure kg',
    'volume kg',
  ],
  opiumHa: [
    'opium ha',
    'opium_ha',
    'opium poppy ha',
    'poppy ha',
    'cultivation ha',
    'opium cultivation hectares',
    'hectares',
  ],
  methIndex: [
    'meth index',
    'meth_index',
    'methamphetamine index',
    'synthetic index',
    'activity index',
    'meth activity',
  ],
};

const VALID_DRUGS = ['cocaine', 'heroin', 'cannabis', 'methamphetamine'];
const VALID_PRECURSORS = [
  'fentanyl_precursors',
  'meth_precursors',
  'meth_pre_precursors',
  'heroin_precursors',
];

/** Normalize a CSV header for matching: lowercase, split camelCase, collapse spaces. */
function normalizeHeader(header) {
  return String(header ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a map from canonical field name -> column index. */
function buildHeaderMap(headers, config) {
  const map = Object.create(null);
  headers.forEach((rawHeader, index) => {
    const normalized = normalizeHeader(rawHeader);
    for (const [field, candidates] of Object.entries(config)) {
      if (candidates.some((candidate) => normalizeHeader(candidate) === normalized)) {
        map[field] = index;
        break;
      }
    }
  });
  return map;
}

/** Tiny inline CSV parser: splits on commas, respecting double quotes. */
function parseCsv(csv) {
  const lines = String(csv ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

/** Split one CSV line, handling quoted fields and escaped quotes (""). */
function splitLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // skip the escaping quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Retrieve a raw field value using the header map. */
function getField(row, headerMap, field) {
  const index = headerMap[field];
  if (index === undefined || index >= row.length) return undefined;
  const value = row[index];
  return value === undefined || value === null ? undefined : value;
}

/** Coerce a value to a string or return null. */
function coerceString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce a value to an integer or return null. */
function coerceInt(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? Math.round(num) : null;
}

/** Coerce a value to a number or return null. */
function coerceNumber(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

/** Coerce an index value (e.g. methIndex): empty/- /n/a/% -> null, otherwise clamp to [0, 100]. */
function coerceIndex(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return null;
  const num = Number(trimmed.replace('%', '').trim());
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

/** Coerce purity: empty/- /n/a -> null, otherwise clamp to [0, 100]. */
function coercePurity(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return null;
  const num = Number(trimmed.replace('%', '').trim());
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

/** Normalize a drug id. */
function normalizeDrug(value) {
  const raw = coerceString(value);
  if (!raw) return null;
  return raw.toLowerCase();
}

/** Normalize a precursor id. */
function normalizePrecursor(value) {
  const raw = coerceString(value);
  if (!raw) return null;
  return raw.toLowerCase().replace(/\s+/g, '_');
}

/** Check whether a record has all required mapped values. */
function hasRequiredFields(record, requiredFields) {
  return requiredFields.every((field) => {
    const value = record[field];
    return value !== null && value !== undefined;
  });
}

/**
 * Parse retail drug-price CSV.
 *
 * Required columns: drug, country, iso3, region, year, priceUsdPerGram.
 * purityPct is optional and may be null.
 */
export function parsePrices(csv) {
  const records = [];
  const warnings = [];
  const { headers, rows } = parseCsv(csv);
  const headerMap = buildHeaderMap(headers, CONFIG);

  const required = ['drug', 'country', 'iso3', 'region', 'year', 'priceUsdPerGram'];
  const missing = required.filter((field) => !(field in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Unrecognized CSV layout: missing columns ${missing.join(', ')}. No records parsed.`
    );
    return { records, warnings };
  }

  rows.forEach((row, index) => {
    const lineNo = index + 2;
    const candidate = {
      drug: normalizeDrug(getField(row, headerMap, 'drug')),
      country: coerceString(getField(row, headerMap, 'country')),
      iso3: coerceString(getField(row, headerMap, 'iso3')),
      region: coerceString(getField(row, headerMap, 'region')),
      year: coerceInt(getField(row, headerMap, 'year')),
      priceUsdPerGram: coerceNumber(getField(row, headerMap, 'priceUsdPerGram')),
      purityPct: coercePurity(getField(row, headerMap, 'purityPct')),
    };

    if (!candidate.drug || !VALID_DRUGS.includes(candidate.drug)) {
      warnings.push(`Row ${lineNo}: skipped due to unknown or missing drug`);
      return;
    }

    if (!hasRequiredFields(candidate, required)) {
      warnings.push(`Row ${lineNo}: skipped due to missing required fields`);
      return;
    }

    if (candidate.priceUsdPerGram < 0) {
      warnings.push(`Row ${lineNo}: skipped due to negative priceUsdPerGram`);
      return;
    }

    records.push(candidate);
  });

  return { records, warnings };
}

/**
 * Parse precursor-price CSV.
 *
 * Required columns: precursor, country, iso3, region, year, priceUsdPerKg.
 */
export function parsePrecursorPrices(csv) {
  const records = [];
  const warnings = [];
  const { headers, rows } = parseCsv(csv);
  const headerMap = buildHeaderMap(headers, CONFIG);

  const required = ['precursor', 'country', 'iso3', 'region', 'year', 'priceUsdPerKg'];
  const missing = required.filter((field) => !(field in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Unrecognized CSV layout: missing columns ${missing.join(', ')}. No records parsed.`
    );
    return { records, warnings };
  }

  rows.forEach((row, index) => {
    const lineNo = index + 2;
    const candidate = {
      precursor: normalizePrecursor(getField(row, headerMap, 'precursor')),
      country: coerceString(getField(row, headerMap, 'country')),
      iso3: coerceString(getField(row, headerMap, 'iso3')),
      region: coerceString(getField(row, headerMap, 'region')),
      year: coerceInt(getField(row, headerMap, 'year')),
      priceUsdPerKg: coerceNumber(getField(row, headerMap, 'priceUsdPerKg')),
    };

    if (!candidate.precursor || !VALID_PRECURSORS.includes(candidate.precursor)) {
      warnings.push(`Row ${lineNo}: skipped due to unknown or missing precursor`);
      return;
    }

    if (!hasRequiredFields(candidate, required)) {
      warnings.push(`Row ${lineNo}: skipped due to missing required fields`);
      return;
    }

    if (candidate.priceUsdPerKg < 0) {
      warnings.push(`Row ${lineNo}: skipped due to negative priceUsdPerKg`);
      return;
    }

    records.push(candidate);
  });

  return { records, warnings };
}

/**
 * Parse precursor-flow CSV.
 *
 * Required columns: precursor, origin, destination, year, quantityKg.
 * transit is optional and may be null.
 */
export function parseFlows(csv) {
  const records = [];
  const warnings = [];
  const { headers, rows } = parseCsv(csv);
  const headerMap = buildHeaderMap(headers, CONFIG);

  const required = ['precursor', 'origin', 'destination', 'year', 'quantityKg'];
  const missing = required.filter((field) => !(field in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Unrecognized CSV layout: missing columns ${missing.join(', ')}. No records parsed.`
    );
    return { records, warnings };
  }

  rows.forEach((row, index) => {
    const lineNo = index + 2;
    const candidate = {
      precursor: normalizePrecursor(getField(row, headerMap, 'precursor')),
      origin: coerceString(getField(row, headerMap, 'origin')),
      transit: coerceString(getField(row, headerMap, 'transit')),
      destination: coerceString(getField(row, headerMap, 'destination')),
      year: coerceInt(getField(row, headerMap, 'year')),
      quantityKg: coerceNumber(getField(row, headerMap, 'quantityKg')),
    };

    if (!candidate.precursor || !VALID_PRECURSORS.includes(candidate.precursor)) {
      warnings.push(`Row ${lineNo}: skipped due to unknown or missing precursor`);
      return;
    }

    if (!hasRequiredFields(candidate, required)) {
      warnings.push(`Row ${lineNo}: skipped due to missing required fields`);
      return;
    }

    if (candidate.quantityKg < 0) {
      warnings.push(`Row ${lineNo}: skipped due to negative quantityKg`);
      return;
    }

    records.push(candidate);
  });

  return { records, warnings };
}

/** Convert a human-readable name to a lowercase snake_case id slug. */
function toSnakeCaseSlug(value) {
  const raw = coerceString(value);
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Normalize a Myanmar flow drug value to the canonical title-case name. */
function normalizeMyanmarDrug(value) {
  const raw = coerceString(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (
    normalized === 'methamphetamine' ||
    normalized === 'meth' ||
    normalized === 'yaba' ||
    normalized === 'ice'
  ) {
    return 'Methamphetamine';
  }
  if (normalized === 'heroin') {
    return 'Heroin';
  }
  return null;
}

/**
 * Shared parser for Myanmar node layers (regions or border corridor towns).
 * Returns records with exactly the { id, label, lat, lng } schema.
 */
function parseMyanmarNodeLayer(csv, layerName) {
  const records = [];
  const warnings = [];
  const { headers, rows } = parseCsv(csv);
  const headerMap = buildHeaderMap(headers, CONFIG);

  const required = ['id', 'label', 'lat', 'lng'];
  const missing = required.filter((field) => !(field in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Unrecognized ${layerName} CSV layout: missing columns ${missing.join(', ')}. No records parsed.`
    );
    return { records, warnings };
  }

  rows.forEach((row, index) => {
    const lineNo = index + 2;
    const id = toSnakeCaseSlug(getField(row, headerMap, 'id'));
    const label = coerceString(getField(row, headerMap, 'label'));
    const lat = coerceNumber(getField(row, headerMap, 'lat'));
    const lng = coerceNumber(getField(row, headerMap, 'lng'));

    if (!id || !label || lat === null || lng === null) {
      warnings.push(`Row ${lineNo}: skipped due to missing required fields`);
      return;
    }

    if (lat < -90 || lat > 90) {
      warnings.push(`Row ${lineNo}: skipped due to invalid lat ${lat}`);
      return;
    }

    if (lng < -180 || lng > 180) {
      warnings.push(`Row ${lineNo}: skipped due to invalid lng ${lng}`);
      return;
    }

    records.push({ id, label, lat, lng });
  });

  return { records, warnings };
}

/**
 * Parse Myanmar Golden Triangle region nodes.
 */
export function parseMyanmarRegions(csv) {
  // Ethical grain guard: province/named-town grain only; extra source columns are dropped so output is not navigable.
  return parseMyanmarNodeLayer(csv, 'regions');
}

/**
 * Parse Myanmar cross-border corridor towns.
 */
export function parseMyanmarBorderNodes(csv) {
  // Ethical grain guard: province/named-town grain only; extra source columns are dropped so output is not navigable.
  return parseMyanmarNodeLayer(csv, 'border nodes');
}

/**
 * Parse Myanmar region-level cultivation / synthetic-activity records.
 */
export function parseMyanmarRegionRecords(csv, knownIds) {
  // Ethical grain guard: province/named-town grain only; extra source columns are dropped so output is not navigable.
  const records = [];
  const warnings = [];
  const { headers, rows } = parseCsv(csv);
  const headerMap = buildHeaderMap(headers, CONFIG);
  const knownSet = knownIds ? new Set(knownIds) : null;

  const required = ['region', 'year', 'opiumHa', 'methIndex'];
  const missing = required.filter((field) => !(field in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Unrecognized Myanmar region records CSV layout: missing columns ${missing.join(', ')}. No records parsed.`
    );
    return { records, warnings };
  }

  rows.forEach((row, index) => {
    const lineNo = index + 2;
    const region = toSnakeCaseSlug(getField(row, headerMap, 'region'));
    const year = coerceInt(getField(row, headerMap, 'year'));
    const opiumHa = coerceNumber(getField(row, headerMap, 'opiumHa'));
    const methIndex = coerceIndex(getField(row, headerMap, 'methIndex'));

    if (!region || year === null || opiumHa === null || methIndex === null) {
      warnings.push(`Row ${lineNo}: skipped due to missing required fields`);
      return;
    }

    if (opiumHa < 0) {
      warnings.push(`Row ${lineNo}: skipped due to negative opiumHa`);
      return;
    }

    if (knownSet && !knownSet.has(region)) {
      warnings.push(`Row ${lineNo}: unknown region id ${region}`);
    }

    records.push({ region, year, opiumHa, methIndex });
  });

  return { records, warnings };
}

/**
 * Parse Myanmar inter-region / cross-border flow records.
 */
export function parseMyanmarFlows(csv, knownIds) {
  // Ethical grain guard: province/named-town grain only; extra source columns are dropped so output is not navigable.
  const records = [];
  const warnings = [];
  const { headers, rows } = parseCsv(csv);
  const headerMap = buildHeaderMap(headers, CONFIG);
  const knownSet = knownIds ? new Set(knownIds) : null;

  const required = ['from', 'to', 'year', 'quantityKg', 'drug'];
  const missing = required.filter((field) => !(field in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Unrecognized Myanmar flows CSV layout: missing columns ${missing.join(', ')}. No records parsed.`
    );
    return { records, warnings };
  }

  rows.forEach((row, index) => {
    const lineNo = index + 2;
    const from = toSnakeCaseSlug(getField(row, headerMap, 'from'));
    const to = toSnakeCaseSlug(getField(row, headerMap, 'to'));
    const year = coerceInt(getField(row, headerMap, 'year'));
    const quantityKg = coerceNumber(getField(row, headerMap, 'quantityKg'));
    const drug = normalizeMyanmarDrug(getField(row, headerMap, 'drug'));

    if (!from || !to || year === null || quantityKg === null) {
      warnings.push(`Row ${lineNo}: skipped due to missing required fields`);
      return;
    }

    if (!drug) {
      warnings.push(`Row ${lineNo}: skipped due to unknown drug`);
      return;
    }

    if (quantityKg < 0) {
      warnings.push(`Row ${lineNo}: skipped due to negative quantityKg`);
      return;
    }

    if (knownSet) {
      if (!knownSet.has(from)) {
        warnings.push(`Row ${lineNo}: unknown from id ${from}`);
      }
      if (!knownSet.has(to)) {
        warnings.push(`Row ${lineNo}: unknown to id ${to}`);
      }
    }

    records.push({ from, to, year, quantityKg, drug });
  });

  return { records, warnings };
}
