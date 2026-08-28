import { useRef, useState, type KeyboardEvent } from 'react'

const CORRIDOR_STAGES = [
  {
    id: 'record',
    index: '01',
    eyebrow: 'Official record',
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
    eyebrow: 'China + BRI context',
    title: 'Test what is visible.',
    copy: 'Palimpsest tracks China’s information controls, publication gaps and pinned Belt and Road coverage. Its BRI lane stays beside this record and never enters drug-market inference.',
    href: 'https://palimpsest.info/?ref=narcoscope_corridor',
    cta: 'Open Palimpsest',
    auxHref: '/api/v1/palimpsest-bri',
    auxLabel: 'Inspect bounded BRI context',
  },
  {
    id: 'bot',
    index: '03',
    eyebrow: 'Personal desk',
    title: 'Ask, then follow.',
    copy: 'Use the NarcoScope evidence bot for the latest bounded brief, a newsroom story, scope notes, and explicit opt-in follow alerts.',
    href: 'https://t.me/NarcoScopeEvidenceBot?start=ref_site_corridor',
    cta: 'Open @NarcoScopeEvidenceBot',
    auxHref: '/developers/',
    auxLabel: 'Or connect through API + MCP',
  },
  {
    id: 'signal',
    index: '04',
    eyebrow: 'Reviewed channel',
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

export default function EvidenceCorridor({ onOpenNewsroom }: { onOpenNewsroom: () => void }) {
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
          <span>Evidence corridor</span>
          <h2 id="corridor-title">Don&rsquo;t stop at the chart.<br /><em>Follow the claim.</em></h2>
        </div>
        <p>
          Move from the underlying record to separately attributed China and BRI context, then choose
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
          key={active.id}
        >
          <div><span>{active.index} / {active.eyebrow}</span><h3>{active.title}</h3></div>
          <div>
            <p>{active.copy}</p>
            <nav>
              {active.id === 'record' ? (
                <button type="button" onClick={onOpenNewsroom}>{active.cta} <span aria-hidden="true">↗</span></button>
              ) : (
                <a href={active.href} target="_blank" rel="noreferrer">{active.cta} <span aria-hidden="true">↗</span></a>
              )}
              <a href={active.auxHref} target={active.auxHref.startsWith('http') ? '_blank' : undefined} rel={active.auxHref.startsWith('http') ? 'noreferrer' : undefined}>{active.auxLabel}</a>
            </nav>
          </div>
        </article>
      </div>
    </section>
  )
}
