import { useMemo, useState, type ChangeEvent } from 'react'
import { useData } from '../lib/dataStore'
import { BUNDLED_DESIGNATION_RECORDS, DESIGNATION_META, withBundled } from '../data/bundled'
import { buildDesignationNetwork, searchDesignations } from '../lib/designationNetwork'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'

const PROGRAM_LABEL = DESIGNATION_META.programs as Record<string, string>

/** DOJ/FTC concentration bands, the same scale intelligence.ts uses for corridors. */
function concentrationTier(hhi: number): string {
  if (hhi > 2500) return 'highly concentrated'
  if (hhi >= 1500) return 'moderately concentrated'
  return 'dispersed'
}

export default function Designations() {
  const { designationRecords: loadedDesignations } = useData()
  const designationRecords = withBundled(loadedDesignations, BUNDLED_DESIGNATION_RECORDS)
  const [program, setProgram] = useState('all')
  const [query, setQuery] = useState('')

  const network = useMemo(
    () => buildDesignationNetwork(designationRecords, program === 'all' ? {} : { program }),
    [designationRecords, program],
  )

  const matches = useMemo(
    () => searchDesignations(designationRecords, query),
    [designationRecords, query],
  )

  const bridges = network.nodes.filter((n) => n.articulationPoint)

  // Top jurisdictions by betweenness — the brokers of the designated network.
  // Charted rather than only tabled because the striking finding (a country
  // with few designations but high betweenness is a structural broker) is a
  // relationship between two columns, which a bar makes visible at a glance.
  const brokerChart = useMemo(
    () => network.nodes
      .filter((n) => n.betweenness > 0)
      .slice(0, 10)
      .map((n) => ({
        country: n.country.length > 18 ? `${n.country.slice(0, 17)}…` : n.country,
        fullName: n.country,
        betweenness: n.betweenness,
        articulationPoint: n.articulationPoint,
      })),
    [network],
  )

  return (
    <section>
      <div className="controls">
        <label>
          Sanctions programme&nbsp;
          <select value={program} onChange={(e: ChangeEvent<HTMLSelectElement>) => setProgram(e.target.value)}>
            <option value="all">All narcotics &amp; TCO programmes</option>
            {Object.entries(PROGRAM_LABEL).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Search name or alias&nbsp;
          <input
            type="search"
            value={query}
            placeholder="e.g. Kings Romans, Chao Wei"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="stat-band">
        <div className="stat">
          <span className="stat-value"><CountUp value={network.totalEntities} /></span>
          <span className="stat-label">Designated entities</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={network.crossBorderEntities} /></span>
          <span className="stat-label">Recorded in 2+ countries</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={network.nodes.length} group={false} /></span>
          <span className="stat-label">Jurisdictions</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={network.concentrationHHI} /></span>
          <span className="stat-label">Concentration (HHI)</span>
        </div>
      </div>

      <Explainer
        text={
          `Across ${network.totalEntities.toLocaleString()} entities designated under these authorities, ` +
          `${network.crossBorderEntities} are recorded by OFAC in more than one country — those are the ` +
          `only entities that create a link between jurisdictions here. Designations are ` +
          `${concentrationTier(network.concentrationHHI)} across ${network.nodes.length} countries ` +
          `(HHI ${network.concentrationHHI.toLocaleString()}), and ${bridges.length} jurisdiction` +
          `${bridges.length === 1 ? '' : 's'} sit at structural bridge points in the graph.`
        }
      />

      {query.trim().length >= 2 ? (
        <>
          <h3>Search results — {matches.length} match{matches.length === 1 ? '' : 'es'}</h3>
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Programme(s)</th><th>Countries</th><th>Matched via</th></tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.entityNumber}>
                  <td>{m.name}</td>
                  <td>{m.entityType}</td>
                  <td>{m.programs.map((p) => PROGRAM_LABEL[p] ?? p).join(', ')}</td>
                  <td>{m.countries.join(', ') || '—'}</td>
                  <td>{m.matchedAlias ? <em>alias: {m.matchedAlias}</em> : 'primary name'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {matches.length === 0 ? (
            <p className="note">No designated entity matches that name or any OFAC-published alias.</p>
          ) : null}
        </>
      ) : null}

      {brokerChart.length > 1 ? (
        <div className="chart-card">
          <h3>Broker jurisdictions — betweenness centrality</h3>
          {/* Pure-CSS bars: a horizontal ranking needs no charting library, and
              avoids recharts v3's vertical-BarChart quirks. Widths are relative
              to the top bar so the shape is read as a ranking, not an axis. */}
          <div className="bar-list">
            {brokerChart.map((n) => (
              <div className="bar-row" key={n.country}>
                <span className="bar-label" title={n.fullName}>{n.country}</span>
                <span className="bar-track">
                  <span
                    className={`bar-fill ${n.articulationPoint ? 'bar-fill--hot' : ''}`}
                    style={{ width: `${(n.betweenness / brokerChart[0].betweenness) * 100}%` }}
                  />
                </span>
                <span className="bar-value">{n.betweenness.toFixed(3)}{n.articulationPoint ? ' ⧉' : ''}</span>
              </div>
            ))}
          </div>
          <p className="note">
            Betweenness = how often a jurisdiction sits on the shortest path between two others in
            the designation graph. A high bar on few designations is a <strong>broker</strong>:
            structurally central out of proportion to its own designation count. Coral bars marked
            ⧉ are <strong>articulation points</strong> — removing them splits the graph.
          </p>
        </div>
      ) : null}

      <h3>Jurisdictions by structural position</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Country</th>
            <th>Designations</th>
            <th>Cross-border</th>
            <th>Linked jurisdictions</th>
            <th>Betweenness</th>
            <th>Bridge</th>
          </tr>
        </thead>
        <tbody>
          {network.nodes.slice(0, 30).map((n) => (
            <tr key={n.country}>
              <td className={n.articulationPoint ? 'hot' : ''}>{n.country}</td>
              <td>{n.designations.toLocaleString()}</td>
              <td>{n.crossBorderDesignations}</td>
              <td>{n.degree}</td>
              <td>{n.betweenness.toFixed(4)}</td>
              <td>{n.articulationPoint ? 'yes' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Strongest jurisdiction links</h3>
      <table className="data-table">
        <thead>
          <tr><th>Jurisdiction pair</th><th>Shared designations</th><th>Programme(s)</th></tr>
        </thead>
        <tbody>
          {network.edges.slice(0, 20).map((e) => (
            <tr key={`${e.from}|${e.to}`}>
              <td>{e.from} — {e.to}</td>
              <td>{e.weight}</td>
              <td>{e.programs.map((p) => PROGRAM_LABEL[p] ?? p).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        <strong>What the graph is.</strong> Nodes are countries; an edge exists when OFAC records a
        single designated entity in both. Every edge is therefore something Treasury published.
        There are deliberately <em>no</em> entity-to-entity edges: the public SDN file contains no
        relationships between designated parties, so any such link would be invented by this tool,
        and network metrics computed over invented edges measure only the join condition
        (arXiv:2501.01508). Betweenness identifies jurisdictions that sit on paths between others;
        &ldquo;bridge&rdquo; marks articulation points, whose removal would fragment the graph.
      </p>

      <p className="note">
        <strong>What a designation is and is not.</strong> {DESIGNATION_META.note} Source:{' '}
        <a href={DESIGNATION_META.url} target="_blank" rel="noreferrer">{DESIGNATION_META.source}</a>,
        retrieved {DESIGNATION_META.downloaded}. {DESIGNATION_META.license}. Always check the live
        SDN list before relying on any row — OFAC adds and removes entities continuously.
      </p>
    </section>
  )
}
