import { useMemo, useState, type ChangeEvent } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, Geometry } from 'geojson'
import { useData } from '../lib/dataStore'
import { BUNDLED_OVERDOSE_RECORDS, OVERDOSE_META, withBundled } from '../data/bundled'
import { FIPS_TO_ABBR } from '../data/usStates'
import usTopo from '../data/us-states-10m.json'
import {
  STATE_SUBSTANCES, stateMetrics, stateTrend, nationalMetric, stateMovers, stateYears, ramp,
} from '../lib/stateOverdose'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'
import type { OverdoseSubstance } from '../types'
import DataTableViewport from './DataTableViewport'

// State polygons, derived once from the bundled topojson.
const STATE_FEATURES = (() => {
  const t = usTopo as unknown as Parameters<typeof feature>[0]
  const fc = feature(t, (usTopo as { objects: { states: unknown } }).objects.states as never) as unknown as {
    features: Feature<Geometry>[]
  }
  return fc.features
})()

/** Interpolate the choropleth colour: cool panel → coral for high rates. */
function fillFor(t: number): string {
  if (t <= 0) return '#16233a'
  const lo = [26, 39, 58]    // #1a273a
  const hi = [255, 143, 110] // #ff8f6e
  const c = lo.map((l, i) => Math.round(l + (hi[i] - l) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const fmtPct = (v: number | null): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`

export default function StateOverdose() {
  const { overdoseRecords: loaded } = useData()
  const records = withBundled(loaded, BUNDLED_OVERDOSE_RECORDS)

  const years = useMemo(() => stateYears(records), [records])
  const latest = years[years.length - 1]
  const [substance, setSubstance] = useState<OverdoseSubstance>('all_drugs')
  const [year, setYear] = useState<number>(latest)
  const [metric, setMetric] = useState<'rate' | 'count'>('rate')
  const [selected, setSelected] = useState<string | null>('WV')

  const metrics = useMemo(() => stateMetrics(records, substance, year), [records, substance, year])
  const national = useMemo(() => nationalMetric(records, substance, year), [records, substance, year])
  const movers = useMemo(
    () => stateMovers(records, substance, years[0], latest),
    [records, substance, years, latest],
  )

  const value = (abbr: string): number | null => {
    const m = metrics.get(abbr)
    if (!m) return null
    return metric === 'rate' ? m.ratePer100k : m.deaths
  }
  const maxOnView = useMemo(() => {
    let max = 0
    for (const m of metrics.values()) {
      const v = metric === 'rate' ? m.ratePer100k : m.deaths
      if (v != null && v > max) max = v
    }
    return max
  }, [metrics, metric])

  // Projection fit to a fixed viewBox, computed once per render cheaply.
  const width = 960
  const height = 600
  const projection = useMemo(
    () => geoAlbersUsa().fitSize([width, height], { type: 'FeatureCollection', features: STATE_FEATURES } as never),
    [],
  )
  const pathGen = useMemo(() => geoPath(projection), [projection])

  const ranked = useMemo(
    () => [...metrics.values()]
      .map((m) => ({ ...m, v: metric === 'rate' ? m.ratePer100k : m.deaths }))
      .filter((m) => m.v != null)
      .sort((a, b) => (b.v as number) - (a.v as number)),
    [metrics, metric],
  )

  const selectedTrend = useMemo(
    () => (selected ? stateTrend(records, selected, substance) : []),
    [records, selected, substance],
  )
  const selectedName = ranked.find((r) => r.abbr === selected)?.name ?? selected
  const unitLabel = metric === 'rate' ? 'per 100k' : 'deaths'

  return (
    <section>
      <div className="controls">
        <label>
          Substance&nbsp;
          <select value={substance} onChange={(e: ChangeEvent<HTMLSelectElement>) => setSubstance(e.target.value as OverdoseSubstance)}>
            {STATE_SUBSTANCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label>
          Year&nbsp;
          <select value={year} onChange={(e: ChangeEvent<HTMLSelectElement>) => setYear(Number(e.target.value))}>
            {[...years].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={metric === 'rate'} onChange={(e) => setMetric(e.target.checked ? 'rate' : 'count')} />
          &nbsp;Rate per 100k (vs raw deaths)
        </label>
      </div>

      <div className="stat-band">
        <div className="stat">
          <span className="stat-value">{national ? <CountUp value={national.deaths} /> : '—'}</span>
          <span className="stat-label">US deaths, {STATE_SUBSTANCES.find((s) => s.id === substance)?.label} ({year})</span>
        </div>
        <div className="stat">
          <span className="stat-value">{national?.ratePer100k ?? '—'}</span>
          <span className="stat-label">US rate per 100k</span>
        </div>
        <div className="stat">
          <span className="stat-value">{ranked[0]?.name ?? '—'}</span>
          <span className="stat-label">Highest {metric === 'rate' ? 'rate' : 'count'}: {ranked[0]?.v ?? '—'} {unitLabel}</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={ranked.length} group={false} /></span>
          <span className="stat-label">States reporting</span>
        </div>
      </div>

      <Explainer
        text={
          `In ${year}, ${STATE_SUBSTANCES.find((s) => s.id === substance)?.label.toLowerCase()} killed ` +
          `${national?.deaths.toLocaleString() ?? '—'} people across the US (${national?.ratePer100k ?? '—'} per 100k). ` +
          `${ranked[0]?.name ?? ''} carried the heaviest ${metric === 'rate' ? 'per-capita rate' : 'raw toll'} ` +
          `(${ranked[0]?.v ?? '—'} ${unitLabel}). Rate per 100k, not raw deaths, is the honest cross-state ` +
          `comparison — otherwise the largest states always lead.`
        }
      />

      <div className="chart-card">
        <h3>
          {STATE_SUBSTANCES.find((s) => s.id === substance)?.label} — {metric === 'rate' ? 'deaths per 100k' : 'total deaths'}, {year}
        </h3>
        <svg viewBox={`0 0 ${width} ${height}`} className="us-choropleth" role="img"
             aria-label={`US choropleth of ${substance} overdose by state, ${year}`}>
          {STATE_FEATURES.map((f) => {
            const abbr = FIPS_TO_ABBR[String(f.id)]
            const v = abbr ? value(abbr) : null
            const d = pathGen(f) ?? ''
            const isSel = abbr === selected
            return (
              <path
                key={String(f.id)}
                d={d}
                fill={fillFor(ramp(v, maxOnView))}
                stroke={isSel ? '#a1ecff' : '#0c1220'}
                strokeWidth={isSel ? 2 : 0.5}
                className="us-state"
                onClick={() => abbr && setSelected(abbr)}
                role="button"
                tabIndex={abbr ? 0 : -1}
                aria-label={abbr ? `${metrics.get(abbr)?.name ?? abbr}: ${v ?? 'no data'} ${unitLabel}` : undefined}
                onKeyDown={(e) => { if (abbr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(abbr) } }}
              >
                <title>{abbr ? `${metrics.get(abbr)?.name ?? abbr}: ${v ?? 'no data'} ${unitLabel}` : 'no CDC data'}</title>
              </path>
            )
          })}
        </svg>
        <p className="note">Click a state to see its trend below. Grey = no CDC report for this substance/year. Colour scales by {metric === 'rate' ? 'rate per 100k' : 'raw deaths'} (√-scaled for contrast).</p>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h4>{selectedName}: {STATE_SUBSTANCES.find((s) => s.id === substance)?.label} over time</h4>
          {selectedTrend.length > 1 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={selectedTrend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#26314a" />
                <XAxis dataKey="year" stroke="#8aa0c6" />
                <YAxis stroke="#8aa0c6" />
                <Tooltip contentStyle={{ background: '#0e1626', border: '1px solid #26314a' }} />
                <Line type="monotone" dataKey={metric === 'rate' ? 'ratePer100k' : 'deaths'} stroke="#ff9f6e" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="note">Select a state on the map.</p>}
        </div>

        <div className="panel">
          <h4>Fastest-rising states — rate change {years[0]}→{latest}</h4>
          <DataTableViewport label={`Fastest-rising state overdose rates from ${years[0]} to ${latest}`}>
            <table className="data-table">
            <thead><tr><th>State</th><th>{years[0]}</th><th>{latest}</th><th>Change</th></tr></thead>
            <tbody>
              {movers.slice(0, 10).map((m) => (
                <tr key={m.abbr} className="scan-row" onClick={() => setSelected(m.abbr)}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(m.abbr) } }}>
                  <td className={m.abbr === selected ? 'hot' : ''}>{m.name}</td>
                  <td>{m.fromRate}</td>
                  <td>{m.toRate}</td>
                  <td className={m.changePct != null && m.changePct > 0 ? 'hot' : ''}>{fmtPct(m.changePct)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </DataTableViewport>
          <p className="panel-note">Deaths per 100k, so a small high-rate state isn't buried under a large one.</p>
        </div>
      </div>

      <h3>All states — {STATE_SUBSTANCES.find((s) => s.id === substance)?.label}, {year}</h3>
      <DataTableViewport label={`All-state overdose records for ${STATE_SUBSTANCES.find((s) => s.id === substance)?.label ?? substance}, ${year}`}>
        <table className="data-table">
        <thead><tr><th>State</th><th>Deaths</th><th>Rate / 100k</th></tr></thead>
        <tbody>
          {ranked.map((m) => (
            <tr key={m.abbr} className={`scan-row ${m.abbr === selected ? 'scan-row--active' : ''}`}
                onClick={() => setSelected(m.abbr)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(m.abbr) } }}>
              <td>{m.name}</td>
              <td>{m.deaths.toLocaleString()}</td>
              <td>{m.ratePer100k ?? '—'}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </DataTableViewport>

      <p className="note">
        Source: {OVERDOSE_META.source}, 12-month-ending counts, full calendar years only.
        Provisional and subject to revision. Rates use 2023 US Census population. A state greyed on
        the map did not report this substance for this year — CDC suppresses low or unreliable
        counts, which is missing evidence, not zero.
      </p>
    </section>
  )
}
