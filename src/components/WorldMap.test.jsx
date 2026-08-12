// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CorridorMap, flowSummary } from './WorldMap'

afterEach(cleanup)

describe('precursor corridor qualification', () => {
  it('renders every source quantity qualifier in plain language', () => {
    const base = { quantityKg: 500, recordKind: 'single_incident' }

    expect(flowSummary({ ...base, quantityRelation: 'exact' })).toBe('500 kg; single incident')
    expect(flowSummary({ ...base, quantityRelation: 'approx' })).toBe('approximately 500 kg; single incident')
    expect(flowSummary({ ...base, quantityRelation: 'less_than' })).toBe('less than 500 kg; single incident')
    expect(flowSummary({ ...base, quantityRelation: 'greater_than' })).toBe('more than 500 kg; single incident')
    expect(flowSummary(base)).toBe('an unqualified 500 kg; single incident')
  })

  it('uses uniform record-leg arcs and record-count nodes without summing masses', () => {
    render(<CorridorMap />)

    const range = document.querySelector('input[type="range"]')
    expect(range).toBeTruthy()
    fireEvent.change(range, { target: { value: '1' } })

    const map = screen.getByRole('img', { name: 'World precursor flow map' })
    const arcPaths = [...map.querySelectorAll('path')]
      .filter((path) => path.querySelector(':scope > title'))
    const arcTitles = arcPaths.map((path) => path.querySelector('title')?.textContent ?? '')
    const nodeTitles = [...map.querySelectorAll('g > title')]
      .map((title) => title.textContent ?? '')

    expect(arcPaths.length).toBeGreaterThan(0)
    expect(nodeTitles.length).toBeGreaterThan(0)
    expect(arcPaths.every((path) => path.getAttribute('stroke-width') === '2.5')).toBe(true)
    expect(arcTitles.some((title) => title.includes('less than 5,000 kg'))).toBe(true)
    expect(arcTitles.some((title) => title.includes('more than 15,000 kg'))).toBe(true)
    expect(arcTitles.some((title) => title.includes('Thailand → Myanmar'))).toBe(false)
    expect(arcTitles.some((title) => title.includes('less than 1,000 kg'))).toBe(false)
    expect(nodeTitles.some((title) => title.includes('Thailand') && title.includes('stated seizure location'))).toBe(true)
    expect(nodeTitles.every((title) => title.includes('masses are not summed'))).toBe(true)
    expect(nodeTitles.some((title) => title.includes('kg across corridors'))).toBe(false)
    expect(screen.getByText(/Uniform arc width and record-count nodes/i)).toBeTruthy()
  })
})
