import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRestrictedWdrSource } from '../../lib/publication-rights.mjs'
import {
  REPOSITORY_ROOT, TRACKED_PROJECTIONS, WITHHELD_DIRECTORY, originalPath, originalsPresent,
  readWithheld, trackedFilesProjected, writeWithheld,
} from '../../lib/withheld-originals.mjs'

const tracked = path => readFileSync(join(REPOSITORY_ROOT, path), 'utf8')

describe('withheld WDR values stay out of the public repository', () => {
  // UNODC permits educational or non-profit reproduction only; the hosted product
  // withholds WDR values pending permission, so the public repository must not
  // carry them either. The daily collector commits whatever these paths hold.
  it('tracks only the publishable projection of every WDR-bearing generated file', () => {
    expect(trackedFilesProjected()).toBe(true)
    expect(tracked('src/data/prices.ts')).toContain('export const PRICE_RECORDS: PriceRecord[] = []\n')
    expect(tracked('src/data/prices.ts')).not.toMatch(/priceUsdPerGram: \d/)
    for (const name of ['priceSeries.json', 'seizures.json']) {
      const data = JSON.parse(tracked('src/data/' + name))
      expect(data.records).toEqual([])
      expect(data.publication.status).toBe('metadata_only')
    }
    const overview = JSON.parse(tracked('src/data/overview.json'))
    expect(overview.headline).toMatchObject({ worldSeizureTonnes: null, seizureCountries: null })
    expect([overview.topSeizureCountries, overview.divergences]).toEqual([[], []])
    const drugs = JSON.parse(tracked('public/data/global-drugs-v1.json'))
    const withheld = new Set(drugs.sources.filter(isRestrictedWdrSource).map(source => source.id))
    const indicators = new Set(drugs.indicators.filter(row => withheld.has(row.sourceId)).map(row => row.id))
    expect(withheld.size).toBeGreaterThan(0)
    expect(drugs.observations.filter(row => indicators.has(row.indicatorId))).toEqual([])
  })

  it('writes the original only to the untracked directory and the projection to the tracked path', () => {
    const root = mkdtempSync(join(tmpdir(), 'narcoscope-withheld-'))
    try {
      mkdirSync(join(root, 'src/data'), { recursive: true })
      const original = JSON.stringify({ meta: { years: [2023] }, records: [[1, 2, 2023, 456.7]] }) + '\n'
      expect(originalsPresent(root)).toBe(false)
      writeWithheld(root, 'src/data/seizures.json', original)
      expect(readFileSync(originalPath(root, 'src/data/seizures.json'), 'utf8')).toBe(original)
      expect(statSync(originalPath(root, 'src/data/seizures.json')).mode & 0o777).toBe(0o600)
      const projection = JSON.parse(readFileSync(join(root, 'src/data/seizures.json'), 'utf8'))
      expect(projection.records).toEqual([])
      expect(JSON.stringify(projection)).not.toContain('456.7')
      expect(readWithheld(root, 'src/data/seizures.json')).toBe(original)
      // Without the private copy, readers see the tracked projection.
      rmSync(join(root, WITHHELD_DIRECTORY), { recursive: true })
      expect(JSON.parse(readWithheld(root, 'src/data/seizures.json')).records).toEqual([])
      expect(() => writeWithheld(root, 'src/data/organizedCrime.json', '{}')).toThrow(/Not a withheld WDR file/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ignores the withheld directory in .gitignore and in every Docker build context, and publishes no path inside it', () => {
    // Read the rules themselves, so this holds without Git (the Railway CI context excludes .git).
    const rules = file => readFileSync(join(REPOSITORY_ROOT, file), 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    const ignoresDirectory = file => rules(file).some(line => ['data-private', 'data-private/', '/data-private', '/data-private/'].includes(line))
    // A Docker build may consume its own ignore file without copying it into the
    // image, so the Docker ignore files are required wherever Git is (every real
    // checkout) and checked wherever they are present.
    const inGitCheckout = existsSync(join(REPOSITORY_ROOT, '.git'))
    const dockerIgnores = ['.dockerignore', 'deploy/railway-ci/Dockerfile.dockerignore']
      .filter(file => inGitCheckout || existsSync(join(REPOSITORY_ROOT, file)))
    for (const file of ['.gitignore', ...dockerIgnores]) {
      expect(ignoresDirectory(file), file).toBe(true)
      // A negation could re-include an original below the ignored directory.
      expect(rules(file).filter(line => line.startsWith('!') && line.includes('data-private')), file).toEqual([])
    }
    expect(WITHHELD_DIRECTORY.startsWith('data-private/')).toBe(true)
    // What the collector commits, what the quarterly refresh may propose, and what
    // the hosted functions and production image ship never name the directory.
    for (const file of ['deploy/collector/collect.sh', 'deploy/railway-quarterly/refresh.py', 'vercel.json', 'Dockerfile.railway', 'package.json']) {
      expect(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'), file).not.toContain('data-private')
    }
  })

  // Requires a Git checkout. The Railway CI build context excludes .git, so this
  // runs in local and GitHub checkouts and the collector's worktree, and skips there.
  it.skipIf(!existsSync(join(REPOSITORY_ROOT, '.git')))('lets Git neither track nor un-ignore the withheld originals (Git checkouts only; skipped where .git is absent)', () => {
    for (const path of Object.keys(TRACKED_PROJECTIONS)) {
      const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', join(WITHHELD_DIRECTORY, path)], { cwd: REPOSITORY_ROOT })
      expect(ignored.status, path).toBe(0)
    }
    const listed = spawnSync('git', ['ls-files', '--', WITHHELD_DIRECTORY], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
    expect(listed.status).toBe(0)
    expect(listed.stdout).toBe('')
  })

  it('projects each tracked file idempotently', () => {
    for (const [path, project] of Object.entries(TRACKED_PROJECTIONS)) {
      const text = tracked(path)
      expect(project(text), path).toBe(text)
    }
  })

  it('keeps a generator run that writes an original from changing the tracked projection', () => {
    const root = mkdtempSync(join(tmpdir(), 'narcoscope-withheld-'))
    try {
      mkdirSync(join(root, 'src/data'), { recursive: true })
      for (const path of Object.keys(TRACKED_PROJECTIONS)) {
        writeFileSync(join(root, path), tracked(path))
        writeWithheld(root, path, readWithheld(REPOSITORY_ROOT, path))
        expect(readFileSync(join(root, path), 'utf8'), path).toBe(tracked(path))
      }
      expect(trackedFilesProjected(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
