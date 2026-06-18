import { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, Line, Marker } from 'react-simple-maps'
import topology from 'world-atlas/countries-110m.json'
import { useData } from '../lib/dataStore.js'
import { explainMyanmar } from '../lib/explain.js'
import Explainer from './Explainer.jsx'

const widthScale = (qty, max) => (max ? 1 + (qty / max) * 5 : 1)

export default function MyanmarFocus() {
  const { mmRegions, mmBorderNodes, mmRegionRecords, mmFlowRecords } = useData()
  const [yearIdx, setYearIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Resolve any region/border id -> [lng, lat] from the (possibly swapped-in)
  // node tables. Rebuilds only when the node tables change.
  const coordOf = useMemo(() => {
    const idx = Object.fromEntries(
      [...mmRegions, ...mmBorderNodes].map((n) => [n.id, [n.lng, n.lat]]),
    )
    return (id) => idx[id] ?? null
  }, [mmRegions, mmBorderNodes])

  // Resolve any id -> human label (for the plain-English explainer).
  const labelOf = useMemo(() => {
    const idx = Object.fromEntries([...mmRegions, ...mmBorderNodes].map((n) => [n.id, n.label]))
    return (id) => idx[id] ?? id
  }, [mmRegions, mmBorderNodes])

  const years = useMemo(
    () => [...new Set(mmRegionRecords.map((r) => r.year))].sort((a, b) => a - b),
    [mmRegionRecords],
  )
  useEffect(() => { setYearIdx((i) => Math.min(i, Math.max(0, years.length - 1))) }, [years.length])
  useEffect(() => {
    if (!playing || years.length < 2) return
    const id = setInterval(() => setYearIdx((i) => (i + 1) % years.length), 1200)
    return () => clearInterval(id)
  }, [playing, years.length])
  const currentYear = years[Math.min(yearIdx, years.length - 1)]

  const regionRows = useMemo(
    () => mmRegionRecords.filter((r) => r.year === currentYear),
    [mmRegionRecords, currentYear],
  )
  const flows = useMemo(
    () => mmFlowRecords.filter((r) => r.year === currentYear),
    [mmFlowRecords, currentYear],
  )

  // Stable scales across all years (honest comparison during playback).
  const maxHa = useMemo(() => Math.max(0, ...mmRegionRecords.map((r) => r.opiumHa)), [mmRegionRecords])
  const maxQty = useMemo(() => Math.max(0, ...mmFlowRecords.map((r) => r.quantityKg)), [mmFlowRecords])

  const haFor = (id) => regionRows.find((r) => r.region === id)?.opiumHa ?? 0
  const methFor = (id) => regionRows.find((r) => r.region === id)?.methIndex ?? 0

  return (
    <section>
      <p className="intro">
        Zooming from country → province. Circles are Myanmar production regions
        (sized by opium-poppy hectares; redder = higher synthetic-drug activity
        index). Diamonds are named cross-border corridor towns; arcs show seized
        volumes leaving toward China, Thailand, the Mekong, and NE India.
      </p>

      <div className="timeline">
        <button className="play-btn" onClick={() => setPlaying((p) => !p)} disabled={years.length < 2}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range" min={0} max={Math.max(0, years.length - 1)} step={1}
          value={Math.min(yearIdx, years.length - 1)}
          onChange={(e) => { setPlaying(false); setYearIdx(Number(e.target.value)) }}
          disabled={years.length < 2}
        />
        <span className="year-label">{currentYear ?? '—'}</span>
      </div>

      <Explainer text={explainMyanmar(regionRows, flows, currentYear, labelOf)} />

      <div className="map-card">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ center: [98.7, 22], scale: 1500 }}
          height={460}
          style={{ width: '100%', height: 'auto' }}
        >
          <Geographies geography={topology}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#15203a"
                  stroke="#26314a"
                  strokeWidth={0.5}
                  style={{ default: { outline: 'none' }, hover: { fill: '#1c2a48', outline: 'none' }, pressed: { outline: 'none' } }}
                />
              ))
            }
          </Geographies>

          {/* Cross-border corridor arcs */}
          {flows.map((rec) => {
            const from = coordOf(rec.from)
            const to = coordOf(rec.to)
            if (!from || !to) return null
            return (
              <Line
                key={`${rec.from}->${rec.to}`}
                from={from} to={to}
                stroke={rec.drug === 'Heroin' ? '#e0d36e' : '#ff7a59'}
                strokeWidth={widthScale(rec.quantityKg, maxQty)}
                strokeLinecap="round" opacity={0.8}
                style={{ default: { transition: 'stroke-width 0.6s ease' } }}
              />
            )
          })}

          {/* Border corridor towns (diamonds) */}
          {mmBorderNodes.map((n) => (
            <Marker key={n.id} coordinates={[n.lng, n.lat]}>
              <title>{n.label} — cross-border corridor town</title>
              <rect x={-3.5} y={-3.5} width={7} height={7} transform="rotate(45)" fill="#6ea8fe" stroke="#0a0f1a" strokeWidth={0.8} />
              <text textAnchor="middle" y={-7} className="map-label-sm">{n.label}</text>
            </Marker>
          ))}

          {/* Production regions (circles) */}
          {mmRegions.map((rg) => {
            const ha = haFor(rg.id)
            const meth = methFor(rg.id)
            const r = 3 + (maxHa ? (ha / maxHa) * 12 : 0)
            const fill = `rgb(${110 + Math.round(meth * 1.45)}, ${120 - Math.round(meth * 0.5)}, 90)`
            return (
              <Marker key={rg.id} coordinates={[rg.lng, rg.lat]}>
                <title>{`${rg.label} — ${ha.toLocaleString()} ha opium poppy, synthetic-drug activity ${meth}/100 (${currentYear ?? '—'})`}</title>
                <circle r={r} fill={fill} fillOpacity={0.85} stroke="#0a0f1a" strokeWidth={0.8} />
                <text textAnchor="middle" y={-r - 3} className="map-label">{rg.label}</text>
              </Marker>
            )
          })}
        </ComposableMap>
      </div>

      <h3>Region detail — {currentYear ?? '—'}</h3>
      <table className="data-table">
        <thead>
          <tr><th>Region</th><th>Opium poppy (ha)</th><th>Synthetic-drug activity index</th></tr>
        </thead>
        <tbody>
          {mmRegions.map((rg) => (
            <tr key={rg.id}>
              <td className={rg.id.startsWith('shan') || rg.id === 'wa' ? 'hot' : ''}>{rg.label}</td>
              <td>{haFor(rg.id).toLocaleString()} ha</td>
              <td>{methFor(rg.id)} / 100</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        Region grain matches the UNODC Myanmar Opium Survey (cultivation by
        township/region) — published, aggregate, non-navigable. The activity index
        is a relative indicator, not a production volume.
      </p>
    </section>
  )
}
