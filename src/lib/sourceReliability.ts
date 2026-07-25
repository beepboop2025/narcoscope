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
  // Official national statistical / regulatory publishers. These sit at the
  // same tier as intergovernmental bodies: a designation or a vital-statistics
  // count is a published act of a government, with a named legal basis and a
  // correction process behind it.
  { match: /\b(CDC|NCHS|VSRR|NIDA|SAMHSA|OFAC|DEA|HIDTA|EUDA|EMCDDA|ACIC|Conflict Armament Research|Small Arms Survey)\b/i, tier: 'high' },
  // Established research institutes and investigative NGOs with published
  // methodologies. High-quality, but their outputs are analysis rather than
  // the primary official record, so they sit a tier below.
  { match: /\b(C4ADS|OCCRP|RAND|Stimson|Global Financial Integrity|The Sentry|Global Witness|Fortify Rights|TRAFFIC|EIA|Environmental Investigation Agency|InSight Crime|Insight Crime)\b/i, tier: 'medium' },
  { match: /\b(Radio Free Asia|RFA|Frontier Myanmar|The Irrawaddy|Myanmar Now|Reuters|AP|AFP|BBC)\b/i, tier: 'medium' },
  // Crowd-sourced and community-reported trackers. Genuinely useful for lead
  // generation and deliberately NOT promoted above 'low': entries are
  // self-reported, unverified, and frequently name private individuals.
  { match: /\b(GASO|Global Anti-Scam|WildLeaks)\b/i, tier: 'low' },
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

/**
 * Canonical-organisation rules for source-identity resolution: maps free-text
 * `sourceName` variants (e.g. "UNODC", "UNODC Myanmar Opium Survey 2024",
 * "unodc.org") to a single stable family id. Order matters — first match
 * wins, so more specific/longer organisation names should precede broader
 * ones if they could otherwise collide (none currently do).
 */
const SOURCE_FAMILY_RULES: Array<{ match: RegExp; family: string }> = [
  { match: /\bUNODC\b/i, family: 'unodc' },
  { match: /\bINCB\b/i, family: 'incb' },
  { match: /\bWHO\b/i, family: 'who' },
  { match: /\bOHCHR\b/i, family: 'ohchr' },
  { match: /\bOCHA\b/i, family: 'ocha' },
  { match: /\bUNDP\b/i, family: 'undp' },
  { match: /\bUNHCR\b/i, family: 'unhcr' },
  { match: /\bWorld Bank\b/i, family: 'world-bank' },
  { match: /\bACLED\b/i, family: 'acled' },
  { match: /\b(International Crisis Group|Crisis Group)\b/i, family: 'crisis-group' },
  { match: /\bIISS\b/i, family: 'iiss' },
  { match: /\bUSIP\b/i, family: 'usip' },
  { match: /\b(GI-TOC|Global Initiative)\b/i, family: 'gi-toc' },
  // Order note: CDC/NCHS/VSRR collapse to one family because they are one
  // reporter — NCHS is a CDC centre and VSRR is its release series. Counting
  // them as three would manufacture corroboration out of a single dataset,
  // exactly the non-independence bias `canonicalSourceId` exists to prevent.
  { match: /\b(CDC|NCHS|VSRR)\b/i, family: 'cdc' },
  { match: /\b(OFAC|Treasury)\b/i, family: 'ofac' },
  { match: /\bDEA\b/i, family: 'dea' },
  { match: /\bHIDTA\b/i, family: 'hidta' },
  { match: /\b(SAMHSA|NIDA)\b/i, family: 'hhs-research' },
  // EUDA is the renamed EMCDDA — same institution, so same family.
  { match: /\b(EUDA|EMCDDA)\b/i, family: 'euda' },
  { match: /\b(ACIC|Australian Criminal Intelligence|NWDMP)\b/i, family: 'acic' },
  { match: /\bC4ADS\b/i, family: 'c4ads' },
  { match: /\bOCCRP\b/i, family: 'occrp' },
  { match: /\bRAND\b/i, family: 'rand' },
  { match: /\bStimson\b/i, family: 'stimson' },
  { match: /\bGlobal Financial Integrity\b/i, family: 'gfi' },
  { match: /\bThe Sentry\b/i, family: 'the-sentry' },
  { match: /\bGlobal Witness\b/i, family: 'global-witness' },
  { match: /\bFortify Rights\b/i, family: 'fortify-rights' },
  { match: /\bTRAFFIC\b/i, family: 'traffic' },
  { match: /\b(EIA|Environmental Investigation Agency)\b/i, family: 'eia' },
  { match: /\bConflict Armament Research\b/i, family: 'conflict-armament-research' },
  { match: /\bSmall Arms Survey\b/i, family: 'small-arms-survey' },
  { match: /\bIn[Ss]ight Crime\b/i, family: 'insight-crime' },
  { match: /\b(GASO|Global Anti-Scam)\b/i, family: 'gaso' },
  { match: /\b(Radio Free Asia|RFA)\b/i, family: 'rfa' },
  { match: /\bFrontier Myanmar\b/i, family: 'frontier-myanmar' },
  { match: /\bThe Irrawaddy\b/i, family: 'irrawaddy' },
  { match: /\bMyanmar Now\b/i, family: 'myanmar-now' },
  { match: /\bReuters\b/i, family: 'reuters' },
  { match: /\bAP\b/, family: 'ap' },
  { match: /\bAFP\b/i, family: 'afp' },
  { match: /\bBBC\b/i, family: 'bbc' },
]

const SOURCE_FAMILY_DOMAIN_RULES: Array<{ match: RegExp; family: string }> = [
  { match: /(^|\.)unodc\.org$/i, family: 'unodc' },
  { match: /(^|\.)incb\.org$/i, family: 'incb' },
  { match: /(^|\.)who\.int$/i, family: 'who' },
  { match: /(^|\.)ohchr\.org$/i, family: 'ohchr' },
  { match: /(^|\.)unocha\.org$/i, family: 'ocha' },
  { match: /(^|\.)undp\.org$/i, family: 'undp' },
  { match: /(^|\.)unhcr\.org$/i, family: 'unhcr' },
  { match: /(^|\.)worldbank\.org$/i, family: 'world-bank' },
  { match: /(^|\.)acleddata\.com$/i, family: 'acled' },
  { match: /(^|\.)crisisgroup\.org$/i, family: 'crisis-group' },
  { match: /(^|\.)iiss\.org$/i, family: 'iiss' },
  { match: /(^|\.)usip\.org$/i, family: 'usip' },
  { match: /(^|\.)globalinitiative\.net$/i, family: 'gi-toc' },
  { match: /(^|\.)cdc\.gov$/i, family: 'cdc' },
  { match: /(^|\.)(treasury|treas)\.gov$/i, family: 'ofac' },
  { match: /(^|\.)dea\.gov$/i, family: 'dea' },
  { match: /(^|\.)(euda|emcdda)\.europa\.eu$/i, family: 'euda' },
  { match: /(^|\.)acic\.gov\.au$/i, family: 'acic' },
  { match: /(^|\.)c4ads\.org$/i, family: 'c4ads' },
  { match: /(^|\.)occrp\.org$/i, family: 'occrp' },
  { match: /(^|\.)rand\.org$/i, family: 'rand' },
  { match: /(^|\.)stimson\.org$/i, family: 'stimson' },
  { match: /(^|\.)gfintegrity\.org$/i, family: 'gfi' },
  { match: /(^|\.)thesentry\.org$/i, family: 'the-sentry' },
  { match: /(^|\.)globalwitness\.org$/i, family: 'global-witness' },
  { match: /(^|\.)fortifyrights\.org$/i, family: 'fortify-rights' },
  { match: /(^|\.)traffic\.org$/i, family: 'traffic' },
  { match: /(^|\.)eia-international\.org$/i, family: 'eia' },
  { match: /(^|\.)conflictarm\.com$/i, family: 'conflict-armament-research' },
  { match: /(^|\.)smallarmssurvey\.org$/i, family: 'small-arms-survey' },
  { match: /(^|\.)insightcrime\.org$/i, family: 'insight-crime' },
  { match: /(^|\.)gaso\.world$/i, family: 'gaso' },
  { match: /(^|\.)rfa\.org$/i, family: 'rfa' },
  { match: /(^|\.)frontiermyanmar\.net$/i, family: 'frontier-myanmar' },
  { match: /(^|\.)irrawaddy\.com$/i, family: 'irrawaddy' },
  { match: /(^|\.)myanmar-now\.org$/i, family: 'myanmar-now' },
  { match: /(^|\.)reuters\.com$/i, family: 'reuters' },
  { match: /(^|\.)apnews\.com$/i, family: 'ap' },
  { match: /(^|\.)afp\.com$/i, family: 'afp' },
  { match: /(^|\.)bbc\.co\.?(uk|m)?$/i, family: 'bbc' },
]

/**
 * Resolves a free-text `sourceName`/`sourceUrl` pair to a stable source-
 * identity key ("family"), so that name-string variants of the *same*
 * organisation (a scraper picking up "UNODC Myanmar Opium Survey 2024" one
 * year and "UNODC" the next, or an analyst typing "unodc.org" as the name)
 * collapse to one independent source instead of inflating source diversity.
 *
 * This directly targets the non-independence bias documented in
 * multi-source/Dempster-Shafer evidence fusion research: naively counting
 * distinct *strings* as distinct *evidence* overstates corroboration when
 * two "sources" are really the same underlying reporter (arXiv:2401.02379
 * source-reliability weighting; CARE-RAG's caution against conflating
 * near-duplicate citations with independent corroboration). Unrecognised
 * sources still get their own identity — normalised on case/whitespace so
 * "Ministry Of Health " and "ministry of health" collapse together, but two
 * genuinely different unrecognised names never collide.
 */
export function canonicalSourceId(sourceName: string | undefined | null, sourceUrl?: string | null): string {
  const name = sourceName ?? ''
  for (const rule of SOURCE_FAMILY_RULES) {
    if (rule.match.test(name)) return rule.family
  }
  const host = hostnameOf(sourceUrl)
  if (host) {
    for (const rule of SOURCE_FAMILY_DOMAIN_RULES) {
      if (rule.match.test(host)) return rule.family
    }
  }
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized ? `name:${normalized}` : 'unknown'
}

/**
 * Human-readable label for a `canonicalSourceId` family key. The `name:`
 * prefix is an internal disambiguator (it keeps unrecognised free-text names
 * from colliding with curated family ids) and must never surface in the UI —
 * use this at every display site. CSV audit exports deliberately keep the
 * raw key instead: it is the stable identity auditors can join/dedupe on.
 */
export function sourceFamilyLabel(familyId: string): string {
  return familyId.startsWith('name:') ? familyId.slice('name:'.length) : familyId
}
