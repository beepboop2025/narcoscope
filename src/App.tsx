import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react'
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
import HeroEvidenceStack from './components/HeroEvidenceStack'
import ResearchNav from './components/ResearchNav'
import NetworkRelay from './components/NetworkRelay'
import AuthorityBar from './components/AuthorityBar'
import EvidenceCorridor from './components/EvidenceCorridor'
import { TABS, type TabId } from './navigation'

export { resolveCorridorTabIndex } from './components/EvidenceCorridor'

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

const tabIds = new Set<string>(TABS.map((item) => item.id))

export function resolveTabFromHash(hash: string): string | null {
  const requested = hash.replace(/^#\/?/, '')
  if (requested === '') return 'overview'
  if (tabIds.has(requested)) return requested
  if (/^news-/.test(requested)) return 'newsroom'
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

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 42 42" aria-hidden="true">
      <circle cx="21" cy="21" r="7.5" />
      <ellipse cx="21" cy="21" rx="18" ry="8.5" />
      <ellipse cx="21" cy="21" rx="18" ry="8.5" transform="rotate(62 21 21)" />
      <circle className="brand-mark__signal" cx="35.5" cy="17" r="2.5" />
    </svg>
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

  const selectTab = (nextTab: TabId, revealWorkspace = false) => {
    setTab(nextTab)
    if (typeof window !== 'undefined' && window.location.hash !== `#${nextTab}`) {
      window.history.pushState(null, '', `#${nextTab}`)
    }
    if (revealWorkspace && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.getElementById('research-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  return (
    <div className="app tk">
      <header className="app-header">
        <HeroScene />
        <div className="hero-inner">
          <div className="hero-masthead">
            <button type="button" className="brand" onClick={() => selectTab('overview')} aria-label="Open NarcoScope overview">
              <BrandMark />
              <span>NarcoScope</span>
              <small>Public evidence atlas</small>
            </button>
            <span
              className={`data-badge tk-chip ${isSample ? 'tk-chip--warning' : 'tk-chip--ok'}`}
              title={isSample
                ? 'Official: street prices (WDR 2025 Annex 8.1), seizure globe (Annex 7.1), overdose mortality (CDC VSRR), sanctions designations (US Treasury OFAC), Myanmar opium + conflict (Opium Survey 2025; Data: ACLED), precursor corridors (INCB Precursors Report 2025). Still illustrative: Myanmar region-level flow volumes and precursor prices. Not loaded: wastewater (no automatable publisher).'
                : 'All datasets replaced via the CSV loader — verify against the cited official sources.'}
            >
              {isSample ? 'Official data · some inputs illustrative' : 'Live data'}
            </span>
          </div>
          <div className="hero-layout">
            <div className="hero-copy">
              <p className="hero-kicker">Markets · movement · harm · public networks</p>
              <SpringText
                as="h1"
                text="The official record has layers."
                inkWords={['layers.']}
                trigger="mount"
                stagger={24}
              />
              <p className="tagline">See the market. Challenge the record.</p>
              <Reveal delay={360}>
                <p className="lede">
                  NarcoScope turns official drug-price, precursor, seizure, mortality and
                  designation records into an explorable evidence atlas. Every view keeps
                  its source, denominator, missing join and claim boundary beside the chart.
                </p>
                <div className="hero-actions" aria-label="NarcoScope entry points">
                  <button type="button" className="hero-action hero-action--primary" onClick={() => selectTab('newsroom', true)}>
                    Read the lead investigation
                  </button>
                  <a className="hero-action" href="/developers/">Connect API + MCP</a>
                  <a className="hero-action" href="/research/">Research guides</a>
                </div>
                <AuthorityBar
                  tab={tab}
                  label={TABS.find((item) => item.id === tab)?.label ?? 'Official drug-market evidence'}
                />
                <ul className="hero-proof" aria-label="Publication guarantees">
                  <li>Official aggregates</li>
                  <li>Visible uncertainty</li>
                  <li>No point-level market guidance</li>
                </ul>
              </Reveal>
            </div>
            <Reveal delay={180}>
              <HeroEvidenceStack onOpen={(nextTab) => selectTab(nextTab, true)} />
            </Reveal>
          </div>
        </div>
      </header>

      <ResearchNav activeTab={tab} onSelect={selectTab} />

      <main id="research-workspace">
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
        <NetworkRelay />
      </Reveal>

      <Reveal>
        <EvidenceCorridor onOpenNewsroom={() => selectTab('newsroom', true)} />
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
            <span id="network-note-title">Independent evidence network</span>
            <p>
              For censorship, network interference and sealed AI evaluations,{' '}
              <a href="https://palimpsest.info/?ref=narcoscope_footer" target="_blank" rel="noreferrer">Palimpsest</a>{' '}
              publishes a separate evidence desk. For financial-system plumbing, institution risk and market exits,{' '}
              <a href="https://myquantdoesntspeakenglish.com/">My Quant Doesn’t Speak English</a>{' '}
              collects the Seiche, LiquiLens and Undertow investigations. Different subjects; the same rule that evidence must stay inspectable.
            </p>
          </aside>
          <nav className="product-links" aria-label="NarcoScope product links">
            <a href="/#newsroom">Evidence newsroom</a>
            <a href="/research/">Research guides</a>
            <a href="/developers/">API + MCP</a>
            <a href="/openapi.json">OpenAPI</a>
            <a href="/server.json">MCP manifest</a>
            <a href="/product-card.json">Product card</a>
            <a href="https://palimpsest.info/?ref=narcoscope_products" target="_blank" rel="noreferrer">Palimpsest</a>
            <a href="https://t.me/NarcoScopeEvidenceBot?start=ref_site_footer" target="_blank" rel="noreferrer">Evidence bot</a>
            <a href="https://t.me/EvidenceSignalDesk" target="_blank" rel="noreferrer">Evidence Signal</a>
            <a href="https://github.com/beepboop2025/narcoscope" target="_blank" rel="noreferrer">Source code</a>
          </nav>
        </footer>
      </Reveal>
    </div>
  )
}
