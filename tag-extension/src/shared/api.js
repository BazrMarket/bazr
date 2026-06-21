// BAZR API client. docs/api-contract.md is the source of truth.
// No chrome.*, and the fetch implementation is injected -- that is what lets the Node smoke test
// drive this file unchanged.
//
// [security] Never put an API key in this file. Anyone can unzip an extension and read it.
// Per the contract, /relic/{mint} is anonymous and protected by rate limiting instead.

import { AXIS_ORDER, REQUEST_TIMEOUT_MS } from './constants.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, retryAfterMs = null, detail = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }

  /** A plain object that survives postMessage to a content script. Error is not structured-cloneable. */
  toPlain() {
    return {
      message: this.message,
      status: this.status,
      code: this.code,
      retryAfterMs: this.retryAfterMs,
      detail: this.detail,
    };
  }
}

/** Strips the trailing slash and checks the scheme is http or https. Throws on anything else. */
export function normalizeBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new ApiError('API base URL is empty.', { status: 0, code: 'bad_base_url' });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(`API base URL is not a valid URL: ${raw}`, { status: 0, code: 'bad_base_url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(`API base URL must be http or https: ${raw}`, { status: 0, code: 'bad_base_url' });
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * The Retry-After header in milliseconds. Both the seconds form and the HTTP-date form are legal.
 * @returns {number|null}
 */
export function parseRetryAfter(headerValue, now = Date.now()) {
  if (headerValue === null || headerValue === undefined) return null;
  const text = String(headerValue).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const when = Date.parse(text);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now);
}

/**
 * The contract always sends five axes. Defend anyway -- a missing axis is filled in as unknown,
 * and any axis whose status is not ok has its score flattened to null. Folding a missing value
 * into a zero would show every failed lookup as a dead token (api-contract.md warns about it).
 */
export function normalizeRelic(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const provided = Array.isArray(source.axes) ? source.axes : [];
  const byKey = new Map();
  for (const axis of provided) {
    if (axis && typeof axis.key === 'string') byKey.set(axis.key, axis);
  }

  const axes = AXIS_ORDER.map((key) => {
    const axis = byKey.get(key);
    if (!axis) return { key, label: null, blurb: null, score: null, status: 'unknown', weight: null, contribution: null, detail: null };
    const ok = axis.status === 'ok' && typeof axis.score === 'number' && !Number.isNaN(axis.score);
    return {
      key,
      label: typeof axis.label === 'string' ? axis.label : null,
      blurb: typeof axis.blurb === 'string' ? axis.blurb : null,
      score: ok ? axis.score : null,
      status: ok ? 'ok' : 'unknown',
      weight: typeof axis.weight === 'number' ? axis.weight : null,
      contribution: typeof axis.contribution === 'number' ? axis.contribution : null,
      detail: axis.detail && typeof axis.detail === 'object' ? axis.detail : null,
    };
  });

  // An axis outside the contract is appended, not dropped. Swallowing it would hide a backend change.
  for (const [key, axis] of byKey.entries()) {
    if (!AXIS_ORDER.includes(key)) {
      const ok = axis.status === 'ok' && typeof axis.score === 'number';
      axes.push({
        key,
        label: typeof axis.label === 'string' ? axis.label : null,
        blurb: typeof axis.blurb === 'string' ? axis.blurb : null,
        score: ok ? axis.score : null,
        status: ok ? 'ok' : 'unknown',
        weight: typeof axis.weight === 'number' ? axis.weight : null,
        contribution: typeof axis.contribution === 'number' ? axis.contribution : null,
        detail: axis.detail && typeof axis.detail === 'object' ? axis.detail : null,
      });
    }
  }

  const tags = (Array.isArray(source.tags) ? source.tags : []).map((tag) => ({
    key: typeof tag?.key === 'string' ? tag.key : '',
    label: typeof tag?.label === 'string' ? tag.label : (tag?.key || ''),
    severity: ['info', 'caution', 'alert'].includes(tag?.severity) ? tag.severity : 'info',
    observed: tag?.observed === true ? true : (tag?.observed === false ? false : null),
    confidence: ['high', 'medium', 'low'].includes(tag?.confidence) ? tag.confidence : null,
    evidence: tag?.evidence && typeof tag.evidence === 'object' ? tag.evidence : null,
  }));

  return {
    mint: typeof source.mint === 'string' ? source.mint : '',
    symbol: typeof source.symbol === 'string' ? source.symbol : null,
    name: typeof source.name === 'string' ? source.name : null,
    score: typeof source.score === 'number' && !Number.isNaN(source.score) ? source.score : null,
    verdict: typeof source.verdict === 'string' ? source.verdict : 'unclear',
    // The reason relic-spec sections 8-9 ship alongside the verdict. The three unclear cases are
    // different events; drop this and "high total, nothing to exit into" collapses into plain unclear.
    reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : null,
    axes,
    tags,
    graduated_at: typeof source.graduated_at === 'string' ? source.graduated_at : null,
    scored_at: typeof source.scored_at === 'string' ? source.scored_at : null,
    cache: source.cache && typeof source.cache === 'object' ? source.cache : null,
    sources: Array.isArray(source.sources) ? source.sources : [],
    disclaimer: typeof source.disclaimer === 'string' ? source.disclaimer : null,
  };
}

/**
 * @param {{ baseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number }} config
 */
export function createApiClient({ baseUrl, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new ApiError('No fetch implementation available.', { status: 0, code: 'no_fetch' });
  }

  async function request(path, { signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      throw new ApiError(
        aborted ? `Request timed out after ${timeoutMs}ms.` : `Network error: ${error?.message || error}`,
        { status: 0, code: aborted ? 'timeout' : 'network' },
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (response.status === 429) {
      throw new ApiError('Rate limited.', {
        status: 429,
        code: 'rate_limited',
        retryAfterMs: parseRetryAfter(response.headers?.get?.('Retry-After')),
      });
    }

    let payload = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new ApiError('API returned a non-JSON body.', { status: response.status, code: 'bad_json' });
        }
      }
    }

    if (!response.ok) {
      const err = payload?.error || {};
      throw new ApiError(err.message || `HTTP ${response.status}`, {
        status: response.status,
        code: err.code || null,
        detail: err.detail || null,
      });
    }
    return payload;
  }

  return {
    baseUrl: base,

    /** GET /relic/{mint} */
    async getRelic(mint, { refresh = false, signal } = {}) {
      const query = refresh ? '?refresh=true' : '';
      const payload = await request(`/relic/${encodeURIComponent(mint)}${query}`, { signal });
      return normalizeRelic(payload);
    },

    /** GET /relic/{mint}/tags */
    async getTags(mint, { signal } = {}) {
      const payload = await request(`/relic/${encodeURIComponent(mint)}/tags`, { signal });
      return Array.isArray(payload?.tags) ? payload.tags : [];
    },

    /** GET /health */
    async getHealth({ signal } = {}) {
      return request('/health', { signal });
    },
  };
}
