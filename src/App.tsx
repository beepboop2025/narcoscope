import { useState, lazy, Suspense, type ReactNode } from 'react'
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
  { id: 'illicitfinance', label: 'Illicit Finance' },
  { id: 'wildlife', label: 'Wildlife Seizures' },
  { id: 'myanmar', label: 'Myanmar Focus' },
  { id: 'intel', label: 'Enterprise Intel' },
] as const

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

export default function App() {
  const { isSample } = useData()
  const [tab, setTab] = useState<string>('overview')
  useSmoothScroll()

  return (
    <div className="app tk">
      <header className="app-header">
        <HeroScene />
        <div className="hero-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">N</span>
            <div className="titles">
              <SpringText
                as="h1"
                text="NarcoScope"
                inkWords={['NarcoScope']}
                trigger="mount"
                stagger={26}
              />
              <p className="tagline">Public drug-market data, sourced and explained.</p>
              <p className="formerly-note">formerly the Drug Price Observatory</p>
            </div>
            <span
              className={`data-badge tk-chip ${isSample ? 'tk-chip--warning' : 'tk-chip--ok'}`}
              title={isSample
                ? 'Official: street prices (WDR 2025 Annex 8.1), seizure globe (Annex 7.1), overdose mortality (CDC VSRR), sanctions designations (US Treasury OFAC), Myanmar opium + conflict (Opium Survey 2025; Data: ACLED), precursor corridors (INCB Precursors Report 2025). Still illustrative: Myanmar region-level flow volumes and precursor prices. Not loaded: wastewater (no automatable publisher).'
                : 'All datasets replaced via the CSV loader — verify against the cited official sources.'}
            >
              {isSample ? 'Official data · corridors illustrative' : 'Live data'}
            </span>
          </div>
          <Reveal delay={420}>
            <p className="lede">
              Explore street prices, precursor flows, trafficking corridors, overdose
              mortality, and sanctions designations from public UNODC, INCB, CDC, and US
              Treasury records. Aggregate statistics for awareness, education, and
              research only.
            </p>
          </Reveal>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
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
          </TabPanel>
        </Suspense>
      </main>

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
        </footer>
      </Reveal>
    </div>
  )
}
