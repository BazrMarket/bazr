// The price tag overlay. All of it lives inside a closed Shadow DOM.
// Host page CSS must not break the overlay and the overlay must not break the host page --
// dexscreener and x.com both ship global resets and very high z-index values.

import { PALETTE, FONT_STACK } from '../shared/constants.js';
import { formatScore, scoreColor, verdictLabel } from '../shared/format.js';
import {
  PRICE_TAG_CSS, SHADOW_RESET_CSS, buildErrorHtml, buildLoadingHtml, buildPriceTagHtml,
} from '../shared/render.js';

const MAX_Z = '2147483647';

const MARKER_CSS = `
:host { all: initial; }
.mk {
  display: inline-flex; align-items: center; gap: 4px; vertical-align: middle;
  margin: 0 4px; padding: 1px 7px 1px 5px;
  font-family: ${FONT_STACK.mono}; font-size: 11px; font-weight: 700; line-height: 1.5;
  color: ${PALETTE.asphalt}; background: ${PALETTE.labelCream};
  border: 1.5px solid ${PALETTE.asphalt}; border-radius: 3px 8px 8px 3px;
  cursor: pointer; user-select: none; white-space: nowrap;
  box-shadow: 1px 1px 0 rgba(58, 58, 56, 0.35);
}
.mk:hover { border-color: ${PALETTE.tarpBlue}; }
.mk__hole { width: 5px; height: 5px; border-radius: 50%; border: 1.5px solid ${PALETTE.tarpBlue}; }
.mk__score { font-weight: 800; }
.mk__verdict { font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; color: ${PALETTE.shadeGray}; }
`;

/**
 * The small tag that hangs beside an address. Built only after the background confirms a mint.
 * @param {object} relic
 * @returns {HTMLElement} shadow host
 */
export function createMarker(relic) {
  const host = document.createElement('span');
  host.setAttribute('data-bazr-marker', '1');
  host.style.cssText = 'all:initial;display:inline-block;vertical-align:middle;';

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = MARKER_CSS;

  const pill = document.createElement('span');
  pill.className = 'mk';
  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');
  pill.setAttribute('aria-label', `BAZR relic score ${formatScore(relic?.score)}, verdict ${verdictLabel(relic?.verdict)}`);

  const hole = document.createElement('span');
  hole.className = 'mk__hole';

  const score = document.createElement('span');
  score.className = 'mk__score';
  score.textContent = formatScore(relic?.score);
  score.style.color = scoreColor(relic?.score);

  const verdict = document.createElement('span');
  verdict.className = 'mk__verdict';
  verdict.textContent = verdictLabel(relic?.verdict);

  pill.append(hole, score, verdict);
  shadow.append(style, pill);
  return host;
}

/**
 * The one price tag panel on the page. Hovering a marker opens it; clicking pins it open.
 */
export function createPanelController({ onCopy } = {}) {
  let host = null;
  let shadow = null;
  let body = null;
  let pinned = false;
  let anchor = null;
  let hideTimer = null;

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-bazr-panel', '1');
    host.style.cssText = `all:initial;position:fixed;top:0;left:0;z-index:${MAX_Z};display:none;`;

    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SHADOW_RESET_CSS + PRICE_TAG_CSS;

    body = document.createElement('div');
    body.addEventListener('click', handlePanelClick);
    body.addEventListener('mouseenter', cancelHide);
    body.addEventListener('mouseleave', () => scheduleHide(220));

    shadow.append(style, body);
    document.body.appendChild(host);
  }

  function handlePanelClick(event) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    for (const node of path) {
      const action = node?.getAttribute?.('data-bazr-action');
      if (action === 'close') { hide(); return; }
      if (action === 'copy') {
        const mint = node.getAttribute('data-bazr-mint');
        if (mint && onCopy) onCopy(mint, node);
        return;
      }
    }
  }

  /** Positions the panel against its anchor, keeping it inside the viewport. */
  function position() {
    if (!anchor || !host) return;
    const rect = anchor.getBoundingClientRect();
    host.style.display = 'block';
    const panel = host.getBoundingClientRect();
    const width = panel.width || 320;
    const height = panel.height || 300;
    const gap = 8;

    let left = rect.left;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - 8) {
      const above = rect.top - height - gap;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - height - 8);
    }
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function render(html, anchorElement) {
    ensure();
    anchor = anchorElement || anchor;
    body.innerHTML = html;
    position();
  }

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleHide(delay = 200) {
    if (pinned) return;
    cancelHide();
    hideTimer = setTimeout(hide, delay);
  }

  function hide() {
    cancelHide();
    pinned = false;
    anchor = null;
    if (host) host.style.display = 'none';
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && host && host.style.display !== 'none') hide();
  }, true);

  document.addEventListener('click', (event) => {
    if (!pinned || !host || host.style.display === 'none') return;
    const path = event.composedPath ? event.composedPath() : [];
    if (path.includes(host)) return;
    if (anchor && path.includes(anchor)) return;
    hide();
  }, true);

  window.addEventListener('scroll', () => { if (host && host.style.display !== 'none') position(); }, true);
  window.addEventListener('resize', () => { if (host && host.style.display !== 'none') position(); });

  return {
    showLoading(anchorElement, mint) { render(buildLoadingHtml(mint), anchorElement); },
    showRelic(anchorElement, relic) {
      render(buildPriceTagHtml(relic, { showClose: true, showCopy: true }), anchorElement);
    },
    showError(anchorElement, mint, message) { render(buildErrorHtml(mint, message), anchorElement); },
    pin() { pinned = true; cancelHide(); },
    unpin() { pinned = false; },
    isPinned: () => pinned,
    scheduleHide,
    cancelHide,
    hide,
    isOpen: () => Boolean(host) && host.style.display !== 'none',
  };
}

const NOTICE_CSS = `
:host { all: initial; }
.n {
  font-family: ${FONT_STACK.body}; font-size: 12px; line-height: 1.45;
  color: ${PALETTE.asphalt}; background: ${PALETTE.labelCream};
  border: 2px solid ${PALETTE.tagRed}; border-left-width: 6px;
  border-radius: 8px; padding: 10px 13px; max-width: 300px;
  box-shadow: 0 8px 20px rgba(58, 58, 56, 0.3);
}
.n[data-kind="warn"] { border-color: ${PALETTE.dustYellow}; }
.n__head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.n__title { font-weight: 700; color: ${PALETTE.tagRed}; }
.n[data-kind="warn"] .n__title { color: ${PALETTE.asphalt}; }
.n__close {
  margin-left: auto; border: 0; background: none; cursor: pointer;
  font-size: 15px; line-height: 1; color: ${PALETTE.shadeGray}; padding: 0 2px;
}
.n__close:hover { color: ${PALETTE.tagRed}; }
.n__body { color: ${PALETTE.asphalt}; }
.n__actions { margin-top: 8px; display: flex; gap: 7px; }
.n__btn {
  font-family: ${FONT_STACK.body}; font-size: 11px; font-weight: 700; cursor: pointer;
  color: ${PALETTE.asphalt}; background: rgba(255, 255, 255, 0.7);
  border: 1.5px solid ${PALETTE.asphalt}; border-radius: 5px; padding: 3px 9px;
}
.n__btn:hover { border-color: ${PALETTE.tarpBlue}; color: ${PALETTE.tarpBlue}; }
`;

/**
 * A single notice in the corner of the screen. If one with the same id is already up, this is a
 * no-op. It all sits in a closed Shadow DOM, so host page CSS and this cannot break each other.
 *
 * @param {{ id: string, title: string, body: string, kind?: 'error'|'warn',
 *           timeoutMs?: number, actionLabel?: string, onAction?: () => void }} options
 * @returns {HTMLElement|null} the host that was created, or null if one was already showing
 */
export function showNotice({
  id, title, body, kind = 'error', timeoutMs = 12000, actionLabel, onAction,
}) {
  if (document.querySelector(`[data-bazr-notice="${id}"]`)) return null;

  const host = document.createElement('div');
  host.setAttribute('data-bazr-notice', id);
  host.style.cssText = `all:initial;position:fixed;bottom:18px;right:18px;z-index:${MAX_Z};`;

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = NOTICE_CSS;

  const box = document.createElement('div');
  box.className = 'n';
  box.dataset.kind = kind;
  box.setAttribute('role', 'status');

  const head = document.createElement('div');
  head.className = 'n__head';
  const titleEl = document.createElement('span');
  titleEl.className = 'n__title';
  titleEl.textContent = title;          // may carry API text, so it only ever goes in as textContent
  const close = document.createElement('button');
  close.className = 'n__close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => host.remove());
  head.append(titleEl, close);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'n__body';
  bodyEl.textContent = body;

  box.append(head, bodyEl);

  if (actionLabel && onAction) {
    const actions = document.createElement('div');
    actions.className = 'n__actions';
    const button = document.createElement('button');
    button.className = 'n__btn';
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', () => { host.remove(); onAction(); });
    actions.appendChild(button);
    box.appendChild(actions);
  }

  shadow.append(style, box);
  document.body.appendChild(host);
  if (timeoutMs > 0) setTimeout(() => host.remove(), timeoutMs);
  return host;
}

/** Reloading the extension cuts the old content script off chrome.runtime. Say so, do not just die. */
export function showContextInvalidatedNotice() {
  showNotice({
    id: 'context-invalidated',
    title: 'BAZR Tag reloaded',
    body: 'Refresh this page to keep price tags working.',
    kind: 'error',
  });
}

/**
 * Shown when an API lookup fails. Simply not drawing a marker leaves the reader unable to tell
 * "the extension is dead" from "there are no mints here".
 * @param {{title:string, body:string, kind:'error'|'warn'}} notice from apiFailureNotice in format.js
 */
export function showApiFailureNotice(notice, { onRetry } = {}) {
  return showNotice({
    id: 'api-failure',
    title: notice.title,
    body: notice.body,
    kind: notice.kind,
    timeoutMs: 15000,
    actionLabel: onRetry ? 'Try again' : undefined,
    onAction: onRetry,
  });
}
