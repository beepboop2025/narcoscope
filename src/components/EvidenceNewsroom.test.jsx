// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EvidenceNewsroom, { formatNewsroomNumber } from './EvidenceNewsroom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let index
let dossier

beforeAll(async () => {
  index = JSON.parse(await fs.readFile(path.join(root, 'public/news/index.json'), 'utf8'))
  dossier = JSON.parse(await fs.readFile(
    path.join(root, 'public/news/china-linked-precursor-incidents-official-record.dossier.json'),
    'utf8',
  ))
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (request) => {
    const url = String(request)
    const body = url.endsWith('/news/index.json') ? index : dossier
    return { ok: true, status: 200, json: async () => body }
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Evidence Newsroom', () => {
  it('preserves source decimals while grouping thousands', () => {
    expect(formatNewsroomNumber(1234567.8901)).toBe('1,234,567.8901')
    expect(formatNewsroomNumber(-1234.5678)).toBe('-1,234.5678')
  })

  it('renders the gated article, verification receipt and bounded quantities', async () => {
    render(<EvidenceNewsroom />)

    expect(await screen.findByRole('heading', { name: dossier.title })).toBeTruthy()
    expect(screen.getByText(/No human review recorded/i)).toBeTruthy()
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
    expect(screen.getAllByText('9').length).toBeGreaterThan(0)
    expect(screen.queryByText('2,200')).toBeNull()
    expect(screen.queryByText('7,200')).toBeNull()

    const receipt = screen.getByRole('list', { name: 'Verification receipt summary' })
    expect(within(receipt).getAllByText('100%')).toHaveLength(2)
    expect(within(receipt).getByText('2')).toBeTruthy()
    expect(within(receipt).getByText('8')).toBeTruthy()
    expect(within(receipt).getAllByText('0').length).toBeGreaterThanOrEqual(2)
  })

  it('renders three separately labelled, table-backed evidence visuals', async () => {
    render(<EvidenceNewsroom />)
    await screen.findByRole('heading', { name: dossier.title })

    const incidentFigure = screen.getByRole('figure', { name: 'China-to-EU aggregate retained at source precision' })
    const operationFigure = screen.getByRole('figure', { name: 'Operation Pseudonym: the allocation gap' })
    const harmFigure = screen.getByRole('figure', { name: 'US T40.4 mortality: every available December checkpoint' })
    expect(incidentFigure.getAttribute('aria-describedby')).toBe('news-visual-china-eu-aggregate-description')
    expect(operationFigure.getAttribute('aria-describedby')).toBe('news-visual-operation-pseudonym-context-description')
    expect(harmFigure.getAttribute('aria-describedby')).toBe('news-visual-cdc-harm-trend-description')

    const incidentTable = within(incidentFigure).getByRole('table', {
      name: 'China-to-EU aggregate retained at source precision in tonnes, upper bound',
    })
    const harmTable = within(harmFigure).getByRole('table', {
      name: 'US T40.4 mortality: every available December checkpoint in provisional deaths',
    })
    expect(within(incidentTable).getAllByRole('row')).toHaveLength(2)
    expect(within(harmTable).getAllByRole('row')).toHaveLength(12)
    expect(within(operationFigure).getByText(/annual seizure totals are excluded/i)).toBeTruthy()
    expect(within(harmFigure).getByText(/not joined to either INCB record/i)).toBeTruthy()
  })

  it('keeps sentence citations keyboard-reachable and source roles visible', async () => {
    render(<EvidenceNewsroom />)
    await screen.findByRole('heading', { name: dossier.title })

    const sourceLinks = screen.getAllByRole('link', { name: /^Source \d+$/ })
    expect(sourceLinks.length).toBeGreaterThan(20)
    expect(sourceLinks.every((link) => link.getAttribute('href')?.startsWith('#news-source-'))).toBe(true)
    expect(screen.getAllByText(/active evidence ·/i).length).toBe(2)
    expect(screen.getAllByText(/unavailable ·/i).length).toBe(3)
    expect(screen.getByRole('link', { name: 'Machine brief' }).getAttribute('href')).toMatch(/machine-brief\.json$/)
    const locators = screen.getAllByText(/paragraph 94; PDF page 44; printed page 26/i)
    expect(locators.length).toBeGreaterThan(0)
    expect(locators.some((locator) => locator.classList.contains('sr-only'))).toBe(true)
  })

  it('discloses publication history, right-to-reply status and absent testimony without simulated voices', async () => {
    render(<EvidenceNewsroom />)
    await screen.findByRole('heading', { name: dossier.title })

    const status = screen.getByRole('complementary', { name: 'Right to reply and testimony status' })
    expect(within(status).getByText(/Right to reply: not required/i)).toBeTruthy()
    expect(within(status).getByText(/No expert or affected-person testimony is included/i)).toBeTruthy()
    expect(within(status).getByText(/does not simulate those voices/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Corrections and update history' })).toBeTruthy()
    expect(screen.getByText('initial publication')).toBeTruthy()
    expect(screen.getByText(/Initial deterministic publication/)).toBeTruthy()
  })

  it('maps findings, countercase and receipts into a navigable evidence spine', async () => {
    render(<EvidenceNewsroom />)
    await screen.findByRole('heading', { name: dossier.title })

    const rail = screen.getByRole('complementary', { name: 'Article evidence map' })
    const links = within(rail).getAllByRole('link')
    expect(links.length).toBe(dossier.sections.length + 4)
    expect(within(rail).getByText(/1 countercase/i)).toBeTruthy()
    expect(within(rail).getByText('100% cited')).toBeTruthy()
    expect(links.some((link) => link.getAttribute('href') === '#news-limitations')).toBe(true)
    expect(links.some((link) => link.getAttribute('href') === '#news-sources')).toBe(true)
  })
})
