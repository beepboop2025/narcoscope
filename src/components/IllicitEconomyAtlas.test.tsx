// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import IllicitEconomyAtlas from './IllicitEconomyAtlas'

afterEach(cleanup)

describe('IllicitEconomyAtlas', () => {
  it('opens on a source-grained drug-market measure with visible claim boundaries', () => {
    render(<IllicitEconomyAtlas />)
    expect(screen.getByRole('heading', { name: /read one measure/i })).toBeTruthy()
    expect(screen.getAllByText('Expert assessment').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Myanmar' })).toBeTruthy()
    expect(screen.getByText(/missing means/i).parentElement?.textContent).toMatch(/unavailable, never zero/i)
    expect(screen.getByText(/what it cannot say/i).parentElement?.textContent).toMatch(/individual offence/i)
  })

  it('switches arms evidence classes without treating tracing as flow volume', () => {
    render(<IllicitEconomyAtlas />)
    fireEvent.click(screen.getByRole('button', { name: /Arms$/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Tracing response' }))
    expect(screen.getAllByText('Official statistic')).toHaveLength(2)
    expect(screen.getByText(/share of seized, found or surrendered arms/i)).toBeTruthy()
    expect(screen.getByText(/higher traced share/i)).toBeTruthy()
    expect(screen.getByText(/not a composite/i)).toBeTruthy()
  })

  it('searches the complete current country release and opens a dossier', () => {
    render(<IllicitEconomyAtlas />)
    const search = screen.getByRole('searchbox', { name: /find a jurisdiction/i })
    fireEvent.change(search, { target: { value: 'China' } })
    const results = screen.getByText('CHN · Eastern Asia').parentElement
    expect(results).toBeTruthy()
    fireEvent.click(within(results as HTMLElement).getByText('China'))
    expect(screen.getByRole('heading', { name: 'China' })).toBeTruthy()
    expect(screen.getByText(/world-market summary context/i)).toBeTruthy()
    expect(screen.getByText(/China, BRI \+ raw-material context/i)).toBeTruthy()
  })
})
