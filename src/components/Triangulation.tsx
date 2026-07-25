import { useMemo, useState, type ChangeEvent } from 'react'
import { DRUGS } from '../data/prices'
import { useData } from '../lib/dataStore'
import {
  BUNDLED_OVERDOSE_RECORDS, BUNDLED_WASTEWATER_RECORDS,
  OVERDOSE_META, WASTEWATER_META, withBundled,
} from '../data/bundled'
import { SEIZURE_COUNTRIES, SEIZURE_YEARS, fmtKg } from '../lib/seizures'
import {
  triangulate,
  MODALITY_LABEL,
  MODALITY_COLLECTOR,
  MODALITY_SIDE,
  VERDICT_LABEL,
  VERDICT_PLAIN_ENGLISH,
  DRUG_BRIDGE,
  MATERIAL_CHANGE_THRESHOLD,
  type TriangulationVerdict,
} from '../lib/triangulate'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'
import type { Drug } from '../types'

/** Verdict -> the chip style that carries the right urgency. */
const VERDICT_CHIP: Record<TriangulationVerdict, string> = {
  concordantExpansion: 'tk-chip--warning',
  concordantContraction: 'tk-chip--ok',
  enforcementArtifact: 'tk-chip--warning',
  undetectedExpansion: 'tk-chip--warning',
  mixedSignals: '',
  untriangulated: '',
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

      <h3>
        The four modalities — {country?.name ?? iso3}, {DRUGS.find((d) => d.id === drug)?.label},
        {' '}{baselineYear} → {year}
      </h3>
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
