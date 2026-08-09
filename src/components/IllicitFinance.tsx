import { useMemo } from 'react'
import { useData } from '../lib/dataStore'
import { BUNDLED_DESIGNATION_RECORDS, DESIGNATION_META, withBundled } from '../data/bundled'
import {
  crossJurisdictionDesignations,
  designationJurisdictionCoverage,
  designationProgramCoverage,
  explicitLaunderingDesignations,
  TYPOLOGIES,
} from '../lib/illicitFinance'
import Explainer from './Explainer'
import CountUp from '../motion/CountUp'
import Reveal from '../motion/Reveal'

const PROGRAM_LABEL = DESIGNATION_META.programs as Record<string, string>

/**
 * Official designation context plus a separate typology reference. The OFAC
 * extract has no allegation narrative, so generic entity-name words are never
 * converted into financial-facilitator or laundering labels.
 */
export default function IllicitFinance() {
  const { designationRecords: loaded } = useData()
  const records = withBundled(loaded, BUNDLED_DESIGNATION_RECORDS)

  const explicit = useMemo(() => explicitLaunderingDesignations(records), [records])
  const crossJurisdiction = useMemo(() => crossJurisdictionDesignations(records), [records])
  const jurisdictions = useMemo(() => designationJurisdictionCoverage(records), [records])
  const programs = useMemo(() => designationProgramCoverage(records), [records])
  const maxJurisdiction = jurisdictions[0]?.count ?? 1
  const topJurisdiction = jurisdictions[0]?.country ?? 'n/a'

  return (
    <section>
      <div className="stat-band">
        <div className="stat">
          <span className="stat-value"><CountUp value={records.length} /></span>
          <span className="stat-label">Scoped OFAC designation records</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={explicit.length} group={false} /></span>
          <span className="stat-label">Official names that say money laundering</span>
        </div>
        <div className="stat">
          <span className="stat-value"><CountUp value={crossJurisdiction.length} /></span>
          <span className="stat-label">Records with multiple countries</span>
        </div>
        <div className="stat">
          <span className="stat-value">{topJurisdiction}</span>
          <span className="stat-label">Most country-of-record mentions</span>
        </div>
      </div>

      <Explainer
        text={
          `This extract can verify whom OFAC designated, the legal program code and the ` +
          `countries carried in OFAC address records. It cannot establish an entity's conduct ` +
          `or financial function because allegation narratives and transaction evidence are not ` +
          `part of the dataset. Words such as trading, exchange, casino, group and cartel are ` +
          `therefore never used to infer laundering or financial-facilitator status.`
        }
      />

      <Reveal>
        <h3>Official names that explicitly include "money laundering"</h3>
        <p className="note">
          This narrow list is based only on the literal OFAC-published name or alias. Inclusion states
          what the official name says and that Treasury published a designation. It is not an
          adjudication of guilt and does not classify similarly named businesses.
        </p>
        <table className="data-table">
          <thead><tr><th>Official name</th><th>Matched field</th><th>Countries of record</th><th>Authority</th></tr></thead>
          <tbody>
            {explicit.map((record) => (
              <tr key={record.name}>
                <td>{record.name}</td>
                <td>{record.matchedField === 'official_name' ? 'Name' : 'Alias'}</td>
                <td>{record.countries.join(', ') || 'n/a'}</td>
                <td>{record.programs.map((program) => PROGRAM_LABEL[program] ?? program).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>

      <Reveal delay={80}>
        <h3>Multi-country designation records by recorded reach</h3>
        <p className="note">
          Countries come from OFAC address records. Multiple countries do not establish a money flow,
          an entity-to-entity relationship or a laundering network.
        </p>
        <table className="data-table">
          <thead><tr><th>Official name</th><th>Country count</th><th>Countries of record</th><th>Authority</th></tr></thead>
          <tbody>
            {crossJurisdiction.slice(0, 14).map((record) => (
              <tr key={record.name}>
                <td>{record.name}</td>
                <td>{record.reach}</td>
                <td>{record.countries.join(', ')}</td>
                <td>{record.programs.map((program) => PROGRAM_LABEL[program] ?? program).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>

      <Reveal delay={160}>
        <h3>Official program coverage</h3>
        <div className="panel-grid">
          {programs.map((program) => (
            <div className="panel" key={program.program}>
              <h4>{PROGRAM_LABEL[program.program] ?? program.program}</h4>
              <p className="panel-note" style={{ marginTop: 0 }}>
                {program.count.toLocaleString()} records under program code {program.program}.
              </p>
            </div>
          ))}
        </div>
        <p className="note">
          Program counts are not mutually exclusive because one record may carry more than one legal authority.
        </p>
      </Reveal>

      <Reveal delay={240}>
        <div className="panel">
          <h4>Countries of record represented in the scoped designations</h4>
          <div className="bar-list">
            {jurisdictions.map((item) => (
              <div className="bar-row" key={item.country}>
                <span className="bar-label" title={item.country}>{item.country}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(item.count / maxJurisdiction) * 100}%` }} />
                </span>
                <span className="bar-value">{item.count}</span>
              </div>
            ))}
          </div>
          <p className="panel-note">
            This is address-record coverage, not nationality, market size or a ranking of laundering hubs.
          </p>
        </div>
      </Reveal>

      <Reveal delay={320}>
        <h3>Reference typologies, separate from entity facts</h3>
        <p className="note">
          These documented methods provide research context. They are not derived from the designation
          extract and do not imply that any displayed entity used a listed method.
        </p>
        <div className="panel-grid">
          {TYPOLOGIES.map((typology) => (
            <div className="panel typology-card" key={typology.id}>
              <h4>{typology.name}</h4>
              <div className="typology-region">{typology.region}</div>
              <p className="typology-how">{typology.how}</p>
              <div className="typology-src">Source: {typology.source}</div>
            </div>
          ))}
        </div>
      </Reveal>

      <p className="note">
        Source: <a href={DESIGNATION_META.url} target="_blank" rel="noreferrer">{DESIGNATION_META.source}</a>.
        {' '}{DESIGNATION_META.note} Generic entity-name words are not used as evidence of conduct or
        financial function.
      </p>
    </section>
  )
}
