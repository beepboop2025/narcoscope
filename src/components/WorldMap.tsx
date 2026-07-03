import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { geoEqualEarth } from 'd3-geo'
import topology from 'world-atlas/countries-110m.json'
import { PRECURSORS, COUNTRY_CENTROIDS } from '../data/flows'
import { useData } from '../lib/dataStore'
import { explainFlows } from '../lib/explain'
import { arcPath, countriesFromTopology, graticulePath, pathForGeometry, projectedPoint } from '../lib/mapSvg'
import Explainer from './Explainer'
import type { FlowRecord } from '../types'

// Map a seized quantity to a stroke width so the eye reads volume directly.
function widthScale(qty: number, max: number): number {
  if (!max) return 1
  return 1 + (qty / max) * 5 // 1px (small) → 6px (largest corridor)
}

// Break a corridor into legs: origin → transit → destination (or a direct hop).
function legsOf(rec: FlowRecord): [string, string][] {
  const stops = [rec.origin, rec.transit, rec.destination].filter((s): s is string => Boolean(s))
  const legs: [string, string][] = []
  for (let i = 0; i < stops.length - 1; i++) legs.push([stops[i], stops[i + 1]])
  return legs
}

const coord = (name: string): [number, number] | null => {
  const c = COUNTRY_CENTROIDS[name]
  return c ? [c.lng, c.lat] : null
}

const MAP_WIDTH = 800
const MAP_HEIGHT = 440
const countries = countriesFromTopology(topology)

export default function WorldMap() {
  const { flowRecords } = useData()
  const [precursor, setPrecursor] = useState('all')
  const [yearIdx, setYearIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const projection = useMemo(
    () => geoEqualEarth().fitSize([MAP_WIDTH, MAP_HEIGHT], { type: 'Sphere' }),
    [],
  )
  const graticule = useMemo(() => graticulePath(projection), [projection])

  // All corridors for the chosen precursor, across every year. STABLE reference
  // set: the arc-thickness scale is computed from it once, so a corridor that
  // doubles year-over-year actually looks twice as thick during playback.
  const allFlows = useMemo(
    () => flowRecords.filter((r) => precursor === 'all' || r.precursor === precursor),
    [flowRecords, precursor],
  )

  const years = useMemo(
    () => [...new Set(allFlows.map((r) => r.year))].sort((a, b) => a - b),
    [allFlows],
  )

  useEffect(() => { setYearIdx((i) => Math.min(i, Math.max(0, years.length - 1))) }, [years.length])

  useEffect(() => {
    if (!playing || years.length < 2) return
    const id = setInterval(() => setYearIdx((i) => (i + 1) % years.length), 1200)
    return () => clearInterval(id)
  }, [playing, years.length])

  const currentYear = years[Math.min(yearIdx, years.length - 1)]

  const flows = useMemo(
    () => allFlows.filter((r) => r.year === currentYear),
    [allFlows, currentYear],
  )

  // Scale fixed across all years for honest comparison.
  const maxQty = useMemo(
    () => allFlows.reduce((m, r) => Math.max(m, r.quantityKg), 0),
    [allFlows],
  )

  // Throughput per country (sum of every corridor it touches) → marker size.
  const nodes = useMemo(() => {
    const totals: Record<string, number> = {}
    flows.forEach((r) => {
      [r.origin, r.transit, r.destination]
        .filter((s): s is string => Boolean(s))
        .forEach((n) => { totals[n] = (totals[n] || 0) + r.quantityKg })
    })
    return Object.entries(totals)
      .filter(([name]) => coord(name))
      .map(([name, qty]) => ({ name, qty, isSource: flows.some((f) => f.origin === name) }))
  }, [flows])

  return (
    <section>
      <div className="controls">
        <label>
          Precursor class&nbsp;
          <select value={precursor} onChange={(e: ChangeEvent<HTMLSelectElement>) => setPrecursor(e.target.value)}>
            <option value="all">All precursors</option>
            {PRECURSORS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <span className="legend">
          <span className="swatch source" /> source country&nbsp;&nbsp;
          <span className="swatch transit" /> transit / destination&nbsp;&nbsp;
          arc thickness = volume seized
        </span>
      </div>

      <div className="timeline">
        <button
          className="play-btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={years.length < 2}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, years.length - 1)}
          step={1}
          value={Math.min(yearIdx, years.length - 1)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setPlaying(false); setYearIdx(Number(e.target.value)) }}
          disabled={years.length < 2}
        />
        <span className="year-label">{currentYear ?? '—'}</span>
      </div>

      <Explainer text={explainFlows(flows, `recorded corridors in ${currentYear}`)} />

      <div className="map-card">
        <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="World precursor flow map">
          <path d={graticule} fill="none" stroke="#1b2540" strokeWidth={0.4} />
          {countries.map((country, index) => (
            <path
              key={country.id ?? index}
              d={pathForGeometry(projection, country.geometry)}
              fill="#15203a"
              stroke="#26314a"
              strokeWidth={0.4}
            />
          ))}

          {/* Corridor arcs */}
          {flows.flatMap((rec) =>
            legsOf(rec).map((leg) => {
              const from = coord(leg[0])
              const to = coord(leg[1])
              if (!from || !to) return null
              const fromChina = leg[0] === 'China'
              // Stable, content-based key: the SAME corridor leg keeps its SVG
              // element across year changes, so width transitions instead of
              // flickering. (Index-based keys would reshuffle every frame.)
              const key = `${rec.precursor}|${leg[0]}->${leg[1]}`
              return (
                <path
                  key={key}
                  d={arcPath(projection, from, to)}
                  stroke={fromChina ? '#ff7a59' : '#6ea8fe'}
                  strokeWidth={widthScale(rec.quantityKg, maxQty)}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.7}
                />
              )
            }),
          )}

          {/* Country nodes */}
          {nodes.map((n) => {
            const c = coord(n.name)
            if (!c) return null
            const point = projectedPoint(projection, c)
            if (!point) return null
            const r = 3 + (maxQty ? (n.qty / maxQty) * 7 : 0)
            return (
              <g key={n.name} transform={`translate(${point[0]} ${point[1]})`}>
                <title>{`${n.name} — ${n.qty.toLocaleString()} kg across corridors (${n.isSource ? 'a listed source' : 'transit/destination'})`}</title>
                <circle
                  r={r}
                  fill={n.isSource ? '#ff7a59' : '#6ea8fe'}
                  fillOpacity={0.85}
                  stroke="#0a0f1a"
                  strokeWidth={1}
                />
                <text textAnchor="middle" y={-r - 4} className="map-label">
                  {n.name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <p className="note">
        Each arc is an aggregate trafficking corridor (country-level, seized volume).
        Sources glow <strong style={{ color: '#ff7a59' }}>orange</strong> — the upstream
        supply hubs this tool exists to keep visible. Swap in real INCB/UNODC corridor
        data via <code>src/lib/ingest.js</code> and this map updates automatically.
      </p>
    </section>
  )
}
