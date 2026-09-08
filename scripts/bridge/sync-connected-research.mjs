import { readFile, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CONNECTED_FILE, CONNECTED_SOURCE, CONNECTED_MAX_BYTES, connectedSha256, loadConnectedResearch, validateConnectedResearch } from '../../lib/connected-research.mjs'

const directory = fileURLToPath(new URL('../../public/data/', import.meta.url))
const args = process.argv.slice(2)
if (args.includes('--check')) {
  await loadConnectedResearch()
  process.stdout.write('Connected Palimpsest research: hashes and evidence contract verified\n')
} else {
  const local = args.indexOf('--source')
  let raw
  if (local >= 0) {
    if (!args[local + 1]) throw new Error('--source requires a file')
    raw = await readFile(args[local + 1])
  } else {
    const response = await fetch(CONNECTED_SOURCE, { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Palimpsest research HTTP ${response.status}`)
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > CONNECTED_MAX_BYTES) throw new Error('Palimpsest research exceeds response limit')
      chunks.push(chunk)
    }
    raw = Buffer.concat(chunks)
  }
  if (raw.length > CONNECTED_MAX_BYTES) throw new Error('Palimpsest research exceeds response limit')
  validateConnectedResearch(JSON.parse(raw.toString('utf8')))
  const hash = connectedSha256(raw)
  const temp = `${directory}/.${CONNECTED_FILE}.${process.pid}`
  await writeFile(temp, raw)
  await rename(temp, `${directory}/${CONNECTED_FILE}`)
  await writeFile(`${temp}.sha256`, `${hash}  ${CONNECTED_FILE}\n`)
  await rename(`${temp}.sha256`, `${directory}/${CONNECTED_FILE}.sha256`)
  process.stdout.write(`Connected research snapshot: ${hash}\n`)
}
