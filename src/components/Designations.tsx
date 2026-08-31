import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useData } from '../lib/dataStore'
import { BUNDLED_DESIGNATION_RECORDS, DESIGNATION_META, withBundled } from '../data/bundled'
import { buildDesignationNetwork, searchDesignations } from '../lib/designationNetwork'
import CountUp from '../motion/CountUp'
import type { DesignationEntityType, DesignationRecord } from '../types'
import DataTableViewport from './DataTableViewport'

const PROGRAM_LABEL = DESIGNATION_META.programs as Record<string, string>
const PAGE_SIZE = 50

function concentrationTier(hhi: number): string {
  if (hhi > 2500) return 'highly concentrated'
  if (hhi >= 1500) return 'moderately concentrated'
  return 'dispersed'
}

function typeLabel(type: DesignationEntityType): string {
  return { individual: 'Person', organization: 'Organization', vessel: 'Vessel', aircraft: 'Aircraft' }[type]
}

function actionDescription(record: DesignationRecord): string {
  const authorities = record.programs.map((program) => PROGRAM_LABEL[program] ?? program).join(', ')
  return `U.S. Treasury OFAC lists this ${typeLabel(record.entityType).toLocaleLowerCase()} under ${authorities}. This records a designation, not a conviction or a finding of guilt.`
}

export default function Designations() {
  const { designationRecords: loadedDesignations } = useData()
  const designationRecords = withBundled(loadedDesignations, BUNDLED_DESIGNATION_RECORDS)
  const [program, setProgram] = useState('all')
  const [entityType, setEntityType] = useState<'all' | DesignationEntityType>('all')
  const [country, setCountry] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)

  const countries = useMemo(
    () => [...new Set(designationRecords.flatMap((record) => record.countries))].sort((a, b) => a.localeCompare(b)),
    [designationRecords],
  )
  const scopedRecords = useMemo(
    () => designationRecords.filter((record) => {
      if (program !== 'all' && !record.programs.includes(program)) return false
      if (entityType !== 'all' && record.entityType !== entityType) return false
      return country === 'all' || record.countries.includes(country)
    }),
    [country, designationRecords, entityType, program],
  )
  const matches = useMemo(() => {
    if (query.trim().length < 2) return scopedRecords.map((record) => ({ ...record, matchedAlias: null }))
    return searchDesignations(scopedRecords, query, scopedRecords.length)
  }, [query, scopedRecords])
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const visibleRecords = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selected = designationRecords.find((record) => record.entityNumber === selectedNumber) ?? visibleRecords[0] ?? null

  useEffect(() => { setPage(1) }, [program, entityType, country, query])
  useEffect(() => {
    if (selectedNumber != null && !matches.some((record) => record.entityNumber === selectedNumber)) setSelectedNumber(null)
  }, [matches, selectedNumber])

  const network = useMemo(() => buildDesignationNetwork(scopedRecords), [scopedRecords])
  const bridges = network.nodes.filter((node) => node.articulationPoint)
  const brokerChart = useMemo(
    () => network.nodes.filter((node) => node.betweenness > 0).slice(0, 10).map((node) => ({
      country: node.country.length > 18 ? `${node.country.slice(0, 17)}…` : node.country,
      fullName: node.country,
      betweenness: node.betweenness,
      articulationPoint: node.articulationPoint,
    })),
    [network],
  )
  const counts = useMemo(() => ({
    individual: designationRecords.filter((record) => record.entityType === 'individual').length,
    organization: designationRecords.filter((record) => record.entityType === 'organization').length,
    asset: designationRecords.filter((record) => record.entityType === 'vessel' || record.entityType === 'aircraft').length,
  }), [designationRecords])

  const clearFilters = () => {
    setProgram('all')
    setEntityType('all')
    setCountry('all')
    setQuery('')
  }

  return (
    <section className="entity-register" aria-labelledby="entity-register-title">
      <header className="entity-register__header">
        <div>
          <p>Named public actions · privacy-minimized · continuously refreshed</p>
          <h1 id="entity-register-title">Entity and action register</h1>
          <span>Search people, organizations and assets named in OFAC’s public narcotics and transnational-crime programs. Every row states what the authority did—never an inferred association.</span>
        </div>
        <div className="entity-register__boundary" role="note">
          <b>Legal-stage boundary</b>
          <strong>Designation ≠ charge ≠ conviction</strong>
          <p>A designation is a government action under a stated authority. It is not an adjudication of guilt, and records may later be removed.</p>
        </div>
      </header>

      <div className="entity-register__stats" aria-label="Designation coverage">
        <div><span>All public actions</span><strong><CountUp value={designationRecords.length} /></strong><small>OFAC entity records</small></div>
        <div><span>People</span><strong><CountUp value={counts.individual} /></strong><small>named individuals</small></div>
        <div><span>Organizations</span><strong><CountUp value={counts.organization} /></strong><small>named organizations</small></div>
        <div><span>Assets</span><strong><CountUp value={counts.asset} /></strong><small>vessels + aircraft</small></div>
      </div>

      <div className="entity-register__filters">
        <label><span>Name or published alias</span><input type="search" value={query} placeholder="Search exact name tokens…" onChange={(event) => setQuery(event.target.value)} /></label>
        <label>
          <span>Legal authority</span>
          <select value={program} onChange={(event: ChangeEvent<HTMLSelectElement>) => setProgram(event.target.value)}>
            <option value="all">All narcotics + TCO programs</option>
            {Object.entries(PROGRAM_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Record type</span>
          <select value={entityType} onChange={(event) => setEntityType(event.target.value as 'all' | DesignationEntityType)}>
            <option value="all">People, organizations + assets</option><option value="individual">People</option><option value="organization">Organizations</option><option value="vessel">Vessels</option><option value="aircraft">Aircraft</option>
          </select>
        </label>
        <label>
          <span>Country of record</span>
          <select value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">All published countries</option>{countries.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </label>
        <button type="button" onClick={clearFilters}>Clear filters</button>
      </div>

      <div className="entity-register__receipt">
        <span className="entity-register__receipt-dot" aria-hidden="true" />
        <strong>{matches.length.toLocaleString()} matching public actions</strong>
        <span>Retrieved {DESIGNATION_META.downloaded}</span><span>Country-level locations only</span><span>No identity documents or birth dates</span>
      </div>

      <div className="entity-register__workspace">
        <div className="entity-register__table-wrap">
          <table className="entity-register__table">
            <thead><tr><th>Named record</th><th>Type</th><th>Action + authority</th><th>Country record</th><th>Matched through</th></tr></thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.entityNumber} className={selected?.entityNumber === record.entityNumber ? 'is-selected' : ''}>
                  <td><button type="button" onClick={() => setSelectedNumber(record.entityNumber)}>{record.name}</button><small>OFAC #{record.entityNumber}</small></td>
                  <td><span className={`entity-register__type entity-register__type--${record.entityType}`}>{typeLabel(record.entityType)}</span></td>
                  <td><strong>Designation</strong><small>{record.programs.map((value) => PROGRAM_LABEL[value] ?? value).join(' · ')}</small></td>
                  <td>{record.countries.join(' · ') || <em>Not published</em>}</td>
                  <td>{record.matchedAlias ? <span>Alias: {record.matchedAlias}</span> : 'Primary name'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRecords.length === 0 && <div className="entity-register__empty"><h2>No matching action record</h2><p>Change or clear the filters. An empty result is not evidence that no action exists outside this source.</p></div>}
          {matches.length > PAGE_SIZE && (
            <nav className="entity-register__pagination" aria-label="Entity register pages">
              <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button>
            </nav>
          )}
        </div>

        <aside className="entity-register__dossier" aria-live="polite">
          {selected ? (
            <>
              <header><span>Published action record</span><h2>{selected.name}</h2><p>{typeLabel(selected.entityType)} · OFAC #{selected.entityNumber}</p></header>
              <div className="entity-register__stage"><span>Recorded legal stage</span><strong>OFAC designation</strong><small>Not a charge or conviction</small></div>
              <section><h3>What the source says</h3><p>{actionDescription(selected)}</p></section>
              <dl>
                <div><dt>Authorities</dt><dd>{selected.programs.map((value) => PROGRAM_LABEL[value] ?? value).join('; ')}</dd></div>
                <div><dt>Countries of record</dt><dd>{selected.countries.join('; ') || 'Not published in extracted fields'}</dd></div>
                <div><dt>Published aliases</dt><dd>{selected.aliases.join('; ') || 'None in source'}</dd></div>
                <div><dt>Retrieved</dt><dd>{DESIGNATION_META.downloaded}</dd></div>
              </dl>
              <div className="entity-register__excluded"><span>Privacy-minimized extraction</span><p>Street addresses, dates of birth, passport numbers and national identifiers are deliberately excluded.</p></div>
              <a href={DESIGNATION_META.url} target="_blank" rel="noreferrer">Verify against the live OFAC list ↗</a>
            </>
          ) : <p>Select a public action record.</p>}
        </aside>
      </div>

      <details className="entity-register__analysis">
        <summary><span>Jurisdiction structure</span><strong>Open the country-level designation graph</strong><small>{network.nodes.length} jurisdictions · {network.crossBorderEntities} cross-border records · no person-to-person edges</small></summary>
        <div className="entity-register__analysis-intro">Across {network.totalEntities.toLocaleString()} filtered entities, {network.crossBorderEntities} are recorded by OFAC in more than one country. Designations are {concentrationTier(network.concentrationHHI)} across {network.nodes.length} jurisdictions (HHI {network.concentrationHHI.toLocaleString()}); {bridges.length} are structural articulation points in this country graph.</div>
        {brokerChart.length > 1 && (
          <div className="chart-card">
            <h3>Country betweenness in the published designation graph</h3>
            <div className="bar-list">{brokerChart.map((node) => <div className="bar-row" key={node.country}><span className="bar-label" title={node.fullName}>{node.country}</span><span className="bar-track"><span className={`bar-fill ${node.articulationPoint ? 'bar-fill--hot' : ''}`} style={{ width: `${(node.betweenness / brokerChart[0].betweenness) * 100}%` }} /></span><span className="bar-value">{node.betweenness.toFixed(3)}{node.articulationPoint ? ' ⧉' : ''}</span></div>)}</div>
          </div>
        )}
        <div className="entity-register__analysis-tables">
          <div>
            <h3>Jurisdictions by structural position</h3>
            <DataTableViewport label="Jurisdictions by structural position">
              <table className="data-table"><thead><tr><th>Country</th><th>Actions</th><th>Cross-border</th><th>Links</th><th>Betweenness</th></tr></thead><tbody>{network.nodes.slice(0, 30).map((node) => <tr key={node.country}><td className={node.articulationPoint ? 'hot' : ''}>{node.country}</td><td>{node.designations}</td><td>{node.crossBorderDesignations}</td><td>{node.degree}</td><td>{node.betweenness.toFixed(4)}</td></tr>)}</tbody></table>
            </DataTableViewport>
          </div>
          <div>
            <h3>Strongest country pairs</h3>
            <DataTableViewport label="Strongest country pairs">
              <table className="data-table"><thead><tr><th>Country pair</th><th>Shared records</th><th>Authorities</th></tr></thead><tbody>{network.edges.slice(0, 20).map((edge) => <tr key={`${edge.from}|${edge.to}`}><td>{edge.from} — {edge.to}</td><td>{edge.weight}</td><td>{edge.programs.map((value) => PROGRAM_LABEL[value] ?? value).join(', ')}</td></tr>)}</tbody></table>
            </DataTableViewport>
          </div>
        </div>
        <p className="note"><strong>Graph boundary.</strong> A country pair appears only when Treasury records one designated entity in both. There are no entity-to-entity edges because the public SDN flat file does not publish them. Shared authority, country or nationality never becomes an inferred association.</p>
      </details>

      <footer className="entity-register__source">
        <div><span>Source</span><p><a href={DESIGNATION_META.url} target="_blank" rel="noreferrer">{DESIGNATION_META.source}</a></p></div>
        <div><span>Rights</span><p>{DESIGNATION_META.license}</p></div>
        <div><span>Claim boundary</span><p>{DESIGNATION_META.note}</p></div>
      </footer>
    </section>
  )
}
