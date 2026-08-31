import { useEffect, useMemo, useState } from 'react'

type WireStatus = 'fresh' | 'aging' | 'stale' | 'partial' | 'restricted' | 'unavailable'
type VerificationState = 'source-published' | 'reported-lead' | 'context-only'

type WireItem = {
  id: string
  title: string
  summary?: string
  url: string
  sourceId: string
  sourceName: string
  publishedAt: string | null
  retrievedAt: string
  evidenceClass: 'official-release' | 'official-action' | 'reported-lead' | 'economic-context'
  verificationState: VerificationState
  legalStage: 'designation' | 'charge' | 'conviction' | 'sentencing' | 'settlement' | 'report' | 'not-applicable'
  topics: string[]
  countries: string[]
  publicationAllowed: boolean
}

type WireSource = {
  id: string
  name: string
  status: WireStatus
  checkedAt: string
  lastSuccessAt: string | null
  cadenceMinutes: number | null
  staleAfterMinutes: number | null
  rights: string
  detail?: string
}

type WireArtifact = {
  schema: 'narcoscope.evidence-wire.v1'
  generatedAt: string
  status: WireStatus
  window: { start: string | null; end: string | null }
  items: WireItem[]
  sources: WireSource[]
  caveats: string[]
}

type MonitorHeartbeat = {
  schema: 'narcoscope.wire-heartbeat.v1'
  status: 'ok' | 'failed' | 'unavailable'
  recordedAt: string | null
  itemCount: number | null
  artifactSha256?: string
  reason?: 'upstream_unconfigured' | 'upstream_invalid_config' | 'upstream_unavailable' | 'upstream_invalid_payload'
}

type JsonFeedItem = {
  id?: string
  url?: string
  title?: string
  content_text?: string
  summary?: string
  date_published?: string
  date_modified?: string
  tags?: string[]
}

type JsonFeed = { title?: string; items?: JsonFeedItem[] }

const POLL_INTERVAL_MS = 5 * 60 * 1000

function isWireArtifact(value: unknown): value is WireArtifact {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WireArtifact>
  return candidate.schema === 'narcoscope.evidence-wire.v1'
    && typeof candidate.generatedAt === 'string'
    && Array.isArray(candidate.items)
    && Array.isArray(candidate.sources)
}

function isMonitorHeartbeat(value: unknown): value is MonitorHeartbeat {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MonitorHeartbeat>
  return candidate.schema === 'narcoscope.wire-heartbeat.v1'
    && ['ok', 'failed', 'unavailable'].includes(candidate.status ?? '')
    && (candidate.recordedAt === null || typeof candidate.recordedAt === 'string')
    && (candidate.itemCount === null || (Number.isSafeInteger(candidate.itemCount) && (candidate.itemCount ?? -1) >= 0))
}

function feedFallback(feed: JsonFeed, retrievedAt: string): WireArtifact {
  const items = Array.isArray(feed.items) ? feed.items : []
  return {
    schema: 'narcoscope.evidence-wire.v1',
    generatedAt: retrievedAt,
    status: 'partial',
    window: { start: null, end: retrievedAt },
    items: items.slice(0, 40).map((item, index) => ({
      id: item.id ?? item.url ?? `newsroom-${index}`,
      title: item.title ?? 'Untitled newsroom record',
      summary: item.summary ?? item.content_text,
      url: item.url ?? '/#newsroom',
      sourceId: 'narcoscope-newsroom',
      sourceName: feed.title ?? 'NarcoScope evidence newsroom',
      publishedAt: item.date_published ?? item.date_modified ?? null,
      retrievedAt,
      evidenceClass: 'reported-lead',
      verificationState: 'reported-lead',
      legalStage: 'not-applicable',
      topics: item.tags ?? [],
      countries: [],
      publicationAllowed: true,
    })),
    sources: [{
      id: 'narcoscope-newsroom',
      name: feed.title ?? 'NarcoScope evidence newsroom',
      status: 'fresh',
      checkedAt: retrievedAt,
      lastSuccessAt: retrievedAt,
      cadenceMinutes: null,
      staleAfterMinutes: null,
      rights: 'NarcoScope-authored public feed',
      detail: 'The multi-source live wire is warming; showing the citation-gated newsroom feed.',
    }],
    caveats: ['Fallback mode: this view does not represent the full multi-source evidence wire.'],
  }
}

function formatClock(value: string | null): string {
  if (!value) return 'not reported'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date) + ' UTC'
}

function relativeClock(value: string | null, now: number): string {
  if (!value) return 'publication time unavailable'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'publication time unavailable'
  const minutes = Math.max(0, Math.round((now - time) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function evidenceLabel(value: WireItem['evidenceClass']): string {
  return {
    'official-release': 'Official release',
    'official-action': 'Official action',
    'reported-lead': 'Reported lead',
    'economic-context': 'Economic context',
  }[value]
}

async function fetchWire(signal: AbortSignal): Promise<WireArtifact> {
  const response = await fetch('/data/evidence-wire-v1.json', { cache: 'no-store', signal })
  if (response.ok) {
    const payload: unknown = await response.json()
    if (!isWireArtifact(payload)) throw new Error('The evidence wire returned an unsupported schema.')
    return payload
  }
  if (response.status !== 404) throw new Error(`Evidence wire returned HTTP ${response.status}.`)

  const fallbackResponse = await fetch('/news/feed.json', { cache: 'no-store', signal })
  if (!fallbackResponse.ok) throw new Error(`Evidence wire unavailable; newsroom fallback returned HTTP ${fallbackResponse.status}.`)
  const fallback = await fallbackResponse.json() as JsonFeed
  return feedFallback(fallback, new Date().toISOString())
}

async function fetchMonitorHeartbeat(signal: AbortSignal): Promise<MonitorHeartbeat> {
  const response = await fetch('/monitor/wire-heartbeat-v1.json', { cache: 'no-store', signal })
  const payload: unknown = await response.json()
  if (!isMonitorHeartbeat(payload)) throw new Error('The monitor heartbeat returned an unsupported schema.')
  if (!response.ok && payload.status !== 'unavailable') {
    throw new Error(`Monitor heartbeat returned HTTP ${response.status}.`)
  }
  return payload
}

export default function LiveEvidenceWire() {
  const [wire, setWire] = useState<WireArtifact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heartbeat, setHeartbeat] = useState<MonitorHeartbeat | null>(null)
  const [monitorError, setMonitorError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState('all')
  const [verification, setVerification] = useState<'all' | VerificationState>('all')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let activeController: AbortController | null = null

    const load = async () => {
      if (document.visibilityState === 'hidden') return
      activeController?.abort()
      activeController = new AbortController()
      const [wireResult, heartbeatResult] = await Promise.allSettled([
        fetchWire(activeController.signal),
        fetchMonitorHeartbeat(activeController.signal),
      ])

      if (wireResult.status === 'fulfilled') {
        setWire(wireResult.value)
        setError(null)
      } else if (wireResult.reason?.name !== 'AbortError') {
        setError(wireResult.reason instanceof Error ? wireResult.reason.message : 'Evidence wire unavailable.')
      }
      if (heartbeatResult.status === 'fulfilled') {
        setHeartbeat(heartbeatResult.value)
        setMonitorError(null)
      } else if (heartbeatResult.reason?.name !== 'AbortError') {
        setHeartbeat(null)
        setMonitorError(heartbeatResult.reason instanceof Error ? heartbeatResult.reason.message : 'Monitor heartbeat unavailable.')
      }
      setLoading(false)
      setNow(Date.now())
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    const onVisibility = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      activeController?.abort()
    }
  }, [])

  const topics = useMemo(
    () => [...new Set((wire?.items ?? []).flatMap((item) => item.topics))].sort(),
    [wire],
  )
  const items = useMemo(
    () => (wire?.items ?? []).filter((item) => {
      if (!item.publicationAllowed) return false
      if (topic !== 'all' && !item.topics.includes(topic)) return false
      return verification === 'all' || item.verificationState === verification
    }),
    [topic, verification, wire],
  )

  return (
    <section className="wire" aria-labelledby="wire-title">
      <header className="wire__header">
        <div>
          <p className="wire__eyebrow">Continuously monitored · rights-aware · source-grained</p>
          <h1 id="wire-title">Live evidence wire</h1>
          <p>New publications arrive here as evidence leads. They remain separate from atlas facts until a source-specific pipeline validates their schema, rights, clocks and claim boundary.</p>
        </div>
        <div className={`wire__status wire__status--${wire?.status ?? (error ? 'unavailable' : 'aging')}`}>
          <span aria-hidden="true" />
          <div><small>Wire state</small><strong>{loading ? 'Checking' : wire?.status ?? 'Unavailable'}</strong></div>
          <time dateTime={wire?.generatedAt}>Artifact generated {wire ? formatClock(wire.generatedAt) : 'not reported'}</time>
          <time dateTime={heartbeat?.recordedAt ?? undefined} aria-live="polite">
            Monitor last checked {formatClock(heartbeat?.recordedAt ?? null)}
            {' · '}{heartbeat?.status ?? (monitorError ? 'unavailable' : 'checking')}
            {heartbeat?.itemCount !== null && heartbeat?.itemCount !== undefined ? ` · ${heartbeat.itemCount} items in bound artifact` : ' · no bound artifact receipt'}
          </time>
        </div>
      </header>

      {error && (
        <div className="wire__error" role="status">
          <strong>Last-good view retained.</strong> {error}
        </div>
      )}

      <div className="wire__source-tape" aria-label="Source health">
        {(wire?.sources ?? []).map((source) => (
          <article key={source.id} className={`wire__source wire__source--${source.status}`}>
            <div><i aria-hidden="true" /><strong>{source.name}</strong><span>{source.status}</span></div>
            <p>{source.detail ?? source.rights}</p>
            <small>
              Checked {formatClock(source.checkedAt)} · last success {formatClock(source.lastSuccessAt)}
              {source.staleAfterMinutes ? ` · stale after ${source.staleAfterMinutes}m` : ''}
            </small>
          </article>
        ))}
        {!wire && loading && <div className="wire__source wire__source--aging"><strong>Reading source receipts…</strong></div>}
      </div>

      <div className="wire__body">
        <aside className="wire__filters" aria-label="Wire filters">
          <label>
            <span>Topic</span>
            <select value={topic} onChange={(event) => setTopic(event.target.value)}>
              <option value="all">All topics</option>
              {topics.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>Verification state</legend>
            {(['all', 'source-published', 'reported-lead', 'context-only'] as const).map((value) => (
              <label key={value}><input type="radio" name="wire-verification" value={value} checked={verification === value} onChange={() => setVerification(value)} /> {value.replaceAll('-', ' ')}</label>
            ))}
          </fieldset>
          <div className="wire__boundary">
            <span>Publication boundary</span>
            <p>Restricted source content is counted in health receipts but is never reproduced here. A headline is not an allegation ledger.</p>
          </div>
        </aside>

        <div className="wire__stream" aria-live="polite" aria-busy={loading}>
          <div className="wire__stream-heading">
            <div><span>Latest retrieved items</span><strong>{items.length} visible</strong></div>
            <p>Sorted by publication time where supplied; retrieval time remains visible.</p>
          </div>
          {items.map((item) => (
            <article className="wire__item" key={item.id}>
              <div className="wire__item-clock">
                <time dateTime={item.publishedAt ?? undefined}>{relativeClock(item.publishedAt, now)}</time>
                <span>{evidenceLabel(item.evidenceClass)}</span>
              </div>
              <div className="wire__item-copy">
                <p><strong>{item.sourceName}</strong><span>{item.verificationState.replaceAll('-', ' ')}</span>{item.legalStage !== 'not-applicable' && <span>{item.legalStage}</span>}</p>
                <h2><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h2>
                {item.summary && <p className="wire__summary">{item.summary}</p>}
                <div className="wire__tags">
                  {item.topics.map((value) => <span key={value}>{value}</span>)}
                  {item.countries.map((value) => <span key={value}>{value}</span>)}
                </div>
                <dl>
                  <div><dt>Published</dt><dd>{formatClock(item.publishedAt)}</dd></div>
                  <div><dt>Retrieved</dt><dd>{formatClock(item.retrievedAt)}</dd></div>
                </dl>
              </div>
            </article>
          ))}
          {!loading && items.length === 0 && (
            <div className="wire__empty"><h2>No matching public items</h2><p>Change the filters, or inspect source health above. Missing and restricted are intentional states, not empty-news claims.</p></div>
          )}
        </div>

        <aside className="wire__clocks" aria-label="Freshness method">
          <h2>Four clocks</h2>
          <dl>
            <div><dt>Observed</dt><dd>When the underlying event or measurement occurred.</dd></div>
            <div><dt>Published</dt><dd>When the source released its record.</dd></div>
            <div><dt>Retrieved</dt><dd>When NarcoScope captured it.</dd></div>
            <div><dt>Generated</dt><dd>When this sanitized public artifact was built.</dd></div>
          </dl>
          <p>“Fresh” means current to the declared source cadence. It never means every phenomenon is observed in real time.</p>
          <p>“Monitor last checked” is an execution heartbeat. It does not advance any evidence clock or make unchanged material newly fresh.</p>
          <a href="/api/v1/federation">Inspect federation receipts</a>
        </aside>
      </div>

      {wire?.caveats && wire.caveats.length > 0 && (
        <footer className="wire__caveats"><strong>Active caveats</strong><ul>{wire.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></footer>
      )}
    </section>
  )
}
