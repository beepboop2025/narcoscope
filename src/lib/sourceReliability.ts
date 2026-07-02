/**
 * Source reliability weighting.
 *
 * Follows trust/reliability weighting practice from misinformation-source
 * webgraph research (arXiv:2401.02379) and OSINT source-grading conventions
 * (admiralty code style tiers): not every "independent source" deserves equal
 * weight in a fused estimate. A named intergovernmental body (UNODC, INCB,
 * WHO) reporting a number should outweigh an unnamed blog or a wire aggregator
 * with unknown methodology when they disagree, and multi-source corroboration
 * should count for more when the corroborating sources are themselves credible.
 *
 * This module is deliberately conservative and deterministic: it never
 * silently drops or hides a disagreeing source, it only changes how much
 * weight that source's number carries in the fused mean and in the region
 * confidence score. Callers can always see the raw per-source records.
 */

export type ReliabilityTier = 'high' | 'medium' | 'low'

export const RELIABILITY_TIER_WEIGHT: Record<ReliabilityTier, number> = {
  high: 1,
  medium: 0.75,
  low: 0.5,
}

/**
 * Name-based rules for well-known intergovernmental, multilateral, and
 * established OSINT/conflict-monitoring organisations. Matched against the
 * free-text `sourceName` field, since curated CSV rows carry human-readable
 * source names rather than normalised IDs.
 */
const NAME_RULES: Array<{ match: RegExp; tier: ReliabilityTier }> = [
  { match: /\b(UNODC|INCB|WHO|OHCHR|OCHA|UNDP|UNHCR|World Bank)\b/i, tier: 'high' },
  { match: /\b(ACLED|International Crisis Group|Crisis Group|IISS|USIP|GI-TOC|Global Initiative)\b/i, tier: 'high' },
  { match: /\b(Radio Free Asia|RFA|Frontier Myanmar|The Irrawaddy|Myanmar Now|Reuters|AP|AFP|BBC)\b/i, tier: 'medium' },
]

/**
 * Domain-based fallback when a source name doesn't match a known-name rule
 * but the source URL host suggests a tier (used for scraper-discovered
 * sources and analyst-entered rows that reuse a known domain).
 */
const DOMAIN_RULES: Array<{ match: RegExp; tier: ReliabilityTier }> = [
  { match: /\.(gov|int)$/i, tier: 'high' },
  { match: /(^|\.)(unodc|incb|who|un|undp|unhcr|worldbank)\.org$/i, tier: 'high' },
  { match: /(^|\.)(acleddata|crisisgroup|iiss|globalinitiative)\.(org|net)$/i, tier: 'high' },
  { match: /\.(org|edu)$/i, tier: 'medium' },
]

function hostnameOf(sourceUrl: string | undefined | null): string | null {
  if (!sourceUrl) return null
  try {
    return new URL(sourceUrl).hostname
  } catch {
    return null
  }
}

/**
 * Classify a source into a reliability tier. Falls back to `low` (not
 * "distrusted" — just "not independently corroborated as high-confidence")
 * for unrecognised sources, so unknown analyst-entered sources still count
 * toward source diversity but carry less weight in fused estimates.
 */
export function sourceReliabilityTier(sourceName: string | undefined | null, sourceUrl?: string | null): ReliabilityTier {
  const name = sourceName ?? ''
  for (const rule of NAME_RULES) {
    if (rule.match.test(name)) return rule.tier
  }
  const host = hostnameOf(sourceUrl)
  if (host) {
    for (const rule of DOMAIN_RULES) {
      if (rule.match.test(host)) return rule.tier
    }
  }
  return 'low'
}

export function sourceReliabilityWeight(sourceName: string | undefined | null, sourceUrl?: string | null): number {
  return RELIABILITY_TIER_WEIGHT[sourceReliabilityTier(sourceName, sourceUrl)]
}
