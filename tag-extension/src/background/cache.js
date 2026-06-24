// Per-mint response cache plus a negative cache of "not a mint". Storage is injected
// (chrome.storage.local).
//
// Why the negative cache: most base58 strings on a Twitter timeline are not mints. Re-asking about
// an address already ruled out, on every scroll, spends the entire rate limit on known non-answers.

import {
  CACHE_MAX_ENTRIES, CACHE_TTL_MS, NEGATIVE_TTL_MS, STORAGE_KEYS,
} from '../shared/constants.js';

/**
 * @param {{ storage: { get: Function, set: Function, remove: Function }, now?: () => number }} options
 */
export function createCacheStore({ storage, now = () => Date.now() }) {
  async function readMap(key) {
    const result = await storage.get(key);
    const value = result?.[key];
    return value && typeof value === 'object' ? value : {};
  }

  /** Drops oldest first to stay under CACHE_MAX_ENTRIES. storage.local only gives us 10MB. */
  function trim(map) {
    const keys = Object.keys(map);
    if (keys.length <= CACHE_MAX_ENTRIES) return map;
    keys.sort((a, b) => (map[a]?.ts || 0) - (map[b]?.ts || 0));
    for (const key of keys.slice(0, keys.length - CACHE_MAX_ENTRIES)) delete map[key];
    return map;
  }

  return {
    /** @returns {Promise<{ data: object, ageMs: number }|null>} */
    async getRelic(mint) {
      const map = await readMap(STORAGE_KEYS.relicCache);
      const entry = map[mint];
      if (!entry) return null;
      const ageMs = now() - (entry.ts || 0);
      if (ageMs > CACHE_TTL_MS) return null;
      return { data: entry.data, ageMs };
    },

    async putRelic(mint, data) {
      const map = await readMap(STORAGE_KEYS.relicCache);
      map[mint] = { data, ts: now() };
      await storage.set({ [STORAGE_KEYS.relicCache]: trim(map) });
    },

    async isKnownNotMint(address) {
      const map = await readMap(STORAGE_KEYS.negativeCache);
      const entry = map[address];
      if (!entry) return false;
      return now() - (entry.ts || 0) <= NEGATIVE_TTL_MS;
    },

    async markNotMint(address) {
      const map = await readMap(STORAGE_KEYS.negativeCache);
      map[address] = { ts: now() };
      await storage.set({ [STORAGE_KEYS.negativeCache]: trim(map) });
    },

    /** Sweeps expired entries only. Run periodically from chrome.alarms. */
    async sweep() {
      const relic = await readMap(STORAGE_KEYS.relicCache);
      const negative = await readMap(STORAGE_KEYS.negativeCache);
      const current = now();
      let removed = 0;
      for (const [key, entry] of Object.entries(relic)) {
        if (current - (entry?.ts || 0) > CACHE_TTL_MS) { delete relic[key]; removed += 1; }
      }
      for (const [key, entry] of Object.entries(negative)) {
        if (current - (entry?.ts || 0) > NEGATIVE_TTL_MS) { delete negative[key]; removed += 1; }
      }
      await storage.set({
        [STORAGE_KEYS.relicCache]: trim(relic),
        [STORAGE_KEYS.negativeCache]: trim(negative),
      });
      return removed;
    },

    async stats() {
      const relic = await readMap(STORAGE_KEYS.relicCache);
      const negative = await readMap(STORAGE_KEYS.negativeCache);
      return { relicEntries: Object.keys(relic).length, negativeEntries: Object.keys(negative).length };
    },

    async clear() {
      await storage.remove([STORAGE_KEYS.relicCache, STORAGE_KEYS.negativeCache]);
    },
  };
}
