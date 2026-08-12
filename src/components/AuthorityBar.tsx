import { useState } from 'react'

const PUBLIC_ORIGIN = 'https://narcoscope.com/'

export function canonicalViewUrl(tab: string, base = PUBLIC_ORIGIN): string {
  const url = new URL(base)
  url.pathname = '/'
  url.search = ''
  url.hash = tab === 'overview' ? '' : tab
  return url.toString()
}

export function trackedViewUrl(tab: string, action: string, base = PUBLIC_ORIGIN): string {
  const url = new URL(canonicalViewUrl(tab, base))
  url.searchParams.set('utm_source', 'narcoscope')
  url.searchParams.set('utm_medium', 'earned_share')
  url.searchParams.set('utm_campaign', 'citable_research')
  url.searchParams.set('utm_content', action)
  url.hash = tab === 'overview' ? '' : tab
  return url.toString()
}

export function viewCitation(
  label: string,
  tab: string,
  accessed = new Date().toISOString().slice(0, 10),
  base = PUBLIC_ORIGIN,
): string {
  return `NarcoScope. “${label}.” NarcoScope, accessed ${accessed}. ${canonicalViewUrl(tab, base)}`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 4_000)
}

function downloadVisibleChart(label: string) {
  const source = Array.from(document.querySelectorAll<SVGSVGElement>('main svg')).find((svg) => {
    const box = svg.getBoundingClientRect()
    return box.width >= 180 && box.height >= 100 && box.bottom > 0 && box.top < window.innerHeight
  })
  if (!source) throw new Error('No visible chart')

  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('role', 'img')
  if (!clone.querySelector('title')) {
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = `${label} — NarcoScope`
    clone.prepend(title)
  }

  const sourceNodes = [source, ...Array.from(source.querySelectorAll<SVGElement>('*'))]
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<SVGElement>('*'))]
  const properties = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size', 'font-weight']
  sourceNodes.forEach((node, index) => {
    const target = cloneNodes[index]
    if (!target) return
    const computed = window.getComputedStyle(node)
    properties.forEach((property) => {
      const value = computed.getPropertyValue(property)
      if (value) target.style.setProperty(property, value)
    })
  })

  const xml = new XMLSerializer().serializeToString(clone)
  saveBlob(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), `narcoscope-${slug(label)}.svg`)
}

function downloadCitationCard(label: string, tab: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.fillStyle = '#05080a'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const gradient = context.createLinearGradient(72, 72, 1128, 558)
  gradient.addColorStop(0, '#79e8ee')
  gradient.addColorStop(1, '#ffab98')
  context.fillStyle = gradient
  context.fillRect(72, 78, 188, 5)
  context.fillStyle = '#79e8ee'
  context.font = '700 24px system-ui, sans-serif'
  context.fillText('NARCOSCOPE · OFFICIAL RECORD', 72, 138)
  context.fillStyle = '#f4f7f7'
  context.font = '400 58px Georgia, serif'
  const words = label.split(/\s+/)
  const lines: string[] = []
  let current = ''
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word
    if (context.measureText(candidate).width > 990 && current) {
      lines.push(current)
      current = word
    } else current = candidate
  })
  if (current) lines.push(current)
  lines.slice(0, 3).forEach((line, index) => context.fillText(line, 72, 238 + index * 72))
  context.fillStyle = '#a5b2b8'
  context.font = '400 26px system-ui, sans-serif'
  context.fillText('Sources, units, missing joins and claim limits stay attached.', 72, 500)
  context.fillStyle = '#79e8ee'
  context.font = '500 22px ui-monospace, monospace'
  context.fillText(canonicalViewUrl(tab).replace(/^https?:\/\//, ''), 72, 558)
  canvas.toBlob((blob) => {
    if (!blob) return
    saveBlob(blob, `narcoscope-${slug(label)}-citation-card.png`)
  }, 'image/png')
}

export default function AuthorityBar({ tab, label }: { tab: string; label: string }) {
  const [status, setStatus] = useState('')
  const report = (message: string) => {
    setStatus(message)
    window.setTimeout(() => setStatus(''), 2_400)
  }
  const liveBase = typeof window === 'undefined' ? PUBLIC_ORIGIN : window.location.origin

  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value)
    report(message)
  }

  const share = async () => {
    const url = trackedViewUrl(tab, 'native_share', liveBase)
    if (navigator.share) {
      await navigator.share({ title: `${label} | NarcoScope`, text: 'Inspect the official record and its limits.', url })
      return
    }
    await copy(url, 'Tracked link copied')
  }

  return (
    <div className="authority-bar" role="group" aria-label={`Share and cite ${label}`}>
      <button type="button" onClick={() => void share().catch(() => report('Share cancelled'))}>Share view</button>
      <button type="button" onClick={() => void copy(viewCitation(label, tab, undefined, liveBase), 'Citation copied').catch(() => report('Copy unavailable'))}>Copy citation</button>
      <button type="button" onClick={() => void copy(trackedViewUrl(tab, 'copy_link', liveBase), 'Tracked link copied').catch(() => report('Copy unavailable'))}>Copy link</button>
      <button type="button" onClick={() => {
        try { downloadVisibleChart(label); report('Chart SVG saved') } catch { report('Open a chart first') }
      }}>Download chart SVG</button>
      <button type="button" onClick={() => {
        try { downloadCitationCard(label, tab); report('Citation card saved') } catch { report('Export unavailable') }
      }}>Download share card</button>
      <span className="authority-bar__status" role="status" aria-live="polite">{status}</span>
    </div>
  )
}
