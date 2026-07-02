import { useMemo } from 'react'
import { MM_REGION_ADJACENCY } from '../data/myanmar'
import { useData } from '../lib/dataStore'
import { downloadCsv, evidenceLedgerToCsv, riskProfilesToCsv } from '../lib/exportBriefing'
import { buildMyanmarIntelligenceBriefing } from '../lib/intelligence'

const riskClass = (score: number): string => {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'elevated'
  return 'watch'
}

const reliabilityLabel = (weight: number): string => {
  if (weight >= 0.9) return 'high'
  if (weight >= 0.65) return 'medium'
  return 'low'
}

const trajectoryIcon: Record<string, string> = {
  rising: '▲',
  falling: '▼',
  stable: '▬',
  'insufficient-data': '·',
}

const trajectoryLabel = (
  trajectory: string,
  changePct: number | null,
  baselineYear: number | null,
): string => {
  if (trajectory === 'insufficient-data') return 'No prior-year data'
  const pct = changePct !== null ? `${changePct >= 0 ? '+' : ''}${Math.round(changePct * 100)}%` : '—'
  return `${pct} vs ${baselineYear}`
}

const stalenessIcon: Record<string, string> = {
  current: '●',
  aging: '◐',
  stale: '○',
  'no-data': '·',
}

const stalenessLabel = (
  staleness: string,
  mostRecentEvidenceYear: number | null,
  evidenceAgeYears: number | null,
): string => {
  if (staleness === 'no-data') return 'No dated evidence on file'
  if (evidenceAgeYears === 0) return `Current — most recent evidence is ${mostRecentEvidenceYear}`
  return `Most recent evidence is ${mostRecentEvidenceYear} (${evidenceAgeYears} yr${evidenceAgeYears === 1 ? '' : 's'} old)`
}

const corridorIcon: Record<string, string> = {
  diversified: '◇',
  moderate: '◆',
  concentrated: '⬛',
  'insufficient-data': '·',
}

const corridorLabel = (
  tier: string,
  hhi: number | null,
  dominantCorridor: string | null,
  dominantSharePct: number | null,
): string => {
  if (tier === 'insufficient-data') return 'No precursor-corridor data on file'
  return `HHI ${hhi} — ${dominantSharePct}% via ${dominantCorridor}`
}

export default function IntelligenceBriefing() {
  const {
    mmRegions,
    mmRegionRecords,
    mmConflictEvents,
    mmPrecursorFlows,
    mmFlowRecords,
  } = useData()

  const latestYear = useMemo(
    () => Math.max(0, ...[
      ...mmRegionRecords.map((r) => r.year),
      ...mmConflictEvents.map((r) => r.year),
      ...mmPrecursorFlows.map((r) => r.year),
      ...mmFlowRecords.map((r) => r.year),
    ]),
    [mmRegionRecords, mmConflictEvents, mmPrecursorFlows, mmFlowRecords],
  )

  const briefing = useMemo(
    () => buildMyanmarIntelligenceBriefing({
      year: latestYear,
      regions: mmRegions,
      regionRecords: mmRegionRecords,
      conflictEvents: mmConflictEvents,
      precursorFlows: mmPrecursorFlows,
      outflows: mmFlowRecords,
      regionAdjacency: MM_REGION_ADJACENCY,
    }),
    [latestYear, mmRegions, mmRegionRecords, mmConflictEvents, mmPrecursorFlows, mmFlowRecords],
  )

  const top = briefing.profiles[0]

  return (
    <section>
      <p className="intro">
        Enterprise intelligence layer: deterministic evidence fusion inspired by
        event-knowledge-graph and source-reliability research. It combines public
        conflict events, precursor inflows, Myanmar region stats, and outbound
        seizure corridors into auditable risk profiles — no black-box claims.
      </p>

      <div className="stat-band">
        <div className="stat">
          <span className="stat-value">{top?.riskScore ?? 0}</span>
          <span className="stat-label">Highest regional risk score</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.provenanceCoveragePct}%</span>
          <span className="stat-label">Provenance coverage</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.evidenceRecords}</span>
          <span className="stat-label">Evidence records fused</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.nodes.length}/{briefing.edges.length}</span>
          <span className="stat-label">Graph nodes / edges</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.conflictedRegions}</span>
          <span className="stat-label">Regions with cross-source conflicts</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.risingRegions}</span>
          <span className="stat-label">Regions trending upward</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.spilloverWatchRegions}</span>
          <span className="stat-label">Regions on spillover watch</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.staleRegions}</span>
          <span className="stat-label">Regions with stale evidence (3+ yrs)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{briefing.enterpriseReadiness.concentratedCorridorRegions}</span>
          <span className="stat-label">Regions with concentrated precursor corridor</span>
        </div>
      </div>

      <div className="export-actions">
        <button
          type="button"
          className="export-btn"
          onClick={() => downloadCsv(`myanmar-risk-profiles-${briefing.year}.csv`, riskProfilesToCsv(briefing))}
        >
          ⬇ Export risk profiles (CSV)
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={() => downloadCsv(`myanmar-evidence-ledger-${briefing.year}.csv`, evidenceLedgerToCsv(briefing))}
        >
          ⬇ Export evidence ledger (CSV)
        </button>
      </div>

      <div className="intel-grid">
        {briefing.profiles.map((profile) => (
          <article className={`risk-card ${riskClass(profile.riskScore)}`} key={profile.region}>
            <div className="risk-card-head">
              <h3>{profile.label}</h3>
              <span>{profile.riskScore}</span>
            </div>
            <div className="risk-bar" aria-label={`Risk ${profile.riskScore} of 100`}>
              <i style={{ width: `${profile.riskScore}%` }} />
            </div>
            <p>
              Confidence {profile.confidenceScore}/100 from {profile.evidenceCount} evidence
              record(s) and {profile.sourceDiversity} source family/families
              {profile.sourceDiversity > 0 && ` (avg. reliability ${reliabilityLabel(profile.avgSourceReliability)})`}.
            </p>
            <p className={`verification-tier tier-${profile.verificationTier}`}>
              {profile.verificationTier === 'multi-source' && 'Multi-source verified'}
              {profile.verificationTier === 'single-source' && 'Single-source — unverified'}
              {profile.verificationTier === 'unverified' && 'No independent sourcing'}
            </p>
            <p
              className={`trajectory-tag trend-${profile.trajectory}`}
              title={trajectoryLabel(profile.trajectory, profile.trajectoryChangePct, profile.trajectoryBaselineYear)}
            >
              {trajectoryIcon[profile.trajectory]} {profile.trajectory === 'insufficient-data' ? 'No trend data' : profile.trajectory}
              {' '}({trajectoryLabel(profile.trajectory, profile.trajectoryChangePct, profile.trajectoryBaselineYear)})
            </p>
            {profile.hasSourceConflict && (
              <p className="conflict-flag" title={profile.conflictNotes.join('; ')}>
                ⚠ Cross-source conflict: {profile.conflictNotes[0]}
              </p>
            )}
            {profile.spilloverWatch && (
              <p
                className="spillover-flag"
                title={`Highest bordering risk score: ${profile.neighborRiskScore} (${
                  briefing.profiles.find((p) => p.region === profile.neighborRegion)?.label ?? profile.neighborRegion
                })`}
              >
                ⇄ Spillover watch: borders a high-risk region
              </p>
            )}
            <p
              className={`staleness-tag staleness-${profile.evidenceStaleness}`}
              title={stalenessLabel(profile.evidenceStaleness, profile.mostRecentEvidenceYear, profile.evidenceAgeYears)}
            >
              {stalenessIcon[profile.evidenceStaleness]} {profile.evidenceStaleness === 'no-data' ? 'No dated evidence' : `Evidence: ${profile.evidenceStaleness}`}
            </p>
            {profile.precursorCorridorTier !== 'insufficient-data' && (
              <p
                className={`corridor-tag corridor-${profile.precursorCorridorTier}`}
                title={corridorLabel(
                  profile.precursorCorridorTier,
                  profile.precursorCorridorHHI,
                  profile.dominantPrecursorCorridor,
                  profile.dominantPrecursorCorridorSharePct,
                )}
              >
                {corridorIcon[profile.precursorCorridorTier]} Precursor corridor: {profile.precursorCorridorTier}
              </p>
            )}
            <div className="driver-list">
              {profile.drivers.map((driver) => <span key={driver}>{driver}</span>)}
            </div>
          </article>
        ))}
      </div>

      <h3>Risk decomposition — {briefing.year}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Region</th>
            <th>Risk</th>
            <th>Confidence</th>
            <th>Conflict</th>
            <th>Precursor</th>
            <th>Outbound</th>
            <th>Synthetic</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {briefing.profiles.map((p) => (
            <tr key={p.region}>
              <td className={p.riskScore >= 70 ? 'hot' : ''}>{p.label}</td>
              <td>{p.riskScore}</td>
              <td>{p.confidenceScore}</td>
              <td>{p.conflictPressure}</td>
              <td>{p.precursorPressure}</td>
              <td>{p.outflowPressure}</td>
              <td>{p.syntheticActivity}</td>
              <td>{p.evidenceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Evidence graph ledger</h3>
      <table className="data-table">
        <thead>
          <tr><th>From</th><th>Relation</th><th>To</th><th>Weight</th><th>Source</th><th>Reliability</th></tr>
        </thead>
        <tbody>
          {briefing.edges
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 14)
            .map((edge, i) => {
              const from = briefing.nodes.find((n) => n.id === edge.from)?.label ?? edge.from
              const to = briefing.nodes.find((n) => n.id === edge.to)?.label ?? edge.to
              const sourceNode = edge.sourceName ? briefing.nodes.find((n) => n.id === `source:${edge.sourceName}`) : undefined
              return (
                <tr key={`${edge.from}-${edge.to}-${i}`}>
                  <td>{from}</td>
                  <td>{edge.relation.replace(/_/g, ' ')}</td>
                  <td>{to}</td>
                  <td>{Math.round(edge.weight).toLocaleString()}</td>
                  <td>
                    {edge.sourceUrl ? (
                      <a href={edge.sourceUrl} target="_blank" rel="noreferrer">{edge.sourceName}</a>
                    ) : 'Loaded data'}
                  </td>
                  <td>
                    {sourceNode?.reliability ? (
                      <span className={`reliability-tag tier-${sourceNode.reliability}`}>{sourceNode.reliability}</span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>

      <p className="note">
        Scores are transparent composite indicators for prioritising analyst
        review, not ground truth. They reward multi-source provenance and keep
        uncertain reported/estimated precursor flows lower than official records.
      </p>
    </section>
  )
}
