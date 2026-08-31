import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DEFAULT_ATLAS_PATH = path.join(ROOT, 'src/data/countries-ind.json')

/**
 * Exact upstream label -> bundled Natural Earth label aliases.
 *
 * These are intentionally explicit. Fuzzy matching country names can merge
 * genuinely different geographies, so a new spelling fails the refresh until
 * it is reviewed and added here.
 */
export const COUNTRY_NAME_ALIASES = Object.freeze({
  'Antigua and Barbuda': 'Antigua and Barb.',
  'Bolivia (Plurinational State of)': 'Bolivia',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'Central African Republic': 'Central African Rep.',
  'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Congo, Dem, Rep,': 'Democratic Republic of the Congo',
  'Congo, Rep.': 'Republic of the Congo',
  'Congo, Rep,': 'Republic of the Congo',
  'Czech Republic': 'Czechia',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Eswatini': 'eSwatini',
  'Korea, DPR': 'Dem. Rep. Korea',
  'Korea, Rep.': 'Republic of Korea',
  'Korea, Rep,': 'Republic of Korea',
  'Marshall Islands': 'Marshall Is.',
  'Micronesia (Federated States of)': 'Micronesia',
  'Republic of Moldova': 'Moldova',
  'Solomon Islands': 'Solomon Is.',
  'South Sudan': 'S. Sudan',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'St, Kitts and Nevis': 'Saint Kitts and Nevis',
  'St. Lucia': 'Saint Lucia',
  'St, Lucia': 'Saint Lucia',
  'St. Vincent and the Grenadines': 'St. Vin. and Gren.',
  'St, Vincent and the Grenadines': 'St. Vin. and Gren.',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
})

const requireNonEmptyString = (value, label) => {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${label} must be a non-empty string`)
  return text
}

/** Build an exact resolver from a Natural Earth TopoJSON object. */
export function createCountryResolverFromTopology(
  topology,
  aliases = COUNTRY_NAME_ALIASES,
) {
  const geometries = topology?.objects?.countries?.geometries
  if (!Array.isArray(geometries) || geometries.length === 0) {
    throw new Error('Natural Earth topology is missing objects.countries.geometries')
  }

  const byName = new Map()
  const seenIso3 = new Map()
  for (const geometry of geometries) {
    const name = requireNonEmptyString(geometry?.properties?.name, 'Natural Earth country name')
    const iso3 = requireNonEmptyString(
      geometry?.properties?.ADM0_A3 ?? geometry?.id,
      `Natural Earth ISO3 for ${name}`,
    )
    if (!/^[A-Z]{3}$/.test(iso3)) {
      throw new Error(`Natural Earth country ${name} has invalid ISO3 ${iso3}`)
    }
    if (byName.has(name)) throw new Error(`duplicate Natural Earth country name: ${name}`)
    if (seenIso3.has(iso3)) {
      throw new Error(`duplicate Natural Earth ISO3 ${iso3}: ${seenIso3.get(iso3)} and ${name}`)
    }
    byName.set(name, { iso3, atlasName: name })
    seenIso3.set(iso3, name)
  }

  for (const [sourceName, atlasName] of Object.entries(aliases)) {
    if (!byName.has(atlasName)) {
      throw new Error(`country alias ${sourceName} points to missing Natural Earth name ${atlasName}`)
    }
  }

  return (sourceName) => {
    const name = requireNonEmptyString(sourceName, 'source country name')
    const atlasName = aliases[name] ?? name
    const match = byName.get(atlasName)
    if (!match) {
      throw new Error(`unmapped country name: ${name}`)
    }
    return { ...match, sourceName: name }
  }
}

/** Load the repository's reviewed Natural Earth India-POV atlas. */
export function createCountryResolver(atlasPath = DEFAULT_ATLAS_PATH) {
  const topology = JSON.parse(fs.readFileSync(atlasPath, 'utf8'))
  return createCountryResolverFromTopology(topology)
}
