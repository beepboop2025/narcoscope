import { useMemo, useState, type ChangeEvent } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import series from '../data/priceSeries.json'
import DataTableViewport from './DataTableViewport'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'

/**
 * The 30-year price history — UNODC Annex 8.3. Where Street Prices shows a
 * dense five-year window, this shows the long arc: retail heroin and cocaine
 * street prices back to 1990, which is where the story lives (the long collapse
 * in European heroin prices; the flatter, higher cocaine line). Its own lazy
 * tab so the ~118 kB series never touches the landing path.
 */

type Rec = { drug: string; region: string; country: string; year: number; priceUsdPerGram: number }
const RECORDS = series.records as Rec[]
const META = series.meta

const LINE_COLORS = ['#6ea8fe', '#ff9f6e', '#79e0a8', '#e06ec0', '#e0d36e', '#a1ecff', '#f4a4c0']

/** Countries shown by default — a legible spread, US bold via ordering. */
const DEFAULT_COUNTRIES = ['United States', 'United Kingdom', 'Germany', 'France', 'Italy']

export default function PriceHistory() {
  const [drug, setDrug] = useState('heroin')

  const forDrug = useMemo(() => RECORDS.filter((r) => r.drug === drug), [drug])
  const countries = useMemo(
    () => [...new Set(forDrug.map((r) => r.country))].sort(),
    [forDrug],
  )
  const [selected, setSelected] = useState<string[]>(DEFAULT_COUNTRIES)

  const shown = selected.filter((c) => countries.includes(c))

  // One row per year, one key per selected country.
  const chartData = useMemo(() => {
    const years = [...new Set(forDrug.map((r) => r.year))].sort((a, b) => a - b)
    return years.map((year) => {
      const row: Record<string, number> = { year }
      for (const c of shown) {
        const rec = forDrug.find((r) => r.country === c && r.year === year)
        if (rec) row[c] = rec.priceUsdPerGram
      }
      return row
    })
  }, [forDrug, shown])

  // Long-run change per shown country: first vs last year it reported.
  const changes = useMemo(() => shown.map((c) => {
    const pts = forDrug.filter((r) => r.country === c).sort((a, b) => a.year - b.year)
    if (pts.length < 2) return { country: c, from: null, to: null, changePct: null, fromYear: null, toYear: null }
    const first = pts[0]; const last = pts[pts.length - 1]
    return {
      country: c, from: first.priceUsdPerGram, to: last.priceUsdPerGram,
      fromYear: first.year, toYear: last.year,
      changePct: first.priceUsdPerGram > 0 ? (last.priceUsdPerGram - first.priceUsdPerGram) / first.priceUsdPerGram : null,
    }
  }), [forDrug, shown])

  const biggestFall = useMemo(
    () => [...changes].filter((c) => c.changePct != null).sort((a, b) => (a.changePct as number) - (b.changePct as number))[0],
    [changes],
  )

  const toggleCountry = (c: string) =>
    setSelected((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))

  const fmtPct = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`

  return (
    <section>
      <div className="controls">
        <label>
          Drug&nbsp;
          <select value={drug} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDrug(e.target.value)}>
            <option value="heroin">Heroin</option>
            <option value="cocaine">Cocaine</option>
          </select>
        </label>
      </div>

      <div className="stat-band">
        <div className="stat">
          <span className="stat-value">{META.yearRange[0]}–{META.yearRange[1]}</span>
          <span className="stat-label">Years covered</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={countries.length} group={false} /></span>
          <span className="stat-label">Countries reporting {drug}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{biggestFall ? fmtPct(biggestFall.changePct) : '—'}</span>
          <span className="stat-label">
            {biggestFall ? `${biggestFall.country} (${biggestFall.fromYear}→${biggestFall.toYear})` : 'biggest change'}
          </span>
        </div>
      </div>

      <Explainer
        text={
          drug === 'heroin'
            ? `European heroin street prices collapsed over three decades — ${biggestFall?.country ?? 'many markets'} ` +
              `fell ${fmtPct(biggestFall?.changePct ?? null)} from ${biggestFall?.fromYear ?? '1990'} to ${biggestFall?.toYear ?? '2023'}. ` +
              `Falling retail prices usually mean rising supply, not falling demand — the same reading the Triangulation tab formalises.`
            : `Cocaine street prices held far steadier than heroin's over the same decades, and higher — a different market ` +
              `structure. Prices are nominal US$ per gram, not inflation-adjusted, so real declines are even steeper than they look.`
        }
      />

      <div className="chart-card">
        <h3>Retail {drug} street price, US$/g — {META.yearRange[0]}–{META.yearRange[1]}</h3>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#26314a" />
            <XAxis dataKey="year" stroke="#8aa0c6" />
            <YAxis stroke="#8aa0c6" tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#0e1626', border: '1px solid #26314a' }}
              formatter={(v) => `$${v}`}
            />
            <Legend />
            {shown.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={c === 'United States' ? 3 : 2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="note">Nominal US$ per gram (not inflation-adjusted). Toggle countries below; a gap means a year that country did not report.</p>
      </div>

      <div className="panel">
        <h4>Countries — toggle on the chart</h4>
        <div className="country-toggles">
          {countries.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip-toggle ${selected.includes(c) ? 'chip-toggle--on' : ''}`}
              onClick={() => toggleCountry(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <h3>Long-run change ({drug})</h3>
      <DataTableViewport label={`Long-run ${drug} price changes`}>
        <table className="data-table">
        <thead><tr><th>Country</th><th>First</th><th>Latest</th><th>Change</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.country}>
              <td>{c.country}</td>
              <td>{c.from != null ? `$${c.from} (${c.fromYear})` : '—'}</td>
              <td>{c.to != null ? `$${c.to} (${c.toYear})` : '—'}</td>
              <td className={c.changePct != null && c.changePct < 0 ? 'delta-down' : c.changePct != null && c.changePct > 0 ? 'hot' : ''}>
                {fmtPct(c.changePct)}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </DataTableViewport>

      <p className="note">
        Source: <a href={META.url} target="_blank" rel="noreferrer">{META.source}</a>. {META.note} US
        heroin data ends earlier than Europe's (ONDCP series). This complements the Street Prices
        tab, which shows a denser five-year window across many more countries.
      </p>
    </section>
  )
}
