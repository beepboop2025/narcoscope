import { useMemo, useState, type ChangeEvent } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts'
import { DRUGS } from '../data/prices'
import { useData } from '../lib/dataStore'
import {
  BUNDLED_OVERDOSE_RECORDS, BUNDLED_WASTEWATER_RECORDS,
  OVERDOSE_META, WASTEWATER_META, withBundled,
} from '../data/bundled'
import { SEIZURE_COUNTRIES, SEIZURE_YEARS, fmtKg } from '../lib/seizures'
import {
  triangulate,
  triangulateSeries,
  scanDivergences,
  MODALITY_LABEL,
  MODALITY_COLLECTOR,
  MODALITY_SIDE,
  VERDICT_LABEL,
  VERDICT_PLAIN_ENGLISH,
  DRUG_BRIDGE,
  MATERIAL_CHANGE_THRESHOLD,
  type Modality,
  type TriangulationVerdict,
} from '../lib/triangulate'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'
import type { Drug } from '../types'
import DataTableViewport from './DataTableViewport'

/** Verdict -> the chip style that carries the right urgency. */
const VERDICT_CHIP: Record<TriangulationVerdict, string> = {
  concordantExpansion: 'tk-chip--warning',
  concordantContraction: 'tk-chip--ok',
  enforcementArtifact: 'tk-chip--warning',
  undetectedExpansion: 'tk-chip--warning',
  mixedSignals: '',
  untriangulated: '',
}

/**
 * Line colour per modality, chosen so SUPPLY reads warm and CONSUMPTION reads
 * cool — the same source-hot / destination-cool grammar the corridor maps use.
 * When the two sides diverge, warm and cool lines physically pull apart, which
 * is the whole point of drawing them together.
 */
const MODALITY_COLOR: Record<Modality, string> = {
  seizures: '#ff9f6e',
  retail_price: '#e0c37f',
  mortality: '#6ea8fe',
  wastewater: '#79e0a8',
}

const fmtPct = (v: number | null): string =>
  v === null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`

const arrow = (d: -1 | 0 | 1): string => (d === 1 ? '▲ rising' : d === -1 ? '▼ falling' : '● flat')

function fmtValue(value: number | null, unit: string): string {
  if (value === null) return '—'
  if (unit === 'kg') return fmtKg(value)
  if (unit === 'USD/g') return `$${value.toFixed(2)}`
  if (unit === 'deaths') return value.toLocaleString()
  return `${value.toFixed(1)} ${unit}`
}

const drugLabel = (id: Drug): string => DRUGS.find((d) => d.id === id)?.label ?? id

export default function Triangulation() {
  const {
    priceRecords,
    overdoseRecords: loadedOverdose,
    wastewaterRecords: loadedWastewater,
  } = useData()
  const overdoseRecords = withBundled(loadedOverdose, BUNDLED_OVERDOSE_RECORDS)
  const wastewaterRecords = withBundled(loadedWastewater, BUNDLED_WASTEWATER_RECORDS)
  const [iso3, setIso3] = useState('USA')
  const [drug, setDrug] = useState<Drug>('methamphetamine')

  // Compare the latest seizure year against the earliest, so the window is the
  // full span UNODC publishes rather than an arbitrary one-year hop that
  // single-year reporting gaps could swallow.
  const year = SEIZURE_YEARS[SEIZURE_YEARS.length - 1]
  const baselineYear = SEIZURE_YEARS[0]

  const country = SEIZURE_COUNTRIES.find((c) => c.iso3 === iso3)
  const drugList = useMemo(() => DRUGS.map((d) => d.id), [])

  const result = useMemo(
    () => triangulate({
      iso3,
      country: country?.name ?? iso3,
      drug,
      year,
      baselineYear,
      priceRecords,
      overdoseRecords,
      wastewaterRecords,
    }),
    [iso3, country, drug, year, baselineYear, priceRecords, overdoseRecords, wastewaterRecords],
  )

  // The scan runs every country+drug pair and ranks divergences first, so the
  // interesting cases surface without the user knowing to hunt for them. It
  // does not depend on the current selection, so it is memoised on the data
  // alone and stays stable while the user clicks around.
  const scan = useMemo(
    () => scanDivergences({
      countries: SEIZURE_COUNTRIES.map((c) => ({ iso3: c.iso3, name: c.name })),
      drugs: drugList,
      year,
      baselineYear,
      priceRecords,
      overdoseRecords,
      wastewaterRecords,
    }),
    [drugList, year, baselineYear, priceRecords, overdoseRecords, wastewaterRecords],
  )

  const series = useMemo(
    () => triangulateSeries({
      iso3,
      country: country?.name ?? iso3,
      drug,
      priceRecords,
      overdoseRecords,
      wastewaterRecords,
    }),
    [iso3, country, drug, priceRecords, overdoseRecords, wastewaterRecords],
  )

  // Reshape the indexed series into recharts rows: one object per year, one key
  // per modality. Only years where at least one modality has a value are kept.
  const chartData = useMemo(() => {
    return series.years
      .map((yr) => {
        const row: Record<string, number> = { year: yr }
        let any = false
        for (const s of series.series) {
          const pt = s.points.find((p) => p.year === yr)
          if (pt?.index != null) { row[s.modality] = pt.index; any = true }
        }
        return any ? row : null
      })
      .filter((r): r is Record<string, number> => r !== null)
  }, [series])

  // Countries ranked by how many modalities they can actually support, so the
  // picker leads with the ones where triangulation is possible rather than
  // making the user hunt for them.
  const countryOptions = useMemo(() => {
    const scored = SEIZURE_COUNTRIES.map((c) => {
      const r = triangulate({
        iso3: c.iso3,
        country: c.name,
        drug,
        year,
        baselineYear,
        priceRecords,
        overdoseRecords,
        wastewaterRecords,
      })
      return { ...c, coverage: r.modalityCoverage }
    })
    return scored.sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name))
  }, [drug, year, baselineYear, priceRecords, overdoseRecords, wastewaterRecords])

  const bridge = DRUG_BRIDGE[drug]

  return (
    <section>
      {/* Divergence scan — the interesting cases surfaced automatically. */}
      <div className="chart-card">
        <h3>Where supply and consumption disagree — {baselineYear}→{year}</h3>
        <Explainer
          text={
            `Of every country and drug that can be cross-checked, ${scan.filter((h) => h.verdict === 'undetectedExpansion' || h.verdict === 'enforcementArtifact').length} show ` +
            `supply and consumption moving in genuinely different directions. Those are listed first: they are the cases a ` +
            `seizure-only view gets wrong. Click any row to open it.`
          }
        />
        <DataTableViewport label={`Supply and consumption divergence scan from ${baselineYear} to ${year}`}>
          <table className="data-table">
          <thead>
            <tr>
              <th>Country</th><th>Drug</th><th>Verdict</th><th>Supply</th><th>Consumption</th><th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {scan.slice(0, 8).map((h) => {
              const open = () => { setIso3(h.iso3); setDrug(h.drug) }
              return (
              <tr
                key={`${h.iso3}-${h.drug}`}
                className={`scan-row ${iso3 === h.iso3 && drug === h.drug ? 'scan-row--active' : ''}`}
                // A clickable row must also be operable without a mouse: it takes
                // focus, announces itself as a button, and responds to Enter and
                // Space the way a button does.
                role="button"
                tabIndex={0}
                aria-label={`Open ${h.country} ${drugLabel(h.drug)} — ${VERDICT_LABEL[h.verdict]}`}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
                }}
              >
                <td>{h.country}</td>
                <td>{drugLabel(h.drug)}</td>
                <td>
                  <span className={`tk-chip ${VERDICT_CHIP[h.verdict]}`}>{VERDICT_LABEL[h.verdict]}</span>
                  {h.verdictFragile ? <span className="scan-fragile" title="Verdict flips if one modality is dropped"> ⚑</span> : null}
                </td>
                <td className={h.supplyDirection === 1 ? 'hot' : ''}>{arrow(h.supplyDirection)} {fmtPct(h.supplyChangePct)}</td>
                <td>{arrow(h.demandDirection)} {fmtPct(h.demandChangePct)}</td>
                <td>{Math.round(h.gap * 100)} pts</td>
              </tr>
              )
            })}
          </tbody>
          </table>
        </DataTableViewport>
        <p className="note">Gap = distance between the supply and consumption changes over the window. ⚑ marks a verdict that would flip if one modality were dropped.</p>
      </div>

      <div className="controls">
        <label>
          Country&nbsp;
          <select value={iso3} onChange={(e: ChangeEvent<HTMLSelectElement>) => setIso3(e.target.value)}>
            {countryOptions.map((c) => (
              <option key={c.iso3} value={c.iso3}>
                {c.name} — {c.coverage} modalit{c.coverage === 1 ? 'y' : 'ies'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Drug&nbsp;
          <select value={drug} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDrug(e.target.value as Drug)}>
            {DRUGS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
      </div>

      <div className="stat-band">
        <div className="stat">
          <span className="stat-value"><CountUp value={result.modalityCoverage} group={false} /> / 4</span>
          <span className="stat-label">Modalities with data</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={result.independentCollectors} group={false} /></span>
          <span className="stat-label">Independent collectors</span>
        </div>
        <div className="stat">
          <span className="stat-value">{arrow(result.supplyDirection)}</span>
          <span className="stat-label">Supply signal</span>
        </div>
        <div className="stat">
          <span className="stat-value">{arrow(result.demandDirection)}</span>
          <span className="stat-label">Consumption signal</span>
        </div>
      </div>

      <div className="tk-card">
        <p>
          <span className={`data-badge tk-chip ${VERDICT_CHIP[result.verdict]}`}>
            {VERDICT_LABEL[result.verdict]}
          </span>
          {result.verdictFragile && result.fragileModality ? (
            <span className="data-badge tk-chip tk-chip--warning" style={{ marginLeft: '0.5rem' }}>
              Not robust — flips without {MODALITY_LABEL[result.fragileModality].toLowerCase()}
            </span>
          ) : null}
          {result.atMinimumCoverage ? (
            <span className="data-badge tk-chip" style={{ marginLeft: '0.5rem' }}>
              Minimum coverage — two collectors, no tie-breaker
            </span>
          ) : null}
        </p>
        <Explainer text={VERDICT_PLAIN_ENGLISH[result.verdict]} />
      </div>

      {/* The divergence, drawn. Every modality rebased to 100 at its own first
          year, so trajectories are comparable even though the units are not. */}
      {chartData.length > 1 ? (
        <div className="chart-card">
          <h3>Trajectories, indexed to 100 — {country?.name ?? iso3}, {drugLabel(drug)}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#26314a" />
              <XAxis dataKey="year" stroke="#8aa0c6" />
              <YAxis stroke="#8aa0c6" />
              <ReferenceLine y={100} stroke="#4a5a7a" strokeDasharray="4 4" label={{ value: 'baseline', fill: '#8aa0c6', fontSize: 11, position: 'insideBottomLeft' }} />
              <Tooltip
                contentStyle={{ background: '#0e1626', border: '1px solid #26314a' }}
                formatter={(v, name) => [`${v} (index)`, MODALITY_LABEL[name as Modality]]}
              />
              <Legend formatter={(name) => `${MODALITY_LABEL[name as Modality]} (${MODALITY_SIDE[name as Modality] === 'supply' ? 'supply' : 'consumption'})`} />
              {series.series.map((s) => (
                <Line
                  key={s.modality}
                  type="monotone"
                  dataKey={s.modality}
                  stroke={MODALITY_COLOR[s.modality]}
                  strokeWidth={2}
                  strokeDasharray={s.side === 'supply' ? undefined : '5 3'}
                  dot={{ r: 2 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="note">
            Solid = supply, dashed = consumption. Each line starts at 100 in its own first year;
            the reader compares <em>shapes</em>, never levels — the units (kg, deaths, mg/1000/day)
            are not comparable, but the trajectories are. Lines pulling apart is the divergence.
          </p>
        </div>
      ) : null}

      <h3>
        The four modalities — {country?.name ?? iso3}, {drugLabel(drug)},
        {' '}{baselineYear} → {year}
      </h3>
      <DataTableViewport label={`Four-modality reading for ${country?.name ?? iso3}, ${drugLabel(drug)}`}>
        <table className="data-table">
        <thead>
          <tr>
            <th>Modality</th>
            <th>Measures</th>
            <th>Collected by</th>
            <th>{baselineYear}</th>
            <th>{year}</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {result.readings.map((r) => (
            <tr key={r.modality} className={r.available ? '' : 'tk-degraded'}>
              <td>{MODALITY_LABEL[r.modality]}</td>
              <td>{MODALITY_SIDE[r.modality] === 'supply' ? 'Supply' : 'Consumption'}</td>
              <td>{MODALITY_COLLECTOR[r.modality]}</td>
              <td>{fmtValue(r.baselineValue, r.unit)}</td>
              <td>{fmtValue(r.currentValue, r.unit)}</td>
              <td>
                {r.available
                  ? fmtPct(r.changePct)
                  : <span title={r.absentReason ?? ''}>no data</span>}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </DataTableViewport>

      {result.readings.some((r) => !r.available) ? (
        <div className="tk-card tk-card--watch">
          <h4>Why modalities are missing</h4>
          <ul>
            {result.readings.filter((r) => !r.available).map((r) => (
              <li key={r.modality}>
                <strong>{MODALITY_LABEL[r.modality]}:</strong> {r.absentReason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.caveats.length > 0 ? (
        <div className="tk-card tk-card--watch">
          <h4>Caveats on this reading</h4>
          <ul>
            {result.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      ) : null}

      <p className="note">
        <strong>Why this tab exists.</strong> A seizure figure cannot tell you whether more drugs
        moved or more officers looked — the series contains no information that separates
        trafficking volume from enforcement capacity. Reading it against modalities collected by
        <em> different institutions</em> can. Where they agree, the reading is credible; where they
        diverge, the divergence is the finding. Movement smaller than{' '}
        {(MATERIAL_CHANGE_THRESHOLD * 100).toFixed(0)}% is treated as flat.
        {bridge.caveat ? <> {bridge.caveat}</> : null}
      </p>

      <p className="note">
        Mortality: {OVERDOSE_META.source}, 12-month-ending counts, latest window{' '}
        {OVERDOSE_META.latestWindow}. Provisional and subject to revision. Seizures: UNODC WDR 2025
        Annex 7.1. Prices: UNODC WDR 2025 Annex 8.1. Wastewater: {WASTEWATER_META.source}{' '}
        ({WASTEWATER_META.sites.length} cities, {WASTEWATER_META.years.join('/')}) — Canada only.
        EUDA (Europe) and ACIC (Australia) publish comparable series but block automated
        collection, so those regions stay CSV-load only rather than being filled with invented
        figures.
      </p>
    </section>
  )
}
