import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './tikto.css'
import './styles.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Preloader reveal: the document starts at opacity 0 with a
// black background to avoid a flash of unstyled, unfonted content. Once fonts
// are ready (or after a safety timeout) we fade the whole page in via CSS.
const reveal = () => {
  document.documentElement.style.opacity = '1'
}
const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready
if (fontsReady) {
  fontsReady.then(reveal)
  setTimeout(reveal, 1200) // never let a slow font block the page
} else {
  requestAnimationFrame(reveal)
}
