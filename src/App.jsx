import { useState, lazy, Suspense } from 'react'
import Explorer from './components/Explorer.jsx'
import Flows from './components/Flows.jsx'

const WorldMap = lazy(() => import('./components/WorldMap.jsx'))
const MyanmarFocus = lazy(() => import('./components/MyanmarFocus.jsx'))
import DataLoader from './components/DataLoader.jsx'
import { useData } from './lib/dataStore.js'
import { SOURCES } from './data/prices.js'

const TABS = [
  { id: 'prices', label: 'Street Prices' },
  { id: 'flows', label: 'Precursor Flows & Prices' },
  { id: 'map', label: 'Flow Map' },
  { id: 'myanmar', label: 'Myanmar Focus' },
]

export default function App() {
  const { isSample } = useData()
  const [tab, setTab] = useState('prices')

  return (
    <div className="app">
      <header className="app-header">
        <h1>🌍 Global Drug Price Observatory</h1>
        <p className="tagline">
          Awareness through public data — retail prices &amp; precursor supply chains,
          at country &amp; annual grain. Educational use only.
        </p>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <Suspense fallback={<div className="map-loading">Loading map…</div>}>
          {tab === 'prices' && <Explorer />}
          {tab === 'flows' && <Flows />}
          {tab === 'map' && <WorldMap />}
          {tab === 'myanmar' && <MyanmarFocus />}
        </Suspense>
      </main>

      <footer className="app-footer">
        <DataLoader />
        <p className="disclaimer">
          ⚠️ {isSample
            ? 'Showing sample/illustrative figures pending replacement with official data. '
            : 'Showing loaded data — verify against the cited official sources. '}
          This tool reports aggregate, published statistics (country and, for focus
          regions, province level) for awareness and research. It does not provide
          point-of-sale, real-time, or navigable location information, and is not a
          guide to obtaining any substance.
        </p>
        <div className="sources">
          <strong>Sources:</strong>{' '}
          {SOURCES.map((s, i) => (
            <span key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
              {i < SOURCES.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      </footer>
    </div>
  )
}
