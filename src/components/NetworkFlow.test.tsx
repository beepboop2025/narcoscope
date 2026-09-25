// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from '../motion/usePrefersReducedMotion'
import NetworkFlow from './NetworkFlow'

vi.mock('../motion/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: vi.fn(() => false) }))
afterEach(() => { cleanup(); vi.mocked(usePrefersReducedMotion).mockReturnValue(false) })

describe('research network illustration', () => {
  it('lets the reader pause and resume movement without leaving the page', () => {
    const { container } = render(<NetworkFlow />)
    expect(screen.getByRole('img', { name: /illustration of connected economic research/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause motion' }))
    expect(container.firstElementChild?.getAttribute('data-paused')).toBe('true')
    expect(screen.getByRole('button', { name: 'Play motion' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Play motion' }))
    expect(container.firstElementChild?.getAttribute('data-paused')).toBe('false')
  })

  it('keeps the illustration still when the reader requests reduced motion', () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true)
    const { container } = render(<NetworkFlow />)
    expect(container.firstElementChild?.getAttribute('data-paused')).toBe('true')
    expect((screen.getByRole('button', { name: 'Reduced motion' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
