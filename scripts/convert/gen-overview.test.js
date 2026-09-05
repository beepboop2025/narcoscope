import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { STATE_SUBSTANCES } from '../../src/lib/stateOverdose'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
const temporaryRoots = []

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function generate(overdose = read('src/data/overdose.json')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'narcoscope-overview-'))
  temporaryRoots.push(directory)
  fs.mkdirSync(path.join(directory, 'scripts/convert'), { recursive: true })
  fs.mkdirSync(path.join(directory, 'src/data'), { recursive: true })
  const script = 'scripts/convert/gen-overview.mjs'
  fs.copyFileSync(path.join(root, script), path.join(directory, script))
  for (const name of ['seizures', 'designations', 'wastewater']) {
    fs.copyFileSync(path.join(root, `src/data/${name}.json`), path.join(directory, `src/data/${name}.json`))
  }
  fs.writeFileSync(path.join(directory, 'src/data/overdose.json'), JSON.stringify(overdose))
  execFileSync(process.execPath, [path.join(directory, script)], { stdio: 'pipe' })
  return JSON.parse(fs.readFileSync(path.join(directory, 'src/data/overview.json'), 'utf8'))
}

describe('CDC overdose presentation', () => {
  it('preserves the source class in generated chart labels and the state selector', () => {
    const overview = generate()
    const label = 'Psychostimulants with abuse potential'
    expect(overview.overdoseBySubstance.find((row) => row.substance === 'psychostimulants').label).toBe(label)
    expect(overview.overdoseTrend.substances.find((row) => row.id === 'psychostimulants').label).toBe(label)
    expect(STATE_SUBSTANCES.find((row) => row.id === 'psychostimulants').label).toBe(label)

    // Regeneration must reproduce every bundled aggregate and its provenance;
    // only the generation date depends on when this offline check runs.
    const bundled = read('src/data/overview.json')
    expect({ ...overview, meta: { ...overview.meta, generated: bundled.meta.generated } }).toEqual(bundled)
  })

  it('shows a newer rolling window without changing the annual comparison year or values', () => {
    const overdose = read('src/data/overdose.json')
    const baseline = generate(overdose)
    overdose.meta.latestWindow = '2030-04'
    const overview = generate(overdose)
    expect(overview.headline.usOverdoseWindow).toBe('2030-04')
    expect(overview.freshness.find((row) => row.source === 'CDC overdose mortality').latest).toBe('2030-04')
    expect(overview.headline.usOverdoseYear).toBe(baseline.headline.usOverdoseYear)
    expect(overview.overdoseBySubstance).toEqual(baseline.overdoseBySubstance)
    expect(overview.overdoseTrend).toEqual(baseline.overdoseTrend)
  })
})
