// =============================================================================
// SHARED DOMAIN TYPES
// =============================================================================
// One source of truth for the shape of every record. These mirror exactly what
// ingest.js validates at runtime — so the parser's job is to turn untrusted CSV
// into values that satisfy these types, and everything downstream is type-safe.

/** Finished drugs tracked on the Street Prices tab. */
export type Drug = 'cocaine' | 'heroin' | 'cannabis' | 'methamphetamine'

/** Precursor-chemical classes (identified by end-drug + control status). */
export type PrecursorId =
  | 'fentanyl_precursors'
  | 'meth_precursors'
  | 'meth_pre_precursors'
  | 'heroin_precursors'
  | 'mdma_precursors'
  | 'cocaine_precursors'

/** Drugs that appear in Myanmar cross-border flow records (normalised form). */
export type MyanmarDrug = 'Methamphetamine' | 'Heroin'
export type MyanmarConflictActorType =
  | 'military'
  | 'eao'
  | 'militia'
  | 'resistance'
  | 'criminal'
  | 'state'
  | 'unknown'
export type MyanmarConflictEventType =
  | 'clash'
  | 'airstrike'
  | 'territorial_control'
  | 'ceasefire'
  | 'sanction'
  | 'seizure'
  | 'other'
export type SourceConfidence = 'official' | 'reported' | 'estimated'

export interface DrugMeta { id: Drug; label: string; unit: string }
export interface PrecursorMeta { id: PrecursorId; label: string; endDrug: string; incbScheduled: boolean }
export interface Source { name: string; url: string }
export interface Centroid { lat: number; lng: number }

export interface PriceRecord {
  drug: Drug
  country: string
  iso3: string
  region: string
  year: number
  priceUsdPerGram: number
  purityPct: number | null
}

export interface PrecursorPriceRecord {
  precursor: PrecursorId
  country: string
  iso3: string
  region: string
  year: number
  priceUsdPerKg: number
}

/** How the source qualifies a reported precursor quantity. */
export type QuantityRelation = 'exact' | 'approx' | 'less_than' | 'greater_than'

/** Whether a quantitative row is one incident, an aggregate, or a documented derivation. */
export type FlowRecordKind =
  | 'single_incident'
  | 'multi_incident_aggregate'
  | 'annual_aggregate'
  | 'derived_subtotal'

/** A locator that remains stable when the report is cited outside this application. */
export interface DocumentSourceLocator {
  /** One-based page number in the PDF file. */
  pdfPage: number
  /** Page number printed on the report page. */
  printedPage: number
  paragraph: number
}

export interface FlowRecord {
  precursor: PrecursorId
  origin: string
  transit: string | null
  destination: string
  year: number
  quantityKg: number
  /** Optional for user-imported legacy CSV; required by AuditedFlowRecord. */
  quantityRelation?: QuantityRelation
  /** What the reported kilograms measure, including derivation or gross-weight caveats. */
  quantityBasis?: string
  recordKind?: FlowRecordKind
  /** Null means the source does not allocate an incident count at this row's grain. */
  incidentCount?: number | null
  /** Attribution for the corridor figure (publisher of the seizure/incident report). */
  sourceName?: string
  sourceUrl?: string
  sourceDocumentSha256?: string
  sourceRetrievedAt?: string
  sourceLocator?: DocumentSourceLocator
}

/** Fully sourced curated flow row. Public bridge generation accepts only this shape. */
export interface AuditedFlowRecord extends FlowRecord {
  quantityRelation: QuantityRelation
  quantityBasis: string
  recordKind: FlowRecordKind
  incidentCount: number | null
  sourceName: string
  sourceUrl: string
  sourceDocumentSha256: string
  sourceRetrievedAt: string
  sourceLocator: DocumentSourceLocator
}

/**
 * Source context that cannot safely be represented as a quantitative corridor.
 * It deliberately has no quantity field, so it cannot enter corridor totals.
 */
export interface FlowContextRecord {
  contextId: string
  precursor: PrecursorId
  origins: string[]
  destinations: string[]
  year: number
  recordKind: 'qualitative_context'
  allocationStatus: 'not_reported_by_origin_destination_pair'
  /** Report-wide operation count; never an origin/destination-pair count. */
  operationReportedSeizureCount: number
  countScope: 'four_reporting_countries_operation_total'
  summary: string
  sourceName: string
  sourceUrl: string
  sourceDocumentSha256: string
  sourceRetrievedAt: string
  sourceLocator: DocumentSourceLocator
}

/** A geographic node (Myanmar production region or border corridor town). */
export interface MmNode { id: string; label: string; lat: number; lng: number }

export interface MmRegionRecord {
  region: string
  year: number
  opiumHa: number
  /** Relative 0–100 synthetic-drug activity indicator (constructed, not a volume). */
  methIndex: number
}

export interface MmFlowRecord {
  from: string
  to: string
  year: number
  quantityKg: number
  drug: MyanmarDrug
  /**
   * Attribution for the outbound seizure figure. Optional (unlike conflict
   * events/precursor flows) to stay backward-compatible with pre-existing
   * flow CSVs that predate provenance tracking, but should be populated for
   * any newly ingested outbound-flow record so corridor-concentration and
   * cross-source disagreement checks can run on it.
   */
  sourceName?: string
  sourceUrl?: string
}

export interface MmConflictEventRecord {
  region: string
  year: number
  actor: string
  actorType: MyanmarConflictActorType
  eventType: MyanmarConflictEventType
  /** Relative 0-100 conflict-pressure indicator derived from public event reporting. */
  intensity: number
  sourceName: string
  sourceUrl: string
}

// =============================================================================
// DEMAND-SIDE MODALITIES
// =============================================================================
// Everything above this line is supply-side evidence: seizures, corridors,
// cultivation. All of it is collected BY interdiction agencies, so all of it
// carries the same enforcement-capacity bias — more customs officers produce
// more seizures whether or not more drugs moved. The two record types below
// are measured by entirely different institutions (vital-statistics
// registrars; environmental chemists), which is precisely what makes them
// useful: they can corroborate or contradict the supply story without
// inheriting its bias. See `src/lib/triangulate.ts`.

/**
 * Substance classes in the mortality layer. These are ICD-10 *class codes* as
 * CDC publishes them, not NarcoScope `Drug` ids — the two vocabularies are
 * deliberately kept apart, and any mapping between them is made explicitly in
 * triangulate.ts rather than silently at ingest time.
 */
export type OverdoseSubstance =
  | 'cocaine'
  | 'heroin'
  | 'psychostimulants'
  | 'synthetic_opioids'
  | 'opioids_all'
  | 'all_drugs'

/**
 * One 12-month-ending overdose death count for one jurisdiction, year, and
 * substance class. Counts are provisional: recent periods are incomplete, and
 * `percentComplete` is the gate for whether a reading should be trusted or
 * shown with a caveat.
 */
export interface OverdoseRecord {
  /** CDC jurisdiction code: 'US' for national, two-letter state code, 'YC' for New York City. */
  jurisdiction: string
  year: number
  /** Month the 12-month window ends on. 12 = calendar-year aligned. */
  periodEndMonth: number
  /** True when this is the freshest rolling window rather than a full calendar year. */
  partialYear: boolean
  substance: OverdoseSubstance
  deaths: number
  /** CDC's completeness-adjusted estimate; null when it equals the reported count. */
  predictedDeaths: number | null
  /** Percent of expected death records received for the period. */
  percentComplete: number | null
}

/**
 * Wastewater-based drug load: population-normalised mass of a drug (or its
 * urinary metabolite) measured at a sewage treatment plant.
 *
 * This is the closest thing to a direct CONSUMPTION measure that exists — it
 * is blind to enforcement effort, blind to reporting willingness, and blind
 * to who dies. EUDA/SCORE (Europe) and the ACIC National Wastewater Drug
 * Monitoring Programme (Australia) are the two rigorous programmes.
 *
 * There is deliberately NO bundled wastewater dataset: both publishers block
 * automated collection (EUDA returns 403 to non-browser clients, ACIC ships
 * PDF reports), and inventing plausible-looking numbers to fill a schema is
 * exactly the failure mode this codebase's provenance headers exist to
 * prevent. Load real figures through the CSV panel; until then triangulation
 * reports this modality as absent, which is an honest answer.
 */
export interface WastewaterRecord {
  /** City or catchment name as the publisher reports it. */
  site: string
  country: string
  iso3: string
  year: number
  drug: Drug
  /** Milligrams of drug per 1,000 inhabitants per day — the SCORE/ACIC standard unit. */
  mgPer1000PerDay: number
  /**
   * Months of sampling behind an annual mean. Optional, because most publishers
   * report a single annual figure with no coverage statement — but where it IS
   * known it must be carried, since a mean over six bi-monthly samples and a
   * mean over twelve are not equally strong readings even though both are
   * per-day rates.
   */
  monthsObserved?: number
  sourceName: string
  sourceUrl: string
}

// =============================================================================
// OFFICIAL DESIGNATIONS
// =============================================================================

/** OFAC SDN entity classes, normalised from the upstream file's dialect. */
export type DesignationEntityType = 'individual' | 'organization' | 'vessel' | 'aircraft'

/**
 * One entity on the US Treasury OFAC Specially Designated Nationals list,
 * under a narcotics or transnational-crime authority.
 *
 * A designation is a PUBLISHED GOVERNMENT ACTION — a named entity was placed
 * on a list under a stated legal authority. It is not an adjudication of
 * guilt, and OFAC delists. That distinction is why this record type carries
 * `programs` (the legal authority) rather than any free-text characterisation
 * of what the entity is alleged to have done: the app can state what Treasury
 * did, and must not state what the entity did.
 *
 * Deliberately absent, though present upstream: addresses, passport and
 * national-ID numbers, dates of birth. See
 * scripts/convert/ofac-designations-to-json.mjs.
 */
export interface DesignationRecord {
  /** OFAC's stable entity number — the join key for audits against the live list. */
  entityNumber: number
  name: string
  entityType: DesignationEntityType
  /** OFAC program codes (e.g. 'SDNTK', 'TCO') under which the entity is designated. */
  programs: string[]
  /** Countries of record, from the OFAC address file. Country only, never street address. */
  countries: string[]
  /**
   * OFAC-published a.k.a./f.k.a. names for this entity.
   *
   * This is the entity-resolution problem criminal-network KG research
   * (CORE-KG, LINK-KG) builds ML pipelines to solve — one actor surfacing as
   * "WEI, Zhao", "WEI, Chao" and "SAECHOU, Thanchai" across languages and
   * transliterations. OFAC has already done that resolution and publishes the
   * result, so these are documented equivalences, not inferred ones, and
   * matching on them carries no risk of merging two real people by accident.
   */
  aliases: string[]
}

export interface MmPrecursorFlowRecord {
  originCountry: string
  transitCountry: string | null
  to: string
  year: number
  precursor: PrecursorId
  quantityKg: number
  sourceName: string
  sourceUrl: string
  confidence: SourceConfidence
}

// ---- ingest ----
/** Every parser returns validated records plus per-row warnings. */
export interface ParseResult<T> { records: T[]; warnings: string[] }

// ---- runtime data store ----
export interface DataState {
  isSample: boolean
  priceRecords: PriceRecord[]
  precursorPriceRecords: PrecursorPriceRecord[]
  flowRecords: FlowRecord[]
  overdoseRecords: OverdoseRecord[]
  /** Empty by default — no wastewater dataset is bundled. See `WastewaterRecord`. */
  wastewaterRecords: WastewaterRecord[]
  designationRecords: DesignationRecord[]
  mmRegions: MmNode[]
  mmBorderNodes: MmNode[]
  mmRegionRecords: MmRegionRecord[]
  mmFlowRecords: MmFlowRecord[]
  mmConflictEvents: MmConflictEventRecord[]
  mmPrecursorFlows: MmPrecursorFlowRecord[]
}

/** CSV strings keyed by dataset; any subset may be provided to loadData(). */
export interface LoadBundle {
  prices?: string
  precursorPrices?: string
  flows?: string
  overdose?: string
  wastewater?: string
  designations?: string
  mmRegions?: string
  mmBorderNodes?: string
  mmRegionRecords?: string
  mmFlows?: string
  mmConflictEvents?: string
  mmPrecursorFlows?: string
}

export interface LoadReport {
  ok: boolean
  loaded: Record<string, number>
  warnings: string[]
  errors: string[]
}
