import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const RUNTIME_FILE = /\.(?:[cm]?[jt]sx?|py|go|rb|rs|php|sh)$/

export function checkVercelApi(root = ROOT) {
  const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'))
  const expected = Object.keys(config.functions ?? {}).sort()
  const found = []
  function walk(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      // Vercel keeps underscore-prefixed files/directories private to imports.
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      const name = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(name)
      else if (RUNTIME_FILE.test(entry.name)) found.push(name)
    }
  }
  walk('api')
  found.sort()
  if (!expected.length || expected.length > 12 || JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error(`Vercel API entrypoints must match vercel.json functions (maximum 12): expected ${expected.join(', ')}; found ${found.join(', ')}`)
  }
  return found
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`VERCEL_API_ENTRYPOINTS_PASS ${checkVercelApi().join(' ')}`)
}
