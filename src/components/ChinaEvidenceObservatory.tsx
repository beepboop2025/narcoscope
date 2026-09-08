export type Observatory = {
  generated_at: string; source_url: string
  datasets: { id: string; title: string; status: string; visibility: string; clock: string; path: string; download: string; coverage: Record<string, number>; description: string }[]
  findings: { id: string; title: string; text: string; interpretation: string; evidence_class: string; source_urls: string[]; data_path: string; region: string; evidence_series?: string[] }[]
  methodology_cases: { id: string; title: string; event_date: string; claim: string; interpretation: string; source_urls: string[]; evidence_status: string }[]
}

const origin = 'https://www.palimpsest.info'
const labels: Record<string, string> = {
  archive_numeric_cells: 'Retained numeric table cells', archive_vintages: 'Retained source vintages',
  comparable_series: 'Comparable economic series', city_housing_series: 'City housing series',
  deduplicated_series_months: 'Distinct series-month observations', observed_revision_pairs: 'Observed revision pairs',
  ambiguous_series_months: 'Ambiguous series-month observations', series: 'Trade series', rows: 'Historical rows',
  numeric_cells: 'Reported numeric cells', unavailable_cells: 'Unavailable cells', products: 'Product categories',
  independent_source_groups: 'Independent source groups', watched_documents: 'Watched documents',
  available_documents: 'Documents available at this check', retained_documents: 'Documents with successful captures',
  source_groups: 'Watched publisher groups', available_source_groups: 'Publisher groups available at this check',
  retained_source_groups: 'Publisher groups with successful captures', baseline_documents: 'New document baselines',
  changed_documents: 'Changed documents', updated_indexes: 'Updated indexes', unavailable_documents: 'Unavailable documents',
  removal_observations: 'Repeated URL-absence observations', retained_captures: 'Retained capture receipts',
  captured_characters: 'Characters retained privately', captured_numeric_tokens: 'Numeric tokens retained privately',
  workbooks_retained: 'Workbooks retained privately', sheets_retained: 'Workbook sheets retained privately',
  numeric_observations_private: 'Numeric observations retained privately', unavailable_observations_private: 'Unavailable observations in private records',
  public_numeric_observations: 'Numeric observations cleared for public display',
}

export default function ChinaEvidenceObservatory({ data, region }: { data: Observatory; region: string }) {
  const china = region === 'china'
  const partners = region === 'myanmar' ? new Set(['CN', 'MM']) : new Set(['CN', 'PK'])
  const findings = data.findings.filter(item => china || (item.region === 'regional' && (region === 'bri'
    || item.evidence_series?.some(series => partners.has(series.split(':')[1])))))
  return <section className="connected-research__observatory" aria-label="China evidence observatory">
    <h3>{china ? 'Read beneath the headline' : 'Follow the trade evidence into the regional record'}</h3>
    <p>Compare economic histories, outside trade declarations and changes in official publications. Gaps and disagreements raise research questions; they do not establish concealment.</p>
    <p className="connected-research__clock">Evidence desk captured {data.generated_at.slice(0, 10)}. Each dataset below retains its own collection date.</p>
    <div className="connected-research__actions"><a href={data.source_url}>Open the China evidence observatory</a><a href={`${origin}/readings/china-evidence-observatory-latest.json`}>Full evidence snapshot</a></div>
    <div className="connected-research__grid">{findings.map(item => <article key={item.id}>
      <p className="connected-research__evidence-class">{item.evidence_class === 'externally_reported_trade' ? 'EU-reported trade' : 'Official statistical comparison'}</p>
      <h4>{item.title}</h4><p>{item.text}</p><p className="connected-research__note">{item.interpretation}</p>
      <div className="connected-research__actions"><a href={item.source_urls[0]}>Original source</a><a href={`${origin}${item.data_path}`}>Evidence and historical data</a></div>
    </article>)}</div>
    {china && <><h4>Methodology and publication changes</h4><p>These dates describe historical official announcements. They are separate from when Palimpsest captured the documents.</p>
      <div className="connected-research__grid">{data.methodology_cases.map(item => <article key={item.id}>
        <p className="connected-research__evidence-class">Official announcement · {item.event_date}</p><h4>{item.title}</h4>
        <p>{item.claim}</p><p className="connected-research__note">{item.interpretation}</p>
        <p className="connected-research__note">{item.evidence_status === 'captured' ? 'Supporting official documents captured.' : 'Some supporting documents were unavailable for capture.'}</p>
        <div className="connected-research__actions">{item.source_urls.map((url, index) => <a href={url} key={url}>Official document {index + 1}</a>)}</div>
      </article>)}</div></>}
    <details className="connected-research__library"><summary>Inspect the four evidence collections</summary><div className="connected-research__grid">{data.datasets.map(item => <article key={item.id}>
      <h4>{item.title}</h4><p>{item.description}</p>
      <p className="connected-research__note">Checked {item.clock.slice(0, 10)} · {item.status.replaceAll('_', ' ')}</p>
      {item.visibility === 'numeric_data_private' && <p className="connected-research__private">Acquisition metadata is public. Numeric records remain private.</p>}
      <dl className="connected-research__coverage">{Object.entries(item.coverage).map(([key, value]) => <div key={key}><dt>{labels[key] ?? key.replaceAll('_', ' ')}</dt><dd>{value.toLocaleString('en')}</dd></div>)}</dl>
      <div className="connected-research__actions"><a href={`${origin}${item.path}`}>Dataset and provenance</a><a href={`${origin}${item.download}`}>{item.visibility === 'numeric_data_private' ? 'Download acquisition metadata' : 'Download retained data'}</a></div>
    </article>)}</div></details>
  </section>
}
