#!/usr/bin/env node
/**
 * from-spreadsheet.mjs
 *
 * Convert a source spreadsheet (CSV, .xlsx, or .xls) into one of the fixed CSV
 * schemas expected by the drug-price-observatory loader.
 *
 * CLI:
 *   node from-spreadsheet.mjs <schema> <input-file> <output-file>
 *
 *   <schema> is one of: prices, flows, precursorPrices, mmRegionRecords.
 *   <output-file> must resolve inside scripts/convert/output/.
 *
 * Edit CONFIG below to match the column names used in your source sheet.
 */

import fs from 'node:fs'
import path from 'node:path'

// =============================================================================
// EDIT THIS CONFIG to match your source spreadsheets.
// Each top-level key is a schema. The optional `sheetName` overrides the default
// behaviour of reading the first worksheet for .xlsx/.xls files.
// Every value under `headers` maps an output column to one or more possible
// source column names (matched case-insensitively, ignoring spaces/underscores/%).
// =============================================================================
const CONFIG = {
  prices: {
    // sheetName: 'Sheet1',
    headers: {
      drug: ['drug', 'substance', 'drug type', 'drug_name', 'drug name', 'narcotic', 'product type'],
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
      purityPct: ['purity pct', 'purity', 'purity percent', 'purity %', 'purity_pct'],
    },
  },
  flows: {
    // sheetName: 'Sheet1',
    headers: {
      precursor: ['precursor', 'chemical', 'precursor_name', 'precursor name', 'substance group'],
      origin: ['origin', 'source', 'originating country', 'origin_country', 'origin country'],
      transit: ['transit', 'transit country', 'transiting country', 'via'],
      destination: ['destination', 'dest', 'destination country', 'destination_country'],
      year: ['year', 'yr', 'date', 'year_text'],
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
    },
  },
  precursorPrices: {
    // sheetName: 'Sheet1',
    headers: {
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
      priceUsdPerKg: [
        'price usd per kg',
        'priceusdperkg',
        'price per kg',
        'price usd/kg',
        'price_usd_per_kg',
      ],
    },
  },
  mmRegionRecords: {
    // sheetName: 'Sheet1',
    headers: {
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
    },
  },
}

const VALID_DRUGS = new Set(['cocaine', 'heroin', 'cannabis', 'methamphetamine'])
const VALID_PRECURSORS = new Set([
  'fentanyl_precursors',
  'meth_precursors',
  'meth_pre_precursors',
  'heroin_precursors',
])

const SCHEMAS = {
  prices: {
    required: ['drug', 'country', 'iso3', 'region', 'year', 'priceUsdPerGram'],
    optional: ['purityPct'],
  },
  flows: {
    required: ['precursor', 'origin', 'destination', 'year', 'quantityKg'],
    optional: ['transit'],
  },
  precursorPrices: {
    required: ['precursor', 'country', 'iso3', 'region', 'year', 'priceUsdPerKg'],
    optional: [],
  },
  mmRegionRecords: {
    required: ['region', 'year', 'opiumHa', 'methIndex'],
    optional: [],
  },
}

// =============================================================================
// Header / CSV helpers (kept aligned with src/lib/ingest.ts)
// =============================================================================

function normalizeHeader(header) {
  return String(header ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildHeaderMap(headers, headerAliases) {
  const map = Object.create(null)
  const ambiguous = []

  headers.forEach((rawHeader, sourceIndex) => {
    const normalized = normalizeHeader(rawHeader)
    if (normalized === '') return

    const matchedFields = []
    for (const [field, candidates] of Object.entries(headerAliases)) {
      if (candidates.some((candidate) => normalizeHeader(candidate) === normalized)) {
        matchedFields.push(field)
      }
    }

    if (matchedFields.length === 1) {
      const field = matchedFields[0]
      if (map[field] !== undefined) {
        ambiguous.push(
          `Ambiguous header "${rawHeader}": column index ${sourceIndex} also matches already-mapped field "${field}"`
        )
      } else {
        map[field] = sourceIndex
      }
    } else if (matchedFields.length > 1) {
      ambiguous.push(
        `Ambiguous header "${rawHeader}": matches multiple output fields (${matchedFields.join(', ')})`
      )
    }
  })

  return { map, ambiguous }
}

function splitCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++ // skip the escaping quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

function parseCsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }

  const headers = splitCsvLine(lines[0])
  const rows = lines.slice(1).map(splitCsvLine)
  return { headers, rows }
}

async function readSpreadsheet(inputPath, schemaConfig) {
  const ext = path.extname(inputPath).toLowerCase()
  const buffer = fs.readFileSync(inputPath)

  if (ext === '.csv') {
    return parseCsv(buffer.toString('utf8'))
  }

  // .xlsx / .xls — the xlsx package was dropped from the project's
  // dependencies (unpatched upstream advisories; `npm audit` stays clean
  // without it), so it is loaded on demand only when someone actually
  // converts an Excel file. CSV conversion never needs it.
  let xlsx
  try {
    xlsx = (await import('xlsx')).default
  } catch {
    throw new Error(
      'Converting .xlsx/.xls requires the optional "xlsx" package, which is not installed. ' +
      'Run `npm install --no-save xlsx` and retry, or export the sheet as CSV instead.',
    )
  }
  const workbook = xlsx.read(buffer, { type: 'buffer' })
  const sheetName = schemaConfig.sheetName ?? workbook.SheetNames[0]
  if (!workbook.Sheets[sheetName]) {
    throw new Error(`Worksheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`)
  }
  const sheet = workbook.Sheets[sheetName]
  const json = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (json.length === 0) {
    return { headers: [], rows: [] }
  }

  const headers = json[0].map(String)
  const rows = json
    .slice(1)
    .map((row) => {
      const arr = Array.isArray(row) ? row : []
      return headers.map((_, idx) => (arr[idx] === undefined || arr[idx] === null ? '' : String(arr[idx]).trim()))
    })
    .filter((row) => row.some((cell) => cell !== ''))

  return { headers, rows }
}

// =============================================================================
// Value coercion helpers
// =============================================================================

function coerceString(value) {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseNumeric(value) {
  if (value === undefined || value === null) return null
  let s = String(value).trim()
  if (s === '' || s === '-' || s.toLowerCase() === 'n/a') return null
  s = s.replace(/,/g, '').replace(/^\$/, '')
  if (s.endsWith('%')) {
    s = s.slice(0, -1).trim()
  }
  const num = Number(s)
  return Number.isFinite(num) ? num : null
}

function parseYear(value) {
  if (value === undefined || value === null) return null
  let s = String(value).trim().replace(/,/g, '')
  if (s === '' || s === '-' || s.toLowerCase() === 'n/a') return null
  const num = parseInt(s, 10)
  return Number.isFinite(num) ? num : null
}

function normalizeDrug(value) {
  const raw = coerceString(value)
  if (!raw) return null
  return raw.toLowerCase()
}

function normalizePrecursor(value) {
  const raw = coerceString(value)
  if (!raw) return null
  return raw.toLowerCase().replace(/\s+/g, '_')
}

function toSnakeCaseSlug(value) {
  const raw = coerceString(value)
  if (!raw) return null
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getRawCell(row, headerMap, field) {
  const index = headerMap[field]
  if (index === undefined || index >= row.length) return undefined
  const value = row[index]
  return value === undefined || value === null ? undefined : value
}

// =============================================================================
// Output CSV helpers
// =============================================================================

function csvEscape(value) {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function writeCsv(outputPath, headers, records) {
  const lines = [headers.join(',')]
  for (const record of records) {
    lines.push(headers.map((h) => csvEscape(record[h])).join(','))
  }
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8')
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const [, , schema, inputFile, outputFile] = process.argv

  if (!schema || !inputFile || !outputFile) {
    console.error('Usage: node from-spreadsheet.mjs <schema> <input-file> <output-file>')
    console.error('Schemas: prices, flows, precursorPrices, mmRegionRecords')
    process.exit(1)
  }

  const schemaDef = SCHEMAS[schema]
  const schemaConfig = CONFIG[schema]
  if (!schemaDef || !schemaConfig) {
    console.error(`Unknown schema: ${schema}`)
    console.error('Schemas: prices, flows, precursorPrices, mmRegionRecords')
    process.exit(1)
  }

  const inputPath = path.resolve(inputFile)
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`)
    process.exit(1)
  }

  const projectRoot = process.cwd()
  const outputDir = path.resolve(projectRoot, 'scripts', 'convert', 'output')
  const outputPath = path.resolve(outputFile)
  if (!outputPath.startsWith(outputDir + path.sep) && outputPath !== outputDir) {
    console.error(`Output file must be inside ${path.relative(projectRoot, outputDir)}/`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const warningsPath = `${outputPath}.warnings.txt`

  const { headers, rows } = await readSpreadsheet(inputPath, schemaConfig)
  const { map: headerMap, ambiguous } = buildHeaderMap(headers, schemaConfig.headers)
  const outputHeaders = [...schemaDef.required, ...schemaDef.optional]

  const warnings = [...ambiguous]
  const missingRequiredHeaders = schemaDef.required.filter((field) => !(field in headerMap))
  if (missingRequiredHeaders.length > 0) {
    warnings.push(
      `Unrecognized spreadsheet layout: missing required columns ${missingRequiredHeaders.join(', ')}. No records parsed.`
    )
  }

  const records = []
  let skippedCount = 0

  if (missingRequiredHeaders.length === 0) {
    rows.forEach((row, index) => {
      const sourceRowNumber = index + 2 // 1-based header row + data row offset
      const record = {}
      const missingFields = []

      for (const field of outputHeaders) {
        const raw = getRawCell(row, headerMap, field)
        let value = null

        if (field === 'drug') {
          value = normalizeDrug(raw)
        } else if (field === 'precursor') {
          value = normalizePrecursor(raw)
        } else if (field === 'region' && schema === 'mmRegionRecords') {
          value = toSnakeCaseSlug(raw)
        } else if (field === 'year') {
          value = parseYear(raw)
        } else if (
          field === 'priceUsdPerGram' ||
          field === 'priceUsdPerKg' ||
          field === 'quantityKg' ||
          field === 'opiumHa' ||
          field === 'methIndex' ||
          field === 'purityPct'
        ) {
          value = parseNumeric(raw)
        } else {
          value = coerceString(raw)
        }

        record[field] = value === null ? '' : value

        if (schemaDef.required.includes(field) && (value === null || value === '')) {
          missingFields.push(field)
        }
      }

      if (missingFields.length > 0) {
        warnings.push(`Row ${sourceRowNumber}: skipped due to missing required fields (${missingFields.join(', ')})`)
        skippedCount++
        return
      }

      // Schema-specific validation (mirrors src/lib/ingest.ts)
      if (schema === 'prices' && !VALID_DRUGS.has(record.drug)) {
        warnings.push(`Row ${sourceRowNumber}: skipped due to unknown or missing drug "${record.drug}"`)
        skippedCount++
        return
      }
      if ((schema === 'flows' || schema === 'precursorPrices') && !VALID_PRECURSORS.has(record.precursor)) {
        warnings.push(
          `Row ${sourceRowNumber}: skipped due to unknown or missing precursor "${record.precursor}"`
        )
        skippedCount++
        return
      }

      const negativeField = outputHeaders.find(
        (f) =>
          (f === 'priceUsdPerGram' ||
            f === 'priceUsdPerKg' ||
            f === 'quantityKg' ||
            f === 'opiumHa') &&
          typeof record[f] === 'number' &&
          record[f] < 0
      )
      if (negativeField) {
        warnings.push(`Row ${sourceRowNumber}: skipped due to negative ${negativeField}`)
        skippedCount++
        return
      }

      records.push(record)
    })
  }

  writeCsv(outputPath, outputHeaders, records)

  if (warnings.length > 0) {
    fs.writeFileSync(warningsPath, warnings.join('\n') + '\n', 'utf8')
  } else {
    fs.writeFileSync(warningsPath, '', 'utf8')
  }

  console.log(`Rows read:    ${rows.length}`)
  console.log(`Rows written: ${records.length}`)
  console.log(`Rows skipped: ${skippedCount}`)
  console.log(`Output:       ${path.relative(projectRoot, outputPath)}`)
  console.log(`Warnings:     ${path.relative(projectRoot, warningsPath)}`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
