import { useEffect, useMemo, useState } from 'react'

type CitationSentence = {
  id: string
  text: string
  citationIds: string[]
  citationLocators: Array<{ sourceId: string; locator: string }>
}

type NewsSource = {
  id: string
  publisher: string
  title: string
  url: string
  upstreamGroup: string
  newsroomRole: string
  availabilityStatus: string
  newsroomUseStatus: string
  accessNote: string
  documentSha256: string | null
  retrievedAt: string | null
}

type NewsDossier = {
  title: string
  dek: string
  byline: string
  dataAsOf: string
  revisionHash: string
  contentHash: string
  editorialStatus: {
    automationDisclosure: string
    humanReviewStatus: string
    causalAttribution: string
    adjudicatedGuilt: string
  }
  publicationRecord: {
    corrections: { status: string; policy: string }
    rightToReply: { status: string; rationale: string; outreachPerformed: boolean }
    testimony: {
      expertTestimonyIncluded: boolean
      affectedPersonTestimonyIncluded: boolean
      simulatedHumanVoicesIncluded: boolean
      disclosure: string
    }
    updateHistory: Array<{
      eventType: string
      date: string
      summary: string
      revisionHash: string
    }>
  }
  promotion: {
    machineBriefUrl: string
  }
  keyFigures: Array<{
    id: string
    value: number
    unit: string
    label: string
    attributionBoundary: string
  }>
  visuals: Array<{
    id: string
    kind: string
    title: string
    description: string
    unit: string
    note: string
    items: Array<{
      id: string
      year: number
      category: string
      label: string
      value: number
      citationIds: string[]
      citationLocators: Array<{ sourceId: string; locator: string }>
    }>
  }>
  sections: Array<{
    id: string
    evidenceLane: string
    heading: string
    sentences: CitationSentence[]
  }>
  countercase: {
    heading: string
    sentences: CitationSentence[]
  }
  limitations: CitationSentence[]
  sources: NewsSource[]
  verificationReceipt: {
    citationCoverage: { percent: number }
    visualCitationCoverage: { percent: number }
    sourceInventory: {
      activeIndependenceGroupCount: number
      independentlyCorroboratedEventClaimCount: number
    }
    synthesisEvaluation: { synthesisSentenceCount: number }
    bannedClaimScan: { matches: unknown[] }
  }
}

type NewsIndex = {
  feeds: { json: string; atom: string }
  articles: Array<{
    dossierUrl: string
    htmlUrl: string
    machineBriefUrl: string
  }>
}

type LoadedNews = {
  index: NewsIndex
  dossier: NewsDossier
}

export function formatNewsroomNumber(value: number): string {
  const [integer, decimal] = String(value).split('.')
  const sign = integer.startsWith('-') ? '-' : ''
  const digits = sign ? integer.slice(1) : integer
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}${decimal ? `.${decimal}` : ''}`
}

function CitationList({
  ids,
  locators,
  sourceNumbers,
}: {
  ids: string[]
  locators: Array<{ sourceId: string; locator: string }>
  sourceNumbers: Map<string, number>
}) {
  return (
    <span className="news-citations" aria-label="Sentence citations">
      {locators.map(({ sourceId, locator }, index) => (
        <span key={`${sourceId}-${locator}`}>
          <a href={`#news-source-${sourceId}`} aria-label={`Source ${sourceNumbers.get(sourceId)}`} title={locator}>
            [{sourceNumbers.get(sourceId)}]
          </a>
          <small className="sr-only">{locator}</small>
          {ids[index] === sourceId ? null : <span className="sr-only">citation mismatch</span>}
        </span>
      ))}
    </span>
  )
}

function CitedSentence({
  sentence,
  sourceNumbers,
}: {
  sentence: CitationSentence
  sourceNumbers: Map<string, number>
}) {
  return (
    <p id={`news-sentence-${sentence.id}`}>
      {sentence.text}{' '}
      <CitationList ids={sentence.citationIds} locators={sentence.citationLocators} sourceNumbers={sourceNumbers} />
    </p>
  )
}

function EvidenceVisual({
  visual,
  sourceNumbers,
}: {
  visual: NewsDossier['visuals'][number]
  sourceNumbers: Map<string, number>
}) {
  const maxValue = Math.max(1, ...visual.items.map((item) => item.value))
  return (
    <figure
      className="newsroom-visual"
      aria-labelledby={`news-visual-${visual.id}-title`}
      aria-describedby={`news-visual-${visual.id}-description`}
    >
      <figcaption>
        <strong id={`news-visual-${visual.id}-title`}>{visual.title}</strong>
        <span id={`news-visual-${visual.id}-description`}>{visual.description}</span>
      </figcaption>
      <div className="newsroom-visual-scroll">
        <table>
          <caption>{visual.title} in {visual.unit}</caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">Record</th>
              <th scope="col">{visual.unit}</th>
              <th scope="col">Relative scale</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {visual.items.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.year}</th>
                <td>
                  <span className="newsroom-visual-category">{item.category.replaceAll('_', ' ')}</span>
                  {item.label}
                </td>
                <td className="newsroom-visual-value">{formatNewsroomNumber(item.value)}</td>
                <td className="newsroom-visual-bar-cell">
                  <span className="newsroom-visual-bar" aria-hidden="true">
                    <i style={{ width: `${(item.value / maxValue) * 100}%` }} />
                  </span>
                </td>
                <td><CitationList ids={item.citationIds} locators={item.citationLocators} sourceNumbers={sourceNumbers} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="newsroom-visual-note"><strong>Boundary:</strong> {visual.note}</p>
    </figure>
  )
}

function NewsroomRail({ dossier }: { dossier: NewsDossier }) {
  const items = useMemo(() => [
    ...dossier.sections.map((section) => ({ id: `news-${section.id}`, label: section.heading, kind: section.evidenceLane })),
    { id: 'news-countercase', label: dossier.countercase.heading, kind: 'countercase' },
    { id: 'news-limitations', label: 'Limitations', kind: 'claim boundary' },
    { id: 'news-sources', label: 'Sources and capability boundaries', kind: 'citation ledger' },
    { id: 'news-corrections', label: 'Corrections and update history', kind: 'publication record' },
  ], [dossier])
  const [activeId, setActiveId] = useState(items[0]?.id ?? 'news-limitations')

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return
    const targets = items
      .map((item) => document.getElementById(item.id))
      .filter((item): item is HTMLElement => Boolean(item))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]?.target.id) setActiveId(visible[0].target.id)
    }, { rootMargin: '-18% 0px -67% 0px', threshold: [0, 0.2, 0.6] })
    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [items])

  return (
    <aside className="newsroom-rail" aria-label="Article evidence map">
      <div className="newsroom-rail__head">
        <p>Evidence map</p>
        <span>{dossier.sections.length} findings · 1 countercase</span>
      </div>
      <nav>
        {items.map((item, index) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={activeId === item.id ? 'is-active' : undefined}
            aria-current={activeId === item.id ? 'location' : undefined}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <span><small>{item.kind.replaceAll('_', ' ')}</small>{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="newsroom-rail__receipt">
        <span>Receipt</span>
        <strong>{dossier.verificationReceipt.citationCoverage.percent}% cited</strong>
        <small>Data as of {dossier.dataAsOf}</small>
      </div>
    </aside>
  )
}

export default function EvidenceNewsroom() {
  const [loaded, setLoaded] = useState<LoadedNews | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      const indexResponse = await fetch('/news/index.json', { signal: controller.signal })
      if (!indexResponse.ok) throw new Error(`news index returned ${indexResponse.status}`)
      const index = await indexResponse.json() as NewsIndex
      const article = index.articles[0]
      if (!article?.dossierUrl) throw new Error('news index has no article dossier')
      const dossierResponse = await fetch(article.dossierUrl, { signal: controller.signal })
      if (!dossierResponse.ok) throw new Error(`article dossier returned ${dossierResponse.status}`)
      const dossier = await dossierResponse.json() as NewsDossier
      setLoaded({ index, dossier })
    }
    load().catch((reason: unknown) => {
      if (controller.signal.aborted) return
      setError(reason instanceof Error ? reason.message : 'unknown newsroom error')
    })
    return () => controller.abort()
  }, [])

  const sourceNumbers = useMemo(
    () => new Map(loaded?.dossier.sources.map((source, index) => [source.id, index + 1]) ?? []),
    [loaded],
  )

  if (error) {
    return (
      <section className="newsroom newsroom--error">
        <h2>Evidence newsroom</h2>
        <p>The structured dossier could not be loaded ({error}).</p>
        <a href="/news/china-linked-precursor-incidents-official-record.html">
          Open the standalone evidence analysis
        </a>
      </section>
    )
  }

  if (!loaded) {
    return (
      <section className="newsroom" aria-busy="true">
        <p className="newsroom-kicker">Official record · deterministic build</p>
        <h2>Loading evidence newsroom…</h2>
      </section>
    )
  }

  const { dossier, index } = loaded
  const indexedArticle = index.articles[0]

  return (
    <article className="newsroom">
      <header className="newsroom-header">
        <p className="newsroom-kicker">Automated evidence analysis · official sources only</p>
        <h2>{dossier.title}</h2>
        <p className="newsroom-dek">{dossier.dek}</p>
        <div className="newsroom-meta">
          <span>{dossier.byline}</span>
          <span>Data as of {dossier.dataAsOf}</span>
          <span>No human review recorded</span>
        </div>
        <aside className="newsroom-disclosure">
          <strong>Automation disclosure.</strong> {dossier.editorialStatus.automationDisclosure}{' '}
          Causal attribution is {dossier.editorialStatus.causalAttribution.replaceAll('_', ' ')};
          adjudicated guilt is {dossier.editorialStatus.adjudicatedGuilt.replaceAll('_', ' ')}.
        </aside>
        <aside className="newsroom-publication-status" aria-label="Right to reply and testimony status">
          <p>
            <strong>Right to reply: {dossier.publicationRecord.rightToReply.status.replaceAll('_', ' ')}.</strong>{' '}
            {dossier.publicationRecord.rightToReply.rationale} No outreach was performed or implied.
          </p>
          <p><strong>Testimony disclosure.</strong> {dossier.publicationRecord.testimony.disclosure}</p>
        </aside>
        <ul className="newsroom-verification" aria-label="Verification receipt summary">
          <li><strong>{dossier.verificationReceipt.citationCoverage.percent}%</strong><span>sentence citation coverage</span></li>
          <li><strong>{dossier.verificationReceipt.visualCitationCoverage.percent}%</strong><span>visual-row citation coverage</span></li>
          <li><strong>{dossier.verificationReceipt.sourceInventory.activeIndependenceGroupCount}</strong><span>independent active groups</span></li>
          <li><strong>{dossier.verificationReceipt.sourceInventory.independentlyCorroboratedEventClaimCount}</strong><span>corroborated event claims</span></li>
          <li><strong>{dossier.verificationReceipt.synthesisEvaluation.synthesisSentenceCount}</strong><span>gated synthesis sentences</span></li>
          <li><strong>{dossier.verificationReceipt.bannedClaimScan.matches.length}</strong><span>banned-claim matches</span></li>
        </ul>
      </header>

      <div className="newsroom-reading-grid">
        <NewsroomRail dossier={dossier} />
        <div className="newsroom-reading-body">

      <ul className="newsroom-figures" aria-label="Key bounded figures">
        {dossier.keyFigures.map((figure) => (
          <li key={figure.id}>
            <strong>{formatNewsroomNumber(figure.value)}</strong>
            <span>{figure.unit}</span>
            <small>{figure.label}</small>
            <em>{figure.attributionBoundary.replaceAll('_', ' ')}</em>
          </li>
        ))}
      </ul>

      <div className="newsroom-visuals" aria-label="Evidence timelines">
        {dossier.visuals.map((visual) => (
          <EvidenceVisual key={visual.id} visual={visual} sourceNumbers={sourceNumbers} />
        ))}
      </div>

      <div className="newsroom-copy">
        {dossier.sections.map((section) => (
          <section key={section.id} id={`news-${section.id}`}>
            <p className="newsroom-lane">{section.evidenceLane.replaceAll('_', ' ')}</p>
            <h3>{section.heading}</h3>
            {section.sentences.map((item) => (
              <CitedSentence key={item.id} sentence={item} sourceNumbers={sourceNumbers} />
            ))}
          </section>
        ))}

        <section className="newsroom-countercase" id="news-countercase">
          <p className="newsroom-lane">countercase</p>
          <h3>{dossier.countercase.heading}</h3>
          {dossier.countercase.sentences.map((item) => (
            <CitedSentence key={item.id} sentence={item} sourceNumbers={sourceNumbers} />
          ))}
        </section>

        <section id="news-limitations">
          <p className="newsroom-lane">limitations</p>
          <h3>Limitations</h3>
          <ul className="newsroom-limitations">
            {dossier.limitations.map((item) => (
              <li key={item.id}>
                {item.text}{' '}
                <CitationList ids={item.citationIds} locators={item.citationLocators} sourceNumbers={sourceNumbers} />
              </li>
            ))}
          </ul>
        </section>

        <section id="news-sources">
          <p className="newsroom-lane">citation ledger</p>
          <h3>Sources and capability boundaries</h3>
          <ol className="newsroom-sources">
            {dossier.sources.map((source, indexValue) => (
              <li key={source.id} id={`news-source-${source.id}`}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  [{indexValue + 1}] {source.publisher} — {source.title}
                </a>
                <span>{source.newsroomRole.replaceAll('_', ' ')} · {source.upstreamGroup} · {source.availabilityStatus.replaceAll('_', ' ')}</span>
                <small>{source.accessNote}</small>
                {source.documentSha256 && <small>Document SHA-256: <code>{source.documentSha256}</code> · retrieved {source.retrievedAt}</small>}
              </li>
            ))}
          </ol>
        </section>

        <section id="news-corrections">
          <p className="newsroom-lane">publication record</p>
          <h3>Corrections and update history</h3>
          <p>
            <strong>Current status:</strong>{' '}
            {dossier.publicationRecord.corrections.status.replaceAll('_', ' ')}.{' '}
            {dossier.publicationRecord.corrections.policy}
          </p>
          <ol className="newsroom-update-history">
            {dossier.publicationRecord.updateHistory.map((event) => (
              <li key={`${event.date}-${event.eventType}`}>
                <time dateTime={event.date}>{event.date}</time>
                <strong>{event.eventType.replaceAll('_', ' ')}</strong>
                <span>{event.summary}</span>
                <code>{event.revisionHash}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="newsroom-links">
        <a href={indexedArticle.htmlUrl}>Standalone article</a>
        <a href={indexedArticle.dossierUrl}>Dossier JSON</a>
        <a href={dossier.promotion.machineBriefUrl}>Machine brief</a>
        <a href={index.feeds.json}>JSON feed</a>
        <a href={index.feeds.atom}>Atom feed</a>
        <span title={dossier.revisionHash}>Revision {dossier.revisionHash.slice(0, 12)}</span>
        <span title={dossier.contentHash}>Content {dossier.contentHash.slice(0, 12)}</span>
      </footer>
        </div>
      </div>
    </article>
  )
}
