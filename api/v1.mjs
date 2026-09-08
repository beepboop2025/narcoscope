import { gzipSync } from 'node:zlib'
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

function sendResponse(res, status, payload, head = false, encoding = '') {
  headers(res)
  res.statusCode = status
  const acceptsGzip = String(encoding).split(',').some(part => {
    const [name, quality] = part.trim().split(';')
    return name === 'gzip' && (!quality || /^q=(?:1(?:\.0*)?|0?\.[0-9]*[1-9][0-9]*)$/.test(quality.trim()))
  })
  const raw = Buffer.from(`${JSON.stringify(payload)}\n`)
  const body = acceptsGzip && raw.length >= 1024 ? gzipSync(raw, { level: 4 }) : raw
  res.setHeader('Vary', 'Accept-Encoding')
  if (body !== raw) res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Content-Length', String(body.length))
  res.end(head ? '' : body === raw ? raw.toString() : body)

}

export function createV1Handler(dependencies = {}) {
  return async function handler(req, res) {
    const send = (res, status, payload, head = false) => sendResponse(res, status, payload, head, req.headers?.['accept-encoding'])
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
    let params = {
      country: req.query?.country ?? requestUrl.searchParams.get('country'),
      cursor: req.query?.cursor ?? requestUrl.searchParams.get('cursor'),
      domain: req.query?.domain ?? requestUrl.searchParams.get('domain'),
      entity_type: req.query?.entity_type ?? requestUrl.searchParams.get('entity_type'),
      iso3: req.query?.iso3 ?? requestUrl.searchParams.get('iso3'),
      lane: req.query?.lane ?? requestUrl.searchParams.get('lane'),
      limit: req.query?.limit ?? requestUrl.searchParams.get('limit'),
      program: req.query?.program ?? requestUrl.searchParams.get('program'),
      query: req.query?.query ?? requestUrl.searchParams.get('query'),
      slug: req.query?.slug ?? requestUrl.searchParams.get('slug'),
      artifact: req.query?.artifact ?? requestUrl.searchParams.get('artifact'),
      year: req.query?.year ?? requestUrl.searchParams.get('year'),
    }
    try {
      if (['markets', 'market-observations', 'research-network'].includes(name)) {
        const allowed = new Set(name === 'research-network' ? ['topic', 'offset', 'limit'] : name === 'markets' ? [] : ['dataset', 'indicator', 'geo', 'category', 'subgroup', 'from', 'to', 'page', 'limit'])
        params = {}
        for (const key of new Set([...requestUrl.searchParams.keys(), ...Object.keys(req.query ?? {})])) {
          if (key === 'resource') continue
          if (!allowed.has(key)) throw new TypeError(`Unknown market query parameter: ${key}`)
          if (requestUrl.searchParams.getAll(key).length > 1 || Array.isArray(req.query?.[key])) throw new TypeError(`Duplicate market query parameter: ${key}`)
          params[key] = req.query?.[key] ?? requestUrl.searchParams.get(key)
        }
      }
      const data = await resource(name, params, dependencies)
      if (data?.status === 'unavailable') {
        send(res, 503, {
          ok: false,
          resource: name,
          error: 'unavailable',
          message: 'The requested evidence is unavailable; absence is not zero coverage.',
          data,
        }, req.method === 'HEAD')
        return
      }
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
