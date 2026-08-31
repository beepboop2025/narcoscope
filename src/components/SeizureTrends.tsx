import { useMemo, useState, type ChangeEvent } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { SEIZURE_META, fmtKg } from '../lib/seizures'
import { worldTrendByGroup, countryMovers, TREND_WINDOW } from '../lib/seizureTrends'
import DataTableViewport from './DataTableViewport'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'

/**
 * Seizure Trends — the time dimension of the UNODC seizure dataset (164
 * countries × ~160 drugs × 5 years). The Flow Map shows one year; this shows
 * the arc. Lazy tab so the ~210 kB seizure dataset stays out of the entry.
 */

const LINE_COLORS = ['#6ea8fe', '#ff9f6e', '#79e0a8', '#e06ec0', '#e0d36e', '#a1ecff', '#f4a4c0', '#c0a4f4']

const fmtPct = (v: number | null): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`

const fmtT = (kg: number): string => `${Math.round(kg / 1000).toLocaleString()} t`

export default function SeizureTrends() {
  const groups = useMemo(() => worldTrendByGroup(), [])
  // Chart the top groups by latest volume; the long tail clutters more than it tells.
  const charted = groups.slice(0, 6)
  const [groupIndex, setGroupIndex] = useState<number | null>(null)

  const chartData = useMemo(() => {
    const years = SEIZURE_META.years
    return years.map((year) => {
      const row: Record<string, number> = { year }
      for (const g of charted) {
        const kg = g.series.find(([y]) => y === year)?.[1] ?? 0
        row[g.label] = Math.round(kg / 1000) // tonnes
      }
      return row
    })
  }, [charted])

  const movers = useMemo(() => countryMovers(groupIndex).slice(0, 12), [groupIndex])
  const groupLabel = groupIndex == null ? 'all drugs' : groups.find((g) => g.groupIndex === groupIndex)?.label ?? ''

  const risers = groups.filter((g) => (g.changePct ?? 0) > 0.1)
  const fallers = groups.filter((g) => (g.changePct ?? 0) < -0.1)

  return (
    <section>
      <div className="stat-band">
        <div className="stat">
          <span className="stat-value">{TREND_WINDOW[0]}–{TREND_WINDOW[1]}</span>
          <span className="stat-label">Window</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={groups.length} group={false} /></span>
          <span className="stat-label">Drug groups tracked</span>
        </div>
        <div className="stat">
          <span className="stat-value">{groups[0]?.label ?? '—'}</span>
          <span className="stat-label">Largest by volume: {groups[0] ? fmtT(groups[0].latestKg) : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={risers.length} group={false} /> ↑ / <CountUp value={fallers.length} group={false} /> ↓</span>
          <span className="stat-label">Groups rising / falling</span>
        </div>
      </div>

      <Explainer
        text={
          `Across ${TREND_WINDOW[0]}–${TREND_WINDOW[1]}, ${groups[0]?.label ?? 'cannabis'} remained the ` +
          `most-seized drug class by weight. ${risers.length} groups rose and ${fallers.length} fell over the window. ` +
          `Read seizure trends carefully: totals are dominated by a handful of mega-seizures, so a single record can ` +
          `swing a world total — the tables below show the raw tonnage so the magnitude is visible.`
        }
      />

      <div className="chart-card">
        <h3>World seizures by drug group — tonnes, {TREND_WINDOW[0]}–{TREND_WINDOW[1]}</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#26314a" />
            <XAxis dataKey="year" stroke="#8aa0c6" />
            <YAxis stroke="#8aa0c6" tickFormatter={(v) => `${v.toLocaleString()} t`} />
            <Tooltip contentStyle={{ background: '#0e1626', border: '1px solid #26314a' }} formatter={(v) => `${Number(v).toLocaleString()} t`} />
            <Legend />
            {charted.map((g, i) => (
              <Line key={g.label} type="monotone" dataKey={g.label} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="note">Shared honest scale (tonnes), never per-year-normalised. Long-tail groups omitted from the chart; all are in the table below.</p>
      </div>

      <h3>Drug groups — change over the window</h3>
      <DataTableViewport label={`Drug-group seizure changes from ${TREND_WINDOW[0]} to ${TREND_WINDOW[1]}`}>
        <table className="data-table">
        <thead><tr><th>Drug group</th><th>{TREND_WINDOW[0]}</th><th>{TREND_WINDOW[1]}</th><th>Change</th></tr></thead>
        <tbody>
          {groups.map((g) => {
            const from = g.series[0]?.[1] ?? 0
            return (
              <tr key={g.group}>
                <td>{g.label}</td>
                <td>{fmtKg(from)}</td>
                <td>{fmtKg(g.latestKg)}</td>
                <td className={g.changePct != null && g.changePct > 0 ? 'hot' : g.changePct != null && g.changePct < 0 ? 'delta-down' : ''}>
                  {fmtPct(g.changePct)}
                </td>
              </tr>
            )
          })}
        </tbody>
        </table>
      </DataTableViewport>

      <div className="controls" style={{ marginTop: '1.5rem' }}>
        <label>
          Movers for&nbsp;
          <select value={groupIndex ?? 'all'} onChange={(e: ChangeEvent<HTMLSelectElement>) => setGroupIndex(e.target.value === 'all' ? null : Number(e.target.value))}>
            <option value="all">All drugs</option>
            {groups.map((g) => <option key={g.group} value={g.groupIndex}>{g.label}</option>)}
          </select>
        </label>
      </div>

      <h3>Biggest country movers — {groupLabel}, by tonnage change</h3>
      <DataTableViewport label={`Country seizure movers for ${groupLabel}`}>
        <table className="data-table">
        <thead><tr><th>Country</th><th>{TREND_WINDOW[0]}</th><th>{TREND_WINDOW[1]}</th><th>Change</th></tr></thead>
        <tbody>
          {movers.map((m) => (
            <tr key={m.iso3}>
              <td>{m.name}</td>
              <td>{fmtKg(m.fromKg)}</td>
              <td>{fmtKg(m.toKg)}</td>
              <td className={m.changeKg > 0 ? 'hot' : 'delta-down'}>
                {m.changeKg > 0 ? '+' : ''}{fmtKg(m.changeKg)}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </DataTableViewport>

      <p className="note">
        Source: {SEIZURE_META.source}. Seized volume is the standard public proxy for trafficking
        pressure, reflecting both flow and enforcement — which is why the Triangulation tab reads it
        against consumption. Ranked by absolute tonnage change, so a country moving thousands of
        tonnes isn't buried under one moving grams.
      </p>
    </section>
  )
}
