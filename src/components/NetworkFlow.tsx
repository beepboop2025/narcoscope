import { Fragment, useState } from 'react'
import { usePrefersReducedMotion } from '../motion/usePrefersReducedMotion'

/** An illustration of product connections; the research charts carry data. */
export default function NetworkFlow() {
  const reduced = usePrefersReducedMotion()
  const [paused, setPaused] = useState(false)
  return <div className="family-flow" data-paused={String(paused || reduced)}>
    <svg viewBox="0 0 640 180" role="img" aria-label="Illustration of connected economic research">
      {[0, 1, 2].flatMap(channel => Array.from({ length: 7 }, (_, index) => {
        const start = 28 + channel * 58 + (index - 3) * 4
        const middle = 89 + (index - 3) * 4
        const end = 28 + ((channel + 1) % 3) * 58 + (index - 3) * 4
        const d = `M0 ${start} C130 ${start},180 ${middle},320 ${middle} S500 ${end},640 ${end}`
        return <Fragment key={`${channel}-${index}`}><path d={d} /><path d={d} className="family-flow-current" pathLength={100} style={{ animationDelay: `${(index + channel * 3) * -.71}s` }} /></Fragment>
      }))}
      <rect x="245" y="57" width="150" height="65" rx="32" />
      <text x="320" y="86" textAnchor="middle">NarcoScope</text>
      <text className="family-flow-caption" x="320" y="104" textAnchor="middle">Connected research</text>
    </svg>
    <div className="family-flow-controls"><span>Published records · Sources · Context</span>
      <button type="button" disabled={reduced} aria-pressed={paused || reduced} onClick={() => setPaused(value => !value)}>
        {reduced ? 'Reduced motion' : paused ? 'Play motion' : 'Pause motion'}
      </button>
    </div>
  </div>
}
