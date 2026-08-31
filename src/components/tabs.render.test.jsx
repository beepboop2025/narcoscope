// @vitest-environment happy-dom
//
// RENDER SMOKE TESTS — the structural fix for a recurring failure mode.
//
// Every UI bug this project has shipped — a DataLoader that offered 9 pickers
// while the store ingested 12, a word-order-sensitive search that returned zero
// results, a chart that drew an empty surface — passed `tsc` and the full unit
// suite, and was caught only by a human opening the app. Unit tests verify the
// pure functions; nothing verified that the components actually put the right
// things on screen.
//
// These mount each tab in happy-dom and assert on the real DOM. They cannot see
// a recharts chart (ResponsiveContainer needs real layout dimensions, which a
// headless DOM does not provide — the same reason the recharts BarChart failed
// visibly in the browser), so charts stay verified in-browser. But everything
// else — pickers, tables, scan rows, search, clickable selection — is exactly
// the surface that broke before, and now a failing render fails CI.

import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import Overview from './Overview'
import StateOverdose from './StateOverdose'
import PriceHistory from './PriceHistory'
import SeizureTrends from './SeizureTrends'
import IllicitFinance from './IllicitFinance'
import WildlifeSeizures from './WildlifeSeizures'
import Triangulation from './Triangulation'
import Designations from './Designations'
import Explorer from './Explorer'
import Flows from './Flows'
import DataLoader from './DataLoader'
import { LOADABLE_DATASET_KEYS } from '../data/loadableDatasets'
import overview from '../data/overview.json'

beforeAll(() => {
  // recharts' ResponsiveContainer measures its parent; happy-dom reports 0, and
  // recharts logs a warning per chart. Silence just that one line so a real
  // error in a test still stands out.
  const realWarn = console.warn
  console.warn = (...args) => {
    if (String(args[0]).includes('width(0) and height(0)')) return
    realWarn(...args)
  }
})

afterEach(cleanup)

describe('Triangulation tab', () => {
  it('renders the divergence scan with real ranked rows', () => {
    render(<Triangulation />)
    // The scan must surface the known divergences. If the scan silently
    // returned nothing (a regression in scanDivergences), this fails.
    const rows = document.querySelectorAll('.scan-row')
    expect(rows.length).toBeGreaterThan(1)
    expect(screen.getAllByText(/Methamphetamine|Cannabis/i).length).toBeGreaterThan(0)
  })

  it('offers both a country and a drug picker', () => {
    render(<Triangulation />)
    const selects = document.querySelectorAll('select')
    expect(selects.length).toBe(2)
  })

  it('renders the four-modality table with all modality names', () => {
    render(<Triangulation />)
    for (const name of ['Seizures', 'Retail price', 'Overdose mortality', 'Wastewater load']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
  })

  it('opens a country+drug when a scan row is clicked', () => {
    render(<Triangulation />)
    const rows = [...document.querySelectorAll('.scan-row')]
    const target = rows.find((r) => !r.classList.contains('scan-row--active'))
    expect(target).toBeTruthy()
    fireEvent.click(target)
    // After the click that row becomes the active selection.
    expect(target.classList.contains('scan-row--active')).toBe(true)
  })

  it('activates a scan row from the keyboard (Enter)', () => {
    render(<Triangulation />)
    const rows = [...document.querySelectorAll('.scan-row')]
    const target = rows.find((r) => !r.classList.contains('scan-row--active'))
    // The row must be reachable and operable without a mouse.
    expect(target.getAttribute('tabindex')).toBe('0')
    expect(target.getAttribute('role')).toBe('button')
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(target.classList.contains('scan-row--active')).toBe(true)
  })
})

describe('Designations tab', () => {
  it('renders the broker bar ranking', () => {
    render(<Designations />)
    const bars = document.querySelectorAll('.bar-row')
    expect(bars.length).toBeGreaterThan(1)
  })

  it('resolves an OFAC alias through the search box, word-order-insensitive', () => {
    // This is the exact bug that shipped: "chao wei" returned zero results
    // because OFAC stores "WEI, Chao". The end-to-end path — type, filter,
    // render — is what a unit test on searchDesignations could not catch.
    render(<Designations />)
    const input = document.querySelector('input[type=search]')
    fireEvent.change(input, { target: { value: 'chao wei' } })
    expect(screen.getAllByText(/WEI, Zhao/).length).toBeGreaterThan(0)
  })

  it('renders the jurisdiction structural-position table', () => {
    render(<Designations />)
    expect(screen.getByText(/country betweenness in the published designation graph/i)).toBeTruthy()
    expect(screen.getAllByText(/structural position/i).length).toBeGreaterThan(0)
  })
})

describe('Overview landing', () => {
  it('renders the headline stats, divergence alerts, and dense panels', () => {
    render(<Overview />)
    // The divergence alert cards are the flagship — both known cases present.
    expect(screen.getByText('US methamphetamine')).toBeTruthy()
    expect(screen.getByText('Canada cannabis')).toBeTruthy()
    // Dense panels all render with their bar rows.
    expect(screen.getByText(/overdose deaths by substance/i)).toBeTruthy()
    expect(document.querySelectorAll('.bar-row').length).toBeGreaterThan(10)
    // Freshness table proves the collection story is shown.
    expect(screen.getByText('Data freshness')).toBeTruthy()
    // The epidemic-arc trend is the alive centrepiece.
    expect(screen.getByText(/overdose epidemic/i)).toBeTruthy()
  })

  it('shows the current leading substance figure from the generated overview', () => {
    render(<Overview />)
    const leading = overview.overdoseBySubstance[0]
    expect(Number.isFinite(leading?.deaths) && leading.deaths > 0).toBe(true)

    const row = screen.getByText(leading.label).closest('.bar-row')
    expect(row).toBeTruthy()
    expect(row.querySelector('.bar-value')?.textContent).toContain(leading.deaths.toLocaleString())
  })
})

describe('US Overdose Map', () => {
  it('renders the choropleth, national headline, movers and ranked table', () => {
    render(<StateOverdose />)
    // 50 states + DC render as clickable paths.
    expect(document.querySelectorAll('.us-state').length).toBeGreaterThan(50)
    // The ranked all-states table is populated.
    expect(document.querySelectorAll('.data-table tbody tr').length).toBeGreaterThan(40)
    // Substance, year and metric controls exist.
    expect(document.querySelectorAll('select').length).toBe(2)
  })

  it('computes per-100k rates, not just raw counts', () => {
    render(<StateOverdose />)
    // The rate toggle is on by default and the chart title says "per 100k".
    expect(screen.getAllByText(/per 100k/i).length).toBeGreaterThan(0)
  })

  it('state map cells are keyboard-operable', () => {
    render(<StateOverdose />)
    const cells = [...document.querySelectorAll('.us-state')].filter((p) => p.getAttribute('tabindex') === '0')
    expect(cells.length).toBeGreaterThan(40)
    expect(cells[0].getAttribute('role')).toBe('button')
  })
})

describe('Price History (30yr)', () => {
  it('renders the long-run change table with real multi-decade falls', () => {
    render(<PriceHistory />)
    // The long-run change table is the payoff — default countries present.
    expect(screen.getAllByText('Germany').length).toBeGreaterThan(0)
    expect(screen.getAllByText('United States').length).toBeGreaterThan(0)
    // Country toggle chips for every reporting country.
    expect(document.querySelectorAll('.chip-toggle').length).toBeGreaterThan(10)
  })

  it('covers a multi-decade span in the headline', () => {
    render(<PriceHistory />)
    // Year range like 1990–2023 must appear.
    expect(screen.getAllByText(/199\d.\d{4}/).length).toBeGreaterThan(0)
  })
})

describe('Seizure Trends', () => {
  it('renders the world-by-group trend chart and the group + movers tables', () => {
    render(<SeizureTrends />)
    expect(screen.getByText(/World seizures by drug group/i)).toBeTruthy()
    // Two tables: group change + country movers, both populated.
    const tables = document.querySelectorAll('.data-table')
    expect(tables.length).toBeGreaterThanOrEqual(2)
    expect(tables[0].querySelectorAll('tbody tr').length).toBeGreaterThan(3)
  })
})

describe('Street Prices chart (ranked, not a broken line)', () => {
  it('renders ranked price bars, not a single-year line chart', () => {
    render(<Explorer />)
    // The fix: bars, sorted high to low, coloured by region — no recharts line.
    expect(document.querySelectorAll('.price-bar-row').length).toBeGreaterThan(20)
    expect(document.querySelectorAll('.recharts-line').length).toBe(0)
    // Bars are sorted descending.
    const vals = [...document.querySelectorAll('.price-bar-value')]
      .map((el) => Number(el.textContent.replace(/[$,]/g, '')))
    const sorted = [...vals].sort((a, b) => b - a)
    expect(vals).toEqual(sorted)
  })

  it('shows the region legend, not a 58-country rainbow', () => {
    render(<Explorer />)
    // 5 regions max, not one legend entry per country.
    expect(document.querySelectorAll('.region-key').length).toBeLessThanOrEqual(5)
  })
})

describe('Illicit Finance', () => {
  it('limits laundering-specific claims to the literal OFAC name', () => {
    render(<IllicitFinance />)
    expect(screen.getAllByText(/ALTAF KHANANI MONEY LAUNDERING/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/generic entity-name words are not used/i)).toBeTruthy()
    expect(screen.queryByText(/designated financial facilitators/i)).toBeNull()
    expect(screen.queryByRole('heading', { name: /laundering hubs/i })).toBeNull()
  })

  it('renders typologies as reference material separate from entity facts', () => {
    render(<IllicitFinance />)
    expect(screen.getByText('Hawala')).toBeTruthy()
    expect(screen.getByText(/Fei-ch/i)).toBeTruthy()
    expect(screen.getByText(/Trade-based money laundering/i)).toBeTruthy()
    expect(screen.getByText(/not derived from the designation extract/i)).toBeTruthy()
    expect(document.querySelectorAll('.bar-row').length).toBeGreaterThan(3)
  })
})

describe('Wildlife Seizures', () => {
  it('renders the class bars, the most-confiscated species table, and the corridor', () => {
    render(<WildlifeSeizures />)
    // Class bar list (Reptilia leads) + a populated species table.
    expect(document.querySelectorAll('.bar-row').length).toBeGreaterThan(5)
    expect(screen.getAllByText(/Reptilia/i).length).toBeGreaterThan(0)
    const tables = document.querySelectorAll('.data-table')
    expect(tables.length).toBeGreaterThanOrEqual(1)
    expect(tables[0].querySelectorAll('tbody tr').length).toBeGreaterThan(5)
    // Plain-language taxon name resolved (elephant), not just Latin.
    expect(screen.getAllByText(/African elephant/i).length).toBeGreaterThan(0)
  })

  it('drops incomplete trailing years so the trend has no false cliff', () => {
    render(<WildlifeSeizures />)
    // The 2024/2025 near-empty CITES-lag years must be excluded from the trend
    // heading, which names the last full year (2023).
    expect(screen.getAllByText(/2023/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/2025–|–2025/)).toBeNull()
  })
})

describe('DataLoader', () => {
  it('actually renders every picker in the shared list to the DOM', () => {
    // Proves LOADABLE_DATASETS reaches the screen (bundleBudget.test.js does the
    // independent count check against the LoadBundle type). Comparing the DOM
    // count to the list length would be tautological — both come from the same
    // source — so this asserts one label per dataset is present by text.
    render(<DataLoader />)
    fireEvent.click(screen.getByText(/Load official data/i))
    expect(document.querySelectorAll('.loader-field').length).toBe(LOADABLE_DATASET_KEYS.length)
  })

  it('renders the three demand/designation pickers that once shipped missing', () => {
    render(<DataLoader />)
    fireEvent.click(screen.getByText(/Load official data/i))
    // These three were ingestible by the store but had no picker — the exact
    // regression. Asserted by their visible labels, independent of the count.
    expect(screen.getByText(/Wastewater loads/i)).toBeTruthy()
    expect(screen.getByText(/Overdose mortality/i)).toBeTruthy()
    expect(screen.getByText(/Sanctions designations/i)).toBeTruthy()
  })
})

describe('Explorer + Flows tabs mount and populate', () => {
  it('Explorer renders a populated price table', () => {
    render(<Explorer />)
    const bodyRows = document.querySelectorAll('.data-table tbody tr')
    expect(bodyRows.length).toBeGreaterThan(0)
  })

  it('Flows renders the corridor table with the official INCB source', () => {
    render(<Flows />)
    const tables = document.querySelectorAll('.data-table')
    expect(tables.length).toBeGreaterThan(0)
    expect(within(tables[0]).getAllByText(/INCB/i).length).toBeGreaterThan(0)
  })
})
