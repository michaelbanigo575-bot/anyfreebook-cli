/**
 * HTTP client for the ANYFREEBOOK public API (v1).
 *
 * Zero dependencies: Node's global fetch plus AbortSignal.timeout().
 * Every failure mode is converted into a CliError so the caller never has to
 * deal with a raw network exception.
 */

import { apiError, networkError } from './errors.js';
import { USER_AGENT } from './config.js';

export class ApiClient {
  constructor({ base, apiKey = '', timeoutMs = 20000, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('No fetch implementation available. Node 18 or newer is required.');
    }
    this.base = String(base || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /** Headers for every API request. The API key is only sent when present. */
  headers() {
    const headers = {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  buildUrl(pathname, params = {}) {
    const url = new URL(`${this.base}/${String(pathname).replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  /** Perform a GET request and return the decoded JSON body. */
  async request(pathname, params = {}) {
    const url = this.buildUrl(pathname, params);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw this.#networkFailure(err, url);
    }

    let text = '';
    try {
      text = await response.text();
    } catch (err) {
      throw networkError(`The connection to ${this.base} broke while reading the response.`, {
        code: 'network',
        hint: 'Try again, or increase the timeout with --timeout <ms>.',
      });
    }

    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) throw this.#httpFailure(response, data, text);

    if (data === null) {
      throw apiError(`The API returned a non-JSON response (HTTP ${response.status}).`, {
        status: response.status,
        hint: 'Check that --api-base points at an ANYFREEBOOK API v1 base URL.',
      });
    }

    return data;
  }

  /** GET /search */
  async search({ q, page = 1, source = 'all', limit = 20 } = {}) {
    return this.request('search', { q, page, source, limit });
  }

  /** GET /resolve */
  async resolve({ title, author } = {}) {
    return this.request('resolve', { title, author });
  }

  /** GET /health */
  async health() {
    return this.request('health');
  }

  /** GET /sources — the registry of what the API searches. */
  async sources() {
    return this.request('sources');
  }

  #networkFailure(err, url) {
    const name = err && err.name ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return networkError(`Request to ${url.host} timed out after ${this.timeoutMs} ms.`, {
        code: 'timeout',
        hint: 'Raise the timeout with --timeout <ms>, or check that the API is responding.',
      });
    }
    const cause = (err && (err.cause || err)) || {};
    const code = cause.code ? ` (${cause.code})` : '';
    return networkError(`Could not reach the ANYFREEBOOK API at ${this.base}${code}.`, {
      code: 'network',
      hint:
        'Check your internet connection. If the API runs elsewhere, point the CLI at it with ' +
        '--api-base <url> or the ANYFREEBOOK_API_BASE environment variable.',
    });
  }

  #httpFailure(response, data, text) {
    const status = response.status;
    const serverMessage =
      (data && typeof data === 'object' && typeof data.error === 'string' && data.error) ||
      (data && typeof data === 'object' && typeof data.message === 'string' && data.message) ||
      '';

    if (status === 401) {
      return apiError('The API rejected the request as unauthorized (HTTP 401).', {
        status,
        code: 'unauthorized',
        hint:
          'Set ANYFREEBOOK_API_KEY=<your-key> or pass --api-key <your-key>. ' +
          'No key is needed for the anonymous tier, so try again without one; ' +
          'use --json if you want the failure as JSON.',
      });
    }

    if (status === 429) {
      const retryAfter = parseRetryAfter(response.headers && response.headers.get('retry-after'));
      const seconds = retryAfter === null ? 'a short while' : `${retryAfter} second${retryAfter === 1 ? '' : 's'}`;
      return apiError(`Rate limited by the API (HTTP 429). Retry after ${seconds}.`, {
        status,
        code: 'rate_limited',
        exitCode: 2,
        retryAfter,
        hint: 'Slow down and retry shortly.',
      });
    }

    if (status === 400) {
      return apiError(serverMessage || 'The API rejected the request (HTTP 400).', {
        status,
        code: 'bad_request',
      });
    }

    if (status === 404) {
      return apiError(serverMessage || 'The API has no such endpoint (HTTP 404).', {
        status,
        code: 'not_found',
        hint: 'Check --api-base; the public base URL is https://anyfreebook.com/api/v1.',
      });
    }

    if (status >= 500) {
      return apiError(
        serverMessage || `The API failed to handle the request (HTTP ${status}).`,
        { status, code: 'server_error', hint: 'This is a problem on the API side. Try again shortly.' },
      );
    }

    return apiError(serverMessage || `Unexpected API response (HTTP ${status}).`, {
      status,
      code: 'http_error',
      ...(text ? {} : {}),
    });
  }
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }
  return null;
}
