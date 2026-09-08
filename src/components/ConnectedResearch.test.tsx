// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import artifact from '../../public/data/palimpsest-connected-research-v1.json'
import ConnectedResearch from './ConnectedResearch'

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
