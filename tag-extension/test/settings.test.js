// Settings merge and save. chrome.storage.local is the source of truth; here it is injected.
//
// Get the merge rules wrong and it breaks quietly, in the way that hurts -- add a new site and
// existing users see it switched off, or a site a user turned off comes back on with every update.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILTIN_API_ORIGINS, DEFAULT_API_BASE, DEFAULT_SETTINGS, DEV_API_BASE, STORAGE_KEYS,
  SUPPORTED_SITES,
} from '../src/shared/constants.js';
import {
  mergeSettings, needsOptionalPermission, originPattern, readSettings, writeSettings,
} from '../src/shared/settings.js';

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
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key]; },
  };
}

// --- defaults ---------------------------------------------------------------

test('defaults: production API, auto overlay on, every site allowed', () => {
  assert.equal(DEFAULT_SETTINGS.apiBase, DEFAULT_API_BASE);
  assert.equal(DEFAULT_SETTINGS.autoOverlay, true);
  for (const site of SUPPORTED_SITES) {
    assert.equal(DEFAULT_SETTINGS.siteEnabled[site.id], true, `${site.id} does not default to on`);
  }
});

test('mergeSettings: nothing stored gives the defaults', () => {
  const merged = mergeSettings(undefined);
  assert.equal(merged.apiBase, DEFAULT_API_BASE);
  assert.equal(merged.autoOverlay, true);
  assert.equal(Object.keys(merged.siteEnabled).length, SUPPORTED_SITES.length);
});

test('mergeSettings: a newly added site is filled in as allowed', () => {
  // The old stored value only knows one site. Leave the rest undefined and new sites never switch on.
  const merged = mergeSettings({ siteEnabled: { dexscreener: false } });
  assert.equal(merged.siteEnabled.dexscreener, false, 'what the user turned off has to stay off');
  for (const site of SUPPORTED_SITES) {
    if (site.id === 'dexscreener') continue;
    assert.equal(merged.siteEnabled[site.id], true, `${site.id} was not filled in`);
  }
});

test('mergeSettings: only false counts as off (missing or odd values stay on)', () => {
  assert.equal(mergeSettings({ autoOverlay: false }).autoOverlay, false);
  assert.equal(mergeSettings({ autoOverlay: 0 }).autoOverlay, true);
  assert.equal(mergeSettings({ autoOverlay: undefined }).autoOverlay, true);
  assert.equal(mergeSettings({ siteEnabled: { x: 0 } }).siteEnabled.x, true);
});

test('mergeSettings: an empty apiBase falls back to the default (storing "" fails every lookup)', () => {
  assert.equal(mergeSettings({ apiBase: '' }).apiBase, DEFAULT_API_BASE);
  assert.equal(mergeSettings({ apiBase: '   ' }).apiBase, DEFAULT_API_BASE);
  assert.equal(mergeSettings({ apiBase: 42 }).apiBase, DEFAULT_API_BASE);
  assert.equal(mergeSettings({ apiBase: '  http://localhost:8030  ' }).apiBase, DEV_API_BASE);
});

test('mergeSettings: keys outside the contract do not survive into the result', () => {
  const merged = mergeSettings({ apiKey: 'should-not-survive', nonsense: 1 });
  assert.deepEqual(Object.keys(merged).sort(), ['apiBase', 'autoOverlay', 'siteEnabled']);
});

// --- read and write ---------------------------------------------------------

test('readSettings: returns a complete settings object even with nothing stored', async () => {
  const settings = await readSettings(fakeStorage());
  assert.equal(settings.apiBase, DEFAULT_API_BASE);
  assert.equal(Object.keys(settings.siteEnabled).length, SUPPORTED_SITES.length);
});

test('writeSettings: changes only the patch and leaves the rest alone', async () => {
  const storage = fakeStorage();
  await writeSettings({ autoOverlay: false }, storage);
  const next = await writeSettings({ apiBase: DEV_API_BASE }, storage);

  assert.equal(next.apiBase, DEV_API_BASE);
  assert.equal(next.autoOverlay, false, 'a setting turned off earlier got overwritten');
  assert.equal(storage.data[STORAGE_KEYS.settings].apiBase, DEV_API_BASE);
});

test('writeSettings: a bad URL throws before it is stored (never break after saving)', async () => {
  const storage = fakeStorage();
  await writeSettings({ apiBase: DEV_API_BASE }, storage);

  await assert.rejects(writeSettings({ apiBase: 'ftp://api.example.test' }, storage));
  await assert.rejects(writeSettings({ apiBase: 'javascript:alert(1)' }, storage));
  await assert.rejects(writeSettings({ apiBase: 'not a url' }, storage));

  assert.equal(
    storage.data[STORAGE_KEYS.settings].apiBase, DEV_API_BASE,
    'validation failed yet the stored value changed',
  );
});

test('writeSettings: the site toggles are replaced wholesale', async () => {
  const storage = fakeStorage();
  const off = {};
  for (const site of SUPPORTED_SITES) off[site.id] = false;

  const next = await writeSettings({ siteEnabled: off }, storage);
  assert.equal(Object.values(next.siteEnabled).every((v) => v === false), true);
});

// --- permissions ------------------------------------------------------------

test('needsOptionalPermission: origins declared statically in the manifest need nothing extra', () => {
  for (const origin of BUILTIN_API_ORIGINS) {
    assert.equal(needsOptionalPermission(origin), false, `${origin} triggered a permission request`);
  }
  assert.equal(needsOptionalPermission(`${DEFAULT_API_BASE}/`), false, 'a trailing slash must not change the verdict');
  assert.equal(needsOptionalPermission('http://localhost:8030/v1'), false, 'a path does not change the origin');
});

test('needsOptionalPermission: every other origin needs permission', () => {
  assert.equal(needsOptionalPermission('https://relics.example.com'), true);
  assert.equal(needsOptionalPermission('http://localhost:9999'), true, 'a different port is a different origin');
  assert.equal(
    needsOptionalPermission(`${new URL(DEFAULT_API_BASE).host}.evil.com`.replace(/^/, 'https://')),
    true,
    'a suffix match must not get through',
  );
});

test('needsOptionalPermission: an unreadable value raises no permission request (saving blocks it first)', () => {
  assert.equal(needsOptionalPermission('nonsense'), false);
  assert.equal(needsOptionalPermission(''), false);
});

test('originPattern: builds the shape chrome.permissions accepts', () => {
  assert.equal(originPattern('https://relics.example.com/v1/'), 'https://relics.example.com/*');
  assert.equal(originPattern('http://localhost:9999'), 'http://localhost:9999/*');
});

// --- no keys live in the extension bundle -----------------------------------

test('the settings schema has no slot for an API key -- anyone can open an extension bundle', () => {
  const keys = Object.keys(DEFAULT_SETTINGS);
  for (const forbidden of ['apiKey', 'token', 'secret', 'authorization', 'bearer']) {
    assert.equal(keys.some((k) => k.toLowerCase().includes(forbidden)), false, `a ${forbidden} slot appeared`);
  }
});
