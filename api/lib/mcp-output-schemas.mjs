import palimpsestBridgeSchema from '../../public/data/narcoscope-palimpsest-v1.schema.json' with { type: 'json' }
import palimpsestCorridorsSchema from '../../public/data/narcoscope-palimpsest-corridors-v2.schema.json' with { type: 'json' }

const HTTPS_URI = Object.freeze({ type: 'string', format: 'uri', pattern: '^https://' })
const NON_EMPTY_STRING = Object.freeze({ type: 'string', minLength: 1 })
const NULLABLE_STRING = Object.freeze({ type: ['string', 'null'] })
const NULLABLE_JSON_OBJECT = Object.freeze({ type: ['object', 'null'], additionalProperties: true })

const STRING_ARRAY = Object.freeze({
  type: 'array',
  items: NON_EMPTY_STRING,
})

const ARTICLE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'slug',
    'title',
    'dek',
    'contentClass',
    'dataAsOf',
    'publishedAt',
    'updatedAt',
    'htmlUrl',
    'dossierUrl',
    'machineBriefUrl',
    'revisionHash',
    'contentHash',
    'automationDisclosure',
    'humanReviewStatus',
    'correctionsStatus',
    'rightToReplyStatus',
    'testimonyIncluded',
    'simulatedHumanVoicesIncluded',
  ],
  properties: {
    id: NON_EMPTY_STRING,
    slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    title: NON_EMPTY_STRING,
    dek: NON_EMPTY_STRING,
    contentClass: NON_EMPTY_STRING,
    dataAsOf: { type: ['string', 'null'], format: 'date' },
    publishedAt: { type: ['string', 'null'], format: 'date-time' },
    updatedAt: { type: ['string', 'null'], format: 'date-time' },
    htmlUrl: HTTPS_URI,
    dossierUrl: HTTPS_URI,
    machineBriefUrl: HTTPS_URI,
    revisionHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    automationDisclosure: NON_EMPTY_STRING,
    humanReviewStatus: NON_EMPTY_STRING,
    correctionsStatus: NON_EMPTY_STRING,
    rightToReplyStatus: NON_EMPTY_STRING,
    testimonyIncluded: { type: 'boolean' },
    simulatedHumanVoicesIncluded: { type: 'boolean' },
  },
})

export const CAPABILITIES_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'product', 'featured', 'api', 'mcp', 'feeds', 'boundaries'],
  properties: {
    schema: { const: 'narcoscope.capabilities.v1' },
    product: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'url', 'promise', 'audience'],
      properties: {
        name: { const: 'NarcoScope' },
        url: HTTPS_URI,
        promise: NON_EMPTY_STRING,
        audience: STRING_ARRAY,
      },
    },
    featured: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'outcome', 'url'],
        properties: {
          id: NON_EMPTY_STRING,
          title: NON_EMPTY_STRING,
          outcome: NON_EMPTY_STRING,
          url: HTTPS_URI,
        },
      },
    },
    api: {
      type: 'object',
      additionalProperties: false,
      required: ['base_url', 'openapi', 'resources'],
      properties: {
        base_url: HTTPS_URI,
        openapi: HTTPS_URI,
        resources: STRING_ARRAY,
      },
    },
    mcp: {
      type: 'object',
      additionalProperties: false,
      required: [
        'endpoint',
        'transport',
        'current_protocol',
        'protocol_versions',
        'lifecycle',
        'discovery_method',
        'legacy_initialization',
        'tools',
      ],
      properties: {
        endpoint: HTTPS_URI,
        transport: { const: 'streamable-http' },
        current_protocol: { const: '2026-07-28' },
        protocol_versions: {
          type: 'array',
          prefixItems: [
            { const: '2026-07-28' },
            { const: '2025-06-18' },
            { const: '2025-03-26' },
          ],
          minItems: 3,
          maxItems: 3,
        },
        lifecycle: { const: 'stateless-per-request' },
        discovery_method: { const: 'server/discover' },
        legacy_initialization: { const: true },
        tools: STRING_ARRAY,
      },
    },
    feeds: {
      type: 'object',
      additionalProperties: false,
      required: ['json', 'atom'],
      properties: { json: HTTPS_URI, atom: HTTPS_URI },
    },
    boundaries: { ...STRING_ARRAY, minItems: 1 },
  },
})

export const OVERVIEW_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema',
    'generated_at',
    'note',
    'headline',
    'overdose_by_substance',
    'top_seizure_countries',
    'designation_programs',
    'divergences',
    'interpretation',
  ],
  properties: {
    schema: { const: 'narcoscope.api.overview.v1' },
    generated_at: { type: ['string', 'null'], format: 'date' },
    note: NULLABLE_STRING,
    headline: {
      type: 'object',
      additionalProperties: false,
      required: [
        'usOverdoseLatest', 'usOverdoseYoY', 'usOverdoseYear', 'usOverdoseWindow',
        'worldSeizureTonnes', 'seizureYear', 'designations', 'seizureCountries',
        'wastewaterCities',
      ],
      properties: {
        usOverdoseLatest: { type: ['integer', 'null'], minimum: 0 },
        usOverdoseYoY: { type: ['number', 'null'] },
        usOverdoseYear: { type: ['integer', 'null'], minimum: 1900 },
        usOverdoseWindow: NULLABLE_STRING,
        worldSeizureTonnes: { type: ['number', 'null'], minimum: 0 },
        seizureYear: { type: ['integer', 'null'], minimum: 1900 },
        designations: { type: ['integer', 'null'], minimum: 0 },
        seizureCountries: { type: ['integer', 'null'], minimum: 0 },
        wastewaterCities: { type: ['integer', 'null'], minimum: 0 },
      },
    },
    overdose_by_substance: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['substance', 'label', 'deaths', 'yoy'],
        properties: {
          substance: NON_EMPTY_STRING,
          label: NON_EMPTY_STRING,
          deaths: { type: ['integer', 'null'], minimum: 0 },
          yoy: { type: ['number', 'null'] },
        },
      },
    },
    top_seizure_countries: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['iso3', 'name', 'kg'],
        properties: {
          iso3: { type: 'string', pattern: '^[A-Z]{3}$' },
          name: NON_EMPTY_STRING,
          kg: { type: 'number', minimum: 0 },
        },
      },
    },
    designation_programs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'label', 'count'],
        properties: {
          code: NON_EMPTY_STRING,
          label: NON_EMPTY_STRING,
          count: { type: 'integer', minimum: 0 },
        },
      },
    },
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'window', 'supplyLabel', 'supplyPct', 'demandLabel', 'demandPct', 'reading'],
        properties: {
          label: NON_EMPTY_STRING,
          window: NON_EMPTY_STRING,
          supplyLabel: NON_EMPTY_STRING,
          supplyPct: { type: 'number' },
          demandLabel: NON_EMPTY_STRING,
          demandPct: { type: 'number' },
          reading: NON_EMPTY_STRING,
        },
      },
    },
    interpretation: { ...STRING_ARRAY, minItems: 1 },
  },
})

export const NEWSROOM_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'generated_at', 'title', 'articles', 'feeds', 'verification'],
  properties: {
    schema: { const: 'narcoscope.api.newsroom.v1' },
    generated_at: { type: ['string', 'null'], format: 'date-time' },
    title: NON_EMPTY_STRING,
    articles: { type: 'array', maxItems: 25, items: ARTICLE_SCHEMA },
    feeds: {
      type: 'object',
      additionalProperties: false,
      required: ['json', 'atom'],
      properties: { json: HTTPS_URI, atom: HTTPS_URI },
    },
    verification: {
      type: 'object',
      additionalProperties: false,
      required: [
        'pipeline_version', 'gates', 'citation_coverage', 'visual_citation_coverage',
        'source_inventory', 'banned_claim_matches',
      ],
      properties: {
        pipeline_version: NULLABLE_STRING,
        gates: {
          type: ['array', 'null'],
          items: { type: 'object', additionalProperties: true },
        },
        citation_coverage: NULLABLE_JSON_OBJECT,
        visual_citation_coverage: NULLABLE_JSON_OBJECT,
        source_inventory: NULLABLE_JSON_OBJECT,
        banned_claim_matches: { type: ['integer', 'null'], minimum: 0 },
      },
    },
  },
})

export const STORY_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'artifact', 'article', 'content'],
  properties: {
    schema: { const: 'narcoscope.api.story.v1' },
    artifact: { enum: ['metadata', 'machine-brief', 'dossier'] },
    article: ARTICLE_SCHEMA,
    content: NULLABLE_JSON_OBJECT,
  },
})

function normalizeStrictObjectSchemas(value) {
  if (Array.isArray(value)) return value.map(normalizeStrictObjectSchemas)
  if (!value || typeof value !== 'object') return value
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeStrictObjectSchemas(child)]),
  )
  if (!normalized.type && (
    Object.hasOwn(normalized, 'properties')
    || Object.hasOwn(normalized, 'required')
    || Object.hasOwn(normalized, 'additionalProperties')
  )) {
    normalized.type = 'object'
  }
  return normalized
}

function extendArtifactSchema(schema, id) {
  const normalized = normalizeStrictObjectSchemas(schema)
  return Object.freeze({
    ...normalized,
    $id: id,
    required: [...normalized.required, 'canonicalUrl', 'interpretation'],
    properties: {
      ...normalized.properties,
      canonicalUrl: HTTPS_URI,
      interpretation: NON_EMPTY_STRING,
    },
  })
}

export const PALIMPSEST_BRIDGE_OUTPUT_SCHEMA = extendArtifactSchema(
  palimpsestBridgeSchema,
  'urn:narcoscope:mcp-output:palimpsest-bridge:v1',
)

export const PALIMPSEST_CORRIDORS_OUTPUT_SCHEMA = extendArtifactSchema(
  palimpsestCorridorsSchema,
  'urn:narcoscope:mcp-output:palimpsest-corridors:v2',
)

export const TOOL_OUTPUT_SCHEMAS = Object.freeze({
  list_capabilities: CAPABILITIES_OUTPUT_SCHEMA,
  get_overview: OVERVIEW_OUTPUT_SCHEMA,
  get_newsroom: NEWSROOM_OUTPUT_SCHEMA,
  get_story: STORY_OUTPUT_SCHEMA,
  get_palimpsest_bridge: PALIMPSEST_BRIDGE_OUTPUT_SCHEMA,
  get_palimpsest_corridors: PALIMPSEST_CORRIDORS_OUTPUT_SCHEMA,
})
