// Concurrency ceiling plus a 429 backoff queue. No chrome.* (sleep and now are injected), so the
// unit tests drive it as is.
//
// Why it exists: one screen of a Twitter timeline can carry more than 20 mints. Fetching them
// straight through blows past the anonymous rate limit (30 req/min) into a 429 immediately, and
// retries stacking on top only make it worse.

import { ApiError } from '../shared/api.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ concurrency?: number, now?: () => number, sleep?: (ms:number)=>Promise<void>,
 *           maxRetries?: number, maxBackoffMs?: number }} options
 */
export function createRequestQueue(options = {}) {
  const {
    concurrency = 4,
    now = () => Date.now(),
    sleep = defaultSleep,
    maxRetries = 1,
    maxBackoffMs = 60_000,
  } = options;

  /** @type {Array<{ run: Function, resolve: Function, reject: Function, attempt: number }>} */
  const pending = [];
  let active = 0;
  let backoffUntil = 0;
  let draining = false;

  function backoffRemaining() {
    return Math.max(0, backoffUntil - now());
  }

  /** One 429 pauses the whole queue. Sleeping only that task would leave the rest hammering. */
  function applyBackoff(ms) {
    const wait = Math.min(Math.max(0, ms || 0), maxBackoffMs);
    const until = now() + wait;
    if (until > backoffUntil) backoffUntil = until;
    return wait;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (pending.length > 0 && active < concurrency) {
        const remaining = backoffRemaining();
        if (remaining > 0) {
          await sleep(remaining);
          continue;
        }
        const job = pending.shift();
        active += 1;
        void execute(job);
      }
    } finally {
      draining = false;
    }
  }

  async function execute(job) {
    try {
      const value = await job.run();
      job.resolve(value);
    } catch (error) {
      const is429 = error instanceof ApiError && error.status === 429;
      if (is429) {
        // With no Retry-After, fall back conservatively to the contract floor (anonymous 30 req/min).
        applyBackoff(error.retryAfterMs ?? 2000);
      }
      if (is429 && job.attempt < maxRetries) {
        job.attempt += 1;
        pending.unshift(job);
      } else {
        job.reject(error);
      }
    } finally {
      active -= 1;
      void drain();
    }
  }

  return {
    /**
     * @template T
     * @param {() => Promise<T>} run
     * @returns {Promise<T>}
     */
    push(run) {
      return new Promise((resolve, reject) => {
        pending.push({ run, resolve, reject, attempt: 0 });
        void drain();
      });
    },
    size: () => pending.length,
    inFlight: () => active,
    backoffRemaining,
    /** For tests and diagnostics -- forces a backoff from outside. */
    applyBackoff,
  };
}
