import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { renderFamilyHeader } from './family-header.mjs'

const files = ['developers/index.html', 'research/index.html', ...['drug-price-data', 'drug-seizure-data', 'overdose-data', 'precursor-incidents'].map(name => `research/${name}/index.html`)]
const start = '<!-- FAMILY_HEADER_START -->'
const end = '<!-- FAMILY_HEADER_END -->'
const expected = `${start}\n${renderFamilyHeader()}\n${end}`
const check = process.argv.includes('--check')
for (const name of files) {
  const file = fileURLToPath(new URL(`../../public/${name}`, import.meta.url))
  const html = await fs.readFile(file, 'utf8')
  const first = html.indexOf(start), last = html.indexOf(end)
  let updated
  if (first < 0 && last < 0) updated = html.replace('<body>', `<body>\n${expected}`)
  else {
    if (first < 0 || last < first || html.indexOf(start, first + 1) >= 0) throw new Error(`Invalid header markers: ${name}`)
    updated = html.slice(0, first) + expected + html.slice(last + end.length)
  }
  if (!updated.includes(expected)) throw new Error(`Missing body/header: ${name}`)
  if (updated !== html) {
    if (check) throw new Error(`Shared header drift in ${name}; run npm run shell:sync`)
    await fs.writeFile(file, updated)
  }
}
console.log(`Shared research header ${check ? 'verified' : 'synchronized'} across ${files.length} pages`)
