import { useEffect, useMemo, useState } from 'react'
import {
  humanizeBriField,
  loadBriContext,
  selectBriDossier,
  type BriContext,
  type BriDossierScope,
  type BriTarget,
  type BriTargetSource,
} from '../lib/briDossier'

const buildReadyStates = new Set(['live', 'adapter_ready'])

function readableDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function StatusBadge({ state }: { state: string }) {
  const ready = buildReadyStates.has(state)
  return (
    <span className={`bri-status bri-status--${state.replaceAll('_', '-')} ${ready ? 'is-ready' : ''}`}>
      {humanizeBriField(state)}
    </span>
  )
}

function SourceRow({ source }: { source: BriTargetSource }) {
  return (
    <li className="bri-source-row">
      <div>
        <strong>{humanizeBriField(source.sourceId)}</strong>
        <span>{humanizeBriField(source.sourceClass)} · {humanizeBriField(source.authorityRole)}</span>
      </div>
      <StatusBadge state={source.implementationState} />
      <p><b>Claims</b> {source.claimClasses.map(humanizeBriField).join(' · ')}</p>
      <p><b>Rights</b> {humanizeBriField(source.rightsStatus)}</p>
    </li>
  )
}

function TargetStation({ target, index }: { target: BriTarget; index: number }) {
  const readyPercent = target.sourceReadiness.sourceCount
    ? Math.round((target.sourceReadiness.buildReadySourceCount / target.sourceReadiness.sourceCount) * 100)
    : 0
  return (
    <article className="bri-station">
      <span className="bri-station__marker" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <div className="bri-station__body">
        <div className="bri-station__head">
          <div>
            <p>{humanizeBriField(target.targetType)}</p>
            <h4>{target.label}</h4>
          </div>
          <StatusBadge state={target.evidenceStatus} />
        </div>
        <div className="bri-readiness" aria-label={`${target.sourceReadiness.buildReadySourceCount} of ${target.sourceReadiness.sourceCount} sources build-ready`}>
          <span><i style={{ width: `${readyPercent}%` }} /></span>
          <b>{target.sourceReadiness.buildReadySourceCount}/{target.sourceReadiness.sourceCount}</b>
          <small>build-ready sources</small>
        </div>
        <ul className="bri-coverage-chips" aria-label="Required evidence coverage">
          {target.requiredCoverage.map((field) => <li key={field}>{humanizeBriField(field)}</li>)}
        </ul>
        <details className="bri-source-detail" open>
          <summary>Source and rights ledger ({target.sources.length})</summary>
          <ul>{target.sources.map((source) => <SourceRow key={source.sourceId} source={source} />)}</ul>
        </details>
      </div>
    </article>
  )
}

function DossierLoading({ scope }: { scope: BriDossierScope }) {
  return (
    <section className={`bri-dossier bri-dossier--${scope} bri-dossier--loading`} aria-busy="true">
      <p className="bri-dossier__eyebrow">Loading sealed evidence contract</p>
      <h2>Opening the corridor ledger…</h2>
      <p>The interface waits for the verified REST artifact; it does not substitute cached figures or zeroes.</p>
    </section>
  )
}

function DossierError({ message }: { message: string }) {
  return (
    <section className="bri-dossier bri-dossier--error" role="alert">
      <p className="bri-dossier__eyebrow">Evidence contract unavailable</p>
      <h2>This dossier cannot be shown safely.</h2>
      <p>{message} No readiness or economic count has been inferred from the failure.</p>
      <a href="https://palimpsest-publication-production.up.railway.app/belt-and-road/" target="_blank" rel="noreferrer">
        Open the Palimpsest observatory
      </a>
    </section>
  )
}

export default function BriDossier({ scope }: { scope: BriDossierScope }) {
  const [context, setContext] = useState<BriContext | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    loadBriContext()
      .then((value) => {
        if (current) setContext(value)
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Unknown evidence-contract error')
      })
    return () => { current = false }
  }, [])

  const dossier = useMemo(
    () => context ? selectBriDossier(context, scope) : null,
    [context, scope],
  )

  if (error) return <DossierError message={error} />
  if (!context || !dossier) return <DossierLoading scope={scope} />

  const releaseBase = context.provenance.release.railwayMirrorBaseUrl
  const allTargetSources = dossier.areas.flatMap((area) => area.targets.flatMap((target) => target.sources))
  const visibleStates = [...new Set(allTargetSources.map((source) => source.implementationState))].sort()

  return (
    <section className={`bri-dossier bri-dossier--${scope}`} aria-labelledby={`bri-dossier-${scope}-title`}>
      <header className="bri-dossier__hero">
        <div>
          <p className="bri-dossier__eyebrow">{dossier.contract.eyebrow}</p>
          <h2 id={`bri-dossier-${scope}-title`}>{dossier.contract.title}</h2>
          <p className="bri-dossier__lede">{dossier.contract.lede}</p>
        </div>
        <aside className="bri-dossier__seal" aria-label="Palimpsest release identity">
          <span>Palimpsest release verified</span>
          <code>{context.provenance.release.sourceRevision.slice(0, 12)}</code>
          <small>Data as of {readableDate(context.dataAsOf)}</small>
        </aside>
      </header>

      <dl className="bri-dossier__stats">
        <div><dt>Target ledgers</dt><dd>{dossier.targetCount}</dd></div>
        <div><dt>Registered sources</dt><dd>{dossier.sourceCount}</dd></div>
        <div><dt>Build-ready sources</dt><dd>{dossier.buildReadySourceCount}</dd></div>
        <div><dt>Economic rows</dt><dd>{dossier.economicTotals.sourceRows.toLocaleString()}</dd></div>
      </dl>

      <div className="bri-dossier__boundary" role="note">
        <strong>Parallel context only · cross-lane join prohibited</strong>
        <p>{context.usePolicy.displayRelationship}</p>
      </div>

      <div className="bri-dossier__legend" aria-label="Implementation states represented">
        <span>Readiness states</span>
        {visibleStates.map((state) => <StatusBadge key={state} state={state} />)}
        <small>Discovery and planned routes are not live observations.</small>
      </div>

      <div className="bri-dossier__layout">
        <div className="bri-route-ledger">
          {dossier.areas.map((area) => (
            <section className="bri-area" key={area.areaId} aria-labelledby={`bri-area-${scope}-${area.areaId}`}>
              <div className="bri-area__head">
                <p>{area.areaId.toUpperCase()}</p>
                <h3 id={`bri-area-${scope}-${area.areaId}`}>{area.label}</h3>
                <span>{area.targets.length} {area.targets.length === 1 ? 'target' : 'targets'}</span>
              </div>
              <div className="bri-area__stations">
                {area.targets.map((target, index) => <TargetStation key={target.targetId} target={target} index={index} />)}
              </div>
            </section>
          ))}
        </div>

        <aside className="bri-dossier__side">
          <section className="bri-economics" aria-labelledby={`bri-economics-${scope}`}>
            <p className="bri-dossier__eyebrow">World Development Indicators</p>
            <h3 id={`bri-economics-${scope}`}>National context, bounded</h3>
            <p>{dossier.contract.economicBoundary}</p>
            <ul>
              {dossier.countries.map((country) => {
                const observedPercent = country.sourceRowCount
                  ? Math.round((country.observedRowCount / country.sourceRowCount) * 100)
                  : 0
                return (
                  <li key={country.countryCode}>
                    <div><strong>{country.country}</strong><span>{country.indicatorCount} indicators</span></div>
                    <span className="bri-economics__bar" aria-label={`${observedPercent}% of source rows observed`}><i style={{ width: `${observedPercent}%` }} /></span>
                    <dl>
                      <div><dt>Observed</dt><dd>{country.observedRowCount.toLocaleString()}</dd></div>
                      <div><dt>Unavailable</dt><dd>{country.unavailableRowCount.toLocaleString()}</dd></div>
                    </dl>
                  </li>
                )
              })}
            </ul>
            <p className="bri-economics__source">
              {context.economicContext.source.attribution} · {context.economicContext.rights.license} · retrieved {readableDate(context.economicContext.clocks.retrievedAt)}. Unavailable rows remain unavailable, never zero.
            </p>
          </section>

          {scope === 'balochistan' ? (
            <section className="bri-related-release">
              <p className="bri-dossier__eyebrow">Separate historical aggregate</p>
              <h3>Conflict-year release</h3>
              <p>The readiness bridge carries no event narratives or actor records. Open Palimpsest’s delayed, administrative-area aggregate for the separately licensed historical record.</p>
              <a href={`${releaseBase}/readings/ucdp-aggregate-latest.json`} target="_blank" rel="noreferrer">Open the aggregate data ↗</a>
            </section>
          ) : null}

          <section className="bri-limitations" aria-labelledby={`bri-limits-${scope}`}>
            <p className="bri-dossier__eyebrow">Reliance boundary</p>
            <h3 id={`bri-limits-${scope}`}>What this tab cannot prove</h3>
            <ol>{context.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ol>
          </section>

          <section className="bri-prohibitions">
            <p className="bri-dossier__eyebrow">Prohibited uses</p>
            <ul>
              {Object.keys(context.usePolicy.prohibitions).map((rule) => <li key={rule}>{humanizeBriField(rule)}</li>)}
            </ul>
          </section>
        </aside>
      </div>

      <footer className="bri-dossier__links">
        <a href={context.provenance.sourceArtifacts.observatory.railwayMirrorUrl} target="_blank" rel="noreferrer">Source contract JSON</a>
        <a href={`${releaseBase}/belt-and-road/`} target="_blank" rel="noreferrer">Palimpsest BRI observatory</a>
        <a href={`${releaseBase}/research/china-pakistan-myanmar-bri-2026/`} target="_blank" rel="noreferrer">Full research report</a>
        <a href={context.economicContext.source.catalogUrl} target="_blank" rel="noreferrer">World Bank source</a>
      </footer>
    </section>
  )
}
