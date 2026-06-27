import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSpring, animated } from '@react-spring/web'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

interface RevealProps {
  children: ReactNode
  /** Delay in ms before this block springs in (use to stagger siblings). */
  delay?: number
  /** Vertical travel distance in rem. */
  y?: number
  className?: string
}

/**
 * Springs a block from (transparent, offset-down) to (opaque, in place) the
 * first time it scrolls into view. The workhorse for the "content
 * arrives as you reach it" feel. One IntersectionObserver per block, disconnected
 * after firing so it never re-runs or leaks.
 */
export default function Reveal({ children, delay = 0, y = 1.5, className }: RevealProps) {
  const reduced = usePrefersReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (reduced) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  const style = useSpring({
    opacity: reduced || inView ? 1 : 0,
    transform: reduced || inView ? 'translateY(0rem)' : `translateY(${y}rem)`,
    delay,
    config: { tension: 210, friction: 24 },
  })

  if (reduced) return <div className={className}>{children}</div>
  return (
    <animated.div ref={ref} className={className} style={style}>
      {children}
    </animated.div>
  )
}
