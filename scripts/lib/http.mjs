const DEFAULT_USER_AGENT =
  'NarcoScope data collector/0.1 (+https://github.com/beepboop2025/narcoscope)'

const RETRYABLE_STATUSES = new Set([408, 425, 429])

const isRetryableStatus = (status) =>
  RETRYABLE_STATUSES.has(status) || (status >= 500 && status <= 599)

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Fetch JSON from an official source with an explicit request identity and a
 * small retry budget for transport failures and transient HTTP responses.
 * Permanent HTTP failures still fail closed immediately.
 */
export async function fetchWithRetry(
  url,
  {
    attempts = 3,
    baseDelayMs = 500,
    fetchImpl = globalThis.fetch,
    sleep = wait,
    headers = {},
  } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError('attempts must be a positive integer')
  }

  const requestHeaders = {
    Accept: 'application/json',
    'User-Agent': DEFAULT_USER_AGENT,
    ...headers,
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, { headers: requestHeaders })
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`request failed after ${attempts} attempts: ${error.message}`, {
          cause: error,
        })
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1))
      continue
    }

    if (response.ok) return response

    if (!isRetryableStatus(response.status) || attempt === attempts) {
      throw new Error(`HTTP ${response.status} after ${attempt} attempt(s)`)
    }
    await sleep(baseDelayMs * 2 ** (attempt - 1))
  }

  throw new Error('request retry budget exhausted')
}

export async function fetchJsonWithRetry(url, options = {}) {
  const response = await fetchWithRetry(url, options)
  return response.json()
}
