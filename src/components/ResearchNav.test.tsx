// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResearchNav from './ResearchNav'

afterEach(cleanup)

describe('persistent regional dossier navigation', () => {
  it('keeps every first-class dossier visible and routes the selected tab', () => {
    const onSelect = vi.fn()
    render(<ResearchNav activeTab="balochistan" onSelect={onSelect} />)

    for (const label of ['BRI & Corridors', 'Balochistan', 'Pakistan & Gwadar', 'Myanmar']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Balochistan' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: 'Pakistan & Gwadar' }))
    expect(onSelect).toHaveBeenCalledWith('pakistan-gwadar')
  })

  it('keeps ordinary research tabs reachable from a regional dossier', () => {
    const onSelect = vi.fn()
    render(<ResearchNav activeTab="bri" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /markets/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))

    expect(onSelect).toHaveBeenCalledWith('prices')
  })
})
