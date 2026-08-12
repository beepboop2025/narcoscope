import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { geoDistance, geoOrthographic } from 'd3-geo'
// Natural Earth 10m admin-0, India-POV variant (GoI-mandated boundaries:
// India shown with the full former state of Jammu & Kashmir).
import topology from '../data/countries-ind.json'
import { COUNTRY_CENTROID, FEATURE_TO_ISO3 } from '../data/countryGeo'
import { useData } from '../lib/dataStore'
import { arcPath, countriesFromTopology, graticulePath, pathForGeometry, projectedPoint, type LngLat } from '../lib/mapSvg'
import {
  SEIZURE_COUNTRIES,
  SEIZURE_META,
  SEIZURE_YEARS,
  countryGroupTotals,
  countryTrend,
  fmtKg,
  groupsByVolume,
  logShare,
  maxCountryTotal,
  shortGroupLabel,
  topDrugs,
  totalsByCountry,
  worldTotal,
} from '../lib/seizures'
import { COUNTRY_CENTROIDS as FLOW_CENTROIDS } from '../data/flows'
import { usePrefersReducedMotion } from '../motion/usePrefersReducedMotion'
import Explainer from './Explainer'
import type { FlowRecord } from '../types'

const SIZE = 640
const BASE_SCALE = SIZE / 2 - 12

// Colour ramp for seized volume (log scale): deep panel blue → teal → cyan →
// amber → coral. Matches the app's source=coral / activity=cyan semantics.
const RAMP: [number, number, number][] = [
  [18, 32, 46],    // 0.00 — no / negligible reports
  [10, 92, 104],   // 0.35
  [6, 214, 224],   // 0.60 — tk-live cyan
  [255, 176, 32],  // 0.85 — tk-warning amber
  [255, 122, 89],  // 1.00 — coral (heaviest seizure pressure)
]
const RAMP_STOPS = [0, 0.35, 0.6, 0.85, 1]

function rampColor(t: number): string {
  if (t <= 0) return `rgb(${RAMP[0].join(',')})`
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    if (t <= RAMP_STOPS[i]) {
      const f = (t - RAMP_STOPS[i - 1]) / (RAMP_STOPS[i] - RAMP_STOPS[i - 1])
      const mix = RAMP[i - 1].map((a, k) => Math.round(a + (RAMP[i][k] - a) * f))
      return `rgb(${mix.join(',')})`
    }
  }
  return `rgb(${RAMP[RAMP.length - 1].join(',')})`
}

// Corridor legs of the (illustrative) precursor overlay: origin → transit → destination.
function legsOf(rec: FlowRecord): [string, string][] {
  const stops = [rec.origin, rec.transit, rec.destination].filter((s): s is string => Boolean(s))
  const legs: [string, string][] = []
  for (let i = 0; i < stops.length - 1; i++) legs.push([stops[i], stops[i + 1]])
  return legs
}

const flowCoord = (name: string): LngLat | null => {
  const c = FLOW_CENTROIDS[name]
  return c ? [c.lng, c.lat] : null
}

const countryName = new Map(SEIZURE_COUNTRIES.map((c) => [c.iso3, c.name]))

// Countries that report seizures but have no polygon in the 110m atlas
// (city-states and small islands) — rendered as proportional dots instead.
const BUBBLE_ONLY: string[] = (() => {
  const withPolygon = new Set(Object.values(FEATURE_TO_ISO3))
  return SEIZURE_COUNTRIES.filter((c) => !withPolygon.has(c.iso3)).map((c) => c.iso3)
})()

interface HoverState { iso3: string | null; label: string; x: number; y: number }

export default function SeizureGlobe() {
  const { flowRecords } = useData()
  const reducedMotion = usePrefersReducedMotion()

  const [rotation, setRotation] = useState<[number, number]>([-20, -18])
  const [zoom, setZoom] = useState(1)
  const [groupIndex, setGroupIndex] = useState<number | null>(null)
  const [yearIdx, setYearIdx] = useState(SEIZURE_YEARS.length - 1)
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [showCorridors, setShowCorridors] = useState(true)
  const [interacting, setInteracting] = useState(false)

  const year = SEIZURE_YEARS[yearIdx]
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const pendingRef = useRef<[number, number] | null>(null)
  const rafRef = useRef<number | null>(null)

  const countries = useMemo(() => countriesFromTopology(topology), [])
  const groups = useMemo(() => groupsByVolume(), [])
  const totals = useMemo(() => totalsByCountry(groupIndex, year), [groupIndex, year])
  // Fixed across the year slider so playback shows real growth, not rescaling.
  const maxTotal = useMemo(() => maxCountryTotal(groupIndex), [groupIndex])
  const globalKg = useMemo(() => worldTotal(groupIndex, year), [groupIndex, year])

  const projection = useMemo(
    () => geoOrthographic()
      .translate([SIZE / 2, SIZE / 2])
      .scale(BASE_SCALE * zoom)
      .rotate([rotation[0], rotation[1], 0])
      .clipAngle(90),
    [rotation, zoom],
  )
  const graticule = useMemo(() => graticulePath(projection), [projection])

  // ---- interaction: drag to rotate (rAF-throttled), wheel to zoom ----------
  const commitRotation = useCallback(() => {
    rafRef.current = null
    if (pendingRef.current) {
      setRotation(pendingRef.current)
      pendingRef.current = null
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY }
    setInteracting(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    dragRef.current = { x: e.clientX, y: e.clientY }
    const k = 0.25 / zoom
    const base = pendingRef.current ?? rotation
    pendingRef.current = [base[0] + dx * k, Math.max(-85, Math.min(85, base[1] - dy * k))]
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(commitRotation)
  }, [rotation, zoom, commitRotation])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setInteracting(false)
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => Math.max(1, Math.min(6, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Gentle idle spin — never while the user is dragging, hovering a country,
  // pinned on a dossier, or asking the OS for reduced motion.
  useEffect(() => {
    if (reducedMotion || interacting || pinned || hover) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      setRotation(([l, p]) => [l + dt * 0.004, p])
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion, interacting, pinned, hover])

  // Year playback
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setYearIdx((i) => (i + 1) % SEIZURE_YEARS.length), 1400)
    return () => clearInterval(id)
  }, [playing])

  const moveTooltip = useCallback((e: React.PointerEvent, iso3: string | null, label: string) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ iso3, label, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  // ---- derived render data --------------------------------------------------
  const hemisphereCenter: LngLat = [-rotation[0], -rotation[1]]
  const visible = useCallback(
    (coord: LngLat) => geoDistance(coord, hemisphereCenter) < Math.PI / 2 - 0.01,
    [hemisphereCenter[0], hemisphereCenter[1]],
  )

  const bubbles = useMemo(() =>
    BUBBLE_ONLY
      .map((iso3) => ({ iso3, kg: totals.get(iso3) ?? 0, coord: COUNTRY_CENTROID[iso3] as LngLat }))
      .filter((b) => b.kg > 0 && visible(b.coord))
      .map((b) => ({ ...b, point: projectedPoint(projection, b.coord) }))
      .filter((b): b is typeof b & { point: [number, number] } => b.point !== null),
  [totals, projection, visible])

  const corridorLegs = useMemo(() => {
    if (!showCorridors) return []
    const seen = new Set<string>()
    const legs: { key: string; from: LngLat; to: LngLat; fromChina: boolean }[] = []
    for (const rec of flowRecords) {
      for (const [a, b] of legsOf(rec)) {
        const key = `${a}->${b}`
        if (seen.has(key)) continue
        seen.add(key)
        const from = flowCoord(a)
        const to = flowCoord(b)
        if (from && to) legs.push({ key, from, to, fromChina: a === 'China' })
      }
    }
    return legs
  }, [flowRecords, showCorridors])

  const detail = useMemo(() => {
    if (!pinned) return null
    const name = countryName.get(pinned)
    if (!name) return null
    const groupsHere = countryGroupTotals(pinned, year)
    return {
      iso3: pinned,
      name,
      total: totals.get(pinned) ?? 0,
      groups: groupsHere.slice(0, 6),
      drugs: topDrugs(pinned, year, 8),
      trend: countryTrend(pinned, groupIndex),
    }
  }, [pinned, year, totals, groupIndex])

  const trendMax = detail ? Math.max(1, ...detail.trend.map(([, kg]) => kg)) : 1
  const groupLabel = groupIndex === null ? 'all drugs' : shortGroupLabel(groups.find((g) => g.groupIndex === groupIndex)?.group ?? '')
  const reporting = totals.size

  const explainer = `In ${year}, ${reporting} countries reported seizures of ${groupLabel === 'all drugs' ? 'illicit drugs' : groupLabel} totalling ${fmtKg(globalKg)} (UNODC WDR 2025, Annex 7.1). Colour shows seized volume per country on a log scale — coral marks the heaviest trafficking pressure. Drag the globe, scroll to zoom, click a country for its dossier.`

  return (
    <section>
      <div className="chip-row" role="tablist" aria-label="Drug group filter">
        <button
          className={`chip ${groupIndex === null ? 'active' : ''}`}
          onClick={() => setGroupIndex(null)}
        >
          All drugs
        </button>
        {groups.map((g) => (
          <button
            key={g.groupIndex}
            className={`chip ${groupIndex === g.groupIndex ? 'active' : ''}`}
            title={`${g.group} — ${fmtKg(g.kg)} seized worldwide in ${SEIZURE_YEARS[SEIZURE_YEARS.length - 1]}`}
            onClick={() => setGroupIndex((cur) => (cur === g.groupIndex ? null : g.groupIndex))}
          >
            {shortGroupLabel(g.group)}
          </button>
        ))}
      </div>

      <div className="timeline">
        <button
          className="play-btn"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={SEIZURE_YEARS.length - 1}
          step={1}
          value={yearIdx}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setPlaying(false); setYearIdx(Number(e.target.value)) }}
        />
        <span className="year-label">{year}</span>
        <label className="toggle corridor-toggle">
          <input
            type="checkbox"
            checked={showCorridors}
            onChange={(e) => setShowCorridors(e.target.checked)}
          />{' '}
          precursor corridors (official records)
        </label>
      </div>

      <Explainer text={explainer} />

      <div className="globe-layout">
        <div className="map-card globe-wrap" ref={wrapRef}>
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="img"
            aria-label={`Interactive globe of ${groupLabel} seizures by country, ${year}`}
            className="globe-svg"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => { onPointerUp(); setHover(null) }}
          >
            <defs>
              <radialGradient id="ocean" cx="38%" cy="34%" r="72%">
                <stop offset="0%" stopColor="#10202f" />
                <stop offset="80%" stopColor="#0a141f" />
                <stop offset="100%" stopColor="#060b12" />
              </radialGradient>
            </defs>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={BASE_SCALE * zoom} className="globe-halo" />
            <circle cx={SIZE / 2} cy={SIZE / 2} r={BASE_SCALE * zoom} fill="url(#ocean)" />
            <path d={graticule} fill="none" stroke="rgba(120,160,190,0.12)" strokeWidth={0.5} />

            {countries.map((c, i) => {
              const iso3 = FEATURE_TO_ISO3[String(c.id)]
              const kg = iso3 ? totals.get(iso3) ?? 0 : 0
              const d = pathForGeometry(projection, c.geometry)
              if (!d) return null
              const isPinned = iso3 && iso3 === pinned
              return (
                <path
                  key={c.id ?? i}
                  d={d}
                  className={`globe-country ${iso3 ? 'has-data' : ''} ${isPinned ? 'pinned' : ''}`}
                  fill={rampColor(logShare(kg, maxTotal))}
                  onPointerMove={(e) => {
                    if (dragRef.current) return
                    const label = iso3 ? countryName.get(iso3) ?? '' : String((c.properties as { name?: string } | null)?.name ?? '')
                    moveTooltip(e, iso3 ?? null, label)
                  }}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => iso3 && setPinned((p) => (p === iso3 ? null : iso3))}
                />
              )
            })}

            {/* City-states / small islands with no 110m polygon */}
            {bubbles.map((b) => (
              <circle
                key={b.iso3}
                cx={b.point[0]}
                cy={b.point[1]}
                r={2 + logShare(b.kg, maxTotal) * 8}
                className={`globe-bubble ${b.iso3 === pinned ? 'pinned' : ''}`}
                fill={rampColor(logShare(b.kg, maxTotal))}
                onPointerMove={(e) => { if (!dragRef.current) moveTooltip(e, b.iso3, countryName.get(b.iso3) ?? b.iso3) }}
                onPointerLeave={() => setHover(null)}
                onClick={() => setPinned((p) => (p === b.iso3 ? null : b.iso3))}
              />
            ))}

            {corridorLegs.map((leg) => {
              const d = arcPath(projection, leg.from, leg.to)
              if (!d) return null
              return (
                <path
                  key={leg.key}
                  d={d}
                  className={`globe-arc ${reducedMotion ? '' : 'animated'}`}
                  stroke={leg.fromChina ? '#ff7a59' : '#6ea8fe'}
                  fill="none"
                />
              )
            })}
          </svg>

          {hover && (
            <div className="globe-tooltip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
              <strong>{hover.label}</strong>
              {hover.iso3 ? (
                <>
                  <div>{fmtKg(totals.get(hover.iso3) ?? 0)} seized · {groupLabel} · {year}</div>
                  {topDrugs(hover.iso3, year, 3).map((t) => (
                    <div key={t.drug} className="tooltip-drug">{t.drug} — {fmtKg(t.kg)}</div>
                  ))}
                  <div className="tooltip-hint">click for full dossier</div>
                </>
              ) : (
                <div>no seizure reporting in this dataset</div>
              )}
            </div>
          )}

          <div className="globe-legend">
            <span>0</span>
            <span className="globe-legend-bar" aria-hidden="true" />
            <span>{fmtKg(maxTotal)}</span>
            <span className="globe-legend-note">seized volume (log scale, fixed across years)</span>
          </div>
        </div>

        {detail && (
          <aside className="country-panel tk-card">
            <button className="panel-close" onClick={() => setPinned(null)} aria-label="Close">✕</button>
            <h3>{detail.name}</h3>
            <p className="panel-total">{fmtKg(detail.total)} <span>seized · {groupLabel} · {year}</span></p>

            <h4>By drug group ({year})</h4>
            {detail.groups.length === 0 && <p className="note">No reported seizures in {year}.</p>}
            {detail.groups.map((g) => (
              <div key={g.groupIndex} className="panel-bar-row" title={`${g.group}: ${fmtKg(g.kg)}`}>
                <span className="panel-bar-label">{shortGroupLabel(g.group)}</span>
                <span className="panel-bar-track">
                  <span
                    className="panel-bar-fill"
                    style={{ width: `${Math.max(2, (g.kg / Math.max(1, detail.groups[0].kg)) * 100)}%` }}
                  />
                </span>
                <span className="panel-bar-value">{fmtKg(g.kg)}</span>
              </div>
            ))}

            <h4>Top substances ({year})</h4>
            <ul className="panel-drug-list">
              {detail.drugs.map((t) => (
                <li key={t.drug}><span>{t.drug}</span><b>{fmtKg(t.kg)}</b></li>
              ))}
            </ul>

            <h4>2019–2023 trend · {groupLabel}</h4>
            <div className="panel-trend" role="img" aria-label={`Seizure trend for ${detail.name}`}>
              {detail.trend.map(([y, kg]) => (
                <div key={y} className="panel-trend-col" title={`${y}: ${fmtKg(kg)}`}>
                  <span className="panel-trend-bar" style={{ height: `${Math.max(3, (kg / trendMax) * 100)}%` }} />
                  <span className="panel-trend-year">{String(y).slice(2)}</span>
                </div>
              ))}
            </div>
            <p className="note panel-source">Source: UNODC World Drug Report 2025, Statistical Annex 7.1 (kilograms).</p>
          </aside>
        )}
      </div>

      <p className="note">
        Country colour = <strong>official seized volume</strong> ({SEIZURE_META.downloaded ? 'WDR 2025' : ''} Annex 7.1,
        2019–2023) — a proxy for trafficking pressure that reflects both flows and enforcement effort, not consumption.
        Corridor arcs show <strong>selected, source-grained INCB records</strong>; uniform arc widths do not
        represent additive throughput, and a reported origin does not establish responsibility. Toggle them off
        above. City-states without map polygons render as dots.
      </p>
    </section>
  )
}
