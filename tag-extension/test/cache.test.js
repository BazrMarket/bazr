// Cache plus negative cache. Storage and the clock are injected, so every path runs without chrome.
//
// The negative cache ("this address is not a mint") matters more here than it looks.
// Most base58 strings on a timeline are not mints, and asking again on every scroll
// fills the anonymous 30 req/min budget with false positives -- real lookups get pushed out.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCacheStore } from '../src/background/cache.js';
import {
  CACHE_MAX_ENTRIES, CACHE_TTL_MS, NEGATIVE_TTL_MS, STORAGE_KEYS,
} from '../src/shared/constants.js';

/** Stand-in for chrome.storage.local. get takes either a string or an array. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    },
    async set(patch) { Object.assign(data, patch); },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key];
    },
  };
}

function setup(startAt = 1_000_000) {
  const storage = fakeStorage();
  let current = startAt;
  const cache = createCacheStore({ storage, now: () => current });
  return { storage, cache, advance: (ms) => { current += ms; } };
}

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// --- relic cache ------------------------------------------------------------

test('reads back what was put in, with its age alongside', async () => {
  const { cache, advance } = setup();
  await cache.putRelic(MINT, { mint: MINT, score: 51 });

  const fresh = await cache.getRelic(MINT);
  assert.equal(fresh.data.score, 51);
  assert.equal(fresh.ageMs, 0);

  advance(90_000);
  const later = await cache.getRelic(MINT);
  assert.equal(later.ageMs, 90_000);
});

test('past the TTL it counts as absent (stale never goes out dressed as fresh)', async () => {
  const { cache, advance } = setup();
  await cache.putRelic(MINT, { score: 51 });

  advance(CACHE_TTL_MS);
  assert.ok(await cache.getRelic(MINT), 'the boundary itself (exactly TTL) is still alive');

  advance(1);
  assert.equal(await cache.getRelic(MINT), null);
});

test('an unknown mint is null', async () => {
  const { cache } = setup();
  assert.equal(await cache.getRelic('nope'), null);
});

// --- negative cache ---------------------------------------------------------

test('an address judged not-a-mint is not asked about again for 24 hours', async () => {
  const { cache, advance } = setup();
  assert.equal(await cache.isKnownNotMint('abc'), false);

  await cache.markNotMint('abc');
  assert.equal(await cache.isKnownNotMint('abc'), true);

  advance(NEGATIVE_TTL_MS);
  assert.equal(await cache.isKnownNotMint('abc'), true, 'the boundary is still valid');

  advance(1);
  assert.equal(await cache.isKnownNotMint('abc'), false, 'past the TTL it has to be asked again');
});

test('the negative cache and the relic cache live under different storage keys', async () => {
  const { storage, cache } = setup();
  await cache.putRelic(MINT, { score: 1 });
  await cache.markNotMint('other');
  assert.ok(storage.data[STORAGE_KEYS.relicCache][MINT]);
  assert.ok(storage.data[STORAGE_KEYS.negativeCache].other);
  assert.equal(storage.data[STORAGE_KEYS.relicCache].other, undefined);
});

// --- ceiling and sweeping ---------------------------------------------------

test('over the ceiling the oldest entries go first (storage.local is 10MB)', async () => {
  const { storage, cache, advance } = setup();
  for (let i = 0; i < CACHE_MAX_ENTRIES + 25; i += 1) {
    await cache.putRelic(`mint-${String(i).padStart(4, '0')}`, { score: i });
    advance(1);
  }

  const kept = Object.keys(storage.data[STORAGE_KEYS.relicCache]);
  assert.equal(kept.length, CACHE_MAX_ENTRIES);
  assert.equal(kept.includes('mint-0000'), false, 'the oldest entry survived');
  assert.equal(kept.includes(`mint-${String(CACHE_MAX_ENTRIES + 24).padStart(4, '0')}`), true, 'the newest entry was dropped');
});

test('sweep clears only what expired (fresh entries stay)', async () => {
  const { storage, cache, advance } = setup();
  await cache.putRelic('old', { score: 1 });
  await cache.markNotMint('old-negative');

  advance(CACHE_TTL_MS + 1);
  await cache.putRelic('new', { score: 2 });

  const removed = await cache.sweep();
  assert.equal(removed, 1, 'only the one relic should have expired');
  assert.deepEqual(Object.keys(storage.data[STORAGE_KEYS.relicCache]), ['new']);
  assert.deepEqual(Object.keys(storage.data[STORAGE_KEYS.negativeCache]), ['old-negative'],
    'the negative cache runs 24 hours, so it has not expired yet');

  advance(NEGATIVE_TTL_MS);
  assert.equal(await cache.sweep(), 2, 'this time the relic and the negative entry expire together');
});

test('stats counts what is actually there, and clear wipes both', async () => {
  const { storage, cache } = setup();
  await cache.putRelic('a', {});
  await cache.putRelic('b', {});
  await cache.markNotMint('c');

  assert.deepEqual(await cache.stats(), { relicEntries: 2, negativeEntries: 1 });

  await cache.clear();
  assert.deepEqual(await cache.stats(), { relicEntries: 0, negativeEntries: 0 });
  assert.equal(storage.data[STORAGE_KEYS.relicCache], undefined);
  assert.equal(storage.data[STORAGE_KEYS.negativeCache], undefined);
});

// --- corrupted stored values ------------------------------------------------

test('a corrupted stored value is treated as an empty cache, not thrown', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.relicCache]: 'not an object',
    [STORAGE_KEYS.negativeCache]: 42,
  });
  const cache = createCacheStore({ storage, now: () => 0 });

  assert.equal(await cache.getRelic('a'), null);
  assert.equal(await cache.isKnownNotMint('a'), false);
  assert.deepEqual(await cache.stats(), { relicEntries: 0, negativeEntries: 0 });
});

test('an old entry with no timestamp counts as expired (nothing stays fresh forever)', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.relicCache]: { [MINT]: { data: { score: 9 } } },
  });
  const cache = createCacheStore({ storage, now: () => CACHE_TTL_MS + 1 });
  assert.equal(await cache.getRelic(MINT), null);
});
