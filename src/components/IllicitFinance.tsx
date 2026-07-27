import { useMemo } from 'react'
import { useData } from '../lib/dataStore'
import { BUNDLED_DESIGNATION_RECORDS, DESIGNATION_META, withBundled } from '../data/bundled'
import {
  facilitatorGroups, launderingNetworks, launderingHubs, TYPOLOGIES, FUNCTION_LABEL,
} from '../lib/illicitFinance'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'
import Reveal from '../motion/Reveal'

const PROGRAM_LABEL = DESIGNATION_META.programs as Record<string, string>

/**
 * Illicit Finance — the money-laundering infrastructure the drug trade runs on,
 * surfaced from OFAC designations. Every entity here is officially designated;
 * the laundering FLOWS (unobservable, hence modelled) are analysed separately.
 * Lazy tab — reads the bundled ~450 kB designation dataset.
 */
export default function IllicitFinance() {
  const { designationRecords: loaded } = useData()
  const records = withBundled(loaded, BUNDLED_DESIGNATION_RECORDS)

  const groups = useMemo(() => facilitatorGroups(records), [records])
  const networks = useMemo(() => launderingNetworks(records), [records])
  const hubs = useMemo(() => launderingHubs(records), [records])
  const maxHub = hubs.length ? hubs[0].count : 1
  const totalFacilitators = groups.reduce((s, g) => s + g.count, 0)
  const topHub = hubs[0]?.country ?? '—'

  return (
    <section>
      <div className="stat-band">
        <div className="stat">
          <span className="stat-value"><CountUp value={networks.length} group={false} /></span>
          <span className="stat-label">Named cross-border networks</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={totalFacilitators} /></span>
          <span className="stat-label">Designated financial facilitators</span>
        </div>
        <div className="stat">
          <span className="stat-value">{networks[0]?.reach ?? '—'}</span>
          <span className="stat-label">Widest reach: {networks[0]?.name.split(' ').slice(0, 2).join(' ') ?? ''}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{topHub}</span>
          <span className="stat-label">Top laundering hub</span>
        </div>
      </div>

      <Explainer
        text={
          `Drug proceeds move through a financial plumbing of hawala networks, exchange houses, ` +
          `trade-based front companies and casinos — and much of it is designated by name. ` +
          `The same OFAC authorities that name drug traffickers also name the money-laundering ` +
          `organisations (Khanani, Barakat), the exchange houses that move value outside banks, ` +
          `and even wildlife-trafficking networks — one criminal infrastructure, not four separate ones. ` +
          `Everything below is an official designation; nothing is alleged here.`
        }
      />

      {/* The named cross-border networks — the convergence, front and centre. */}
      <Reveal>
        <h3>Cross-border criminal networks — by jurisdictional reach</h3>
        <p className="note">
          Networks OFAC designated across multiple countries: the money-laundering organisations and
          transnational-crime groups that stitch trafficking, laundering and — for entities like the
          designated Teo Boon Ching network — <strong>wildlife trafficking</strong> into one operation.
        </p>
        <table className="data-table">
          <thead><tr><th>Network</th><th>Reach</th><th>Countries</th><th>Authority</th></tr></thead>
          <tbody>
            {networks.slice(0, 14).map((n) => (
              <tr key={n.name}>
                <td>{n.name}</td>
                <td>{n.reach}</td>
                <td>{n.countries.join(', ')}</td>
                <td>{n.programs.map((p) => PROGRAM_LABEL[p] ?? p).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>

      {/* Laundering hubs. */}
      <Reveal delay={80}>
        <div className="panel">
          <h4>Laundering hubs — jurisdictions by designated financial facilitators</h4>
          <div className="bar-list">
            {hubs.map((h) => (
              <div className="bar-row" key={h.country}>
                <span className="bar-label" title={h.country}>{h.country}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(h.count / maxHub) * 100}%` }} />
                </span>
                <span className="bar-value">{h.count}</span>
              </div>
            ))}
          </div>
          <p className="panel-note">
            The Gulf (UAE) is the hawala / exchange hub; Mexico and Colombia the cartel-finance core;
            Lebanon the Hezbollah-linked Barakat node; Panama the shell-company layer.
          </p>
        </div>
      </Reveal>

      {/* Facilitators by function. */}
      <Reveal delay={160}>
        <h3>The financial plumbing, by function</h3>
        <div className="panel-grid">
          {groups.map((g) => (
            <div className="panel" key={g.fn}>
              <h4>{g.label} — {g.count}</h4>
              <p className="panel-note" style={{ marginTop: 0 }}>{g.description}</p>
              <ul className="facilitator-list">
                {g.examples.map((e) => (
                  <li key={e.name}>
                    <strong>{e.name}</strong>
                    <span className="facilitator-meta"> · {e.countries.join(', ') || 'n/a'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Typologies reference — how the money moves. */}
      <Reveal delay={240}>
        <h3>How the money moves — laundering typologies</h3>
        <p className="note">
          The flows themselves are invisible by design — that opacity is what makes laundering work,
          and why no honest tool can chart the money directly. These are the documented <em>methods</em>,
          each anchored to the kind of entity OFAC has designated for it.
        </p>
        <div className="panel-grid">
          {TYPOLOGIES.map((t) => (
            <div className="panel typology-card" key={t.id}>
              <h4>{t.name}</h4>
              <div className="typology-region">{t.region}</div>
              <p className="typology-how">{t.how}</p>
              <div className="typology-src">Source: {t.source}</div>
            </div>
          ))}
        </div>
      </Reveal>

      <p className="note">
        Source: <a href={DESIGNATION_META.url} target="_blank" rel="noreferrer">{DESIGNATION_META.source}</a>,
        classified by function from entity names. {DESIGNATION_META.note} A designation is a published
        government action, not an adjudication of guilt. The laundering <em>flows</em> between these
        entities are not observable and are therefore modelled as scenarios in a separate analysis,
        never charted here as if measured.
      </p>
    </section>
  )
}
