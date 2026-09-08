import { useEffect, useState } from 'react'
import './ConnectedResearch.css'
import ChinaEvidenceObservatory, { type Observatory } from './ChinaEvidenceObservatory'

type Report = { title: string; url: string; source_name: string; published_at: string }
type Finding = { title: string; text: string; limit: string; evidence: { source_url: string; released_at: string }[] }
type Indicator = { name: string; unit: string; country_code: string; source_url: string; latest_available: { value: number; period_end: string } | null }
type Region = { region: string; title: string; thesis: string; palimpsest_path: string; last_30_days_items: number; last_30_days_independence_groups: number; questions: { title: string; question: string; assessment: string; recent_reporting: Report[]; missing_evidence: string[] }[]; national_indicators: Indicator[]; economic_findings: EconomicFinding[] }
type Research = { schema: string; generated_at: string; regions: Region[]; china_findings: Finding[]; source_clocks: Record<string, string>; observatory?: Observatory }
type EconomicFinding = { id: string; title: string; text: string; interpretation: string; evidence: { source_url: string }[] }

export default function ConnectedResearch({ region = 'bri' }: { region?: string }) {
  const [data, setData] = useState<Research | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState(region)
  useEffect(() => setSelected(region), [region])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/connected-research', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Research unavailable')
        const value = await response.json()
        const research = value?.data?.data
        if (research?.schema !== 'palimpsest.connected-research.v1' || !Array.isArray(research.regions)) throw new Error('Research schema mismatch')
        setData(research)
      }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [])
  if (error) return <section className="connected-research"><h2>Connected regional research</h2><p>The research snapshot could not be loaded.</p><a href="https://www.palimpsest.info/research/connected/">Open the Palimpsest research desk</a></section>
  if (!data) return <section className="connected-research" aria-busy="true"><p>Loading economic evidence and regional reporting…</p></section>
  const current = data.regions.find(item => item.region === selected) ?? data.regions[0]
  const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(data.generated_at)) / 86400000))
  return <section className="connected-research" aria-label="Connected Palimpsest research">
    <header><div><p>Palimpsest × NarcoScope</p><h2>{current.title}</h2><p className="connected-research__lede">{current.thesis}</p></div><label>Research area<select value={selected} onChange={event => setSelected(event.target.value)}>{data.regions.map(item => <option key={item.region} value={item.region}>{item.region === 'cpec' ? 'CPEC / Gwadar' : item.region[0].toUpperCase() + item.region.slice(1)}</option>)}</select></label></header>
    <p className="connected-research__clock">Snapshot captured {data.generated_at.slice(0, 10)}{ageDays > 1 ? ` · ${ageDays} days old` : ''}. Economic observations retain their own reference years and release dates.</p>
    <div className="connected-research__actions"><a href={`https://www.palimpsest.info${current.palimpsest_path}`}>Open the full Palimpsest dossier</a><a href="https://www.palimpsest.info/china/economy/">Explore China’s economic tables</a><a href="/api/v1/connected-research">Research API</a></div>
    {selected === 'china' && <div className="connected-research__grid">{data.china_findings.map(finding => <article key={finding.title + finding.text}><h3>{finding.title}</h3><p>{finding.text}</p><p className="connected-research__note">{finding.limit}</p><a href={finding.evidence[0].source_url}>NBS source, {finding.evidence[0].released_at.slice(0, 10)}</a></article>)}</div>}
    {data.observatory && <ChinaEvidenceObservatory data={data.observatory} region={selected} />}
    <h3>What the annual economic record shows</h3>
    <div className="connected-research__grid">{current.economic_findings.map(finding => <article key={finding.id}><h3>{finding.title}</h3><p>{finding.text}</p><p className="connected-research__note">{finding.interpretation}</p><a href={finding.evidence[0].source_url}>World Bank national series</a></article>)}</div>
    <p>{current.last_30_days_items} captured reports from {current.last_30_days_independence_groups} publisher groups in the last 30 days of this snapshot.</p>
    <div className="connected-research__grid">{current.questions.map(question => <article key={question.title}><h3>{question.title}</h3><p><b>{question.question}</b></p><p className="connected-research__note">{question.assessment}</p><ul>{question.recent_reporting.slice(0, 3).map(report => <li key={report.url}><a href={report.url} target="_blank" rel="noreferrer">{report.title}</a><small>{report.source_name} · {report.published_at.slice(0, 10)}</small></li>)}</ul><details><summary>Evidence still needed</summary><ul>{question.missing_evidence.map(gap => <li key={gap}>{gap}</li>)}</ul></details></article>)}</div>
    <details className="connected-research__economics"><summary>Debt, reserves and household conditions: {current.national_indicators.length} national series</summary><p>Annual country statistics provide context. They do not measure a CPEC project or a Balochistan district.</p><div className="connected-research__table" tabIndex={0} role="region" aria-label="National economic indicators"><table><thead><tr><th>Indicator</th><th>Country</th><th>Latest available value</th><th>Unit</th><th>Year</th></tr></thead><tbody>{current.national_indicators.map(item => <tr key={item.country_code + item.name}><th><a href={item.source_url}>{item.name}</a></th><td>{item.country_code}</td><td>{item.latest_available ? item.latest_available.value.toLocaleString('en', { maximumFractionDigits: 2 }) : 'Unavailable'}</td><td>{item.unit}</td><td>{item.latest_available?.period_end.slice(0, 4) ?? 'Unavailable'}</td></tr>)}</tbody></table></div></details>
    <p className="connected-research__note">Economic and regional records share research navigation. Geography and timing do not establish an actor relationship, guilt or causation. Publisher reporting remains attributed; NBS statistical-data terms and World Bank CC BY 4.0 attribution apply.</p>
  </section>
}
