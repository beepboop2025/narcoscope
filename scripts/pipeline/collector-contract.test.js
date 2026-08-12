import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const derivedPublicArtifacts = [
  'public/data/narcoscope-palimpsest-v1.json',
  'public/news',
]

describe('automated refresh publication contract', () => {
  it('stages the derived public artifact with its source data on Hetzner', () => {
    const collector = read('deploy/collector/collect.sh')

    for (const artifact of derivedPublicArtifacts) expect(collector).toContain(`"${artifact}"`)
    expect(collector).toMatch(/git status --porcelain -- "\$\{GENERATED_PATHS\[@\]\}"/)
    expect(collector).toMatch(/git add -- "\$\{GENERATED_PATHS\[@\]\}"/)
  })

  it('includes the derived public artifact in quarterly refresh PRs', () => {
    const workflow = read('.github/workflows/data-refresh.yml')

    for (const artifact of derivedPublicArtifacts) expect(workflow).toContain(`            ${artifact}\n`)
  })
})
