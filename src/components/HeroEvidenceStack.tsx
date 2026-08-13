import { useMemo, useState } from 'react'
import overview from '../data/overview.json'
import type { TabId } from '../navigation'

type EvidenceLayer = {
  id: 'harm' | 'supply' | 'networks'
  index: string
  label: string
  metric: string
  unit: string
  finding: string
  boundary: string
  source: string
  tab: TabId
  action: string
  values: number[]
  years?: number[]
}

function linePath(values: number[], width = 360, height = 98): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = 8 + (index / Math.max(1, values.length - 1)) * (width - 16)
    const y = height - 10 - ((value - min) / range) * (height - 24)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export default function HeroEvidenceStack({ onOpen }: { onOpen: (tab: TabId) => void }) {
  const layers = useMemo<readonly EvidenceLayer[]>(() => [
    {
      id: 'harm',
      index: '01',
      label: 'Human harm',
      metric: overview.headline.usOverdoseLatest.toLocaleString(),
      unit: `US overdose deaths · ${overview.headline.usOverdoseYear}`,
      finding: `${Math.abs((overview.overdoseTrend.changeFromPeak ?? 0) * 100).toFixed(0)}% below the ${overview.overdoseTrend.peakYear} peak, with provisional mortality still historically high.`,
      boundary: 'Outcome context; it does not identify supply origin.',
      source: 'CDC NCHS VSRR',
      tab: 'states',
      action: 'Open the harm layer',
      values: overview.overdoseTrend.series.map((point) => point.all_drugs ?? 0),
      years: overview.overdoseTrend.series.map((point) => point.year),
    },
    {
      id: 'supply',
      index: '02',
      label: 'Recorded supply',
      metric: `${overview.headline.worldSeizureTonnes.toLocaleString()} t`,
      unit: `reported world seizures · ${overview.headline.seizureYear}`,
      finding: `${overview.headline.seizureCountries} countries appear in the latest annual aggregate; reporting intensity differs by jurisdiction.`,
      boundary: 'A seizure is enforcement visibility, not total market volume.',
      source: 'UNODC WDR 2025 · Annex 7.1',
      tab: 'seizuretrends',
      action: 'Open seizure trends',
      values: overview.topSeizureCountries.map((country) => country.kg),
    },
    {
      id: 'networks',
      index: '03',
      label: 'Public networks',
      metric: overview.headline.designations.toLocaleString(),
      unit: 'public OFAC-designated entities',
      finding: `${overview.designationsByProgram.length} authorities structure the current record; the largest is ${overview.designationsByProgram[0]?.label}.`,
      boundary: 'Designation is a public legal record, not a conviction graph.',
      source: 'US Treasury OFAC SDN',
      tab: 'designations',
      action: 'Inspect the public record',
      values: overview.designationsByProgram.map((program) => program.count),
    },
  ], [])
  const [activeId, setActiveId] = useState<EvidenceLayer['id']>('harm')
  const active = layers.find((layer) => layer.id === activeId) ?? layers[0]
  const path = linePath(active.values)

  return (
    <aside className="evidence-stack" aria-label="Live official-record briefing">
      <div className="evidence-stack__head">
        <span>Live evidence stack</span>
        <span>3 independent layers</span>
      </div>

      <div className="evidence-stack__layers" role="list" aria-label="Choose an evidence layer">
        {layers.map((layer) => (
          <button
            key={layer.id}
            type="button"
            role="listitem"
            className={`evidence-stack__layer evidence-stack__layer--${layer.id} ${active.id === layer.id ? 'is-active' : ''}`}
            aria-pressed={active.id === layer.id}
            onClick={() => setActiveId(layer.id)}
          >
            <span>{layer.index}</span>
            <strong>{layer.label}</strong>
            <small>{layer.source}</small>
          </button>
        ))}
      </div>

      <div className={`evidence-stack__reading evidence-stack__reading--${active.id}`} key={active.id}>
        <div>
          <strong>{active.metric}</strong>
          <span>{active.unit}</span>
        </div>
        <svg viewBox="0 0 360 98" role="img" aria-label={`${active.label} relative profile`}>
          <defs>
            <linearGradient id={`hero-line-${active.id}`} x1="0" x2="1">
              <stop offset="0" stopColor="var(--hot)" />
              <stop offset="1" stopColor="var(--accent)" />
            </linearGradient>
          </defs>
          <path className="evidence-stack__grid" d="M8 24H352 M8 52H352 M8 80H352" />
          <path className="evidence-stack__area" d={`${path} L352,90 L8,90 Z`} />
          <path className="evidence-stack__line" d={path} stroke={`url(#hero-line-${active.id})`} />
        </svg>
        <p>{active.finding}</p>
        <small><b>Claim boundary:</b> {active.boundary}</small>
        <button type="button" onClick={() => onOpen(active.tab)}>
          {active.action}<span aria-hidden="true">↗</span>
        </button>
      </div>
    </aside>
  )
}
