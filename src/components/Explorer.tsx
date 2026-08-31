import { useMemo, useState, type ChangeEvent } from 'react'
import { DRUGS } from '../data/prices'
import { useData } from '../lib/dataStore'
import { affordabilityDays, purityAdjustedPrice } from '../lib/metrics'
import { explainPrices } from '../lib/explain'
import DataTableViewport from './DataTableViewport'
import Explainer from './Explainer'

const fmtUsd = (v: number | string | null | undefined): string =>
  (v == null ? 'n/a' : `$${Number(v).toFixed(2)}`)

/** Region → colour, so the price gradient reads geographically at a glance. */
const REGION_COLOR: Record<string, string> = {
  Americas: '#79e0a8',
  Europe: '#6ea8fe',
  Asia: '#ff9f6e',
  Africa: '#e0c37f',
  Oceania: '#e06ec0',
}
const REGION_ORDER = ['Americas', 'Europe', 'Asia', 'Africa', 'Oceania']

export default function Explorer() {
  const { priceRecords } = useData()
  const [drug, setDrug] = useState('cocaine')
  const [purityAdjusted, setPurityAdjusted] = useState(false)

  const rows = useMemo(
    () => priceRecords.filter((r) => r.drug === drug),
    [priceRecords, drug],
  )

  // The data is a single-year cross-section (UNODC WDR 2025 Annex 8.1, 2019),
  // so the honest view is a RANKED price-by-country bar, not a time trend — a
  // line chart of one year collapses every country onto one vertical stack.
  // Ranking also shows the story the explainer tells: cheap near production,
  // dear the further a drug travels.
  const bars = useMemo(() => {
    return rows
      .map((r) => {
        const price = purityAdjusted
          ? purityAdjustedPrice(r.priceUsdPerGram, r.purityPct)
          : r.priceUsdPerGram
        return price == null
          ? null
          : { country: r.country, region: r.region, price: Number(price.toFixed(2)) }
      })
      .filter((x): x is { country: string; region: string; price: number } => x != null)
      .sort((a, b) => b.price - a.price)
  }, [rows, purityAdjusted])
  const maxPrice = bars.length ? bars[0].price : 1
  const regionsPresent = REGION_ORDER.filter((r) => bars.some((b) => b.region === r))
  const priceYear = rows[0]?.year ?? 2019

  const drugLabel = DRUGS.find((d) => d.id === drug)?.label ?? drug
  const explanation = useMemo(() => explainPrices(rows, drugLabel), [rows, drugLabel])

  return (
    <section>
      <div className="controls">
        <label>
          Drug&nbsp;
          <select value={drug} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDrug(e.target.value)}>
            {DRUGS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={purityAdjusted}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPurityAdjusted(e.target.checked)}
          />
          &nbsp;Price per <em>pure</em> gram (purity-adjusted)
        </label>
      </div>

      <Explainer text={explanation} />

      <div className="chart-card">
        <div className="price-chart-head">
          <h3>
            {purityAdjusted ? 'Price per pure gram' : 'Retail price per gram'} by country — {drugLabel} ({priceYear})
          </h3>
          <div className="region-legend">
            {regionsPresent.map((r) => (
              <span key={r} className="region-key">
                <span className="region-dot" style={{ background: REGION_COLOR[r] }} />{r}
              </span>
            ))}
          </div>
        </div>
        {bars.length ? (
          <div className="price-bars">
            {bars.map((b) => (
              <div className="price-bar-row" key={b.country}>
                <span className="price-bar-label" title={`${b.country} · ${b.region}`}>{b.country}</span>
                <span className="price-bar-track">
                  <span
                    className="price-bar-fill"
                    style={{ width: `${Math.max(1.5, (b.price / maxPrice) * 100)}%`, background: REGION_COLOR[b.region] ?? '#6ea8fe' }}
                  />
                </span>
                <span className="price-bar-value">{fmtUsd(b.price)}</span>
              </div>
            ))}
          </div>
        ) : <p className="note">No priced records for this drug.</p>}
        <p className="note">
          One year of data (UNODC WDR {priceYear} Annex 8.1), so this is a price snapshot ranked
          high to low, not a time trend. The 30-year trend for heroin and cocaine lives in the
          <strong> Price History</strong> tab. Bars are coloured by region.
        </p>
      </div>

      <DataTableViewport label="Street price records">
        <table className="data-table">
        <thead>
          <tr>
            <th>Country</th><th>Region</th><th>Year</th>
            <th>Price / g</th><th>Purity</th>
            <th>Price / pure g</th><th>Affordability</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pure = purityAdjustedPrice(r.priceUsdPerGram, r.purityPct)
            const aff = affordabilityDays(r.priceUsdPerGram, r.iso3)
            return (
              <tr key={i}>
                <td>{r.country}</td>
                <td>{r.region}</td>
                <td>{r.year}</td>
                <td>{fmtUsd(r.priceUsdPerGram)}</td>
                <td>{r.purityPct == null ? 'n/a' : `${r.purityPct}%`}</td>
                <td>{fmtUsd(pure)}</td>
                <td title="Days of average local income per gram">
                  {aff == null ? 'n/a' : `${aff.toFixed(2)} days`}
                </td>
              </tr>
            )
          })}
        </tbody>
        </table>
      </DataTableViewport>
    </section>
  )
}
