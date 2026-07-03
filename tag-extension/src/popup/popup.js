// BAZR Tag -- popup logic.
//
// A popup's DOM is built fresh every time it opens and destroyed when it closes, so the module
// variables in this file live exactly as long as this one window. Everything persistent sits in
// the background (chrome.storage.local) and is read back over a message on each open.
//
// The price tag is not redrawn here. It uses the same buildPriceTagHtml() / PRICE_TAG_CSS as the
// content script overlay -- the two must never drift apart.

import { FONT_STACK, MSG, PALETTE, RECENT_LIMIT } from '../shared/constants.js';
import { isMintCandidate } from '../shared/base58.js';
import {
  describeError, formatAge, formatScore, scoreColor, verdictLabel,
} from '../shared/format.js';
import {
  PRICE_TAG_CSS, buildErrorHtml, buildLoadingHtml, buildPriceTagHtml,
} from '../shared/render.js';

// --- Design token injection --------------------------------------------------
// popup.css only references --bz-*. constants.js is the single source of those values.
// This block runs synchronously at module top level (the script tag sits at the end of body and
// is not deferred) -- the tokens have to land before first paint or the background flashes.

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

// PRICE_TAG_CSS is a JS string. Copying it into a CSS file would split the source of truth, so
// it is injected as a <style> element instead (MV3 CSP blocks inline script, not injected style).
{
  const style = document.createElement('style');
  style.setAttribute('data-bazr-style', 'price-tag');
  style.textContent = PRICE_TAG_CSS;
  document.head.appendChild(style);
}

// --- State for this window ---------------------------------------------------

/** The mint looked up last. The Refresh button asks for this one again. */
let lastMint = null;
/** Guards against re-entering a lookup while one is already in flight. */
let busy = false;

const el = (id) => document.getElementById(id);

/**
 * Sends a message to the background. sendMessage throws when the service worker fails to wake or
 * the channel closes first -- swallow that and the popup quietly turns into a blank panel.
 * Failures come back in the contract's own shape ({ ok:false, error }) so callers have one path.
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

function shortMint(mint) {
  const value = String(mint || '');
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

// --- Screen updates ----------------------------------------------------------

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

function renderTag(html) {
  // Only strings render.js has already run through escapeHtml reach this point.
  el('tag-slot').innerHTML = html;
}

function resetTag() {
  const slot = el('tag-slot');
  slot.replaceChildren();
  const hint = document.createElement('p');
  hint.className = 'bz-hint';
  hint.id = 'tag-hint';
  hint.textContent = 'Paste a mint address above, or pick one from recent lookups.';
  slot.appendChild(hint);
}

function setBusy(value) {
  busy = value;
  const readBtn = el('read-btn');
  readBtn.disabled = value;
  readBtn.textContent = value ? 'Reading...' : 'Read tag';
  el('refresh-btn').disabled = value || !lastMint;
  el('mint-input').readOnly = value;
}

function setStatus(state, text) {
  el('status-dot').dataset.state = state;
  el('status-text').textContent = text;
}

// --- Lookup ------------------------------------------------------------------

/**
 * @param {string} rawMint
 * @param {{ refresh?: boolean }} [options]
 */
async function lookup(rawMint, { refresh = false } = {}) {
  if (busy) return;

  const mint = String(rawMint || '').trim();
  if (!mint) {
    showNotice('Paste a Solana mint address first.', 'warn');
    return;
  }

  // First validation pass, locally. A wrong shape never reaches the API and never costs rate limit.
  if (!isMintCandidate(mint)) {
    showNotice(
      'That does not look like a Solana mint address. It has to be a base58 public key that decodes to 32 bytes, and it cannot be a well-known program address.',
      'warn',
    );
    return;
  }

  el('mint-input').value = mint;
  setBusy(true);
  showNotice(refresh ? 'Refreshing from the API and ignoring the cache.' : 'Reading the price tag...', 'info');
  renderTag(buildLoadingHtml(mint));

  const response = await send({ type: MSG.RELIC, mint, refresh, remember: true });

  lastMint = mint;
  setBusy(false);

  if (response?.ok === true && response.relic) {
    renderTag(buildPriceTagHtml(response.relic, { wide: true, showCopy: true }));
    if (response.cached === true) {
      const age = typeof response.ageMs === 'number' ? formatAge(Math.round(response.ageMs / 1000)) : 'unknown';
      showNotice(`Served from the extension cache (${age} old). Press Refresh to ask the API again.`, 'info');
    } else {
      showNotice('Fresh response from the API.', 'info');
    }
    await loadRecent();
    return;
  }

  if (response?.notMint === true) {
    const message = 'The API does not recognize this mint.';
    renderTag(buildErrorHtml(mint, message));
    showNotice(`${message} Refresh asks again and bypasses the 24 hour negative cache.`, 'warn');
    return;
  }

  // A failure is never papered over with a blank panel. The cause is shown as it came.
  const message = describeError(response?.error);
  renderTag(buildErrorHtml(mint, message));
  showNotice(message, 'error');
}

// --- Recent lookups ----------------------------------------------------------

function renderRecent(items) {
  const list = el('recent-list');
  list.replaceChildren();

  const rows = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.mint === 'string' && item.mint)
    .slice(0, RECENT_LIMIT);

  if (rows.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'bz-recentEmpty';
    empty.textContent = 'No lookups yet.';
    list.appendChild(empty);
    return;
  }

  for (const item of rows) {
    const li = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bz-recentItem';
    button.dataset.mint = item.mint;
    button.title = item.mint;

    const score = document.createElement('span');
    score.className = 'bz-recentScore';
    score.textContent = formatScore(item.score);
    score.style.color = scoreColor(item.score);

    const main = document.createElement('span');
    main.className = 'bz-recentMain';

    // A symbol is on-chain metadata and therefore arbitrary text. It only goes in as textContent.
    const symbol = document.createElement('span');
    symbol.className = 'bz-recentSymbol';
    symbol.textContent = item.symbol ? String(item.symbol) : 'UNKNOWN';

    const mint = document.createElement('span');
    mint.className = 'bz-recentMint';
    mint.textContent = shortMint(item.mint);

    main.append(symbol, mint);

    const verdict = document.createElement('span');
    verdict.className = 'bz-recentVerdict';
    verdict.dataset.verdict = typeof item.verdict === 'string' ? item.verdict : 'unknown';
    verdict.textContent = verdictLabel(item.verdict);

    button.append(score, main, verdict);
    li.appendChild(button);
    list.appendChild(li);
  }
}

async function loadRecent() {
  const response = await send({ type: MSG.RECENT_GET });
  if (Array.isArray(response?.recent)) {
    renderRecent(response.recent);
    return;
  }
  renderRecent([]);
  showNotice(`Could not read recent lookups: ${describeError(response?.error)}`, 'error');
}

// --- API status line ---------------------------------------------------------

async function loadStatus() {
  setStatus('checking', 'Checking the API...');

  // On the failure path MSG.HEALTH can come back with a null baseUrl (it threw before the client
  // was built). Read the settings alongside it as a fallback -- which address is down has to show.
  const [settingsResponse, healthResponse] = await Promise.all([
    send({ type: MSG.SETTINGS_GET }),
    send({ type: MSG.HEALTH }),
  ]);

  const configured = typeof settingsResponse?.settings?.apiBase === 'string'
    ? settingsResponse.settings.apiBase
    : null;
  const base = healthResponse?.baseUrl || configured || 'unknown API base';

  if (healthResponse?.ok === true) {
    const health = healthResponse.health && typeof healthResponse.health === 'object' ? healthResponse.health : {};
    const state = typeof health.status === 'string' ? health.status : 'reachable';
    const version = typeof health.version === 'string' ? ` / api ${health.version}` : '';
    setStatus('ok', `${base} -- ${state}${version}`);
    return;
  }

  setStatus('down', `API unreachable: ${describeError(healthResponse?.error)} (${base})`);
}

// --- Events ------------------------------------------------------------------

function bindEvents() {
  el('lookup-form').addEventListener('submit', (event) => {
    event.preventDefault(); // the Enter key lands here too
    void lookup(el('mint-input').value);
  });

  el('refresh-btn').addEventListener('click', () => {
    if (!lastMint) {
      showNotice('Nothing to refresh yet. Read a mint first.', 'warn');
      return;
    }
    // The contract limits ?refresh=true to 5 req/min. A 429 comes through as describeError text.
    void lookup(lastMint, { refresh: true });
  });

  el('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Click delegation for the recent list
  el('recent-list').addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.bz-recentItem') : null;
    if (!button) return;
    const mint = button.dataset.mint;
    if (mint) void lookup(mint);
  });

  // Click delegation for the buttons inside the tag. buildPriceTagHtml(showCopy) and
  // buildErrorHtml plant data-bazr-action -- an inline onclick would violate the MV3 CSP.
  el('tag-slot').addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const actionNode = target ? target.closest('[data-bazr-action]') : null;
    if (!actionNode) return;

    const action = actionNode.getAttribute('data-bazr-action');

    if (action === 'close') {
      resetTag();
      showNotice('');
      return;
    }

    if (action === 'copy') {
      const mint = actionNode.getAttribute('data-bazr-mint');
      if (!mint) return;
      const original = actionNode.textContent;
      if (!navigator.clipboard) {
        actionNode.textContent = 'clipboard blocked';
        setTimeout(() => { actionNode.textContent = original; }, 1600);
        return;
      }
      navigator.clipboard.writeText(mint).then(() => {
        actionNode.textContent = 'copied';
        setTimeout(() => { actionNode.textContent = original; }, 1200);
      }).catch(() => {
        actionNode.textContent = 'copy failed';
        setTimeout(() => { actionNode.textContent = original; }, 1600);
      });
    }
  });
}

// --- Boot --------------------------------------------------------------------

async function init() {
  const manifest = chrome.runtime.getManifest?.();
  if (manifest?.version) el('version').textContent = `v${manifest.version}`;

  bindEvents();
  el('mint-input').focus();

  // Read from the background on every open. Nothing is left behind in a popup global.
  await Promise.all([loadRecent(), loadStatus()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
} else {
  void init();
}
