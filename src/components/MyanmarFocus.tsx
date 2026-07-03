import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { geoMercator } from 'd3-geo'
import topology from 'world-atlas/countries-110m.json'
import { COUNTRY_CENTROIDS, PRECURSORS } from '../data/flows'
import { useData } from '../lib/dataStore'
import { explainMyanmar } from '../lib/explain'
import { arcPath, countriesFromTopology, pathForGeometry, projectedPoint } from '../lib/mapSvg'
import Explainer from './Explainer'

const widthScale = (qty: number, max: number): number => (max ? 1 + (qty / max) * 5 : 1)
const fmtKg = (v: number): string => `${Number(v).toLocaleString()} kg`
const MAP_WIDTH = 800
const MAP_HEIGHT = 460
const countries = countriesFromTopology(topology)

export default function MyanmarFocus() {
  const {
    mmRegions,
    mmBorderNodes,
    mmRegionRecords,
    mmFlowRecords,
    mmConflictEvents,
    mmPrecursorFlows,
  } = useData()
  const [yearIdx, setYearIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const projection = useMemo(
    () => geoMercator().center([98.7, 22]).scale(1500).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]),
    [],
  )

  // Resolve any region/border id -> [lng, lat] from the (possibly swapped-in)
  // node tables. Rebuilds only when the node tables change.
  const coordOf = useMemo(() => {
    const idx: Record<string, [number, number]> = Object.fromEntries(
      [...mmRegions, ...mmBorderNodes].map((n) => [n.id, [n.lng, n.lat]] as [string, [number, number]]),
    )
    return (id: string): [number, number] | null => idx[id] ?? null
  }, [mmRegions, mmBorderNodes])

  // Resolve any id -> human label (for the plain-English explainer).
  const labelOf = useMemo(() => {
    const idx: Record<string, string> = Object.fromEntries(
      [...mmRegions, ...mmBorderNodes].map((n) => [n.id, n.label]),
    )
    return (id: string): string => idx[id] ?? id
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
  const conflictEvents = useMemo(
    () => mmConflictEvents.filter((r) => r.year === currentYear),
    [mmConflictEvents, currentYear],
  )
  const precursorFlows = useMemo(
    () => mmPrecursorFlows.filter((r) => r.year === currentYear),
    [mmPrecursorFlows, currentYear],
  )

  // Stable scales across all years (honest comparison during playback).
  const maxHa = useMemo(() => Math.max(0, ...mmRegionRecords.map((r) => r.opiumHa)), [mmRegionRecords])
  const maxQty = useMemo(() => Math.max(0, ...mmFlowRecords.map((r) => r.quantityKg)), [mmFlowRecords])
  const maxConflict = useMemo(() => Math.max(0, ...mmConflictEvents.map((r) => r.intensity)), [mmConflictEvents])
  const maxPrecursorQty = useMemo(
    () => Math.max(0, ...mmPrecursorFlows.map((r) => r.quantityKg)),
    [mmPrecursorFlows],
  )

  const haFor = (id: string): number => regionRows.find((r) => r.region === id)?.opiumHa ?? 0
  const methFor = (id: string): number => regionRows.find((r) => r.region === id)?.methIndex ?? 0
  const conflictFor = (id: string): number =>
    conflictEvents
      .filter((r) => r.region === id)
      .reduce((max, r) => Math.max(max, r.intensity), 0)
  const precursorLabel = (id: string): string => PRECURSORS.find((p) => p.id === id)?.label ?? id

  return (
    <section>
      <p className="intro">
        Zooming from country → province. Circles are Myanmar production regions
        (sized by opium-poppy hectares; redder = higher synthetic-drug activity
        index). Rings show civil-war conflict pressure; dashed inbound arcs show
        China and other source countries sending precursor classes toward Myanmar
        regions, while solid arcs show seized drug volumes leaving border corridors.
      </p>

      <div className="timeline">
        <button className="play-btn" onClick={() => setPlaying((p) => !p)} disabled={years.length < 2}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range" min={0} max={Math.max(0, years.length - 1)} step={1}
          value={Math.min(yearIdx, years.length - 1)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setPlaying(false); setYearIdx(Number(e.target.value)) }}
          disabled={years.length < 2}
        />
        <span className="year-label">{currentYear ?? '—'}</span>
      </div>

      <Explainer
        text={explainMyanmar(regionRows, flows, currentYear, labelOf, conflictEvents, precursorFlows)}
      />

      <div className="map-card">
        <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Myanmar precursor and conflict focus map">
          {countries.map((country, index) => (
            <path
              key={country.id ?? index}
              d={pathForGeometry(projection, country.geometry)}
              fill="#15203a"
              stroke="#26314a"
              strokeWidth={0.5}
            />
          ))}

          {/* Cross-border corridor arcs */}
          {flows.map((rec) => {
            const from = coordOf(rec.from)
            const to = coordOf(rec.to)
            if (!from || !to) return null
            return (
              <path
                key={`${rec.from}->${rec.to}`}
                d={arcPath(projection, from, to)}
                stroke={rec.drug === 'Heroin' ? '#e0d36e' : '#ff7a59'}
                strokeWidth={widthScale(rec.quantityKg, maxQty)}
                strokeLinecap="round" fill="none" opacity={0.8}
              />
            )
          })}

          {/* Inbound precursor arcs: country centroid -> Myanmar region centroid */}
          {precursorFlows.map((rec) => {
            const origin = COUNTRY_CENTROIDS[rec.originCountry]
            const to = coordOf(rec.to)
            if (!origin || !to) return null
            return (
              <path
                key={`${rec.originCountry}->${rec.to}->${rec.precursor}`}
                d={arcPath(projection, [origin.lng, origin.lat], to)}
                stroke={rec.originCountry === 'China' ? '#ffab98' : '#a1ecff'}
                strokeWidth={widthScale(rec.quantityKg, maxPrecursorQty)}
                strokeLinecap="round"
                fill="none"
                strokeDasharray="5 4"
                opacity={0.62}
              />
            )
          })}

          {/* Border corridor towns (diamonds) */}
          {mmBorderNodes.map((n) => {
            const point = projectedPoint(projection, [n.lng, n.lat])
            if (!point) return null
            return (
              <g key={n.id} transform={`translate(${point[0]} ${point[1]})`}>
                <title>{n.label} — cross-border corridor town</title>
                <rect x={-3.5} y={-3.5} width={7} height={7} transform="rotate(45)" fill="#6ea8fe" stroke="#0a0f1a" strokeWidth={0.8} />
                <text textAnchor="middle" y={-7} className="map-label-sm">{n.label}</text>
              </g>
            )
          })}

          {/* Production regions (circles) */}
          {mmRegions.map((rg) => {
            const point = projectedPoint(projection, [rg.lng, rg.lat])
            if (!point) return null
            const ha = haFor(rg.id)
            const meth = methFor(rg.id)
            const conflict = conflictFor(rg.id)
            const r = 3 + (maxHa ? (ha / maxHa) * 12 : 0)
            const ring = r + 3 + (maxConflict ? (conflict / maxConflict) * 6 : 0)
            const fill = `rgb(${110 + Math.round(meth * 1.45)}, ${120 - Math.round(meth * 0.5)}, 90)`
            return (
              <g key={rg.id} transform={`translate(${point[0]} ${point[1]})`}>
                <title>{`${rg.label} — ${ha.toLocaleString()} ha opium poppy, synthetic-drug activity ${meth}/100, conflict pressure ${conflict}/100 (${currentYear ?? '—'})`}</title>
                {conflict > 0 && (
                  <circle r={ring} fill="none" stroke="#ffab98" strokeOpacity={0.45} strokeWidth={1.2} />
                )}
                <circle r={r} fill={fill} fillOpacity={0.85} stroke="#0a0f1a" strokeWidth={0.8} />
                <text textAnchor="middle" y={-r - 3} className="map-label">{rg.label}</text>
              </g>
            )
          })}
        </svg>
      </div>

      <h3>Region detail — {currentYear ?? '—'}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Region</th>
            <th>Opium poppy (ha)</th>
            <th>Synthetic-drug activity index</th>
            <th>Conflict pressure</th>
          </tr>
        </thead>
        <tbody>
          {mmRegions.map((rg) => (
            <tr key={rg.id}>
              <td className={rg.id.startsWith('shan') || rg.id === 'wa' ? 'hot' : ''}>{rg.label}</td>
              <td>{haFor(rg.id).toLocaleString()} ha</td>
              <td>{methFor(rg.id)} / 100</td>
              <td>{conflictFor(rg.id)} / 100</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Civil-war overlay — {currentYear ?? '—'}</h3>
      <table className="data-table">
        <thead>
          <tr><th>Region</th><th>Actor / party</th><th>Type</th><th>Event</th><th>Pressure</th><th>Source</th></tr>
        </thead>
        <tbody>
          {conflictEvents.map((r, i) => (
            <tr key={`${r.region}-${r.actor}-${i}`}>
              <td>{labelOf(r.region)}</td>
              <td className={r.actorType === 'military' || r.actorType === 'militia' ? 'hot' : ''}>{r.actor}</td>
              <td>{r.actorType}</td>
              <td>{r.eventType.replace(/_/g, ' ')}</td>
              <td>{r.intensity} / 100</td>
              <td><a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceName}</a></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Inbound precursor flows to Myanmar — {currentYear ?? '—'}</h3>
      <table className="data-table">
        <thead>
          <tr><th>Origin</th><th>Transit</th><th>To region</th><th>Precursor class</th><th>Reported volume</th><th>Confidence</th><th>Source</th></tr>
        </thead>
        <tbody>
          {precursorFlows.map((r, i) => (
            <tr key={`${r.originCountry}-${r.to}-${r.precursor}-${i}`}>
              <td className={r.originCountry === 'China' ? 'hot' : ''}>{r.originCountry}</td>
              <td>{r.transitCountry ?? '—'}</td>
              <td>{labelOf(r.to)}</td>
              <td>{precursorLabel(r.precursor)}</td>
              <td>{fmtKg(r.quantityKg)}</td>
              <td>{r.confidence}</td>
              <td><a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceName}</a></td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        Region grain matches the UNODC Myanmar Opium Survey (cultivation by
        township/region) — published, aggregate, non-navigable. Activity and
        conflict indexes are relative indicators, not production volumes or live
        tactical reporting.
      </p>
    </section>
  )
}
