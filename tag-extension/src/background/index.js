// MV3 service worker. The single network path for the content script, the popup, and the options page.
//
// Why every fetch happens here:
//   1) calling from a content script runs into the host page's CORS policy
//   2) one cache and one queue in one place stop the same mint being hit dozens of times a scroll
// [careful] The service worker is torn down after roughly 30 seconds idle. Keep no state in globals.
//           The globals below are all things that may die freely: the queue, the client instance.

import { createApiClient, ApiError } from '../shared/api.js';
import { MSG, MAX_CONCURRENCY, RECENT_LIMIT, STORAGE_KEYS } from '../shared/constants.js';
import { readSettings, writeSettings } from '../shared/settings.js';
import { createCacheStore } from './cache.js';
import { createRequestQueue } from './queue.js';

const queue = createRequestQueue({ concurrency: MAX_CONCURRENCY });
const cache = createCacheStore({ storage: chrome.storage.local });

let clientCache = { baseUrl: null, client: null };

async function getClient() {
  const settings = await readSettings();
  if (clientCache.client && clientCache.baseUrl === settings.apiBase) return clientCache.client;
  const client = createApiClient({ baseUrl: settings.apiBase });
  clientCache = { baseUrl: settings.apiBase, client };
  return client;
}

/**
 * Looks up one mint. Success is itself the confirmation that the address really is a mint.
 * @returns {Promise<{ ok: true, relic: object, cached: boolean, ageMs: number }
 *                 | { ok: false, notMint: true }
 *                 | { ok: false, error: object }>}
 */
async function fetchRelic(mint, { refresh = false } = {}) {
  if (!refresh) {
    if (await cache.isKnownNotMint(mint)) return { ok: false, notMint: true };
    const hit = await cache.getRelic(mint);
    if (hit) return { ok: true, relic: hit.data, cached: true, ageMs: hit.ageMs };
  }

  try {
    const client = await getClient();
    const relic = await queue.push(() => client.getRelic(mint, { refresh }));
    await cache.putRelic(mint, relic);
    return { ok: true, relic, cached: false, ageMs: 0 };
  } catch (error) {
    const plain = error instanceof ApiError ? error.toPlain() : { message: String(error?.message || error), status: 0 };
    // A 404, or a not-a-mint code from the contract, means this address is not a mint. It goes
    // into the 24 hour negative cache so a scroll does not re-ask about the same string.
    if (plain.status === 404 || plain.code === 'unknown_mint' || plain.code === 'not_a_mint') {
      await cache.markNotMint(mint);
      return { ok: false, notMint: true };
    }
    return { ok: false, error: plain };
  }
}

/** Several candidates at once. The queue is what holds the concurrency ceiling. */
async function resolveMints(mints) {
  const unique = [...new Set((Array.isArray(mints) ? mints : []).filter((m) => typeof m === 'string'))];
  const entries = await Promise.all(unique.map(async (mint) => [mint, await fetchRelic(mint)]));
  return Object.fromEntries(entries);
}

async function pushRecent(mint, relic) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.recent);
  const list = Array.isArray(stored?.[STORAGE_KEYS.recent]) ? stored[STORAGE_KEYS.recent] : [];
  const next = [
    { mint, symbol: relic?.symbol || null, score: relic?.score ?? null, verdict: relic?.verdict || null, ts: Date.now() },
    ...list.filter((item) => item?.mint !== mint),
  ].slice(0, RECENT_LIMIT);
  await chrome.storage.local.set({ [STORAGE_KEYS.recent]: next });
  return next;
}

async function getRecent() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.recent);
  return Array.isArray(stored?.[STORAGE_KEYS.recent]) ? stored[STORAGE_KEYS.recent] : [];
}

async function checkHealth() {
  try {
    const client = await getClient();
    const payload = await client.getHealth();
    return { ok: true, baseUrl: client.baseUrl, health: payload };
  } catch (error) {
    const plain = error instanceof ApiError ? error.toPlain() : { message: String(error?.message || error), status: 0 };
    return { ok: false, baseUrl: clientCache.baseUrl, error: plain };
  }
}

// --- Message router. An async reply must always return true. -----------------

const handlers = {
  async [MSG.RELIC](message) {
    const result = await fetchRelic(message.mint, { refresh: message.refresh === true });
    if (result.ok && message.remember === true) await pushRecent(message.mint, result.relic);
    return result;
  },
  async [MSG.RESOLVE](message) {
    return { results: await resolveMints(message.mints) };
  },
  async [MSG.SETTINGS_GET]() {
    return { settings: await readSettings() };
  },
  async [MSG.SETTINGS_SET](message) {
    const settings = await writeSettings(message.patch || {});
    clientCache = { baseUrl: null, client: null }; // the base may have changed
    return { settings };
  },
  async [MSG.CACHE_CLEAR]() {
    await cache.clear();
    return { cleared: true, ...(await cache.stats()) };
  },
  async [MSG.CACHE_STATS]() {
    return cache.stats();
  },
  async [MSG.RECENT_GET]() {
    return { recent: await getRecent() };
  },
  async [MSG.HEALTH]() {
    return checkHealth();
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: { message: `Unknown message type: ${message?.type}`, status: 0 } });
    return false;
  }
  handler(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: { message: String(error?.message || error), status: 0 } }));
  return true; // async reply -- leave this out and the channel closes before the answer arrives
});

chrome.runtime.onInstalled.addListener(() => {
  // Actually write the defaults out, so the options page never reads an empty value and breaks.
  void writeSettings({}).catch(() => {});
  setupAlarms();
});

chrome.runtime.onStartup?.addListener(setupAlarms);

function setupAlarms() {
  // setInterval dies with the service worker. Only alarms can wake it back up.
  chrome.alarms.create('bazrCacheSweep', { periodInMinutes: 30 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bazrCacheSweep') void cache.sweep().catch(() => {});
});

self.addEventListener('error', (event) => {
  console.error('[BAZR Tag] service worker error:', event.error);
});
self.addEventListener('unhandledrejection', (event) => {
  console.error('[BAZR Tag] unhandled rejection:', event.reason);
  event.preventDefault();
});
