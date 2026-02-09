/**
 * Fetch wrapper with timeout and structured error handling.
 */

const DEFAULT_TIMEOUT = 15_000;

export class FetchError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.url = url;
  }
}

/**
 * Fetch JSON with timeout.
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeout]  Timeout in ms (default 15s)
 * @param {object} [options.fetchOptions]  Options passed to fetch()
 * @returns {Promise<any>}
 */
export async function fetchJSON(url, { timeout = DEFAULT_TIMEOUT, fetchOptions = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new FetchError(
        `HTTP ${response.status}: ${response.statusText}`,
        { status: response.status, url }
      );
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new FetchError('Request timed out', { url });
    }
    if (err instanceof FetchError) throw err;
    throw new FetchError(err.message, { url });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST JSON (for GraphQL).
 */
export async function postJSON(url, body, { timeout = DEFAULT_TIMEOUT } = {}) {
  return fetchJSON(url, {
    timeout,
    fetchOptions: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
}
