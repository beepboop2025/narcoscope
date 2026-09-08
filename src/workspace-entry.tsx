import React from 'react'
import { createRoot } from 'react-dom/client'
import GlobalMarketExplorer, { type Market } from './components/GlobalMarketExplorer'
import './market-workspace.css'

const mount = document.getElementById('global-market-workspace')
if (mount) {
  const requested = new URLSearchParams(location.search).get('market') ?? 'all'
  const market: Market = ['drugs', 'arms', 'economy'].includes(requested) ? requested as Market : 'all'
  createRoot(mount).render(<React.StrictMode><GlobalMarketExplorer market={market}
    apiBase={mount.dataset.apiBase ?? 'https://www.narcoscope.com/api/v1'}
    narcoscopeBase="https://www.narcoscope.com/" /></React.StrictMode>)
}
