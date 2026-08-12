import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { geoEqualEarth } from 'd3-geo'
import topology from '../data/countries-ind.json'
import { PRECURSORS, COUNTRY_CENTROIDS } from '../data/flows'
import { useData } from '../lib/dataStore'
import { explainFlows } from '../lib/explain'
import { arcPath, countriesFromTopology, graticulePath, pathForGeometry, projectedPoint } from '../lib/mapSvg'
import Explainer from './Explainer'
import SeizureGlobe from './SeizureGlobe'
import type { FlowRecord } from '../types'

function quantityPrefix(record: FlowRecord): string {
  if (record.quantityRelation === 'approx') return 'approximately '
  if (record.quantityRelation === 'less_than') return 'less than '
  if (record.quantityRelation === 'greater_than') return 'more than '
  if (record.quantityRelation === 'exact') return ''
  return 'an unqualified '
}

export function flowSummary(record: FlowRecord): string {
  const recordKind = record.recordKind?.replaceAll('_', ' ') ?? 'record'
  return `${quantityPrefix(record)}${record.quantityKg.toLocaleString()} kg; ${recordKind}`
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

/**
 * Map tab: interactive seizure globe (official UNODC data) by default, with
 * the original flat precursor-corridor view kept as a secondary mode.
 */
export default function WorldMap() {
  const [view, setView] = useState<'globe' | 'corridors'>('globe')
  return (
    <section>
      <div className="view-switch" role="tablist" aria-label="Map view">
        <button
          id="map-view-globe-tab"
          role="tab"
          aria-controls="map-view-globe-panel"
          aria-selected={view === 'globe'}
          className={`chip ${view === 'globe' ? 'active' : ''}`}
          onClick={() => setView('globe')}
        >
          🌐 Seizure globe (official)
        </button>
        <button
          id="map-view-corridors-tab"
          role="tab"
          aria-controls="map-view-corridors-panel"
          aria-selected={view === 'corridors'}
          className={`chip ${view === 'corridors' ? 'active' : ''}`}
          onClick={() => setView('corridors')}
        >
          🗺 Precursor corridors (official records)
        </button>
      </div>
      <div
        id={view === 'globe' ? 'map-view-globe-panel' : 'map-view-corridors-panel'}
        role="tabpanel"
        aria-labelledby={view === 'globe' ? 'map-view-globe-tab' : 'map-view-corridors-tab'}
      >
        {view === 'globe' ? <SeizureGlobe /> : <CorridorMap />}
      </div>
    </section>
  )
}

export function CorridorMap() {
  const { flowRecords } = useData()
  const [precursor, setPrecursor] = useState('all')
  const [yearIdx, setYearIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const projection = useMemo(
    () => geoEqualEarth().fitSize([MAP_WIDTH, MAP_HEIGHT], { type: 'Sphere' }),
    [],
  )
  const graticule = useMemo(() => graticulePath(projection), [projection])

  // All source-grained records for the chosen precursor, across every year.
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

  // Record counts are comparable. Qualified masses and heterogeneous quantity
  // bases are not, so nodes deliberately never sum quantityKg.
  const nodes = useMemo(() => {
    const recordsByCountry = new Map<string, Set<FlowRecord>>()
    flows.forEach((r) => {
      [r.origin, r.transit, r.destination, r.seizureLocation]
        .filter((s): s is string => Boolean(s))
        .forEach((name) => {
          const records = recordsByCountry.get(name) ?? new Set<FlowRecord>()
          records.add(r)
          recordsByCountry.set(name, records)
        })
    })
    return [...recordsByCountry.entries()]
      .filter(([name]) => coord(name))
      .map(([name, records]) => ({
        name,
        recordCount: records.size,
        isSource: flows.some((flow) => flow.origin === name),
        isSeizureLocation: flows.some((flow) => flow.seizureLocation === name),
      }))
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
          blue nodes = transit, destination, or seizure location&nbsp;&nbsp;
          uniform arcs = stated route legs; node size = record count; masses are not summed
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
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.7}
                >
                  <title>{`${leg[0]} → ${leg[1]} — ${flowSummary(rec)}`}</title>
                </path>
              )
            }),
          )}

          {/* Country nodes */}
          {nodes.map((n) => {
            const c = coord(n.name)
            if (!c) return null
            const point = projectedPoint(projection, c)
            if (!point) return null
            const r = 3 + Math.min(5, Math.sqrt(n.recordCount) * 2)
            return (
              <g key={n.name} transform={`translate(${point[0]} ${point[1]})`}>
                <title>{`${n.name} — appears in ${n.recordCount} source-grained record${n.recordCount === 1 ? '' : 's'} (${n.isSource ? 'a listed source' : n.isSeizureLocation ? 'a stated seizure location' : 'transit/destination'}); masses are not summed`}</title>
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
        Each arc is one leg of a country-level record from the cited INCB report.
        Seizure locations appear as nodes but never become route legs unless the
        report separately identifies that routing role.
        Sources glow <strong style={{ color: '#ff7a59' }}>orange</strong>. Uniform arc width
        and record-count nodes avoid turning approximate values, bounds, annual
        aggregates, and gross preparation weights into an invented throughput
        comparison. A reported origin does not establish responsibility or total flow.
      </p>
    </section>
  )
}
