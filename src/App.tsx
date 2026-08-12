import { useEffect, useRef, useState, lazy, Suspense, type KeyboardEvent, type ReactNode } from 'react'
import { useSpring, animated } from '@react-spring/web'
import Overview from './components/Overview'
import Explorer from './components/Explorer'
import Flows from './components/Flows'
import DataLoader from './components/DataLoader'
import { useData } from './lib/dataStore'
import { SOURCES } from './data/prices'
import { useSmoothScroll } from './motion/useSmoothScroll'
import { usePrefersReducedMotion } from './motion/usePrefersReducedMotion'
import SpringText from './motion/SpringText'
import Reveal from './motion/Reveal'
import HeroScene from './hero/HeroScene'
import AuthorityBar from './components/AuthorityBar'

const WorldMap = lazy(() => import('./components/WorldMap'))
const MyanmarFocus = lazy(() => import('./components/MyanmarFocus'))
const IntelligenceBriefing = lazy(() => import('./components/IntelligenceBriefing'))
// Both lazy: each pulls in a several-hundred-kB bundled dataset (CDC mortality,
// OFAC designations) that has no business in the initial payload.
const Triangulation = lazy(() => import('./components/Triangulation'))
const Designations = lazy(() => import('./components/Designations'))
// Lazy: reads the bundled OFAC designation dataset.
const IllicitFinance = lazy(() => import('./components/IllicitFinance'))
// Lazy: reads the tiny 5.7 kB CITES confiscation pre-aggregate.
const WildlifeSeizures = lazy(() => import('./components/WildlifeSeizures'))
// Lazy: pulls the bundled CDC overdose dataset + the US states topojson.
const StateOverdose = lazy(() => import('./components/StateOverdose'))
// Lazy: the ~118 kB 30-year price series lives in its own chunk.
const PriceHistory = lazy(() => import('./components/PriceHistory'))
// Lazy: reads the ~210 kB seizure dataset (shared with the Flow Map chunk).
const SeizureTrends = lazy(() => import('./components/SeizureTrends'))
// Lazy: fetches the deterministic public/news dossier only when the newsroom is opened.
const EvidenceNewsroom = lazy(() => import('./components/EvidenceNewsroom'))

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'prices', label: 'Street Prices' },
  { id: 'pricehistory', label: 'Price History (30yr)' },
  { id: 'flows', label: 'Precursor Flows & Prices' },
  { id: 'map', label: 'Flow Map' },
  { id: 'seizuretrends', label: 'Seizure Trends' },
  { id: 'states', label: 'US Overdose Map' },
  { id: 'triangulate', label: 'Triangulation' },
  { id: 'designations', label: 'Designations' },
  { id: 'illicitfinance', label: 'Finance Typologies' },
  { id: 'wildlife', label: 'Wildlife Seizures' },
  { id: 'myanmar', label: 'Myanmar Focus' },
  { id: 'intel', label: 'Enterprise Intel' },
  { id: 'newsroom', label: 'Evidence Newsroom' },
] as const

const tabIds = new Set<string>(TABS.map((item) => item.id))

export function resolveTabFromHash(hash: string): string | null {
  const requested = hash.replace(/^#\/?/, '')
  if (requested === '') return 'overview'
  if (tabIds.has(requested)) return requested
  if (/^news-(?:source|sentence|visual)-/.test(requested)) return 'newsroom'
  return null
}

function initialTab(): string {
  if (typeof window === 'undefined') return 'overview'
  return resolveTabFromHash(window.location.hash) ?? 'overview'
}

/** Springs its contents in on mount — remounted per tab (key) for a crossfade. */
function TabPanel({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion()
  const style = useSpring({
    from: { opacity: 0, transform: 'translateY(0.8rem)' },
    to: { opacity: 1, transform: 'translateY(0rem)' },
    config: { tension: 260, friction: 26 },
    immediate: reduced,
  })
  return <animated.div style={style}>{children}</animated.div>
}

const CORRIDOR_STAGES = [
  {
    id: 'record',
    index: '01',
    eyebrow: 'OFFICIAL RECORD',
    title: 'Inspect the claim.',
    copy: 'Start with the source-linked dossier, its aggregation boundary, and every row NarcoScope refused to combine.',
    href: '#newsroom',
    cta: 'Open the cited newsroom',
    auxHref: '/news/feed.json',
    auxLabel: 'Follow the JSON feed',
  },
  {
    id: 'context',
    index: '02',
    eyebrow: 'CHINA CONTEXT',
    title: 'Test what is visible.',
    copy: 'Palimpsest tracks China’s information controls and publication gaps—the relevant context when precursor evidence depends on what entered the public record.',
    href: 'https://palimpsest.info/',
    cta: 'Open Palimpsest',
    auxHref: 'https://t.me/palimpsest_watch_bot?start=narcoscope_corridor',
    auxLabel: 'Ask @palimpsest_watch_bot',
  },
  {
    id: 'bot',
    index: '03',
    eyebrow: 'PERSONAL DESK',
    title: 'Ask, then follow.',
    copy: 'Use the NarcoScope evidence bot for the latest bounded brief, a newsroom story, scope notes, and explicit opt-in follow alerts.',
    href: 'https://t.me/NarcoScopeEvidenceBot?start=ref_site_corridor',
    cta: 'Open @NarcoScopeEvidenceBot',
    auxHref: 'https://narcoscope.com/developers/',
    auxLabel: 'Or connect through API + MCP',
  },
  {
    id: 'signal',
    index: '04',
    eyebrow: 'REVIEWED CHANNEL',
    title: 'Watch the evidence move.',
    copy: 'Evidence Signal carries curated NarcoScope, Palimpsest, and ScamShield updates. Private submissions and raw wire material never enter the channel.',
    href: 'https://t.me/EvidenceSignalDesk',
    cta: 'Join @EvidenceSignalDesk',
    auxHref: 'https://t.me/NarcoScopeEvidenceBot?start=ref_signal_channel',
    auxLabel: 'Prefer the personal bot',
  },
] as const

export function resolveCorridorTabIndex(
  key: string,
  currentIndex: number,
  tabCount = CORRIDOR_STAGES.length,
): number | null {
  if (tabCount < 1) return null
  if (key === 'ArrowRight') return (currentIndex + 1) % tabCount
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount
  if (key === 'Home') return 0
  if (key === 'End') return tabCount - 1
  return null
}

function EvidenceCorridor() {
  const [activeId, setActiveId] = useState<(typeof CORRIDOR_STAGES)[number]['id']>('record')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const active = CORRIDOR_STAGES.find((stage) => stage.id === activeId) ?? CORRIDOR_STAGES[0]

  const handleStageKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = resolveCorridorTabIndex(event.key, currentIndex)
    if (nextIndex === null) return
    const nextStage = CORRIDOR_STAGES[nextIndex]
    if (!nextStage) return
    event.preventDefault()
    setActiveId(nextStage.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section className="evidence-corridor" aria-labelledby="corridor-title">
      <header className="corridor-header">
        <div>
          <span>THE EVIDENCE CORRIDOR</span>
          <h2 id="corridor-title">Don&rsquo;t stop at the chart.<br /><em>Follow the claim.</em></h2>
        </div>
        <p>
          Move from the underlying record to the relevant China context, then choose
          a personal bot or the reviewed public signal. Every step preserves the evidence boundary.
        </p>
      </header>
      <div className="corridor-instrument">
        <div className="corridor-route" role="tablist" aria-label="Evidence corridor stages">
          <span className="corridor-line" aria-hidden="true" />
          {CORRIDOR_STAGES.map((stage, index) => (
            <button
              key={stage.id}
              id={`corridor-tab-${stage.id}`}
              ref={(node) => { tabRefs.current[index] = node }}
              type="button"
              role="tab"
              aria-selected={active.id === stage.id}
              aria-controls="corridor-detail"
              tabIndex={active.id === stage.id ? 0 : -1}
              className={active.id === stage.id ? 'active' : ''}
              onClick={() => setActiveId(stage.id)}
              onPointerEnter={() => setActiveId(stage.id)}
              onKeyDown={(event) => handleStageKeyDown(event, index)}
            >
              <b>{stage.index}</b>
              <span>{stage.eyebrow}</span>
            </button>
          ))}
        </div>
        <article
          className={`corridor-detail corridor-detail--${active.id}`}
          id="corridor-detail"
          role="tabpanel"
          aria-labelledby={`corridor-tab-${active.id}`}
        >
          <div><span>{active.index} / {active.eyebrow}</span><h3>{active.title}</h3></div>
          <div><p>{active.copy}</p><nav><a href={active.href}>{active.cta} ↗</a><a href={active.auxHref}>{active.auxLabel}</a></nav></div>
        </article>
      </div>
    </section>
  )
}

export default function App() {
  const { isSample } = useData()
  const [tab, setTab] = useState<string>(initialTab)
  useSmoothScroll()

  useEffect(() => {
    const syncTabToLocation = () => {
      const nextTab = resolveTabFromHash(window.location.hash)
      if (nextTab) setTab(nextTab)
    }
    window.addEventListener('hashchange', syncTabToLocation)
    window.addEventListener('popstate', syncTabToLocation)
    return () => {
      window.removeEventListener('hashchange', syncTabToLocation)
      window.removeEventListener('popstate', syncTabToLocation)
    }
  }, [])

  const selectTab = (nextTab: string) => {
    setTab(nextTab)
    if (typeof window !== 'undefined' && window.location.hash !== `#${nextTab}`) {
      window.history.pushState(null, '', `#${nextTab}`)
    }
  }

  return (
    <div className="app tk">
      <header className="app-header">
        <HeroScene />
        <div className="hero-inner">
          <div className="brand">
            <span className="brand-mark">🌍</span>
            <div className="titles">
              <SpringText
                as="h1"
                text="NarcoScope"
                inkWords={['NarcoScope']}
                trigger="mount"
                stagger={26}
              />
              <p className="tagline">Making the world&rsquo;s drug-trade data legible.</p>
              <p className="formerly-note">formerly the Drug Price Observatory</p>
            </div>
            <span
              className={`data-badge tk-chip ${isSample ? 'tk-chip--warning' : 'tk-chip--ok'}`}
              title={isSample
                ? 'Official: street prices (WDR 2025 Annex 8.1), seizure globe (Annex 7.1), overdose mortality (CDC VSRR), sanctions designations (US Treasury OFAC), Myanmar opium + conflict (Opium Survey 2025; Data: ACLED), precursor corridors (INCB Precursors Report 2025). Still illustrative: Myanmar region-level flow volumes and precursor prices. Not loaded: wastewater (no automatable publisher).'
                : 'All datasets replaced via the CSV loader — verify against the cited official sources.'}
            >
              {isSample ? 'Official data · some inputs illustrative' : 'Live data'}
            </span>
          </div>
          <Reveal delay={420}>
            <p className="lede">
              Inspect the official record behind drug prices, precursor incidents,
              seizures, overdose mortality, wastewater and public designations. Every
              analysis shows its sources, missing joins and the point where the evidence
              stops. Aggregate statistics for awareness, education, and research only.
            </p>
            <div className="hero-actions" aria-label="NarcoScope entry points">
              <button type="button" className="hero-action hero-action--primary" onClick={() => selectTab('newsroom')}>
                Read the evidence newsroom
              </button>
              <a className="hero-action" href="/developers/">Connect API + MCP</a>
              <a className="hero-action" href="/news/feed.json">Follow the feed</a>
              <a className="hero-action" href="/research/">Research guides</a>
              <a className="hero-action hero-action--telegram" href="https://t.me/NarcoScopeEvidenceBot?start=ref_site_hero">Open the Telegram bot</a>
              <a className="hero-action hero-action--signal" href="https://t.me/EvidenceSignalDesk">Join Evidence Signal</a>
            </div>
            <AuthorityBar
              tab={tab}
              label={TABS.find((item) => item.id === tab)?.label ?? 'Official drug-market evidence'}
            />
          </Reveal>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <Suspense fallback={<div className="map-loading">Loading…</div>}>
          <TabPanel key={tab}>
            {tab === 'overview' && <Overview />}
            {tab === 'prices' && <Explorer />}
            {tab === 'pricehistory' && <PriceHistory />}
            {tab === 'flows' && <Flows />}
            {tab === 'map' && <WorldMap />}
            {tab === 'seizuretrends' && <SeizureTrends />}
            {tab === 'states' && <StateOverdose />}
            {tab === 'triangulate' && <Triangulation />}
            {tab === 'designations' && <Designations />}
            {tab === 'illicitfinance' && <IllicitFinance />}
            {tab === 'wildlife' && <WildlifeSeizures />}
            {tab === 'myanmar' && <MyanmarFocus />}
            {tab === 'intel' && <IntelligenceBriefing />}
            {tab === 'newsroom' && <EvidenceNewsroom />}
          </TabPanel>
        </Suspense>
      </main>

      <Reveal>
        <EvidenceCorridor />
      </Reveal>

      <Reveal>
        <footer className="app-footer tk-card tk-card--watch">
          <DataLoader />
          <p className="disclaimer tk-degraded">
            ⚠️ {isSample
              ? 'Official data: street prices (UNODC WDR 2025 Annex 8.1 + World Bank GDP), the seizure globe (Annex 7.1), overdose mortality (CDC NCHS VSRR, provisional), sanctions designations (US Treasury OFAC SDN), Myanmar opium cultivation (UNODC Myanmar Opium Survey 2025), Myanmar conflict pressure (Data: ACLED), and precursor trafficking corridors (INCB Precursors Report 2025). Still illustrative: Myanmar region-level flow volumes and precursor prices. '
              : 'Showing loaded data — verify against the cited official sources. '}
            This tool reports aggregate, published statistics (country and, for focus
            regions, province level) for awareness and research. It does not provide
            point-of-sale, real-time, or navigable location information, and is not a
            guide to obtaining any substance.
          </p>
          <div className="sources tk-trust">
            <span className="tk-trust__item"><b>Sources</b></span>
            <span className="tk-trust__sep" />
            {SOURCES.map((s, i) => (
              <span key={s.url} className="tk-trust__item">
                <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
                {i < SOURCES.length - 1 ? <span className="tk-trust__sep" /> : null}
              </span>
            ))}
          </div>
          <aside className="network-note" aria-labelledby="network-note-title">
            <span id="network-note-title">Related evidence network</span>
            <div className="network-routes">
              <a href="https://palimpsest.info/"><b>Relevant subject</b><strong>Palimpsest</strong><small>China&rsquo;s information controls and publication gaps beside the precursor record.</small></a>
              <a href="https://myquantdoesntspeakenglish.com/"><b>Different subject</b><strong>My Quant Doesn&rsquo;t Speak English</strong><small>The financial research wire; shared evidence rules, kept outside this subject route.</small></a>
            </div>
          </aside>
          <nav className="product-links" aria-label="NarcoScope product links">
            <a href="/#newsroom">Evidence newsroom</a>
            <a href="/research/">Research guides</a>
            <a href="/developers/">API + MCP</a>
            <a href="/openapi.json">OpenAPI</a>
            <a href="/server.json">MCP manifest</a>
            <a href="/product-card.json">Product card</a>
            <a href="https://t.me/NarcoScopeEvidenceBot?start=ref_site_footer">Telegram bot</a>
            <a href="https://t.me/EvidenceSignalDesk">Evidence Signal channel</a>
            <a href="https://github.com/beepboop2025/narcoscope" target="_blank" rel="noreferrer">Source code</a>
          </nav>
        </footer>
      </Reveal>
    </div>
  )
}
