// Content script entry point. Finds mint addresses on a supported site, clips a small marker next
// to each one, and opens the full price tag panel on hover or click.
//
// Performance rules -- what keeps a Twitter timeline from killing the browser:
//   1) throttle the MutationObserver; rescanning the whole DOM on every scroll is not an option
//   2) only confirm candidates that have entered the viewport (IntersectionObserver)
//   3) mark handled nodes with data-bazr-tagged so they are never walked twice
//   4) draw nothing before confirmation -- trusting the regex alone floods the page with bad hits

import { MSG, SUPPORTED_SITES } from '../shared/constants.js';
import { apiFailureNotice, describeError } from '../shared/format.js';
import {
  createMarker, createPanelController, showApiFailureNotice, showContextInvalidatedNotice,
} from './overlay.js';
import { collectTargets, detectPageMint, markTagged } from './scanner.js';

const SCAN_THROTTLE_MS = 500;
const BATCH_DELAY_MS = 220;
const MAX_BATCH = 12;
/** The same outage must not raise a toast on every scan. A notice that becomes noise goes unread. */
const FAILURE_NOTICE_COOLDOWN_MS = 60_000;

let settings = null;
let panel = null;
let scanTimer = null;
let lastScanAt = 0;
let batchTimer = null;
let observer = null;
let intersectionObserver = null;

/** Candidates waiting on the viewport: host element -> list of addresses */
const pending = new Map();
/** Addresses going out in this batch -> [{ address, kind, node, host }] */
const batch = new Map();
/** When the last failure notice was shown. 0 means none has been shown yet. */
let lastFailureNoticeAt = 0;

/**
 * Surfaces a failed lookup. Simply not drawing a marker leaves the reader unable to tell
 * "the extension is dead" from "there are no mints on this page".
 * A 404 means not-a-mint, which is normal, so apiFailureNotice returns null and it is dropped here.
 */
function reportApiFailure(error) {
  const notice = apiFailureNotice(error, { apiBase: settings?.apiBase });
  if (!notice) return;
  if (Date.now() - lastFailureNoticeAt < FAILURE_NOTICE_COOLDOWN_MS) return;
  lastFailureNoticeAt = Date.now();
  showApiFailureNotice(notice, {
    onRetry: () => {
      // Clear the cooldown and the tagged marks so everything can be asked about again
      lastFailureNoticeAt = 0;
      document.querySelectorAll('[data-bazr-tagged]').forEach((el) => el.removeAttribute('data-bazr-tagged'));
      scheduleScan();
      void refreshPageMarker();
    },
  });
}

/** A single success clears the cooldown, so the next outage is allowed to announce itself. */
function noteApiSuccess() {
  lastFailureNoticeAt = 0;
}

// --- chrome.runtime safe wrapper ---------------------------------------------

function safeSendMessage(message) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
        resolve(null);
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          const text = error.message || '';
          if (text.includes('invalidated') || text.includes('Could not establish') || text.includes('does not exist')) {
            showContextInvalidatedNotice();
          }
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch {
      showContextInvalidatedNotice();
      resolve(null);
    }
  });
}

// --- Site detection ----------------------------------------------------------

function currentSite() {
  const host = location.hostname.toLowerCase();
  return SUPPORTED_SITES.find((site) => host === site.host || host.endsWith(`.${site.host}`)) || null;
}

function overlayAllowed() {
  if (!settings || settings.autoOverlay === false) return false;
  const site = currentSite();
  if (!site) return false;
  return settings.siteEnabled?.[site.id] !== false;
}

// --- Attaching markers -------------------------------------------------------

function attachMarker(target, relic) {
  const marker = createMarker(relic);
  wireMarker(marker, relic);

  if (target.kind === 'text' && target.node?.parentNode) {
    target.node.parentNode.insertBefore(marker, target.node.nextSibling);
  } else if (target.host?.appendChild) {
    target.host.appendChild(marker);
  } else {
    return;
  }
  markTagged(target.host, target.address);
}

function wireMarker(marker, relic) {
  let hoverTimer = null;

  marker.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      panel.cancelHide();
      panel.showRelic(marker, relic);
    }, 140);
  });

  marker.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    panel.scheduleHide(240);
  });

  marker.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(hoverTimer);
    panel.showRelic(marker, relic);
    panel.pin();
  });

  marker.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      panel.showRelic(marker, relic);
      panel.pin();
    }
  });
}

// --- Batch confirmation ------------------------------------------------------

function queueForResolve(target) {
  const list = batch.get(target.address) || [];
  list.push(target);
  batch.set(target.address, list);

  if (batchTimer) return;
  batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
}

async function flushBatch() {
  batchTimer = null;
  if (batch.size === 0) return;

  const addresses = [...batch.keys()].slice(0, MAX_BATCH);
  const targetsByAddress = new Map();
  for (const address of addresses) {
    targetsByAddress.set(address, batch.get(address));
    batch.delete(address);
  }

  const response = await safeSendMessage({ type: MSG.RESOLVE, mints: addresses });
  const results = response?.results || {};

  let firstError = null;
  for (const [address, targets] of targetsByAddress.entries()) {
    const result = results[address];
    if (!result) continue;

    if (result.ok) {
      noteApiSuccess();
      for (const target of targets) attachMarker(target, result.relic);
    } else if (result.notMint) {
      // Not a mint -- leave the mark so it is not asked about again, and draw nothing
      for (const target of targets) markTagged(target.host, address);
    } else if (result.error && !firstError) {
      // A network or rate limit error. No marker, and the next scan retries -- but the failure
      // itself is announced, because silently showing nothing is the worst outcome there is.
      firstError = result.error;
    }
  }
  if (firstError) reportApiFailure(firstError);

  if (batch.size > 0 && !batchTimer) batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
}

// --- Scanning ----------------------------------------------------------------

function ensureIntersectionObserver() {
  if (intersectionObserver || typeof IntersectionObserver !== 'function') return;
  intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const targets = pending.get(entry.target);
      if (targets) {
        for (const target of targets) queueForResolve(target);
        pending.delete(entry.target);
      }
      intersectionObserver.unobserve(entry.target);
    }
  }, { rootMargin: '250px 0px', threshold: 0 });
}

function scan() {
  if (!overlayAllowed()) return;
  lastScanAt = Date.now();

  const targets = collectTargets(document);
  if (targets.length === 0) return;

  ensureIntersectionObserver();

  for (const target of targets) {
    const anchorEl = target.host;
    if (!anchorEl) continue;

    if (!intersectionObserver) {
      queueForResolve(target);
      continue;
    }

    const list = pending.get(anchorEl) || [];
    list.push(target);
    if (list.length === 1) intersectionObserver.observe(anchorEl);
    pending.set(anchorEl, list);
  }
}

function scheduleScan() {
  if (scanTimer) return;
  const elapsed = Date.now() - lastScanAt;
  const delay = elapsed >= SCAN_THROTTLE_MS ? 0 : SCAN_THROTTLE_MS - elapsed;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan();
  }, delay);
}

function startObserving() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    // Rescanning because of a marker we inserted ourselves would loop forever
    const relevant = mutations.some((mutation) => {
      const target = mutation.target;
      if (target?.hasAttribute?.('data-bazr-marker') || target?.hasAttribute?.('data-bazr-panel')) return false;
      return true;
    });
    if (relevant) scheduleScan();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true, subtree: true, characterData: true,
  });
}

// --- Page-level price tag on detail pages ------------------------------------

let pageMarkerHost = null;

async function refreshPageMarker() {
  if (pageMarkerHost) { pageMarkerHost.remove(); pageMarkerHost = null; }
  if (!overlayAllowed()) return;

  const mint = detectPageMint(location.href);
  if (!mint) return;

  const response = await safeSendMessage({ type: MSG.RELIC, mint });
  if (!response?.ok) {
    // On a detail page we know this address is the page's own token. If nothing appears anyway,
    // there is no way to tell the extension died -- so the failure is shown as it is.
    if (response?.error) reportApiFailure(response.error);
    return;
  }
  noteApiSuccess();

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-bazr-marker', '1');
  wrapper.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const marker = createMarker(response.relic);
  wireMarker(marker, response.relic);
  wrapper.appendChild(marker);
  document.body.appendChild(wrapper);
  pageMarkerHost = wrapper;
}

// --- SPA routing -------------------------------------------------------------

function observeUrlChanges(onChange) {
  let lastHref = location.href;
  const check = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    onChange(lastHref);
  };
  const original = { push: history.pushState, replace: history.replaceState };
  history.pushState = function pushState(...args) { original.push.apply(this, args); check(); };
  history.replaceState = function replaceState(...args) { original.replace.apply(this, args); check(); };
  window.addEventListener('popstate', check);
}

// --- Boot --------------------------------------------------------------------

async function boot() {
  const site = currentSite();
  if (!site) return;

  const response = await safeSendMessage({ type: MSG.SETTINGS_GET });
  settings = response?.settings || null;
  if (!overlayAllowed()) return;

  panel = createPanelController({
    onCopy: (mint, button) => {
      navigator.clipboard?.writeText(mint).then(() => {
        const original = button.textContent;
        button.textContent = 'copied';
        setTimeout(() => { button.textContent = original; }, 1200);
      }).catch(() => { button.textContent = 'copy failed'; });
    },
  });

  scan();
  startObserving();
  void refreshPageMarker();

  observeUrlChanges(() => {
    pending.clear();
    batch.clear();
    panel.hide();
    scheduleScan();
    void refreshPageMarker();
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = changes.settings.newValue || settings;
    if (!overlayAllowed()) {
      document.querySelectorAll('[data-bazr-marker]').forEach((el) => el.remove());
      panel.hide();
    } else {
      scheduleScan();
      void refreshPageMarker();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void boot(); }, { once: true });
} else {
  void boot();
}

// Lets the console read internal state during development. The content script world is isolated
// from page scripts, so nothing exposed here is reachable by the page.
globalThis.__bazrTagDebug = {
  scan,
  stats: () => ({ pending: pending.size, batch: batch.size, allowed: overlayAllowed() }),
};

export { describeError };
