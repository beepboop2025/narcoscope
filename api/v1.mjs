import { resource, SITE_URL } from './lib/narcoscope.mjs'

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
const API_CATALOG_URL = `${SITE_URL}/.well-known/api-catalog`

function headers(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type')
  res.setHeader('Cache-Control', CACHE)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Link', `<${API_CATALOG_URL}>; rel="api-catalog"; type="application/linkset+json"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

function send(res, status, payload, head = false) {
  headers(res)
  res.statusCode = status
  res.end(head ? '' : `${JSON.stringify(payload)}\n`)
}

export function createV1Handler(dependencies = {}) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') {
      headers(res)
      res.statusCode = 204
      res.end()
      return
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS')
      send(res, 405, {
        ok: false,
        error: 'method_not_allowed',
        message: 'Use GET or HEAD for NarcoScope public resources.',
      })
      return
    }

    const requestUrl = new URL(req.url, 'https://narcoscope.invalid')
    const name = String(req.query?.resource ?? requestUrl.searchParams.get('resource') ?? 'capabilities')
    const params = {
      limit: req.query?.limit ?? requestUrl.searchParams.get('limit'),
      slug: req.query?.slug ?? requestUrl.searchParams.get('slug'),
      artifact: req.query?.artifact ?? requestUrl.searchParams.get('artifact'),
    }
    try {
      const data = await resource(name, params, dependencies)
      send(res, 200, { ok: true, resource: name, data }, req.method === 'HEAD')
    } catch (error) {
      const clientError = error instanceof TypeError || error instanceof RangeError
      send(res, clientError ? 400 : 500, {
        ok: false,
        error: clientError ? 'invalid_request' : 'internal_error',
        message: clientError ? error.message : 'NarcoScope could not read the published artifact.',
      }, req.method === 'HEAD')
    }
  }
}

export default createV1Handler()
