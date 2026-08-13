import { useEffect, useState } from 'react'
import {
  PALIMPSEST_FALLBACK,
  selectPalimpsestRelayStory,
  type PalimpsestRelay,
  type PalimpsestRelayStory,
} from '../data/networkEditorial'

const PALIMPSEST_FEED = 'https://palimpsest.info/readings/newsroom-latest.json'

type PalimpsestFeed = {
  generated_at: string
  coverage: { total: number; live: number; status: string }
  stories: PalimpsestRelayStory[]
}

function safePalimpsestUrl(value: string): string {
  try {
    const url = new URL(value, 'https://palimpsest.info')
    if (url.origin !== 'https://palimpsest.info') return PALIMPSEST_FALLBACK.url
    url.searchParams.set('ref', 'narcoscope_signal_relay')
    return url.toString()
  } catch {
    return PALIMPSEST_FALLBACK.url
  }
}

function looksLikeFeed(value: unknown): value is PalimpsestFeed {
  if (!value || typeof value !== 'object') return false
  const feed = value as Partial<PalimpsestFeed>
  return typeof feed.generated_at === 'string'
    && Array.isArray(feed.stories)
    && Boolean(feed.coverage && Number.isFinite(feed.coverage.total) && Number.isFinite(feed.coverage.live))
}

function formatMetric(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)
}

export default function NetworkRelay() {
  const [relay, setRelay] = useState<PalimpsestRelay>(PALIMPSEST_FALLBACK)

  useEffect(() => {
    const controller = new AbortController()
    fetch(PALIMPSEST_FEED, { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Palimpsest feed returned ${response.status}`)
        return response.json() as Promise<unknown>
      })
      .then((value) => {
        if (!looksLikeFeed(value)) return
        const story = selectPalimpsestRelayStory(value.stories)
        if (!story) return
        setRelay({
          ...story,
          url: safePalimpsestUrl(story.url),
          coverage: value.coverage,
          generatedAt: value.generated_at,
          remote: true,
        })
      })
      .catch(() => {
        // The checked-in fallback is a complete, dated reading. A network or
        // CORS failure must not turn the sister-publication card into an empty
        // surface or make stale data look live.
      })
    return () => controller.abort()
  }, [])

  const limitation = relay.limitations[0] ?? 'Adjacent context does not become evidence for a NarcoScope claim.'

  return (
    <aside id="palimpsest-relay" className="network-relay" aria-labelledby="network-relay-title" data-feed={relay.remote ? 'live' : 'dated-fallback'}>
      <div className="network-relay__signal" aria-hidden="true">
        <svg viewBox="0 0 420 240">
          <path d="M32 176 C110 52 218 50 388 108" />
          <path d="M32 176 C144 210 266 198 388 108" />
          <circle cx="32" cy="176" r="5" />
          <circle cx="388" cy="108" r="6" />
          <circle cx="193" cy="72" r="3" />
          <circle cx="254" cy="198" r="3" />
        </svg>
        <span>NarcoScope</span>
        <span>Palimpsest</span>
      </div>

      <div className="network-relay__copy">
        <p className="network-relay__kicker"><span /> Signal relay · from Palimpsest</p>
        <h2 id="network-relay-title">{relay.headline}</h2>
        <p className="network-relay__dek">{relay.dek}</p>
        <div className="network-relay__actions">
          <a href={safePalimpsestUrl(relay.url)} target="_blank" rel="noreferrer">Read the Palimpsest dispatch <span aria-hidden="true">↗</span></a>
          <a href="https://palimpsest.info/?ref=narcoscope_network" target="_blank" rel="noreferrer">Enter the observatory</a>
        </div>
      </div>

      <div className="network-relay__receipt">
        <div>
          <span>{relay.metric.label ?? 'current reading'}</span>
          <strong>{formatMetric(relay.metric.value)}</strong>
          <small>{relay.metric.unit ?? 'no promoted metric'}</small>
        </div>
        <dl>
          <div><dt>Coverage</dt><dd>{relay.coverage.live}/{relay.coverage.total} instruments live</dd></div>
          <div><dt>Feed state</dt><dd>{relay.remote ? 'fetched now' : 'dated fallback'} · {relay.coverage.status}</dd></div>
          {relay.metric.denominator.value != null && (
            <div><dt>{relay.metric.denominator.label ?? 'Denominator'}</dt><dd>{formatMetric(relay.metric.denominator.value)}</dd></div>
          )}
        </dl>
        <p><b>Boundary.</b> {limitation}</p>
      </div>
    </aside>
  )
}
