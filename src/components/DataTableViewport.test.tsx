// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DataTableViewport from './DataTableViewport'

afterEach(cleanup)

describe('DataTableViewport', () => {
  it('keeps native table semantics inside a named keyboard-scrollable region', () => {
    render(
      <DataTableViewport label="Seizure history">
        <table>
          <tbody><tr><td>2026</td></tr></tbody>
        </table>
      </DataTableViewport>,
    )

    const viewport = screen.getByRole('region', {
      name: 'Seizure history. Scroll horizontally for all columns.',
    })
    expect(viewport.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Scroll for all columns')).toBeTruthy()
  })
})
