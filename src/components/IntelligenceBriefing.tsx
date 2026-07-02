import { useMemo } from 'react'
import { useData } from '../lib/dataStore'
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
            {profile.hasSourceConflict && (
              <p className="conflict-flag" title={profile.conflictNotes.join('; ')}>
                ⚠ Cross-source conflict: {profile.conflictNotes[0]}
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
