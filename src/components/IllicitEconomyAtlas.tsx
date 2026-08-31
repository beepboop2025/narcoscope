import { useMemo, useState, type KeyboardEvent } from 'react'
import { geoEqualEarth } from 'd3-geo'
import topology from '../data/countries-ind.json'
import organizedCrimeData from '../data/organizedCrime.json'
import firearmsTracingData from '../data/firearmsTracing.json'
import { countriesFromTopology, graticulePath, pathForGeometry } from '../lib/mapSvg'

type NumericLeaf = number | null

type OrganizedCrimeRecord = {
  iso3: string
  country: string
  continent: string
  region: string
  year: number
  criminality: NumericLeaf
  criminalMarkets: NumericLeaf
  markets: Record<string, NumericLeaf>
  actors: Record<string, NumericLeaf>
  resilience: Record<string, NumericLeaf>
}

type OrganizedCrimeDataset = {
  meta: {
    source: string
    url: string
    downloadedAt: string
    years: number[]
    scale: { minimum: number; maximum: number; direction: string }
    caveats: string[]
    rights?: string
  }
  records: OrganizedCrimeRecord[]
}

type FirearmsTracingRecord = {
  iso3: string
  country: string
  year: number
  valuePercent: NumericLeaf
  nature: string | null
  source: string | null
  reportingType: string | null
  footnotes: string[]
}

type FirearmsTracingDataset = {
  meta: {
    source: string
    url: string
    series: string
    release: string
    downloadedAt: string
    unit: string
    caveats: string[]
    rights?: string
  }
  records: FirearmsTracingRecord[]
}

type MeasureGroup = 'drugs' | 'arms' | 'environment' | 'economy' | 'response' | 'actors'
type EvidenceClass = 'expert-assessment' | 'official-statistic'
type MeasurePalette = 'adverse' | 'capacity'

type Measure = {
  id: string
  group: MeasureGroup
  label: string
  shortLabel: string
  description: string
  evidenceClass: EvidenceClass
  unit: 'score' | 'percent'
  palette?: MeasurePalette
  accessor?: (record: OrganizedCrimeRecord) => NumericLeaf
}

const organizedCrime = organizedCrimeData as OrganizedCrimeDataset
const firearmsTracing = firearmsTracingData as FirearmsTracingDataset
const countries = countriesFromTopology(topology)
const MAP_WIDTH = 980
const MAP_HEIGHT = 520

const GROUPS: ReadonlyArray<{ id: MeasureGroup; label: string; eyebrow: string }> = [
  { id: 'drugs', label: 'Drug markets', eyebrow: 'Market scope' },
  { id: 'arms', label: 'Arms', eyebrow: 'Market + response' },
  { id: 'environment', label: 'Wildlife + materials', eyebrow: 'Adjacent markets' },
  { id: 'economy', label: 'Shadow economy', eyebrow: 'Market scope' },
  { id: 'actors', label: 'Actor environment', eyebrow: 'Expert assessment' },
  { id: 'response', label: 'Resilience', eyebrow: 'Institutional response' },
]

const MEASURES: readonly Measure[] = [
  { id: 'synthetic-drugs', group: 'drugs', label: 'Synthetic drug trade', shortLabel: 'Synthetic drugs', description: 'Expert-assessed reach and influence of the synthetic-drug market.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.syntheticDrugTrade },
  { id: 'heroin', group: 'drugs', label: 'Heroin trade', shortLabel: 'Heroin', description: 'Expert-assessed reach and influence of the heroin market.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.heroinTrade },
  { id: 'cocaine', group: 'drugs', label: 'Cocaine trade', shortLabel: 'Cocaine', description: 'Expert-assessed reach and influence of the cocaine market.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.cocaineTrade },
  { id: 'cannabis', group: 'drugs', label: 'Cannabis trade', shortLabel: 'Cannabis', description: 'Expert-assessed reach and influence of the cannabis market.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.cannabisTrade },
  { id: 'arms-market', group: 'arms', label: 'Arms trafficking market', shortLabel: 'Arms market', description: 'Expert-assessed reach and influence of arms trafficking. This is not a flow-volume estimate.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.armsTrafficking },
  { id: 'arms-tracing', group: 'arms', label: 'Firearms successfully traced', shortLabel: 'Tracing response', description: 'Official SDG indicator 16.4.2: the share of seized, found or surrendered arms whose illicit origin or context was traced.', evidenceClass: 'official-statistic', unit: 'percent', palette: 'capacity' },
  { id: 'fauna', group: 'environment', label: 'Fauna crimes', shortLabel: 'Fauna', description: 'Expert-assessed reach and influence of crimes involving protected or regulated fauna.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.faunaCrimes },
  { id: 'flora', group: 'environment', label: 'Flora crimes', shortLabel: 'Flora', description: 'Expert-assessed reach and influence of crimes involving protected or regulated flora.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.floraCrimes },
  { id: 'raw-materials', group: 'environment', label: 'Non-renewable resource crimes', shortLabel: 'Raw materials', description: 'Expert-assessed reach and influence of illicit markets involving non-renewable resources.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.nonRenewableResourceCrimes },
  { id: 'financial-crimes', group: 'economy', label: 'Financial crimes', shortLabel: 'Financial crime', description: 'Expert-assessed reach and influence of financial-crime markets.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.financialCrimes },
  { id: 'illicit-goods', group: 'economy', label: 'Illicit excisable goods', shortLabel: 'Excisable goods', description: 'Expert-assessed reach and influence of illicit trade in excisable goods.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.illicitTradeExcisableGoods },
  { id: 'counterfeit', group: 'economy', label: 'Counterfeit goods', shortLabel: 'Counterfeits', description: 'Expert-assessed reach and influence of counterfeit-goods markets.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.counterfeitGoods },
  { id: 'human-trafficking', group: 'economy', label: 'Human trafficking', shortLabel: 'Human trafficking', description: 'Expert-assessed reach and influence of human-trafficking markets.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.humanTrafficking },
  { id: 'human-smuggling', group: 'economy', label: 'Human smuggling', shortLabel: 'Human smuggling', description: 'Expert-assessed reach and influence of human-smuggling markets.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.markets.humanSmuggling },
  { id: 'state-embedded', group: 'actors', label: 'State-embedded actors', shortLabel: 'State-embedded', description: 'Expert assessment of the influence of state-embedded criminal actors; it does not identify any individual or prove state direction.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.actors.stateEmbeddedActors },
  { id: 'criminal-networks', group: 'actors', label: 'Criminal networks', shortLabel: 'Networks', description: 'Expert assessment of the influence of criminal networks at country level.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.actors.criminalNetworks },
  { id: 'foreign-actors', group: 'actors', label: 'Foreign actors', shortLabel: 'Foreign actors', description: 'Expert assessment of the influence of foreign criminal actors; nationality alone is never an attribution.', evidenceClass: 'expert-assessment', unit: 'score', accessor: (r) => r.actors.foreignActors },
  { id: 'resilience', group: 'response', label: 'Overall resilience', shortLabel: 'Resilience', description: 'Expert assessment of national capacity to withstand and disrupt organized crime.', evidenceClass: 'expert-assessment', unit: 'score', palette: 'capacity', accessor: (r) => r.resilience.average },
  { id: 'aml', group: 'response', label: 'Anti-money laundering', shortLabel: 'AML capacity', description: 'Expert assessment of anti-money-laundering frameworks and effectiveness.', evidenceClass: 'expert-assessment', unit: 'score', palette: 'capacity', accessor: (r) => r.resilience.antiMoneyLaundering },
  { id: 'economic-capacity', group: 'response', label: 'Economic regulatory capacity', shortLabel: 'Economic capacity', description: 'Expert assessment of economic regulation relevant to organized-crime resilience.', evidenceClass: 'expert-assessment', unit: 'score', palette: 'capacity', accessor: (r) => r.resilience.economicRegulatoryCapacity },
]

function formattedDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC'
}

function featureIso3(feature: (typeof countries)[number]): string {
  const properties = feature.properties as Record<string, unknown> | null
  return String(properties?.ADM0_A3 ?? feature.id ?? '')
}

function colorFor(value: NumericLeaf, measure: Measure): string {
  if (value == null || !Number.isFinite(value)) return '#d5ded9'
  const normalized = Math.max(0, Math.min(1, value / (measure.unit === 'percent' ? 100 : 10)))
  const stops = measure.palette === 'capacity'
    ? ['#edd8ce', '#deb69f', '#c78d72', '#7caa9e', '#438a7a', '#155e57']
    : ['#d7e5df', '#a9c9bc', '#6da694', '#2f7c70', '#b78045', '#a04d36']
  return stops[Math.round(normalized * (stops.length - 1))]
}

function legendLabels(measure: Measure): [string, string] {
  if (measure.unit === 'percent') return ['0% lower traced share', '100% higher traced share']
  if (measure.palette === 'capacity') return ['1 lower capacity', '10 higher capacity']
  return ['1 lower influence', '10 higher influence']
}

function valueLabel(value: NumericLeaf, measure: Measure): string {
  if (value == null) return 'Unavailable'
  return measure.unit === 'percent' ? `${value.toFixed(1)}%` : `${value.toFixed(2)} / 10`
}

function nearestFirearmsRecord(iso3: string, requestedYear: number): FirearmsTracingRecord | undefined {
  return firearmsTracing.records
    .filter((record) => record.iso3 === iso3 && record.year <= requestedYear)
    .sort((a, b) => b.year - a.year)[0]
}

function currentValue(record: OrganizedCrimeRecord | undefined, measure: Measure): NumericLeaf {
  if (!record) return null
  if (measure.id === 'arms-tracing') return nearestFirearmsRecord(record.iso3, record.year)?.valuePercent ?? null
  return measure.accessor?.(record) ?? null
}

export default function IllicitEconomyAtlas() {
  const [group, setGroup] = useState<MeasureGroup>('drugs')
  const [measureId, setMeasureId] = useState('synthetic-drugs')
  const [year, setYear] = useState(Math.max(...organizedCrime.meta.years))
  const [selectedIso3, setSelectedIso3] = useState('MMR')
  const [query, setQuery] = useState('')

  const projection = useMemo(
    () => geoEqualEarth().fitExtent([[14, 16], [MAP_WIDTH - 14, MAP_HEIGHT - 16]], { type: 'Sphere' }),
    [],
  )
  const graticule = useMemo(() => graticulePath(projection), [projection])
  const measure = MEASURES.find((candidate) => candidate.id === measureId) ?? MEASURES[0]
  const legend = legendLabels(measure)
  const isOfficialStatistic = measure.evidenceClass === 'official-statistic'
  const visibleMeasures = MEASURES.filter((candidate) => candidate.group === group)

  const yearRecords = useMemo(
    () => organizedCrime.records.filter((record) => record.year === year),
    [year],
  )
  const byIso3 = useMemo(() => new Map(yearRecords.map((record) => [record.iso3, record])), [yearRecords])
  const selected = byIso3.get(selectedIso3)
  const selectedFirearms = selected ? nearestFirearmsRecord(selected.iso3, year) : undefined

  const ranked = useMemo(
    () => yearRecords
      .map((record) => ({ record, value: currentValue(record, measure) }))
      .filter((item): item is { record: OrganizedCrimeRecord; value: number } => item.value != null)
      .sort((a, b) => b.value - a.value),
    [measure, yearRecords],
  )
  const selectedRank = ranked.findIndex((item) => item.record.iso3 === selectedIso3)

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return []
    return yearRecords
      .filter((record) => `${record.country} ${record.iso3} ${record.region}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 8)
  }, [query, yearRecords])

  const selectMeasure = (next: Measure) => {
    setGroup(next.group)
    setMeasureId(next.id)
  }

  const selectCountryFromKey = (event: KeyboardEvent<SVGPathElement>, iso3: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setSelectedIso3(iso3)
  }

  return (
    <section className="atlas" aria-labelledby="atlas-title">
      <header className="atlas__brief">
        <div>
          <p className="atlas__eyebrow">Global illicit-economy atlas · 193 jurisdictions</p>
          <h1 id="atlas-title">Read one measure. Keep every boundary.</h1>
          <p>
            Compare drug, arms, wildlife, raw-material and shadow-economy evidence without
            collapsing unlike sources into a single risk score. Select a country for its
            source record, institutional context and explicit missing fields.
          </p>
        </div>
        <dl className="atlas__brief-stats" aria-label="Atlas coverage">
          <div><dt>Country records</dt><dd>{yearRecords.length}</dd></div>
          <div><dt>Measures</dt><dd>{MEASURES.length}</dd></div>
          <div><dt>Current release</dt><dd>{year}</dd></div>
        </dl>
      </header>

      <div className="atlas__freshness" aria-label="Data freshness and classification">
        <span className="atlas__pulse" aria-hidden="true" />
        <strong>Release-aware monitoring</strong>
        <span>Organized Crime Index retrieved {formattedDate(organizedCrime.meta.downloadedAt)}</span>
        <span>UN SDG release {firearmsTracing.meta.release}</span>
        <span className="atlas__freshness-boundary">News leads never overwrite source records</span>
      </div>

      <div className="atlas__workbench">
        <aside className="atlas__domains" aria-label="Evidence domains">
          <p className="atlas__rail-title">Evidence domains</p>
          {GROUPS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={group === candidate.id ? 'is-active' : ''}
              onClick={() => {
                setGroup(candidate.id)
                setMeasureId(MEASURES.find((item) => item.group === candidate.id)?.id ?? measureId)
              }}
            >
              <span>{candidate.eyebrow}</span>
              {candidate.label}
            </button>
          ))}
          <div className="atlas__rail-note">
            <span>Legal boundary</span>
            Country scores describe published conditions. They do not establish individual guilt, state direction or a navigable trafficking route.
          </div>
        </aside>

        <div className="atlas__map-column">
          <div className="atlas__controls">
            <div className="atlas__measure-tabs" role="tablist" aria-label={`${GROUPS.find((item) => item.id === group)?.label} measures`}>
              {visibleMeasures.map((candidate) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={measure.id === candidate.id}
                  className={measure.id === candidate.id ? 'is-active' : ''}
                  key={candidate.id}
                  onClick={() => selectMeasure(candidate)}
                >
                  {candidate.shortLabel}
                </button>
              ))}
            </div>
            <label className="atlas__year">
              <span>Release year</span>
              <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {[...organizedCrime.meta.years].sort((a, b) => b - a).map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
          </div>

          <div className="atlas__measure-note">
            <span className={`atlas__evidence-class atlas__evidence-class--${measure.evidenceClass}`}>
              {isOfficialStatistic ? 'Official statistic' : 'Expert assessment'}
            </span>
            <div><strong>{measure.label}</strong><p>{measure.description}</p></div>
          </div>

          <div className="atlas__map-wrap">
            <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-labelledby="atlas-map-title atlas-map-desc">
              <title id="atlas-map-title">{measure.label}, {year}</title>
              <desc id="atlas-map-desc">Interactive country map. Use tab then enter to open a country dossier. Missing data is shown in grey.</desc>
              <path className="atlas__graticule" d={graticule} />
              {countries.map((country, index) => {
                const iso3 = featureIso3(country)
                const record = byIso3.get(iso3)
                const value = currentValue(record, measure)
                const isSelected = iso3 === selectedIso3
                const name = record?.country ?? String((country.properties as Record<string, unknown> | null)?.name ?? iso3)
                return (
                  <path
                    key={country.id ?? index}
                    d={pathForGeometry(projection, country.geometry)}
                    fill={colorFor(value, measure)}
                    className={`atlas__country ${isSelected ? 'is-selected' : ''}`}
                    role={record ? 'button' : undefined}
                    tabIndex={record ? 0 : undefined}
                    aria-label={record ? `${name}: ${valueLabel(value, measure)}` : `${name}: unavailable`}
                    onClick={record ? () => setSelectedIso3(iso3) : undefined}
                    onKeyDown={record ? (event) => selectCountryFromKey(event, iso3) : undefined}
                  >
                    <title>{name}: {valueLabel(value, measure)}</title>
                  </path>
                )
              })}
            </svg>
            <div className={`atlas__legend atlas__legend--${measure.palette ?? 'adverse'}`} aria-label={`${measure.label} legend`}>
              <span>{legend[0]}</span>
              <div aria-hidden="true" />
              <span>{legend[1]}</span>
              <span className="atlas__legend-missing"><i /> unavailable</span>
            </div>
          </div>

          <div className="atlas__provenance-aperture" aria-label="Provenance aperture">
            <p>Provenance aperture</p>
            <div><span className="is-open">Observed</span><small>{isOfficialStatistic ? 'reported percentage' : 'published score'}</small></div>
            <div><span className={isOfficialStatistic ? 'is-open' : ''}>Official statistic</span><small>{isOfficialStatistic ? 'UN SDG record' : 'not measured here'}</small></div>
            <div><span className={measure.evidenceClass === 'expert-assessment' ? 'is-open' : ''}>Assessment</span><small>{measure.evidenceClass === 'expert-assessment' ? 'index methodology' : 'not inferred'}</small></div>
            <div><span>Context</span><small>Seiche + Palimpsest, separate</small></div>
            <div><span>Unavailable</span><small>shown, never zero-filled</small></div>
          </div>
        </div>

        <aside className="atlas__dossier" aria-live="polite">
          <div className="atlas__country-search">
            <label htmlFor="atlas-country-search">Find a jurisdiction</label>
            <input
              id="atlas-country-search"
              type="search"
              value={query}
              placeholder="Country, ISO3, region…"
              onChange={(event) => setQuery(event.target.value)}
            />
            {matches.length > 0 && (
              <div className="atlas__search-results">
                {matches.map((record) => (
                  <button key={record.iso3} type="button" onClick={() => { setSelectedIso3(record.iso3); setQuery('') }}>
                    <span>{record.country}</span><small>{record.iso3} · {record.region}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected ? (
            <>
              <header className="atlas__dossier-header">
                <span>{selected.iso3} · {selected.region}</span>
                <h2>{selected.country}</h2>
                <div className="atlas__selected-value">
                  <strong>{valueLabel(currentValue(selected, measure), measure)}</strong>
                  <span>{measure.shortLabel}<br />{selectedRank >= 0 ? `rank ${selectedRank + 1} of ${ranked.length} reporting` : 'not ranked'}</span>
                </div>
              </header>

              <section className="atlas__record" aria-labelledby="atlas-record-title">
                <div><span id="atlas-record-title">Source record</span><i className="atlas__record-status">published</i></div>
                <dl>
                  <div><dt>Evidence class</dt><dd>{measure.evidenceClass.replace('-', ' ')}</dd></div>
                  <div><dt>Observation year</dt><dd>{measure.id === 'arms-tracing' ? selectedFirearms?.year ?? 'unavailable' : selected.year}</dd></div>
                  <div><dt>Retrieved</dt><dd>{formattedDate(measure.id === 'arms-tracing' ? firearmsTracing.meta.downloadedAt : organizedCrime.meta.downloadedAt)}</dd></div>
                  <div><dt>Missing means</dt><dd>Unavailable, never zero</dd></div>
                </dl>
              </section>

              <section className="atlas__cross-section" aria-labelledby="atlas-cross-section-title">
                <h3 id="atlas-cross-section-title">Adjacent evidence, not a composite</h3>
                <dl>
                  <div><dt>All criminal markets</dt><dd>{valueLabel(selected.criminalMarkets, { ...measure, unit: 'score' })}</dd></div>
                  <div><dt>Financial crimes</dt><dd>{valueLabel(selected.markets.financialCrimes, { ...measure, unit: 'score' })}</dd></div>
                  <div><dt>Fauna crimes</dt><dd>{valueLabel(selected.markets.faunaCrimes, { ...measure, unit: 'score' })}</dd></div>
                  <div><dt>Arms market</dt><dd>{valueLabel(selected.markets.armsTrafficking, { ...measure, unit: 'score' })}</dd></div>
                  <div><dt>AML capacity</dt><dd>{valueLabel(selected.resilience.antiMoneyLaundering, { ...measure, unit: 'score' })}</dd></div>
                  <div><dt>Firearms traced</dt><dd>{selectedFirearms?.valuePercent == null ? 'Unavailable' : `${selectedFirearms.valuePercent.toFixed(1)}% (${selectedFirearms.year})`}</dd></div>
                </dl>
              </section>

              <section className="atlas__context-ports" aria-labelledby="atlas-context-title">
                <h3 id="atlas-context-title">Parallel context ports</h3>
                <a href="/api/v1/federation?lane=seiche-summary" className="atlas__context-port">
                  <span>Seiche</span><strong>World-market summary context</strong><small>Read-only. No illicit-economy inference or joint score.</small>
                </a>
                <a href="/api/v1/palimpsest-bri" className="atlas__context-port">
                  <span>Palimpsest</span><strong>China, BRI + raw-material context</strong><small>Reported links only. Identity-bound and rights-fail-closed.</small>
                </a>
              </section>

              <div className="atlas__dossier-actions">
                <a href={`/#designations`} aria-label={`Open public designation register from ${selected.country}`}>Entity + action register</a>
                <a href={`/#newsroom`}>Evidence newsroom</a>
              </div>
            </>
          ) : (
            <div className="atlas__empty-dossier"><h2>No source record</h2><p>Select a reporting jurisdiction. Map areas without a record remain explicitly unavailable.</p></div>
          )}
        </aside>
      </div>

      <footer className="atlas__method">
        <div><span>What this map can say</span><p>It can compare one published country-level measure at a time and expose source coverage, timing and missingness.</p></div>
        <div><span>What it cannot say</span><p>It cannot prove an individual offence, estimate route throughput, identify a point-level market, or establish causality between adjacent datasets.</p></div>
        <div><span>Primary sources</span><p><a href={organizedCrime.meta.url} target="_blank" rel="noreferrer">Global Organized Crime Index</a> · <a href={firearmsTracing.meta.url} target="_blank" rel="noreferrer">UN SDG 16.4.2</a></p></div>
      </footer>
    </section>
  )
}
