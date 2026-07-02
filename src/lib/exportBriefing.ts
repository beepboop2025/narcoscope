/**
 * Audit-trail export for the Myanmar intelligence briefing. Enterprise/analyst
 * users need to hand a point-in-time snapshot of the fused risk profiles and
 * the underlying evidence-graph ledger to reviewers who don't have (or
 * shouldn't need) direct access to this app — a plain CSV keeps that export
 * auditable and diffable rather than a screenshot.
 */

import type { IntelligenceBriefing } from './intelligence'
import { canonicalSourceId } from './sourceReliability'

/** Escapes a single CSV field per RFC 4180 (quote if it contains a comma, quote, or newline). */
function csvField(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function toCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) lines.push(row.map(csvField).join(','))
  return lines.join('\r\n')
}

/** Risk-profile table: one row per region, matching the on-screen decomposition + provenance fields. */
export function riskProfilesToCsv(briefing: IntelligenceBriefing): string {
  const headers = [
    'region', 'label', 'year', 'riskScore', 'confidenceScore', 'verificationTier',
    'sourceDiversity', 'rawSourceNameCount', 'avgSourceReliability', 'evidenceCount',
    'conflictPressure', 'precursorPressure', 'outflowPressure', 'syntheticActivity', 'opiumHa',
    'trajectory', 'trajectoryChangePct', 'trajectoryBaselineYear',
    'hasSourceConflict', 'conflictNotes',
    'spilloverWatch', 'neighborRegion', 'neighborRiskScore',
    'actorNetworkWatch', 'actorNetworkRegion', 'actorNetworkRiskScore', 'actorNetworkActor',
    'compoundEarlyWarning',
    'evidenceStaleness', 'mostRecentEvidenceYear', 'evidenceAgeYears',
    'precursorCorridorHHI', 'precursorCorridorTier', 'dominantPrecursorCorridor', 'dominantPrecursorCorridorSharePct',
    'outflowCorridorHHI', 'outflowCorridorTier', 'dominantOutflowCorridor', 'dominantOutflowCorridorSharePct',
    'topDrivers',
  ]
  const rows = briefing.profiles.map((p) => [
    p.region, p.label, p.year, p.riskScore, p.confidenceScore, p.verificationTier,
    p.sourceDiversity, p.rawSourceNameCount, p.avgSourceReliability, p.evidenceCount,
    p.conflictPressure, p.precursorPressure, p.outflowPressure, p.syntheticActivity, p.opiumHa,
    p.trajectory, p.trajectoryChangePct, p.trajectoryBaselineYear,
    p.hasSourceConflict, p.conflictNotes.join('; '),
    p.spilloverWatch, p.neighborRegion, p.neighborRiskScore,
    p.actorNetworkWatch, p.actorNetworkRegion, p.actorNetworkRiskScore, p.actorNetworkActor,
    p.compoundEarlyWarning,
    p.evidenceStaleness, p.mostRecentEvidenceYear, p.evidenceAgeYears,
    p.precursorCorridorHHI, p.precursorCorridorTier, p.dominantPrecursorCorridor, p.dominantPrecursorCorridorSharePct,
    p.outflowCorridorHHI, p.outflowCorridorTier, p.dominantOutflowCorridor, p.dominantOutflowCorridorSharePct,
    p.drivers.join('; '),
  ])
  return toCsv(headers, rows)
}

/**
 * Evidence-graph ledger: one row per fused edge, with the resolved node
 * labels and source provenance. Includes `sourceFamily` (see
 * `canonicalSourceId`) alongside the raw `sourceName` so auditors can see
 * which raw name strings the fusion engine treated as the same independent
 * source — making the source-independence discounting behind
 * `sourceDiversity`/`verificationTier` reviewable rather than opaque.
 */
export function evidenceLedgerToCsv(briefing: IntelligenceBriefing): string {
  const labelOf = (id: string): string => briefing.nodes.find((n) => n.id === id)?.label ?? id
  const headers = ['from', 'relation', 'to', 'weight', 'sourceName', 'sourceFamily', 'sourceUrl']
  const rows = briefing.edges.map((edge) => [
    labelOf(edge.from), edge.relation, labelOf(edge.to), Math.round(edge.weight),
    edge.sourceName ?? '', edge.sourceName ? canonicalSourceId(edge.sourceName, edge.sourceUrl) : '', edge.sourceUrl ?? '',
  ])
  return toCsv(headers, rows)
}

/**
 * Systemic chokepoint export: one row per outbound corridor town, ranked by
 * total network-wide volume, with the region-count and share metrics behind
 * `systemicChokepoint` — lets an interdiction-planning audience prioritize
 * corridors independent of any single region's own risk profile.
 */
export function chokepointsToCsv(briefing: IntelligenceBriefing): string {
  const headers = ['corridor', 'label', 'totalQuantityKg', 'regionsServed', 'sharePctOfTotalOutflow', 'systemicChokepoint']
  const rows = briefing.enterpriseReadiness.chokepoints.map((c) => [
    c.corridor, c.label, c.totalQuantityKg, c.regionsServed, c.sharePctOfTotalOutflow, c.systemicChokepoint,
  ])
  return toCsv(headers, rows)
}

/** Triggers a browser download of `content` as a named file. No-op outside a browser (e.g. SSR/tests). */
export function downloadCsv(filename: string, content: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
