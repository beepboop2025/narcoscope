import { useEffect, useMemo, useRef, useState } from 'react'
import { geoEqualEarth } from 'd3-geo'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar } from 'recharts'
import topology from '../data/countries-ind.json'
import { countriesFromTopology, graticulePath, pathForGeometry } from '../lib/mapSvg'
import DataTableViewport from './DataTableViewport'

export type Market = 'all' | 'drugs' | 'arms' | 'economy'
type Coverage = { observations: number; numericObservations?: number; reported: number; estimated: number; unavailable: number; firstPeriod: string | null; lastPeriod: string | null; firstNumericPeriod: string | null; lastNumericPeriod: string | null }
type Source = { id: string; name: string; publisher: string; url: string; downloadUrl: string; license: string; licenseUrl: string; retrievedAt: string; sha256: string; notes: string[] }
type DimensionSelection = { category: string; subgroup: string; firstPeriod: string; lastPeriod: string; lastNumericPeriod: string | null; latestNumericObservations: number }
type Indicator = { id: string; sourceId: string; market: Exclude<Market, 'all'>; label: string; unit: string; measureType: string; description: string; limitations: string[]; coverage: Coverage; dimensions: { geographies: { code: string; name: string; level: string }[]; categories: string[]; subgroups: string[]; selections: DimensionSelection[] }; featured?: boolean }
type Dataset = { id: string; title: string; sha256: string; generatedAt: string; indicators: Indicator[]; sources: Source[]; coverage: Coverage; limitations: string[] }
type Catalog = { schema: string; generatedAt: string; datasets: Dataset[]; limitations: string[]; relatedResources?: { label: string; path: string }[] }
export type MarketObservation = { id: string; indicatorId: string; geoCode: string; geoName: string; geoLevel: string; period: string; category: string; subgroup: string; value: number | null; lower: number | null; upper: number | null; status: string; sourceLocator: string; datasetId: string; sourceId: string; unit: string; measureType: string }
type QueryResult = { datasets: { id: string; sha256: string }[]; observations: MarketObservation[]; pagination: { page: number; limit: number; total: number; pages: number; nextPage: number | null }; sources: Source[]; limitations: string[] }
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const COLORS = ['#89b4ff', '#e3b878', '#7ed3c3']
const features = countriesFromTopology(topology)
const projection = geoEqualEarth().fitExtent([[8, 12], [892, 412]], { type: 'Sphere' })
const geoFeatures = features.map((feature) => ({
  code: String((feature.properties as Record<string, unknown>)?.ADM0_A3 ?? feature.id ?? ''),
  name: String((feature.properties as Record<string, unknown>)?.NAME_EN ?? (feature.properties as Record<string, unknown>)?.name ?? ''),
  path: pathForGeometry(projection, feature.geometry),
}))
const DOMAIN = { all: ['World data explorer', 'Explore the record across countries, substances and years.'], drugs: ['Drugs: supply, use and harm', 'Read reported drug statistics in their original units and source periods.'], arms: ['Arms and enforcement', 'Separate recorded arms statistics, legal transfers and measures of enforcement.'], economy: ['Black economy and informality', 'Compare modeled economic activity and reported crime without treating them as equivalent.'] }

async function readApi<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  const result = await response.json()
  if (!response.ok || result.ok !== true) throw new Error(result.message || 'This dataset could not be loaded. Try again shortly.')
  return result.data as T
}

export function chartPeriods(observations: MarketObservation[]): string[] {
  const periods = [...new Set(observations.map((row) => row.period))].sort()
  if (!periods.length) return []
  const monthly = periods.every((value) => /^\d{4}-\d{2}$/.test(value))
  const annual = periods.every((value) => /^\d{4}$/.test(value))
  if (!monthly && !annual) return periods
  const start = monthly ? Number(periods[0].slice(0, 4)) * 12 + Number(periods[0].slice(5)) - 1 : Number(periods[0])
  const last = periods[periods.length - 1]
  const end = monthly ? Number(last.slice(0, 4)) * 12 + Number(last.slice(5)) - 1 : Number(last)
  if (end - start > 1500) return periods
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = start + index
    return monthly ? String(Math.floor(value / 12)) + '-' + String(value % 12 + 1).padStart(2, '0') : String(value)
  })
}

function ObservationMap({ rows, selected, onSelect, unit }: { rows: MarketObservation[]; selected: string[]; onSelect: (code: string) => void; unit: string }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState('')
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const countries = rows.filter((row) => row.geoLevel === 'country')
  const byCode = new Map(countries.map((row) => [row.geoCode, row]))
  const values = countries.flatMap((row) => row.value == null ? [] : [row.value])
  const low = Math.min(0, ...values); const high = Math.max(1, ...values)
  const fill = (value: number | null | undefined) => {
    if (value == null) return '#1b2a3d'
    const amount = (value - low) / (high - low)
    return 'rgb(' + [38 + amount * 99, 61 + amount * 119, 88 + amount * 167].map(Math.round).join(',') + ')'
  }
  return <div className="market-map">
    <div className="market-map__toolbar"><span>{countries.filter((row) => row.value != null).length} countries with values</span><div>
      <button type="button" aria-label="Zoom out map" onClick={() => setZoom(Math.max(1, zoom - .5))}>−</button>
      <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Reset</button>
      <button type="button" aria-label="Zoom in map" onClick={() => setZoom(Math.min(4, zoom + .5))}>+</button>
    </div></div>
    <svg className="market-map__svg" viewBox="0 0 900 424" role="img" aria-label="World map of the selected reported measure" onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, moved: false } }} onPointerMove={(event) => {
      if (drag.current && event.buttons && zoom > 1) {
        const x = event.clientX - drag.current.x; const y = event.clientY - drag.current.y
        if (Math.abs(x) + Math.abs(y) > 2) drag.current.moved = true
        setPan((old) => ({ x: Math.max(-900, Math.min(900, old.x + x)), y: Math.max(-424, Math.min(424, old.y + y)) }))
        drag.current.x = event.clientX; drag.current.y = event.clientY
      }
    }} onPointerLeave={() => { drag.current = null }}>
      <title>Reported values by country. Use the geography selector for keyboard access to every location.</title>
      <defs><clipPath id="market-world-clip"><rect width="900" height="424" rx="6" /></clipPath></defs>
      <g clipPath="url(#market-world-clip)"><g transform={'translate(' + (450 + pan.x) + ',' + (212 + pan.y) + ') scale(' + zoom + ') translate(-450,-212)'}>
        <path d={graticulePath(projection)} fill="none" stroke="#1c3048" strokeWidth=".7" />
        {geoFeatures.map((feature, index) => { const row = byCode.get(feature.code); return <path key={feature.code + '-' + index} d={feature.path} fill={fill(row?.value)} stroke={selected.includes(feature.code) ? '#ffffff' : '#090f18'} strokeWidth={selected.includes(feature.code) ? 1.8 : .65} className={row ? 'has-data' : ''} onPointerEnter={() => setHover((row?.geoName ?? feature.name) + ': ' + (row?.value == null ? 'no value for this selection' : number.format(row.value) + ' ' + unit))} onClick={() => { if (row && !drag.current?.moved) onSelect(row.geoCode); drag.current = null }}><title>{row?.geoName ?? feature.name}: {row?.value == null ? 'Unavailable' : number.format(row.value) + ' ' + unit}</title></path> })}
      </g></g>
    </svg>
    <div className="market-map__legend"><span>{number.format(low)}</span><i /><span>{number.format(high)} {unit}</span><span className="market-map__missing">No value</span></div>
    <p className="market-map__hover" aria-live="polite">{hover || (countries.length ? 'Select a country to inspect its history. Zoom and drag to explore.' : 'This measure uses another geographic level; use the location selector and graphs. Country values are not inferred.')} </p>
  </div>
}

export default function GlobalMarketExplorer({ market = 'all', apiBase = '/api/v1', narcoscopeBase = '' }: { market?: Market; apiBase?: string; narcoscopeBase?: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState('')
  const [category, setCategory] = useState('')
  const [subgroup, setSubgroup] = useState('')
  const [period, setPeriod] = useState('')
  const [geos, setGeos] = useState<string[]>([])
  const [snapshot, setSnapshot] = useState<QueryResult | null>(null)
  const [histories, setHistories] = useState<MarketObservation[]>([])
  const [historyLimit, setHistoryLimit] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [recordView, setRecordView] = useState<'snapshot' | 'history'>('snapshot')
  const [recordSearch, setRecordSearch] = useState('')
  const [tablePage, setTablePage] = useState(0)
  useEffect(() => { const controller = new AbortController(); setLoadError(''); readApi<Catalog>(apiBase + '/markets', controller.signal).then(setCatalog).catch((error) => { if (!controller.signal.aborted) setLoadError(error.message) }); return () => controller.abort() }, [apiBase, retry])
  const all = useMemo(() => (catalog?.datasets ?? []).flatMap((dataset) => dataset.indicators.map((indicator) => ({ dataset, indicator, key: dataset.id + ':' + indicator.id }))).filter((entry) => market === 'all' || entry.indicator.market === market), [catalog, market])
  const options = all.filter((entry) => (entry.indicator.label + ' ' + entry.dataset.title + ' ' + entry.indicator.description).toLowerCase().includes(search.toLowerCase()))
  const current = all.find((entry) => entry.key === selection) ?? all.find((entry) => entry.indicator.featured) ?? all[0]
  const indicator = current?.indicator
  const validSelections = indicator?.dimensions.selections ?? []
  const selectedDimensions = validSelections.find((entry) => entry.category === category && entry.subgroup === subgroup)
  const selectDimensions = (entry: DimensionSelection | undefined) => { if (!entry) return; setCategory(entry.category); setSubgroup(entry.subgroup); setPeriod(entry.lastNumericPeriod ?? entry.lastPeriod); setGeos([]) }
  const source = current?.dataset.sources.find((entry) => entry.id === indicator?.sourceId)
  useEffect(() => {
    if (!current) return
    const initial = current.indicator.dimensions.selections[0]
    setSelection(current.key); setCategory(initial?.category ?? ''); setSubgroup(initial?.subgroup ?? '')
    setPeriod(initial?.lastNumericPeriod ?? current.indicator.coverage.lastNumericPeriod ?? current.indicator.coverage.lastPeriod ?? ''); setGeos([]); setSnapshot(null); setHistories([]); setTablePage(0); setRecordSearch('')
  }, [current?.key])
  const queryUrl = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ dataset: current?.dataset.id ?? '', indicator: indicator?.id ?? '', category, subgroup, limit: '500', ...extra })
    return apiBase + '/market-observations?' + params.toString()
  }
  const readQuery = async (url: string, signal: AbortSignal) => {
    const result = await readApi<QueryResult>(url, signal)
    if (!result.datasets.some((dataset) => dataset.id === current?.dataset.id && dataset.sha256 === current.dataset.sha256)) throw new Error('This dataset was revised while you were reading. Retry to load the new source edition.')
    return result
  }
  useEffect(() => {
    if (!indicator || !period) return
    const controller = new AbortController(); setLoading(true); setQueryError(''); setSnapshot(null); setTablePage(0)
    readQuery(queryUrl({ from: period, to: period }), controller.signal).then((result) => { if (!controller.signal.aborted) { setSnapshot(result); setGeos((previous) => previous.length ? previous : result.observations.filter((row) => row.value != null).slice(0, 1).map((row) => row.geoCode)) } }).catch((error) => { if (!controller.signal.aborted) setQueryError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [current?.key, current?.dataset.sha256, category, subgroup, period, apiBase, retry])
  useEffect(() => {
    if (!indicator || !geos.length) { setHistories([]); return }
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(''); setHistories([]); setHistoryLimit(false)
    Promise.all(geos.map(async (geo) => { const first = await readQuery(queryUrl({ geo }), controller.signal); const rows = [...first.observations]; if (first.pagination.nextPage) { const second = await readQuery(queryUrl({ geo, page: String(first.pagination.nextPage) }), controller.signal); rows.push(...second.observations); if (second.pagination.nextPage && !controller.signal.aborted) setHistoryLimit(true) }; return rows })).then((results) => { if (!controller.signal.aborted) setHistories(results.flat()) }).catch((error) => { if (!controller.signal.aborted) setHistoryError(error.message) }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [current?.key, current?.dataset.sha256, category, subgroup, geos.join(','), apiBase, retry])
  const chartData = useMemo(() => {
    const points = new Map(histories.map((row) => [row.geoCode + ':' + row.period, row]))
    return chartPeriods(histories).map((date) => Object.fromEntries([['period', date], ...geos.map((geo) => [geo, points.get(geo + ':' + date)?.value ?? null])]))
  }, [histories, geos])
  const geographyName = (code: string) => indicator?.dimensions.geographies.find((geo) => geo.code === code)?.name ?? code
  const rankingLevel = ['country', 'city', 'region', 'world'].find((level) => snapshot?.observations.some((row) => row.geoLevel === level && row.value != null))
  const ranking = (snapshot?.observations ?? []).filter((row) => row.value != null && row.geoLevel === rankingLevel).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 10)
  const records = (recordView === 'snapshot' ? snapshot?.observations ?? [] : histories).filter((row) => (row.geoName + ' ' + row.period + ' ' + row.category + ' ' + row.subgroup).toLowerCase().includes(recordSearch.toLowerCase()))
  const visibleRecords = records.slice(tablePage * 50, (tablePage + 1) * 50)
  const periods = selectedDimensions?.firstPeriod && selectedDimensions.lastPeriod ? chartPeriods([{ period: selectedDimensions.firstPeriod }, { period: selectedDimensions.lastPeriod }] as MarketObservation[]) : []
  const numerical = all.reduce((sum, entry) => sum + (entry.indicator.coverage.numericObservations ?? entry.indicator.coverage.reported + entry.indicator.coverage.estimated), 0)
  const coverageCountries = new Set(all.flatMap((entry) => entry.indicator.dimensions.geographies.filter((geo) => geo.level === 'country').map((geo) => geo.code)))
  const csv = () => {
    const columns = ['geoCode', 'geoName', 'geoLevel', 'period', 'category', 'subgroup', 'value', 'lower', 'upper', 'unit', 'status', 'sourceId', 'sourceLocator'] as const
    const cell = (value: unknown) => { let str = String(value ?? ''); if (/^(?:\s*[=+@]|[\t\r])/.test(str) || (/^-/.test(str) && !/^-\d/.test(str))) str = "'" + str; return '"' + str.replaceAll('"', '""') + '"' }
    const content = [[...columns, 'sourceUrl', 'license', 'licenseUrl', 'retrievedAt', 'sourceSha256'].join(','), ...records.map((row) => [...columns.map((key) => cell(row[key])), ...[source?.url, source?.license, source?.licenseUrl, source?.retrievedAt, source?.sha256].map(cell)].join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'narcoscope-' + (indicator?.id ?? 'observations') + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  if (loadError) return <section className="market-explorer market-empty"><h1>Research data could not be loaded</h1><p>{loadError}</p><button type="button" onClick={() => setRetry(retry + 1)}>Try again</button><a href={narcoscopeBase + '#atlas'}>Open the existing country atlas</a></section>
  if (!catalog) return <section className="market-explorer market-empty" role="status"><h1>Loading the research library…</h1><p>Reading dataset coverage and source definitions.</p></section>
  return <section className={'market-explorer market-explorer--' + market} aria-label="Global market data explorer">
    <header className="market-heading"><div><h2>{DOMAIN[market][0]}</h2><p>{DOMAIN[market][1]}</p></div><div className="market-coverage"><span><strong>{number.format(numerical)}</strong> numeric observations</span><span><strong>{all.length}</strong> measures</span><span><strong>{coverageCountries.size}</strong> countries in source coverage</span></div></header>
    <div className="market-find"><label>Find a measure<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by substance, statistic or source" /></label><label>Measure<select aria-label="Measure" value={current?.key ?? ''} onChange={(event) => setSelection(event.target.value)}>{current && !options.includes(current) && <option value={current.key}>{current.indicator.label}</option>}{options.map((entry) => <option key={entry.key} value={entry.key}>{entry.indicator.label} — {entry.indicator.unit}</option>)}</select></label></div>
    {!all.length ? <div className="market-empty"><h3>No acquired dataset is available in this view yet</h3><p>Explore the existing source-defined atlas and specialist tables while additional data is being acquired.</p><a href={narcoscopeBase + '#atlas'}>Country atlas</a></div> : indicator && <>
      <div className="market-definition"><div><h3>{indicator.label}</h3><p>{indicator.description}</p></div><div><span>{source?.publisher}</span><strong>{indicator.unit}</strong><small>{indicator.coverage.firstPeriod} to {indicator.coverage.lastPeriod}</small></div></div>
      <div className="market-filters"><label>Category<select aria-label="Category" value={category} onChange={(event) => { selectDimensions(validSelections.find((entry) => entry.category === event.target.value)); setTablePage(0) }}>{indicator.dimensions.categories.map((value) => <option key={value} value={value}>{value || 'Not further specified'}</option>)}</select></label><label>Population / breakdown<select aria-label="Population / breakdown" value={subgroup} onChange={(event) => { selectDimensions(validSelections.find((entry) => entry.category === category && entry.subgroup === event.target.value)); setTablePage(0) }}>{validSelections.filter((entry) => entry.category === category).map((entry) => entry.subgroup).map((value) => <option key={value} value={value}>{value || 'Reported total'}</option>)}</select></label><label>Map reference period<select aria-label="Map reference period" value={period} onChange={(event) => setPeriod(event.target.value)}>{[...periods].reverse().map((value) => <option key={value}>{value}</option>)}</select></label><label>Primary location<select aria-label="Primary location" value={geos[0] ?? ''} onChange={(event) => setGeos([event.target.value, ...geos.slice(1).filter((geo) => geo !== event.target.value)])}><option value="">Choose a location</option>{indicator.dimensions.geographies.map((geo) => <option key={geo.level + geo.code} value={geo.code}>{geo.name}</option>)}</select></label></div>
      {queryError && <p className="market-error" role="alert">{queryError} <button onClick={() => setRetry(retry + 1)}>Retry</button></p>}
      <div className="market-visuals"><article className="market-visual market-visual--map"><div className="market-panel-title"><h3>Where the source reports data</h3><span>{period} {loading ? ' · loading' : ''}</span></div><ObservationMap rows={snapshot?.observations ?? []} selected={geos} onSelect={(code) => setGeos([code, ...geos.slice(1).filter((geo) => geo !== code)])} unit={indicator.unit} />{snapshot && snapshot.pagination.total > snapshot.observations.length && <p className="market-note">Showing the first {snapshot.observations.length} of {snapshot.pagination.total} records. This map is a partial view; narrow the category or breakdown.</p>}</article>
        <article className="market-visual market-visual--ranking"><div className="market-panel-title"><h3>Reported values in this selection</h3><span>{period}</span></div>{ranking.length ? <ResponsiveContainer width="100%" height={315} minWidth={0}><BarChart data={ranking} layout="vertical" margin={{ left: 4, right: 22, bottom: 4 }}><CartesianGrid stroke="#26394f" horizontal={false} /><XAxis type="number" tick={{ fill: '#a8b8cc', fontSize: 11 }} tickFormatter={(value) => new Intl.NumberFormat('en', { notation: 'compact' }).format(value)} /><YAxis dataKey="geoName" type="category" width={112} tick={{ fill: '#c5d2e3', fontSize: 11 }} /><Tooltip contentStyle={{ background: '#111c2b', border: '1px solid #48617e', borderRadius: 6, color: '#e4edf8' }} formatter={(value) => [number.format(Number(value)) + ' ' + indicator.unit, indicator.label]} /><Bar isAnimationActive={false} dataKey="value" fill={market === 'economy' ? COLORS[2] : market === 'arms' ? COLORS[1] : COLORS[0]} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer> : <p className="market-empty">{loading ? 'Loading the selected period…' : 'No numeric observations in this selection. Choose another period or breakdown.'}</p>}<p className="market-note">Up to ten {rankingLevel ?? "location"} values, in {indicator.unit}. Geographic levels are kept separate. Reporting coverage and source methods affect comparisons; this is not a ranking of the hidden market.</p></article></div>
      <article className="market-visual market-history"><div className="market-panel-title"><div><h3>Follow the same measure over time</h3><p>{category || indicator.label}{subgroup ? ' · ' + subgroup : ''} · {indicator.unit}</p></div><label>Compare another location<select aria-label="Compare another location" value="" disabled={geos.length >= 3} onChange={(event) => { if (event.target.value) setGeos([...geos, event.target.value]) }}><option value="">Add up to three locations</option>{indicator.dimensions.geographies.filter((geo) => !geos.includes(geo.code)).map((geo) => <option key={geo.level + geo.code} value={geo.code}>{geo.name}</option>)}</select></label></div>
        <div className="market-comparisons">{geos.map((geo, index) => <button key={geo} onClick={() => setGeos(geos.filter((value) => value !== geo))} style={{ borderColor: COLORS[index] }} aria-label={'Remove ' + geographyName(geo) + ' from comparison'}><i style={{ background: COLORS[index] }} />{geographyName(geo)} <span aria-hidden="true">×</span></button>)}</div>
        {historyError ? <p role="alert" className="market-error">{historyError}</p> : chartData.length ? <ResponsiveContainer width="100%" height={310} minWidth={0}><LineChart data={chartData} margin={{ top: 15, right: 25, bottom: 10, left: 15 }}><CartesianGrid stroke="#26394f" strokeDasharray="3 4" /><XAxis dataKey="period" minTickGap={45} tick={{ fill: '#a8b8cc', fontSize: 11 }} /><YAxis width={70} tick={{ fill: '#a8b8cc', fontSize: 11 }} tickFormatter={(value) => new Intl.NumberFormat('en', { notation: 'compact' }).format(value)} /><Tooltip contentStyle={{ background: '#111c2b', border: '1px solid #48617e', borderRadius: 6, color: '#e4edf8' }} formatter={(value) => number.format(Number(value)) + ' ' + indicator.unit} /><Legend />{geos.map((geo, index) => <Line key={geo} dataKey={geo} name={geographyName(geo)} stroke={COLORS[index]} strokeWidth={2.3} dot={chartData.length < 50 ? { r: 2 } : false} connectNulls={false} type="linear" isAnimationActive={false} />)}</LineChart></ResponsiveContainer> : <p className="market-empty">{historyLoading ? 'Loading comparable histories…' : 'Select a location on the map or from the list to explore its history.'}</p>}
        <p className="market-note">Gaps remain gaps. Values use the same indicator, category and breakdown; they are not summed across sources.{historyLimit ? ' This chart is limited to the first 1,000 observations per location.' : ''} Reported intervals, where available, remain in the records below.</p>
      </article>
      <section className="market-records"><div className="market-panel-title"><div><h3>Inspect the observations</h3><p>{records.length} loaded records · {indicator.unit}</p></div><button className="market-button" type="button" onClick={csv} disabled={!records.length}>Download this selection</button></div><div className="market-record-tools"><div role="group" aria-label="Observation table view"><button className={recordView === 'snapshot' ? 'is-active' : ''} onClick={() => { setRecordView('snapshot'); setTablePage(0) }}>Map period</button><button className={recordView === 'history' ? 'is-active' : ''} onClick={() => { setRecordView('history'); setTablePage(0) }}>Selected histories</button></div><label>Filter records<input type="search" value={recordSearch} onChange={(event) => { setRecordSearch(event.target.value); setTablePage(0) }} placeholder="Location or period" /></label></div>
        <DataTableViewport label="Source-defined market observations"><table className="data-table"><thead><tr><th>Location</th><th>Period</th><th>Category</th><th>Breakdown</th><th>Value</th><th>Reported interval</th><th>Record</th></tr></thead><tbody>{visibleRecords.map((row) => <tr key={row.id}><th scope="row">{row.geoName}<small>{row.geoLevel}</small></th><td>{row.period}</td><td>{row.category || '—'}</td><td>{row.subgroup || '—'}</td><td className="market-value">{row.value == null ? 'Unavailable' : number.format(row.value)}<small>{row.status}</small></td><td>{row.lower == null && row.upper == null ? 'Not supplied' : (row.lower == null ? '…' : number.format(row.lower)) + '–' + (row.upper == null ? '…' : number.format(row.upper))}</td><td><details><summary>Source record</summary><p>{row.sourceLocator}</p><a href={source?.url} target="_blank" rel="noreferrer">Original source</a><code>{row.id}</code></details></td></tr>)}</tbody></table></DataTableViewport>
        {!records.length && <p className="market-note">No records match this selection. Missing observations are not zero values.</p>}<div className="market-pagination"><button disabled={tablePage === 0} onClick={() => setTablePage(tablePage - 1)}>Previous</button><span>Page {tablePage + 1} of {Math.max(1, Math.ceil(records.length / 50))}</span><button disabled={(tablePage + 1) * 50 >= records.length} onClick={() => setTablePage(tablePage + 1)}>Next</button></div>
      </section>
      <section className="market-method"><div><h3>Source and interpretation</h3><p>{source?.name}</p><a href={source?.url} target="_blank" rel="noreferrer">Open the publisher’s source</a><p className="market-note">Retrieved {source?.retrievedAt.slice(0, 10)}. This is an acquisition date; the observations retain their own reporting periods.</p><details><summary>Reuse terms and capture identity</summary><p>{source?.license}</p><a href={source?.licenseUrl} target="_blank" rel="noreferrer">Publisher’s terms</a>{source?.notes.map((note) => <p key={note}>{note}</p>)}<code>{source?.sha256}</code></details></div><div><h3>Read the limits alongside the data</h3><ul>{[...indicator.limitations, ...current.dataset.limitations].map((item) => <li key={item}>{item}</li>)}</ul></div></section>
      <aside className="market-connected"><h3>Continue the investigation</h3><p>Bring the country and period into the regional evidence desks. Geography and timing identify research questions; they do not establish an actor or causal link.</p><div><a href={narcoscopeBase + '#atlas'}>Organized-crime assessment map</a><a href={narcoscopeBase + '#map'}>Drug seizure globe</a><a href={narcoscopeBase + '#states'}>US overdose map</a><a href={narcoscopeBase + '#bri'}>China, BRI and corridors</a><a href="https://www.palimpsest.info/china/evidence/">Palimpsest economic evidence</a></div></aside>
    </>}
  </section>
}
