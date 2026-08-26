import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const SITE_URL = (process.env.NARCOSCOPE_SITE_URL ||
  'https://narcoscope.com').replace(/\/$/, '')

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MAX_LIMIT = 25
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const PUBLIC_FILES = Object.freeze({
  overview: 'src/data/overview.json',
  newsroom: 'public/news/index.json',
  newsroomManifest: 'public/news/manifest.json',
  palimpsestBridge: 'public/data/narcoscope-palimpsest-v1.json',
  palimpsestCorridors: 'public/data/narcoscope-palimpsest-corridors-v2.json',
  palimpsestBri: 'public/data/narcoscope-palimpsest-bri-v1.json',
})

async function readJson(relativePath) {
  const payload = await readFile(`${ROOT}/${relativePath}`, 'utf8')
  return JSON.parse(payload)
}

function boundedLimit(value, fallback = 10) {
  const parsed = Number.parseInt(String(value ?? fallback), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(parsed, MAX_LIMIT))
}

export function capabilities() {
  return {
    schema: 'narcoscope.capabilities.v1',
    product: {
      name: 'NarcoScope',
      url: SITE_URL,
      promise: 'Turn official drug-market records into evidence you can inspect, cite, and challenge.',
      audience: ['journalists', 'researchers', 'policy teams', 'public-interest investigators'],
    },
    featured: [
      {
        id: 'evidence-newsroom',
        title: 'Evidence Newsroom',
        outcome: 'Read bounded analyses with sentence-level citations, correction history, and explicit abstentions.',
        url: `${SITE_URL}/#newsroom`,
      },
      {
        id: 'official-data-explorer',
        title: 'Official Data Explorer',
        outcome: 'Compare prices, seizures, wastewater, mortality, and public designations without hiding provenance gaps.',
        url: SITE_URL,
      },
      {
        id: 'palimpsest-bridge',
        title: 'Palimpsest Intelligence Commons bridge',
        outcome: 'Use a public, aggregate China record whose claim and disclosure boundaries are machine-readable.',
        url: `${SITE_URL}/data/narcoscope-palimpsest-v1.json`,
      },
      {
        id: 'palimpsest-corridors',
        title: 'China-Pakistan-Myanmar evidence overlay',
        outcome: 'Use official country aggregates with a geography-and-time-only join contract and explicit missing-data states.',
        url: `${SITE_URL}/data/narcoscope-palimpsest-corridors-v2.json`,
      },
      {
        id: 'palimpsest-bri-context',
        title: 'Palimpsest Belt and Road context',
        outcome: 'Inspect source readiness and national economic coverage for CPEC, Gwadar, CMEC, Kyaukpyu, and Balochistan in a parallel lane that cannot enter drug-market inference.',
        url: `${SITE_URL}/data/narcoscope-palimpsest-bri-v1.json`,
      },
    ],
    api: {
      base_url: `${SITE_URL}/api/v1`,
      openapi: `${SITE_URL}/openapi.json`,
      resources: ['capabilities', 'overview', 'newsroom', 'story', 'palimpsest-bridge', 'palimpsest-corridors', 'palimpsest-bri'],
    },
    mcp: {
      endpoint: `${SITE_URL}/mcp`,
      transport: 'streamable-http',
      tools: ['list_capabilities', 'get_overview', 'get_newsroom', 'get_story', 'get_palimpsest_bridge', 'get_palimpsest_corridors', 'get_palimpsest_bri_context'],
    },
    feeds: {
      json: `${SITE_URL}/news/feed.json`,
      atom: `${SITE_URL}/news/feed.xml`,
    },
    boundaries: [
      'Aggregate, published statistics only.',
      'No point-of-sale, real-time, sub-street, navigable, synthesis-route, or yield information.',
      'Administrative seizures do not measure trafficking volume without independent modalities.',
      'Origin labels and public designations are attributed records, not adjudications of guilt or causal proof.',
      'Illustrative datasets remain labelled and are excluded from official-only bridge artifacts.',
      'Belt and Road context is a separate source-readiness and national-economic lane; no drug-conflict-infrastructure causal join, actor classification, bilateral route inference, guilt inference, or political-movement classification is permitted.',
    ],
  }
}

export async function getOverview() {
  const source = await readJson(PUBLIC_FILES.overview)
  return {
    schema: 'narcoscope.api.overview.v1',
    generated_at: source.meta?.generated ?? null,
    note: source.meta?.note ?? null,
    headline: source.headline ?? {},
    overdose_by_substance: source.overdoseBySubstance ?? [],
    top_seizure_countries: (source.topSeizureCountries ?? []).slice(0, 10),
    designation_programs: source.designationsByProgram ?? [],
    divergences: source.divergences ?? [],
    interpretation: [
      'These are descriptive public-data aggregates, not a live illicit-market estimate.',
      'Read seizures beside independent harm and consumption modalities before inferring market movement.',
    ],
  }
}

export async function getNewsroom({ limit } = {}) {
  const [index, manifest] = await Promise.all([
    readJson(PUBLIC_FILES.newsroom),
    readJson(PUBLIC_FILES.newsroomManifest),
  ])
  const receipt = manifest.verificationReceipt ?? {}
  return {
    schema: 'narcoscope.api.newsroom.v1',
    generated_at: index.generatedAt ?? manifest.generatedAt ?? null,
    title: index.title,
    articles: (index.articles ?? []).slice(0, boundedLimit(limit)).map((article) => ({
      ...article,
      htmlUrl: new URL(article.htmlUrl, SITE_URL).toString(),
      dossierUrl: new URL(article.dossierUrl, SITE_URL).toString(),
      machineBriefUrl: new URL(article.machineBriefUrl, SITE_URL).toString(),
    })),
    feeds: {
      json: new URL(index.feeds?.json ?? '/news/feed.json', SITE_URL).toString(),
      atom: new URL(index.feeds?.atom ?? '/news/feed.xml', SITE_URL).toString(),
    },
    verification: {
      pipeline_version: manifest.pipelineVersion ?? null,
      gates: manifest.gates ?? null,
      citation_coverage: receipt.citationCoverage ?? null,
      visual_citation_coverage: receipt.visualCitationCoverage ?? null,
      source_inventory: receipt.sourceInventory ?? null,
      banned_claim_matches: receipt.safetyEvaluation?.bannedClaimMatchCount ?? null,
    },
  }
}

export async function getStory({ slug, artifact = 'machine-brief' } = {}) {
  if (!SLUG_RE.test(String(slug ?? ''))) {
    throw new TypeError('slug must contain lowercase letters, numbers, and single hyphens')
  }
  const index = await readJson(PUBLIC_FILES.newsroom)
  const article = (index.articles ?? []).find((candidate) => candidate.slug === slug)
  if (!article) throw new RangeError(`unknown newsroom story: ${slug}`)

  const artifacts = {
    metadata: null,
    dossier: `public/news/${slug}.dossier.json`,
    'machine-brief': `public/news/${slug}.machine-brief.json`,
  }
  if (!Object.hasOwn(artifacts, artifact)) {
    throw new TypeError('artifact must be metadata, dossier, or machine-brief')
  }
  return {
    schema: 'narcoscope.api.story.v1',
    artifact,
    article: {
      ...article,
      htmlUrl: new URL(article.htmlUrl, SITE_URL).toString(),
      dossierUrl: new URL(article.dossierUrl, SITE_URL).toString(),
      machineBriefUrl: new URL(article.machineBriefUrl, SITE_URL).toString(),
    },
    content: artifacts[artifact] ? await readJson(artifacts[artifact]) : null,
  }
}

export async function getPalimpsestBridge() {
  const bridge = await readJson(PUBLIC_FILES.palimpsestBridge)
  return {
    ...bridge,
    canonicalUrl: `${SITE_URL}/data/narcoscope-palimpsest-v1.json`,
    interpretation: 'Public aggregate context only; this artifact cannot establish a causal chain or guilt.',
  }
}

export async function getPalimpsestCorridors() {
  const bridge = await readJson(PUBLIC_FILES.palimpsestCorridors)
  return {
    ...bridge,
    canonicalUrl: `${SITE_URL}/data/narcoscope-palimpsest-corridors-v2.json`,
    interpretation: 'Official country-level context only. Join by geography and time; never infer an actor relationship, political classification, bilateral route, guilt, or causality.',
  }
}

export async function getPalimpsestBriContext() {
  const context = await readJson(PUBLIC_FILES.palimpsestBri)
  return {
    ...context,
    canonicalUrl: `${SITE_URL}/data/narcoscope-palimpsest-bri-v1.json`,
    hashUrl: `${SITE_URL}/data/narcoscope-palimpsest-bri-v1.json.sha256`,
    interpretation: 'Parallel Palimpsest source-readiness and national-economic context only. It must never be mixed into NarcoScope drug-market inference, actor classification, bilateral route inference, guilt, political classification, or causal claims.',
  }
}

export async function resource(name, params = {}) {
  switch (name) {
    case 'capabilities': return capabilities()
    case 'overview': return getOverview()
    case 'newsroom': return getNewsroom(params)
    case 'story': return getStory(params)
    case 'palimpsest-bridge': return getPalimpsestBridge()
    case 'palimpsest-corridors': return getPalimpsestCorridors()
    case 'palimpsest-bri': return getPalimpsestBriContext()
    default: throw new RangeError(`unknown resource: ${name}`)
  }
}
