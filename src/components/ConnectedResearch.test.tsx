// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import artifact from '../../public/data/palimpsest-connected-research-v1.json'
import ConnectedResearch from './ConnectedResearch'
import { observatoryFixture } from '../../api/observatory-fixture.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('switches between China findings and national Pakistan context with dated sources', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { data: artifact } }) }))
  render(<ConnectedResearch region="balochistan" />)
  expect(await screen.findByText('Balochistan: livelihoods, resources and political life')).toBeTruthy()
  expect(screen.getByText(/They do not measure a CPEC project/)).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'china' } })
  expect(screen.getByText(artifact.china_findings[0].title)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Research API' }).getAttribute('href')).toBe('/api/v1/connected-research')
})

it('shows unavailability when the research endpoint fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  render(<ConnectedResearch />)
  expect(await screen.findByText('The research snapshot could not be loaded.')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('connects regional trade findings and China methodology while labeling private acquisition counts', async () => {
  const research = { ...artifact, observatory: observatoryFixture() }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { data: research } }) }))
  render(<ConnectedResearch region="cpec" />)
  expect(await screen.findByRole('region', { name: 'China evidence observatory' })).toBeTruthy()
  expect(screen.getByText('European trade and regional demand')).toBeTruthy()
  expect(screen.queryByText('Industry cash-flow comparison')).toBeNull()
  expect(screen.queryByText('A changed unemployment denominator')).toBeNull()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'myanmar' } })
  expect(screen.queryByText('European trade and regional demand')).toBeNull()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'china' } })
  expect(screen.getByText('Industry cash-flow comparison')).toBeTruthy()
  expect(screen.getByText('A changed unemployment denominator')).toBeTruthy()
  expect(screen.getByText('Official announcement · 2024-01-17')).toBeTruthy()
  fireEvent.click(screen.getByText('Inspect the four evidence collections'))
  expect(screen.getByText('Acquisition metadata is public. Numeric records remain private.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Download acquisition metadata' }).getAttribute('href')).toBe('https://www.palimpsest.info/readings/china-external-accounts-latest.json')
  expect(screen.getByText('Numeric observations retained privately')).toBeTruthy()
})
