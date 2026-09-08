import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const files = {}
for (const name of ['workspace.js', 'workspace.css']) {
  const bytes = await readFile(new URL('../../dist/workspace/' + name, import.meta.url))
  files[name] = { sha256: sha(bytes), bytes: bytes.length }
}
const inputs = ['src/components/GlobalMarketExplorer.tsx', 'src/components/DataTableViewport.tsx', 'src/lib/mapSvg.ts', 'src/data/countries-ind.json', 'src/market-workspace.css', 'src/workspace-entry.tsx', 'public/research-theme.css', 'vite.workspace.config.js', 'package-lock.json']
const sourceHashes = Object.fromEntries(await Promise.all(inputs.map(async path => [path, sha(await readFile(new URL('../../' + path, import.meta.url)))])))
await writeFile(new URL('../../dist/workspace/manifest.json', import.meta.url), JSON.stringify({ schema: 'connected-research.workspace.v1', version: '1.6.0', files, sourceHashes }, null, 2) + '\n')
console.log(JSON.stringify({ workspace: files }))
