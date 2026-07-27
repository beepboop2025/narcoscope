import overview from '../data/overview.json'
import CountUp from '../motion/CountUp'
import Reveal from '../motion/Reveal'

/**
 * The Overview landing — a dense window onto data the app already holds.
 *
 * Reads only the ~2.5 kB precomputed `overview.json` (built by
 * scripts/convert/gen-overview.mjs), never the heavy CDC/OFAC datasets, so the
 * landing stays cheap and the bundle quarantine holds. Every figure is a direct
 * aggregate of the official bundled data — this is legibility through density,
 * not decoration.
 */

const fmtPct = (v: number | null): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`

const pctClass = (v: number | null, invert = false): string => {
  if (v == null) return ''
  const up = v > 0
  return (invert ? !up : up) ? 'delta-up' : 'delta-down'
}

/** A horizontal CSS bar row, reused from the Designations broker chart. */
function Bars({ rows }: { rows: { label: string; value: number; sub?: string; hot?: boolean }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-label" title={r.label}>{r.label}</span>
          <span className="bar-track">
            <span
              className={`bar-fill ${r.hot ? 'bar-fill--hot' : ''}`}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="bar-value">{r.sub ?? r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export default function Overview() {
  const h = overview.headline

  return (
    <section className="overview">
      {/* Headline band — the pulse of the whole dataset. */}
      <div className="stat-band overview-headline">
        <div className="stat">
          <span className="stat-value"><CountUp value={h.usOverdoseLatest} /></span>
          <span className="stat-label">
            US drug-overdose deaths ({h.usOverdoseYear})
            <span className={`stat-delta ${pctClass(h.usOverdoseYoY, true)}`}> {fmtPct(h.usOverdoseYoY)} YoY</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={h.worldSeizureTonnes} suffix=" t" /></span>
          <span className="stat-label">World drug seizures ({h.seizureYear})</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={h.designations} /></span>
          <span className="stat-label">OFAC-designated entities</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={h.seizureCountries} group={false} /></span>
          <span className="stat-label">Countries tracked</span>
        </div>
      </div>

      {/* Divergence alerts — the flagship finding, front and centre. */}
      <Reveal>
        <h3 className="overview-h">Where seizures and consumption disagree</h3>
        <p className="note">
          A seizure figure alone cannot tell you whether more drugs moved or more officers looked.
          Read against consumption — measured by <em>different</em> institutions — the gaps are the story.
        </p>
        <div className="alert-grid">
          {overview.divergences.map((d) => (
            <div className="alert-card" key={d.label}>
              <div className="alert-head">{d.label} <span className="alert-window">{d.window}</span></div>
              <div className="alert-split">
                <div className="alert-side">
                  <span className={`alert-num ${pctClass(d.supplyPct, true)}`}>{fmtPct(d.supplyPct)}</span>
                  <span className="alert-sub">{d.supplyLabel}</span>
                </div>
                <div className="alert-vs">vs</div>
                <div className="alert-side">
                  <span className={`alert-num ${pctClass(d.demandPct)}`}>{fmtPct(d.demandPct)}</span>
                  <span className="alert-sub">{d.demandLabel}</span>
                </div>
              </div>
              <div className="alert-reading">{d.reading}</div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Dense panel grid. */}
      <div className="panel-grid">
        <Reveal>
          <div className="panel">
            <h4>US overdose deaths by substance ({h.usOverdoseYear})</h4>
            <Bars rows={overview.overdoseBySubstance.map((s) => ({
              label: s.label,
              value: s.deaths ?? 0,
              sub: `${(s.deaths ?? 0).toLocaleString()} · ${fmtPct(s.yoy)}`,
              hot: s.substance === 'synthetic_opioids',
            }))} />
            <p className="panel-note">Fentanyl (coral) still leads, though every class fell in {h.usOverdoseYear}.</p>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="panel">
            <h4>Top seizure countries ({h.seizureYear}, all drugs)</h4>
            <Bars rows={overview.topSeizureCountries.map((c) => ({
              label: c.name.length > 20 ? `${c.name.slice(0, 19)}…` : c.name,
              value: c.kg,
              sub: c.kg >= 1000 ? `${Math.round(c.kg / 1000).toLocaleString()} t` : `${Math.round(c.kg)} kg`,
            }))} />
          </div>
        </Reveal>

        <Reveal delay={160}>
          <div className="panel">
            <h4>Sanctions designations by authority</h4>
            <Bars rows={overview.designationsByProgram.map((p) => ({
              label: p.label,
              value: p.count,
            }))} />
          </div>
        </Reveal>

        <Reveal delay={240}>
          <div className="panel">
            <h4>Most-designated jurisdictions</h4>
            <Bars rows={overview.topDesignationCountries.map((c) => ({
              label: c.country,
              value: c.count,
            }))} />
          </div>
        </Reveal>
      </div>

      {/* Data freshness — proof the collection is live. */}
      <Reveal>
        <div className="panel freshness-panel">
          <h4>Data freshness</h4>
          <table className="data-table freshness-table">
            <thead>
              <tr><th>Source</th><th>Cadence</th><th>Retrieved</th><th>Latest</th></tr>
            </thead>
            <tbody>
              {overview.freshness.map((f) => (
                <tr key={f.source}>
                  <td>{f.source}</td>
                  <td>{f.cadence}</td>
                  <td>{f.downloaded}</td>
                  <td>{f.latest}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="panel-note">
            Refreshed automatically from public sources. Everything above is a direct
            count or sum of official data — no figure is modelled or estimated here.
          </p>
        </div>
      </Reveal>
    </section>
  )
}
