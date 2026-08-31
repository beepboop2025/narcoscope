import { useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { WILDLIFE, countryName, taxonCommon, trendYears, appendixIShare } from '../lib/wildlife'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'
import Reveal from '../motion/Reveal'
import DataTableViewport from './DataTableViewport'

/**
 * Wildlife Seizures presents CITES confiscation records as an adjacent public
 * dataset. It does not use OFAC names to infer a laundering role or claim that
 * wildlife and drug records describe the same actors. Lazy tab, but the data
 * is a tiny 5.7 kB pre-aggregate, so the weight is only recharts.
 *
 * Honesty is the whole design constraint: this is CITES-reported confiscations
 * of CITES-LISTED species, counted as records (quantities mix units), a partial
 * and reporting-dependent view. The copy says so, repeatedly and plainly.
 */

// Distinct hues per taxonomic class, warm = the headline reptile/mammal trade.
const CLASS_COLOR: Record<string, string> = {
  Reptilia: '#ff8f6e', Mammalia: '#f4a4c0', Anthozoa: '#79e0a8', Bivalvia: '#6ea8fe',
  Aves: '#e0d36e', Actinopteri: '#a1ecff', Gastropoda: '#c79bff', Insecta: '#e0b96e',
  Elasmobranchii: '#7fd4c4', Hydrozoa: '#9fe0a0', Amphibia: '#e08c8c',
  Holothuroidea: '#b0b0d8', Arachnida: '#d0a0a0', '(other)': '#7d8aa5',
}
const classColor = (c: string) => CLASS_COLOR[c] ?? '#7d8aa5'

export default function WildlifeSeizures() {
  const { meta, byClass, byYear, topTaxa, topExporters, topImporters, byTerm, byAppendix } = WILDLIFE

  const { series, lastFullYear } = useMemo(() => trendYears(byYear), [byYear])
  const appI = useMemo(() => appendixIShare(byAppendix), [byAppendix])

  const maxClass = byClass[0]?.records ?? 1
  const maxExp = topExporters[0]?.records ?? 1
  const maxImp = topImporters[0]?.records ?? 1
  const maxTerm = byTerm[0]?.records ?? 1
  const topExp = topExporters[0]
  const topImp = topImporters[0]

  return (
    <section>
      <div className="stat-band">
        <div className="stat">
          <span className="stat-value"><CountUp value={meta.totalRecords} /></span>
          <span className="stat-label">Confiscation records ({meta.yearRange[0]}–{lastFullYear ?? meta.yearRange[1]})</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={byClass.length} group={false} /></span>
          <span className="stat-label">Animal classes seized</span>
        </div>
        <div className="stat">
          <span className="stat-value hot"><CountUp value={Math.round(appI.pct * 100)} suffix="%" group={false} /></span>
          <span className="stat-label">Under Appendix I (most endangered)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{countryName(topExp?.country ?? '—')}</span>
          <span className="stat-label">Top source of seized shipments</span>
        </div>
      </div>

      <Explainer
        text={
          `Wildlife confiscations are an adjacent lens on cross-border illicit commodity markets. ` +
          `This tab presents ${meta.totalRecords.toLocaleString()} confiscation records for protected ` +
          `species reported to CITES since ${meta.yearRange[0]}. It does not identify financing methods ` +
          `or link wildlife records to drug-market actors. It is a partial view: only CITES-listed ` +
          `species and only what parties report, so it must never be read as a complete total.`
        }
      />

      {/* Long trend — where LineChart genuinely fits (multi-year, one series). */}
      <Reveal>
        <div className="chart-card">
          <h3>Reported confiscations per year — {series[0]?.year}–{lastFullYear}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#26314a" />
              <XAxis dataKey="year" stroke="#8aa0c6" />
              <YAxis stroke="#8aa0c6" />
              <Tooltip
                contentStyle={{ background: '#0e1626', border: '1px solid #26314a' }}
                formatter={(v) => [`${Number(v).toLocaleString()} records`, 'Confiscations']}
              />
              <Line type="monotone" dataKey="records" stroke="#ff8f6e" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="note">
            Trailing years are dropped: CITES annual reports arrive with a long lag, so the most recent
            year or two are radically under-reported and would draw a false cliff. {meta.yearRange[1]} data
            exists but is incomplete, so the line stops at {lastFullYear}.
          </p>
        </div>
      </Reveal>

      {/* What gets seized, by animal class — ranked coloured bars. */}
      <Reveal delay={80}>
        <div className="panel">
          <h4>What is seized — by taxonomic class</h4>
          <div className="bar-list">
            {byClass.map((c) => (
              <div className="bar-row" key={c.class}>
                <span className="bar-label" title={c.class}>{c.class}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(c.records / maxClass) * 100}%`, background: classColor(c.class) }} />
                </span>
                <span className="bar-value">{c.records.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="panel-note">
            Reptiles (skins, leather goods, live pets) and mammals (ivory, musk, bushmeat) dominate the
            record count. &ldquo;(other)&rdquo; is mostly plant material — medicinal roots such as costus
            and ginseng, which CITES also protects.
          </p>
        </div>
      </Reveal>

      {/* Most-seized species — with plain-language names where known. */}
      <Reveal delay={160}>
        <h3>Most-confiscated species</h3>
        <DataTableViewport label="Most-confiscated wildlife species">
          <table className="data-table">
          <thead><tr><th>Taxon</th><th>Common name</th><th>Class</th><th>Records</th></tr></thead>
          <tbody>
            {topTaxa.slice(0, 15).map((t) => (
              <tr key={t.taxon}>
                <td><em>{t.taxon}</em></td>
                <td>{taxonCommon(t.taxon) ?? '—'}</td>
                <td>{t.class}</td>
                <td>{t.records.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </DataTableViewport>
      </Reveal>

      {/* The corridor: source vs destination, side by side. */}
      <Reveal delay={240}>
        <h3>The corridor — where seized shipments come from, where they were headed</h3>
        <div className="panel-grid">
          <div className="panel">
            <h4>Source countries (exporter of record)</h4>
            <div className="bar-list">
              {topExporters.slice(0, 10).map((c) => (
                <div className="bar-row" key={c.country}>
                  <span className="bar-label" title={countryName(c.country)}>{countryName(c.country)}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${(c.records / maxExp) * 100}%` }} />
                  </span>
                  <span className="bar-value">{c.records.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h4>Destination countries (importer of record)</h4>
            <div className="bar-list">
              {topImporters.slice(0, 10).map((c) => (
                <div className="bar-row" key={c.country}>
                  <span className="bar-label" title={countryName(c.country)}>{countryName(c.country)}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${(c.records / maxImp) * 100}%`, background: '#79e0a8' }} />
                  </span>
                  <span className="bar-value">{c.records.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="note">
          The destination side is dominated by {countryName(topImp?.country ?? '')} — the confiscating
          party reports the seizure, so big consumer markets with active border enforcement (the US, the
          EU) record the most. A high destination count reflects both demand and enforcement, not one
          alone. &ldquo;Unknown / unreported&rdquo; is a real category in the CITES data.
        </p>
      </Reveal>

      {/* What form the contraband takes. */}
      <Reveal delay={320}>
        <div className="panel">
          <h4>What form it takes — seized terms</h4>
          <div className="bar-list">
            {byTerm.slice(0, 12).map((t) => (
              <div className="bar-row" key={t.term}>
                <span className="bar-label" title={t.term}>{t.term}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(t.records / maxTerm) * 100}%`, background: '#e0d36e' }} />
                </span>
                <span className="bar-value">{t.records.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="panel-note">
            Live animals, raw corals, leather goods and derivatives lead. These categories describe the
            seized commodity form; they do not identify a financing or laundering mechanism.
          </p>
        </div>
      </Reveal>

      <p className="note">
        Source: <a href={meta.url} target="_blank" rel="noreferrer">{meta.source}</a>. {meta.caveat} This
        is a one-time annual extract (the full CITES database is ~460 MB), so unlike the drug-market
        panels it is not refreshed daily. It is adjacent context, not evidence that wildlife and drug
        records share actors, routes or financial infrastructure.
      </p>
    </section>
  )
}
