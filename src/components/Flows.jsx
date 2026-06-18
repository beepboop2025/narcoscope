import { useMemo, useState } from 'react'
import { PRECURSORS } from '../data/flows.js'
import { useData } from '../lib/dataStore.js'
import { explainFlows } from '../lib/explain.js'
import Explainer from './Explainer.jsx'

const fmtKg = (v) => `${Number(v).toLocaleString()} kg`
const fmtUsd = (v) => `$${Number(v).toLocaleString()}`

export default function Flows() {
  const { flowRecords, precursorPriceRecords } = useData()
  const [precursor, setPrecursor] = useState('all')

  const flows = useMemo(
    () => flowRecords.filter((r) => precursor === 'all' || r.precursor === precursor),
    [flowRecords, precursor],
  )
  const prices = useMemo(
    () => precursorPriceRecords.filter((r) => precursor === 'all' || r.precursor === precursor),
    [precursorPriceRecords, precursor],
  )

  const labelFor = (id) => PRECURSORS.find((p) => p.id === id)?.label ?? id

  return (
    <section>
      <div className="controls">
        <label>
          Precursor class&nbsp;
          <select value={precursor} onChange={(e) => setPrecursor(e.target.value)}>
            <option value="all">All precursors</option>
            {PRECURSORS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <Explainer text={explainFlows(flows, precursor === 'all' ? 'all tracked precursors' : labelFor(precursor))} />

      <h3>Trafficking corridors — seized volumes (country-level, annual)</h3>
      <table className="data-table">
        <thead>
          <tr><th>Precursor</th><th>Origin</th><th>Transit</th><th>Destination</th><th>Year</th><th>Seized</th></tr>
        </thead>
        <tbody>
          {flows.map((r, i) => (
            <tr key={i}>
              <td>{labelFor(r.precursor)}</td>
              <td className={r.origin === 'China' ? 'hot' : ''}>{r.origin}</td>
              <td>{r.transit ?? '—'}</td>
              <td>{r.destination}</td>
              <td>{r.year}</td>
              <td>{fmtKg(r.quantityKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Precursor prices (USD per kg, country-level)</h3>
      <table className="data-table">
        <thead>
          <tr><th>Precursor</th><th>Country</th><th>Region</th><th>Year</th><th>Price / kg</th></tr>
        </thead>
        <tbody>
          {prices.map((r, i) => (
            <tr key={i}>
              <td>{labelFor(r.precursor)}</td>
              <td className={r.country === 'China' ? 'hot' : ''}>{r.country}</td>
              <td>{r.region}</td>
              <td>{r.year}</td>
              <td>{fmtUsd(r.priceUsdPerKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        Highlighted rows mark <strong>China</strong> as origin/source — the
        upstream supply hub this tool is built to keep visible. Map view (corridor
        arcs over a world map) is the next build step once real INCB/UNODC data is
        loaded via <code>src/lib/ingest.js</code>.
      </p>
    </section>
  )
}
