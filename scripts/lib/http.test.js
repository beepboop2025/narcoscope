import { describe, expect, it, vi } from 'vitest'

import { fetchJsonWithRetry, fetchWithRetry } from './http.mjs'

const response = (status, payload = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(payload),
})

describe('fetchJsonWithRetry', () => {
  it('identifies the collector and requests JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true }))

    await expect(fetchJsonWithRetry('https://example.test/data', { fetchImpl }))
      .resolves.toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/data',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'User-Agent': expect.stringContaining('NarcoScope data collector'),
        }),
      }),
    )
  })

  it('retries transient HTTP responses with bounded exponential delays', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200, { recovered: true }))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(fetchJsonWithRetry('https://example.test/data', {
      attempts: 3,
      baseDelayMs: 10,
      fetchImpl,
      sleep,
    })).resolves.toEqual({ recovered: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[10], [20]])
  })

  it('fails closed immediately for permanent HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(403))
    const sleep = vi.fn()

    await expect(fetchJsonWithRetry('https://example.test/data', {
      fetchImpl,
      sleep,
    })).rejects.toThrow('HTTP 403 after 1 attempt(s)')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries transport errors and reports exhaustion', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection reset'))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(fetchJsonWithRetry('https://example.test/data', {
      attempts: 2,
      baseDelayMs: 5,
      fetchImpl,
      sleep,
    })).rejects.toThrow('request failed after 2 attempts: connection reset')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls).toEqual([[5]])
  })
})

describe('fetchWithRetry', () => {
  it('does not assume a response media type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200))

    await fetchWithRetry('https://example.test/data', { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/data',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Accept: expect.anything() }),
      }),
    )
  })

  it('returns successful binary responses with caller-specific accept headers', async () => {
    const archive = response(200)
    const fetchImpl = vi.fn().mockResolvedValue(archive)

    await expect(fetchWithRetry('https://example.test/table.zip', {
      fetchImpl,
      headers: { Accept: 'application/zip' },
    })).resolves.toBe(archive)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/table.zip',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/zip',
          'User-Agent': expect.stringContaining('NarcoScope data collector'),
        }),
      }),
    )
  })
})
