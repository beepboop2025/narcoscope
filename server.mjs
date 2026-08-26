import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import mcpHandler from './api/mcp.mjs'
import v1Handler from './api/v1.mjs'
import { loadVerifiedPalimpsestBriArtifact } from './api/lib/palimpsest-bri.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_DIST = resolve(ROOT, 'dist')
const MAX_BODY_BYTES = 256 * 1024
const COMMIT_RE = /^[0-9a-f]{40}$/

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
})

function setBaseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(req, res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload) + '\n')
  setBaseHeaders(res)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', String(body.length))
  res.end(req.method === 'HEAD' ? undefined : body)
}

async function readBoundedBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function apiQuery(requestUrl, resourceFromPath) {
  return {
    resource: resourceFromPath || requestUrl.searchParams.get('resource') || undefined,
    limit: requestUrl.searchParams.get('limit') || undefined,
    slug: requestUrl.searchParams.get('slug') || undefined,
    artifact: requestUrl.searchParams.get('artifact') || undefined,
  }
}

async function serveStatic(req, res, requestUrl, distDir) {
  let decodedPath
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname)
  } catch {
    sendJson(req, res, 400, { ok: false, error: 'invalid_path' })
    return
  }

  if (decodedPath.includes('\0')) {
    sendJson(req, res, 400, { ok: false, error: 'invalid_path' })
    return
  }

  let relativePath = decodedPath.replace(/^\/+/, '')
  if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html'
  let candidate = resolve(distDir, relativePath)
  const allowedPrefix = distDir.endsWith(sep) ? distDir : distDir + sep
  if (candidate !== distDir && !candidate.startsWith(allowedPrefix)) {
    sendJson(req, res, 404, { ok: false, error: 'not_found' })
    return
  }

  let fileStat
  try {
    fileStat = await stat(candidate)
    if (fileStat.isDirectory()) {
      candidate = resolve(candidate, 'index.html')
      fileStat = await stat(candidate)
    }
  } catch {
    if (extname(relativePath)) {
      sendJson(req, res, 404, { ok: false, error: 'not_found' })
      return
    }
    candidate = resolve(distDir, 'index.html')
    fileStat = await stat(candidate)
  }

  if (!fileStat.isFile()) {
    sendJson(req, res, 404, { ok: false, error: 'not_found' })
    return
  }

  const extension = extname(candidate).toLowerCase()
  const immutableAsset = relativePath.startsWith('assets/') && /-[A-Za-z0-9_-]{8,}\./.test(relativePath)
  setBaseHeaders(res)
  res.statusCode = 200
  res.setHeader('Content-Type', CONTENT_TYPES[extension] || 'application/octet-stream')
  res.setHeader('Content-Length', String(fileStat.size))
  res.setHeader(
    'Cache-Control',
    immutableAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=60, stale-while-revalidate=300',
  )
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  await pipeline(createReadStream(candidate), res)
}

async function route(req, res, distDir, briLoader) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const pathname = requestUrl.pathname

  if (pathname === '/livez') {
    sendJson(req, res, 200, { status: 'alive', service: 'narcoscope' })
    return
  }

  if (pathname === '/healthz') {
    const revision = process.env.NARCOSCOPE_REVISION || ''
    const revisionValid = COMMIT_RE.test(revision)
    let briArtifactVerified = false
    if (revisionValid) {
      try {
        const [packaged, served] = await Promise.all([
          briLoader(),
          briLoader({ dataDir: resolve(distDir, 'data') }),
        ])
        if (!packaged.artifactRaw.equals(served.artifactRaw)
          || packaged.artifactSha256 !== served.artifactSha256
          || !packaged.schemaRaw.equals(served.schemaRaw)) {
          throw new Error('served Palimpsest BRI bytes differ from the verified packaged artifact')
        }
        briArtifactVerified = true
      } catch {
        briArtifactVerified = false
      }
    }
    const ready = revisionValid && briArtifactVerified
    sendJson(req, res, ready ? 200 : 503, {
      status: ready ? 'ready' : 'unavailable',
      service: 'narcoscope',
      revision: revisionValid ? revision : null,
      briArtifact: briArtifactVerified ? 'verified' : 'unavailable',
    })
    return
  }

  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
    const resourceFromPath = pathname.startsWith('/api/v1/')
      ? pathname.slice('/api/v1/'.length)
      : undefined
    req.query = apiQuery(requestUrl, resourceFromPath)
    await v1Handler(req, res)
    return
  }

  if (pathname === '/mcp' || pathname === '/api/mcp') {
    if (req.method === 'POST' && req.body === undefined) {
      try {
        req.body = await readBoundedBody(req)
      } catch (error) {
        sendJson(req, res, error.statusCode || 400, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Request body too large' },
        })
        return
      }
    }
    await mcpHandler(req, res)
    return
  }

  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, HEAD')
    sendJson(req, res, 405, { ok: false, error: 'method_not_allowed' })
    return
  }
  await serveStatic(req, res, requestUrl, distDir)
}

export function createNarcoscopeServer({
  distDir = DEFAULT_DIST,
  briLoader = loadVerifiedPalimpsestBriArtifact,
} = {}) {
  const resolvedDist = resolve(distDir)
  return createServer((req, res) => {
    route(req, res, resolvedDist, briLoader).catch((error) => {
      console.error('narcoscope request failed', error)
      if (!res.headersSent) {
        sendJson(req, res, 500, { ok: false, error: 'internal_error' })
      } else {
        res.destroy()
      }
    })
  })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || '3000', 10)
  const server = createNarcoscopeServer()
  server.listen(port, '0.0.0.0', () => {
    console.log('NarcoScope listening on port ' + port)
  })
  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
