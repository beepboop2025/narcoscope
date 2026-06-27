import { useEffect } from 'react'
import Lenis from 'lenis'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * Global smooth scrolling. Lenis intercepts wheel/touch and
 * eases the scroll position on a single requestAnimationFrame loop — the same
 * loop philosophy, so scroll-linked animation stays frame-synced.
 *
 * Skipped entirely when the user prefers reduced motion (native scroll returns).
 */
export function useSmoothScroll(): void {
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) return

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out
      smoothWheel: true,
    })

    let rafId = 0
    const raf = (time: number) => {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
    }
  }, [reduced])
}
