export type PalimpsestRelayStory = {
  id: string
  headline: string
  dek: string
  url: string
  priority: string
  status: string
  published_at: string
  metric: {
    label: string | null
    value: number | null
    unit: string | null
    denominator: { label: string | null; value: number | null }
  }
  limitations: string[]
}

export type PalimpsestRelay = PalimpsestRelayStory & {
  coverage: { total: number; live: number; status: string }
  generatedAt: string
  remote: boolean
}

export const PALIMPSEST_FALLBACK: PalimpsestRelay = {
  id: 'palimpsest-news:board-alarm',
  headline: 'Multiple layers elevated together in the latest board synthesis',
  dek: 'The latest Palimpsest board read sees content and network signals moving together. It reports co-movement, not a verdict about a single cause.',
  url: 'https://palimpsest.info/news/board-alarm/?ref=narcoscope_signal_relay',
  priority: 'lead',
  status: 'live',
  published_at: '2026-08-12T14:08:36Z',
  metric: {
    label: 'board e-value',
    value: 14.431,
    unit: 'e-value',
    denominator: { label: 'predeclared alarm threshold', value: 20 },
  },
  limitations: ['A merged e-value measures evidence against no change; it does not identify a common cause.'],
  coverage: { total: 33, live: 30, status: 'degraded' },
  generatedAt: '2026-08-12T18:07:56Z',
  remote: false,
}

/**
 * Editorial promotion policy for the sister publication.
 *
 * TODO(owner): this is the intentional 5–10 line customization seam. The
 * current rule favors a live lead, then any live story, then the first record.
 * It can instead prioritize a subject such as network interference or AI-model
 * refusal, but must never promote a non-live retained metric as current.
 */
export function selectPalimpsestRelayStory(stories: PalimpsestRelayStory[]): PalimpsestRelayStory | null {
  return stories.find((story) => story.status === 'live' && story.priority === 'lead')
    ?? stories.find((story) => story.status === 'live')
    ?? stories[0]
    ?? null
}
