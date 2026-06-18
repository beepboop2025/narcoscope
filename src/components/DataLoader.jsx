import { useState } from 'react'
import { loadData, useData } from '../lib/dataStore.js'

// Each picker maps to one parser/dataset in loadData(). Omit a file → that
// dataset keeps its current data, so you can load one CSV at a time.
const FIELDS = [
  { key: 'prices', label: 'Street prices' },
  { key: 'precursorPrices', label: 'Precursor prices' },
  { key: 'flows', label: 'Precursor flows' },
  { key: 'mmRegions', label: 'Myanmar regions' },
  { key: 'mmBorderNodes', label: 'Myanmar border nodes' },
  { key: 'mmRegionRecords', label: 'Myanmar region stats' },
  { key: 'mmFlows', label: 'Myanmar flows' },
]

export default function DataLoader() {
  const { isSample } = useData()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState({})
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)

  const pick = (key, file) => setFiles((f) => ({ ...f, [key]: file }))

  const run = async () => {
    setBusy(true)
    try {
      const bundle = {}
      for (const { key } of FIELDS) {
        if (files[key]) bundle[key] = await files[key].text()
      }
      setReport(loadData(bundle))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="loader">
      <button className="loader-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Load official data (CSV) — currently showing{' '}
        <strong>{isSample ? 'sample' : 'loaded'}</strong> data
      </button>

      {open && (
        <div className="loader-body">
          <p className="note">
            Drop in INCB/UNODC CSV exports. Each file is parsed by the matching
            function in <code>src/lib/ingest.js</code>; bad rows are reported, not
            silently dropped. See <code>src/lib/ingest-config-reference.md</code> for
            which source columns map to each field.
          </p>

          <div className="loader-grid">
            {FIELDS.map(({ key, label }) => (
              <label key={key} className="loader-field">
                <span>{label}{files[key] ? ' ✓' : ''}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => pick(key, e.target.files[0] ?? null)}
                />
              </label>
            ))}
          </div>

          <button className="loader-run" onClick={run} disabled={busy}>
            {busy ? 'Parsing…' : 'Parse & load'}
          </button>

          {report && (
            <div className={`loader-report ${report.ok ? 'ok' : 'err'}`}>
              {Object.keys(report.loaded).length > 0 ? (
                <p>
                  Loaded:{' '}
                  {Object.entries(report.loaded).map(([k, n]) => `${k} (${n})`).join(', ')}
                </p>
              ) : (
                <p>No datasets loaded.</p>
              )}
              {report.errors.length > 0 && (
                <ul className="report-errors">
                  {report.errors.map((e, i) => <li key={i}>⛔ {e}</li>)}
                </ul>
              )}
              {report.warnings.length > 0 && (
                <details>
                  <summary>{report.warnings.length} row warning(s)</summary>
                  <ul>{report.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
