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

const NULLABLE_HTTPS_URI = Object.freeze({
  oneOf: [HTTPS_URI, { type: 'null' }],
})

const PAGE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['limit', 'matched', 'returned', 'has_more', 'next_cursor'],
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    matched: { type: 'integer', minimum: 0 },
    returned: { type: 'integer', minimum: 0, maximum: 100 },
    has_more: { type: 'boolean' },
    next_cursor: { type: ['string', 'null'], pattern: '^[A-Za-z0-9_-]+$', maxLength: 2048 },
  },
})

const SOURCE_ERROR_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: NON_EMPTY_STRING,
        message: NON_EMPTY_STRING,
      },
    },
  ],
})

const SCORE = Object.freeze({ type: ['number', 'null'], minimum: 1, maximum: 10 })
const SCORE_OBJECT = (fields) => Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: fields,
  properties: Object.fromEntries(fields.map((field) => [field, SCORE])),
})

const ORGANIZED_MARKETS_SCHEMA = SCORE_OBJECT([
  'humanTrafficking',
  'humanSmuggling',
  'extortion',
  'armsTrafficking',
  'counterfeitGoods',
  'illicitTradeExcisableGoods',
  'floraCrimes',
  'faunaCrimes',
  'nonRenewableResourceCrimes',
  'heroinTrade',
  'cocaineTrade',
  'cannabisTrade',
  'syntheticDrugTrade',
  'cyberDependentCrimes',
  'financialCrimes',
])

const ORGANIZED_ACTORS_SCHEMA = SCORE_OBJECT([
  'average',
  'mafiaStyleGroups',
  'criminalNetworks',
  'stateEmbeddedActors',
  'foreignActors',
  'privateSectorActors',
])

const ORGANIZED_RESILIENCE_SCHEMA = SCORE_OBJECT([
  'average',
  'politicalLeadershipAndGovernance',
  'governmentTransparencyAndAccountability',
  'internationalCooperation',
  'nationalPoliciesAndLaws',
  'judicialSystemAndDetention',
  'lawEnforcement',
  'territorialIntegrity',
  'antiMoneyLaundering',
  'economicRegulatoryCapacity',
  'victimAndWitnessSupport',
  'prevention',
  'nonStateActors',
])

const ATLAS_RECORD_META_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'availability', 'unavailable_fields', 'source_schema', 'source', 'source_url',
    'downloaded_at', 'rights', 'caveats',
  ],
  properties: {
    availability: { enum: ['observed', 'partial'] },
    unavailable_fields: { type: 'array', uniqueItems: true, items: NON_EMPTY_STRING },
    source_schema: NON_EMPTY_STRING,
    source: NON_EMPTY_STRING,
    source_url: HTTPS_URI,
    downloaded_at: NON_EMPTY_STRING,
    rights: NON_EMPTY_STRING,
    caveats: STRING_ARRAY,
  },
})

const ORGANIZED_CRIME_RECORD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'meta', 'data'],
  properties: {
    domain: { const: 'organized_crime' },
    meta: ATLAS_RECORD_META_SCHEMA,
    data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'iso3', 'country', 'continent', 'region', 'year', 'criminality', 'criminalMarkets',
        'markets', 'actors', 'resilience',
      ],
      properties: {
        iso3: { type: 'string', pattern: '^[A-Z]{3}$' },
        country: NON_EMPTY_STRING,
        continent: NON_EMPTY_STRING,
        region: NON_EMPTY_STRING,
        year: { type: 'integer', minimum: 1900, maximum: 2200 },
        criminality: SCORE,
        criminalMarkets: SCORE,
        markets: ORGANIZED_MARKETS_SCHEMA,
        actors: ORGANIZED_ACTORS_SCHEMA,
        resilience: ORGANIZED_RESILIENCE_SCHEMA,
      },
    },
  },
})

const FIREARMS_RECORD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'meta', 'data'],
  properties: {
    domain: { const: 'firearms_tracing' },
    meta: ATLAS_RECORD_META_SCHEMA,
    data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'iso3', 'country', 'm49', 'year', 'valuePercent', 'nature', 'source', 'reportingType', 'footnotes',
      ],
      properties: {
        iso3: { type: 'string', pattern: '^[A-Z]{3}$' },
        country: NON_EMPTY_STRING,
        m49: { type: 'string', pattern: '^[0-9]{1,3}$' },
        year: { type: 'integer', minimum: 1900, maximum: 2200 },
        valuePercent: { type: ['number', 'null'], minimum: 0, maximum: 100 },
        nature: NON_EMPTY_STRING,
        source: NON_EMPTY_STRING,
        reportingType: NON_EMPTY_STRING,
        footnotes: STRING_ARRAY,
      },
    },
  },
})

const ATLAS_SOURCE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'status', 'record_count', 'metadata', 'error'],
  properties: {
    domain: { enum: ['firearms_tracing', 'organized_crime'] },
    status: { enum: ['available', 'unavailable'] },
    record_count: { type: ['integer', 'null'], minimum: 0 },
    metadata: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'schema_version', 'source', 'source_url', 'downloaded_at', 'years', 'unit',
            'rights', 'scale', 'series', 'release', 'caveats',
          ],
          properties: {
            schema_version: NON_EMPTY_STRING,
            source: NON_EMPTY_STRING,
            source_url: HTTPS_URI,
            downloaded_at: NON_EMPTY_STRING,
            years: {
              type: 'array',
              uniqueItems: true,
              items: { type: 'integer', minimum: 1900, maximum: 2200 },
            },
            unit: NON_EMPTY_STRING,
            rights: NON_EMPTY_STRING,
            scale: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['minimum', 'maximum', 'direction'],
                  properties: {
                    minimum: { const: 1 },
                    maximum: { const: 10 },
                    direction: NON_EMPTY_STRING,
                  },
                },
              ],
            },
            series: NULLABLE_STRING,
            release: NULLABLE_STRING,
            caveats: STRING_ARRAY,
          },
        },
      ],
    },
    error: SOURCE_ERROR_SCHEMA,
  },
})

export const ATLAS_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'status', 'query', 'sources', 'page', 'records', 'limitations'],
  properties: {
    schema: { const: 'narcoscope.api.atlas.v1' },
    status: { enum: ['available', 'partial', 'unavailable'] },
    query: {
      type: 'object',
      additionalProperties: false,
      required: ['domain', 'iso3', 'year'],
      properties: {
        domain: { enum: ['all', 'firearms_tracing', 'organized_crime'] },
        iso3: { type: ['string', 'null'], pattern: '^[A-Z]{3}$' },
        year: { type: ['integer', 'null'], minimum: 1900, maximum: 2200 },
      },
    },
    sources: { type: 'array', minItems: 1, maxItems: 2, items: ATLAS_SOURCE_SCHEMA },
    page: PAGE_SCHEMA,
    records: {
      type: 'array',
      maxItems: 100,
      items: { oneOf: [FIREARMS_RECORD_SCHEMA, ORGANIZED_CRIME_RECORD_SCHEMA] },
    },
    limitations: { ...STRING_ARRAY, minItems: 4 },
  },
})

const ENTITIES_SOURCE_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'source_url', 'downloaded_at', 'license', 'grain', 'programs', 'note'],
      properties: {
        source: NON_EMPTY_STRING,
        source_url: HTTPS_URI,
        downloaded_at: NON_EMPTY_STRING,
        license: NON_EMPTY_STRING,
        grain: NON_EMPTY_STRING,
        programs: {
          type: 'object',
          minProperties: 1,
          propertyNames: { enum: ['ILLICIT-DRUGS-EO14059', 'SDNT', 'SDNTK', 'TCO'] },
          additionalProperties: NON_EMPTY_STRING,
        },
        note: NON_EMPTY_STRING,
      },
    },
  ],
})

export const ENTITIES_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema', 'status', 'query', 'source', 'page', 'records', 'disclaimer', 'privacy', 'error',
  ],
  properties: {
    schema: { const: 'narcoscope.api.entities.v1' },
    status: { enum: ['available', 'unavailable'] },
    query: {
      type: 'object',
      additionalProperties: false,
      required: ['entity_type', 'program', 'country', 'query'],
      properties: {
        entity_type: { type: ['string', 'null'], enum: ['aircraft', 'individual', 'organization', 'vessel', null] },
        program: { type: ['string', 'null'], enum: ['ILLICIT-DRUGS-EO14059', 'SDNT', 'SDNTK', 'TCO', null] },
        country: NULLABLE_STRING,
        query: NULLABLE_STRING,
      },
    },
    source: ENTITIES_SOURCE_SCHEMA,
    page: PAGE_SCHEMA,
    records: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ofac_entity_number', 'name', 'entity_type', 'programs', 'countries', 'meta'],
        properties: {
          ofac_entity_number: { type: 'integer', minimum: 1 },
          name: NON_EMPTY_STRING,
          entity_type: { enum: ['aircraft', 'individual', 'organization', 'vessel'] },
          programs: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: ['ILLICIT-DRUGS-EO14059', 'SDNT', 'SDNTK', 'TCO'] },
          },
          countries: STRING_ARRAY,
          meta: {
            type: 'object',
            additionalProperties: false,
            required: ['evidence_class', 'adjudication', 'source', 'source_url', 'downloaded_at'],
            properties: {
              evidence_class: { const: 'administrative_action' },
              adjudication: { const: false },
              source: NON_EMPTY_STRING,
              source_url: HTTPS_URI,
              downloaded_at: NON_EMPTY_STRING,
            },
          },
        },
      },
    },
    disclaimer: NON_EMPTY_STRING,
    privacy: {
      type: 'object',
      additionalProperties: false,
      required: ['returned_fields', 'withheld_fields', 'query_scope'],
      properties: {
        returned_fields: { ...STRING_ARRAY, minItems: 5 },
        withheld_fields: { ...STRING_ARRAY, minItems: 5 },
        query_scope: NON_EMPTY_STRING,
      },
    },
    error: SOURCE_ERROR_SCHEMA,
  },
})

const FEDERATION_ERROR_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'upstream_http_status', 'retry_after'],
      properties: {
        code: NON_EMPTY_STRING,
        message: NON_EMPTY_STRING,
        upstream_http_status: { type: ['integer', 'null'], minimum: 100, maximum: 599 },
        retry_after: NULLABLE_STRING,
      },
    },
  ],
})

const FEDERATION_LANE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'product', 'availability', 'evidence_status', 'upstream_schema', 'upstream_status',
    'source_url', 'retrieved_at', 'clocks', 'scope', 'citation', 'transport', 'data', 'error',
    'boundaries',
  ],
  properties: {
    id: {
      enum: [
        'palimpsest-bri',
        'palimpsest-newswire-rights',
        'seiche-capital-markets',
        'seiche-global-money-atlas',
        'seiche-money-markets',
        'seiche-summary',
      ],
    },
    product: { enum: ['Palimpsest', 'Seiche'] },
    availability: { enum: ['available', 'restricted', 'unavailable'] },
    evidence_status: { enum: ['derived', 'observed', 'restricted', 'structural', 'unavailable'] },
    upstream_schema: NULLABLE_STRING,
    upstream_status: NULLABLE_STRING,
    source_url: HTTPS_URI,
    retrieved_at: { type: 'string', format: 'date-time' },
    clocks: NULLABLE_JSON_OBJECT,
    scope: NULLABLE_JSON_OBJECT,
    citation: NULLABLE_JSON_OBJECT,
    transport: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['attempts', 'timeout_ms', 'max_response_bytes'],
          properties: {
            attempts: { const: 1 },
            timeout_ms: { type: 'integer', minimum: 1, maximum: 15000 },
            max_response_bytes: { type: 'integer', minimum: 1, maximum: 2000000 },
          },
        },
      ],
    },
    data: NULLABLE_JSON_OBJECT,
    error: FEDERATION_ERROR_SCHEMA,
    boundaries: { ...STRING_ARRAY, minItems: 2 },
  },
})

export const FEDERATION_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'status', 'retrieved_at', 'query', 'lanes', 'policy', 'limitations'],
  properties: {
    schema: { const: 'narcoscope.api.federation.v1' },
    status: { enum: ['available', 'partial', 'unavailable'] },
    retrieved_at: { type: 'string', format: 'date-time' },
    query: {
      type: 'object',
      additionalProperties: false,
      required: ['lane'],
      properties: {
        lane: {
          enum: [
            'all',
            'palimpsest-bri',
            'palimpsest-newswire-rights',
            'seiche-capital-markets',
            'seiche-global-money-atlas',
            'seiche-money-markets',
            'seiche-summary',
          ],
        },
      },
    },
    lanes: { type: 'array', minItems: 1, maxItems: 6, items: FEDERATION_LANE_SCHEMA },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode', 'cross_lane_join', 'composite_generation', 'causal_inference',
        'culpability_inference', 'missing_value_policy',
      ],
      properties: {
        mode: { const: 'read_only_parallel_context' },
        cross_lane_join: { const: 'prohibited' },
        composite_generation: { const: 'prohibited' },
        causal_inference: { const: 'prohibited' },
        culpability_inference: { const: 'prohibited' },
        missing_value_policy: { const: 'unavailable_not_zero' },
      },
    },
    limitations: { ...STRING_ARRAY, minItems: 4 },
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
  get_atlas: ATLAS_OUTPUT_SCHEMA,
  get_entities: ENTITIES_OUTPUT_SCHEMA,
  get_federation: FEDERATION_OUTPUT_SCHEMA,
  get_overview: OVERVIEW_OUTPUT_SCHEMA,
  get_newsroom: NEWSROOM_OUTPUT_SCHEMA,
  get_story: STORY_OUTPUT_SCHEMA,
  get_palimpsest_bridge: PALIMPSEST_BRIDGE_OUTPUT_SCHEMA,
  get_palimpsest_corridors: PALIMPSEST_CORRIDORS_OUTPUT_SCHEMA,
})
