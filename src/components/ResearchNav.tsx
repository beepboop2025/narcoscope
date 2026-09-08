import { useEffect, useState } from 'react'
import { LENS_GROUPS, PRIMARY_DOSSIERS, TABS, groupForTab, lensForTab, type TabId } from '../navigation'

export default function ResearchNav({ activeTab, onSelect }: { activeTab: string; onSelect: (tab: TabId) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState(groupForTab(activeTab)?.id ?? 'briefing')
  useEffect(() => { setGroup(groupForTab(activeTab)?.id ?? 'briefing') }, [activeTab])
  const select = (id: TabId) => { onSelect(id); setExpanded(false); setQuery('') }
  const item = (entry: typeof TABS[number]) => <button type="button" key={entry.id}
    className={'workspace-nav__item ' + (activeTab === entry.id ? 'is-active' : '')}
    aria-current={activeTab === entry.id ? 'page' : undefined} onClick={() => select(entry.id)}>{entry.shortLabel}</button>
  return <nav className={'workspace-nav ' + (expanded ? 'is-expanded' : '')} aria-label="NarcoScope research lenses">
    <button type="button" className="workspace-nav__toggle" aria-expanded={expanded} aria-controls="workspace-navigation" onClick={() => setExpanded(!expanded)}>
      <span>Browse research</span><span>{lensForTab(activeTab)?.shortLabel ?? 'All datasets'} <b aria-hidden="true">⌄</b></span>
    </button>
    <div className="workspace-nav__body" id="workspace-navigation">
      <label className="workspace-nav__search"><span>Find a view</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Maps, prices, countries…" /></label>
      {query ? <div className="workspace-nav__section"><p>Matching views</p>{TABS.filter((entry) => (entry.label + ' ' + entry.description).toLowerCase().includes(query.toLowerCase())).map(item)}</div> : <>
        <div className="workspace-nav__section workspace-nav__primary"><p>World markets</p>{LENS_GROUPS[0].items.map(item)}</div>
        {LENS_GROUPS.filter((entry) => !['data', 'regions'].includes(entry.id)).map((entry) => <div className="workspace-nav__section" key={entry.id}>
          <button type="button" className="workspace-nav__group" aria-expanded={group === entry.id} aria-controls={'nav-' + entry.id} onClick={() => setGroup(group === entry.id ? '' : entry.id)}>{entry.label}<span aria-hidden="true">{group === entry.id ? '−' : '+'}</span></button>
          {group === entry.id && <div id={'nav-' + entry.id}>{entry.items.map(item)}</div>}
        </div>)}
        <div className="workspace-nav__section"><p>Connected regional desks</p>{PRIMARY_DOSSIERS.map(item)}</div>
      </>}
      <a className="workspace-nav__partner" href="https://www.palimpsest.info/china/evidence/">Palimpsest<span>China, economics and the public record</span></a>
      <a className="workspace-nav__partner" href="https://seiche.info/#RESEARCH/global_data/0">Seiche<span>Connect this evidence with funding, institution and liquidity research</span></a>
    </div>
  </nav>
}
