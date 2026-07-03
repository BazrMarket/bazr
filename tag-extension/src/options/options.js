// BAZR Tag -- options page logic.
//
// Only four things change here: the API base, the automatic overlay on/off, which sites may be
// scanned, and clearing the cache. chrome.storage.local is the source of truth for all four, and
// this page is a thin layer over it (the service worker dies after roughly 30 seconds idle, so
// neither side trusts a global).
//
// [security] Never add an API key field to this page. Anyone can unzip an extension and read it,
//            and storage.local is plaintext to anything in the same profile. /relic/{mint} is an
//            anonymous contract.

import {
  DEFAULT_API_BASE, DEV_API_BASE, FONT_STACK, MSG, PALETTE, SUPPORTED_SITES,
} from '../shared/constants.js';
import { describeError } from '../shared/format.js';
import { needsOptionalPermission, originPattern } from '../shared/settings.js';
import { normalizeBaseUrl } from '../shared/api.js';
import { FALLBACK_DISCLAIMER } from '../shared/render.js';

// --- Design token injection --------------------------------------------------
// options.css only references --bz-*. constants.js is the single source of those values.

const TOKENS = {
  '--bz-asphalt': PALETTE.asphalt,
  '--bz-tarp': PALETTE.tarpBlue,
  '--bz-red': PALETTE.tagRed,
  '--bz-cardboard': PALETTE.cardboard,
  '--bz-grass': PALETTE.grass,
  '--bz-cream': PALETTE.labelCream,
  '--bz-shade': PALETTE.shadeGray,
  '--bz-dust': PALETTE.dustYellow,
  '--bz-font-display': FONT_STACK.display,
  '--bz-font-body': FONT_STACK.body,
  '--bz-font-mono': FONT_STACK.mono,
};

for (const [name, value] of Object.entries(TOKENS)) {
  document.documentElement.style.setProperty(name, value);
}

// --- State for this window ---------------------------------------------------

/** The settings as last read. Every save overwrites this with what the background returns. */
let settings = null;

const el = (id) => document.getElementById(id);

/**
 * Sends a message to the background. Failures come back in the contract's own shape
 * ({ ok:false, error }) so callers have one path -- swallow them and the page silently does nothing.
 */
async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (response === undefined) {
      return { ok: false, error: { message: 'The BAZR Tag service worker did not answer.', status: 0 } };
    }
    return response;
  } catch (error) {
    return { ok: false, error: { message: String(error?.message || error), status: 0 } };
  }
}

function showNotice(text, kind = 'info') {
  const node = el('notice');
  if (!text) {
    node.textContent = '';
    node.hidden = true;
    return;
  }
  node.textContent = text;
  node.dataset.kind = kind;
  node.hidden = false;
}

// --- Saving settings ---------------------------------------------------------

/**
 * Sends a patch to the background to be saved. On failure the screen is rolled back to the
 * pre-save values -- otherwise the toggle reads on while the setting is actually off.
 * @returns {Promise<boolean>} whether the save succeeded
 */
async function saveSettings(patch, { successText = 'Saved.', successKind = 'ok' } = {}) {
  const response = await send({ type: MSG.SETTINGS_SET, patch });
  if (response?.settings) {
    settings = response.settings;
    renderSettings();
    if (successText) showNotice(successText, successKind);
    return true;
  }
  showNotice(`Could not save: ${describeError(response?.error)}`, 'error');
  renderSettings(); // put the screen back to what is stored, i.e. the previous value
  return false;
}

// --- Rendering ---------------------------------------------------------------

function renderSettings() {
  if (!settings) return;

  el('api-base').value = settings.apiBase;
  el('api-base').setAttribute('aria-invalid', 'false');

  const auto = settings.autoOverlay !== false;
  el('auto-overlay').checked = auto;
  el('auto-overlay-note').textContent = auto
    ? 'Scans the pages allowed below.'
    : 'Off. No page is scanned and no address leaves this browser unless you use the popup.';

  for (const site of SUPPORTED_SITES) {
    const input = document.getElementById(`site-${site.id}`);
    if (input) {
      input.checked = settings.siteEnabled?.[site.id] !== false;
      input.disabled = !auto;
    }
  }

  const enabledCount = SUPPORTED_SITES.filter((s) => settings.siteEnabled?.[s.id] !== false).length;
  el('sites-all').disabled = !auto || enabledCount === SUPPORTED_SITES.length;
  el('sites-none').disabled = !auto || enabledCount === 0;
}

/** The site list is built from SUPPORTED_SITES. Hardcoding it in HTML would split that in two. */
function buildSiteList() {
  const list = el('site-list');
  list.replaceChildren();

  for (const site of SUPPORTED_SITES) {
    const li = document.createElement('li');
    li.className = 'bz-siteRow';

    const label = document.createElement('label');
    label.className = 'bz-switch';
    label.setAttribute('for', `site-${site.id}`);

    const input = document.createElement('input');
    input.className = 'bz-switchInput';
    input.type = 'checkbox';
    input.id = `site-${site.id}`;
    input.dataset.siteId = site.id;

    const track = document.createElement('span');
    track.className = 'bz-switchTrack';
    track.setAttribute('aria-hidden', 'true');
    const knob = document.createElement('span');
    knob.className = 'bz-switchKnob';
    track.appendChild(knob);

    const text = document.createElement('span');
    text.className = 'bz-siteText';
    const name = document.createElement('span');
    name.className = 'bz-siteName';
    name.textContent = site.label;
    const host = document.createElement('span');
    host.className = 'bz-siteHost';
    host.textContent = site.host;
    text.append(name, host);

    label.append(input, track, text);
    li.appendChild(label);
    list.appendChild(li);

    input.addEventListener('change', () => {
      void onSiteToggle(site, input);
    });
  }
}

// --- Actions -----------------------------------------------------------------

async function onSiteToggle(site, input) {
  const next = { ...(settings?.siteEnabled || {}), [site.id]: input.checked };
  await saveSettings(
    { siteEnabled: next },
    { successText: `${site.label} is now ${input.checked ? 'allowed' : 'not scanned'}.` },
  );
}

async function onSetAllSites(enabled) {
  const next = {};
  for (const site of SUPPORTED_SITES) next[site.id] = enabled;
  await saveSettings(
    { siteEnabled: next },
    { successText: enabled ? 'All sites allowed.' : 'No site will be scanned.' },
  );
}

async function onAutoOverlayToggle() {
  const enabled = el('auto-overlay').checked;
  await saveSettings(
    { autoOverlay: enabled },
    {
      successText: enabled
        ? 'Automatic overlay is on. Reload an open tab to start tagging it.'
        : 'Automatic overlay is off. Existing tags disappear on the next page update.',
    },
  );
}

/**
 * Saves the API base. The order matters --
 *   1) validate locally (a malformed value is never saved at all)
 *   2) for an origin outside the manifest, ask for permission first (the request only goes
 *      through inside a click gesture)
 *   3) then save
 * Do it the other way round and you end up saved but unable to send a single request.
 */
async function onSaveApiBase(event) {
  event.preventDefault();
  const input = el('api-base');
  const raw = input.value;

  let normalized;
  try {
    normalized = normalizeBaseUrl(raw);
  } catch (error) {
    input.setAttribute('aria-invalid', 'true');
    showNotice(describeError(error), 'error');
    return;
  }
  input.setAttribute('aria-invalid', 'false');

  if (needsOptionalPermission(normalized)) {
    const pattern = originPattern(normalized);
    if (!normalized.startsWith('https://')) {
      showNotice(
        `${pattern} is not covered by this extension and Chrome only grants optional access to https origins.`
        + ' Use https, or one of the two presets.',
        'error',
      );
      return;
    }
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [pattern] });
    } catch (error) {
      showNotice(`Chrome refused the permission request for ${pattern}: ${String(error?.message || error)}`, 'error');
      return;
    }
    if (!granted) {
      showNotice(`Not saved. Without access to ${pattern} every lookup would fail before it left the browser.`, 'warn');
      return;
    }
  }

  const saved = await saveSettings({ apiBase: normalized }, { successText: `API base saved: ${normalized}` });
  if (saved) await loadHealth();
}

async function onPreset(base) {
  el('api-base').value = base;
  const saved = await saveSettings({ apiBase: base }, { successText: `API base saved: ${base}` });
  if (saved) await loadHealth();
}

async function loadHealth() {
  el('health-dot').dataset.state = 'checking';
  el('health-text').textContent = 'Checking the API...';

  const response = await send({ type: MSG.HEALTH });
  const base = response?.baseUrl || settings?.apiBase || 'unknown API base';

  if (response?.ok === true) {
    const health = response.health && typeof response.health === 'object' ? response.health : {};
    const state = typeof health.status === 'string' ? health.status : 'reachable';
    const version = typeof health.version === 'string' ? ` / api ${health.version}` : '';
    el('health-dot').dataset.state = 'ok';
    el('health-text').textContent = `${base} -- ${state}${version}`;
    return;
  }

  el('health-dot').dataset.state = 'down';
  el('health-text').textContent = `API unreachable: ${describeError(response?.error)} (${base})`;
}

function renderCacheStats(stats) {
  el('cache-relic').textContent = typeof stats?.relicEntries === 'number' ? String(stats.relicEntries) : '--';
  el('cache-negative').textContent = typeof stats?.negativeEntries === 'number' ? String(stats.negativeEntries) : '--';
}

async function loadCacheStats() {
  const response = await send({ type: MSG.CACHE_STATS });
  if (typeof response?.relicEntries === 'number') {
    renderCacheStats(response);
    return;
  }
  renderCacheStats(null);
  showNotice(`Could not read the cache: ${describeError(response?.error)}`, 'error');
}

async function onClearCache() {
  const button = el('cache-clear');
  button.disabled = true;
  const response = await send({ type: MSG.CACHE_CLEAR });
  button.disabled = false;

  if (response?.cleared === true) {
    renderCacheStats(response);
    showNotice('Cache cleared. The next lookup asks the API again.', 'ok');
    return;
  }
  showNotice(`Could not clear the cache: ${describeError(response?.error)}`, 'error');
}

// --- Events ------------------------------------------------------------------

function bindEvents() {
  el('api-form').addEventListener('submit', (event) => { void onSaveApiBase(event); });
  el('preset-prod').addEventListener('click', () => { void onPreset(DEFAULT_API_BASE); });
  el('preset-dev').addEventListener('click', () => { void onPreset(DEV_API_BASE); });
  el('api-test').addEventListener('click', () => { void loadHealth(); });

  el('auto-overlay').addEventListener('change', () => { void onAutoOverlayToggle(); });
  el('sites-all').addEventListener('click', () => { void onSetAllSites(true); });
  el('sites-none').addEventListener('click', () => { void onSetAllSites(false); });

  el('cache-clear').addEventListener('click', () => { void onClearCache(); });
  el('cache-refresh').addEventListener('click', () => { void loadCacheStats(); });

  // When another window (the popup, say) changes a setting, this page follows. The two must agree.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings?.newValue) return;
    settings = changes.settings.newValue;
    renderSettings();
  });
}

// --- Boot --------------------------------------------------------------------

async function init() {
  const manifest = chrome.runtime.getManifest?.();
  if (manifest?.version) el('version').textContent = `v${manifest.version}`;
  el('disclaimer').textContent = FALLBACK_DISCLAIMER;

  buildSiteList();
  bindEvents();

  const response = await send({ type: MSG.SETTINGS_GET });
  if (response?.settings) {
    settings = response.settings;
    renderSettings();
  } else {
    showNotice(`Could not read the settings: ${describeError(response?.error)}`, 'error');
  }

  await Promise.all([loadCacheStats(), loadHealth()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
} else {
  void init();
}
