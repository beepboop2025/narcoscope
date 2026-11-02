// UNODC World Drug Report values are withheld from every public surface (see
// docs/publication-rights.md), and this repository is public. Generators therefore
// write each WDR-bearing file twice: the original to an untracked, gitignored
// directory, and only the publishable projection to the tracked path that the
// collector commits. Tools that need the original read it from that directory
// when it exists, which is during a pipeline run or on an owner's machine, and
// otherwise see the projection. Nothing here decides what may be published; the
// projections come from lib/publication-rights.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectLegacyJson, projectOverview, projectPriceModule } from './publication-rights.mjs'

// A browser-like test environment can give this module a non-file URL; tests
// run from the repository root, so fall back to the working directory there.
function repositoryRoot() {
  try { return fileURLToPath(new URL('..', import.meta.url)) } catch { return process.cwd() }
}
export const REPOSITORY_ROOT = repositoryRoot()
export const WITHHELD_DIRECTORY = 'data-private/withheld'

// Keep each file's own serialization: compact JSON, with a trailing newline only
// where the generator wrote one.
const json = (text, project) => JSON.stringify(project(JSON.parse(text))) + (text.endsWith('\n') ? '\n' : '')
export const TRACKED_PROJECTIONS = Object.freeze({
  'src/data/prices.ts': projectPriceModule,
  'src/data/priceSeries.json': text => json(text, data => projectLegacyJson('priceSeries.json', data)),
  'src/data/seizures.json': text => json(text, data => projectLegacyJson('seizures.json', data)),
  'src/data/overview.json': text => json(text, projectOverview),
})

function projectionFor(path) {
  const project = TRACKED_PROJECTIONS[path]
  if (!project) throw new Error(`Not a withheld WDR file: ${path}`)
  return project
}

export const originalPath = (root, path) => join(root, WITHHELD_DIRECTORY, path)

export function projectTrackedText(path, text) {
  return projectionFor(path)(text)
}

/** Write the original privately and only its projection to the tracked path. */
export function writeWithheld(root, path, original) {
  const project = projectionFor(path)
  const target = originalPath(root, path)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, original, { mode: 0o600 })
  writeFileSync(join(root, path), project(original))
}

/** The original when this checkout holds it; otherwise the tracked projection. */
export function readWithheld(root, path) {
  const target = originalPath(root, path)
  return readFileSync(existsSync(target) ? target : join(root, path), 'utf8')
}

export function originalsPresent(root = REPOSITORY_ROOT) {
  return Object.keys(TRACKED_PROJECTIONS).every(path => existsSync(originalPath(root, path)))
}

/** True when every tracked WDR file is exactly its own projection. */
export function trackedFilesProjected(root = REPOSITORY_ROOT) {
  return Object.keys(TRACKED_PROJECTIONS).every(path => {
    const text = readFileSync(join(root, path), 'utf8')
    return projectTrackedText(path, text) === text
  })
}

/**
 * Vitest only: resolve imports of a tracked WDR file to its private original when
 * this checkout has one, so data tests exercise real values during a pipeline run
 * and skip on a clone that holds only projections. Builds never use it.
 */
export function withheldOriginalsForTests(root = REPOSITORY_ROOT) {
  return {
    name: 'narcoscope-withheld-originals-for-tests',
    enforce: 'pre',
    apply: () => process.env.VITEST === 'true' && originalsPresent(root),
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      const path = relative(root, resolved.id.split('?')[0]).replaceAll('\\', '/')
      return Object.hasOwn(TRACKED_PROJECTIONS, path) ? originalPath(root, path) : null
    },
  }
}
