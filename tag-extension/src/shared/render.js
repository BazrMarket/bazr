// Flea-market price tag renderer. Pure functions -- no DOM, no chrome.*, only HTML strings out.
// That is what lets the Node unit tests feed in a fixture and assert on the markup directly.
// The content script (Shadow DOM) and the popup call these same functions and must never drift.

import { AXIS_DISPLAY_ORDER, FONT_STACK, PALETTE } from './constants.js';
import {
  axisBarHeight, axisLabel, axisWeight, confidenceNote, describeReason, escapeHtml,
  formatAge, formatScore, formatUtc, formatWeight, scoreColor, scoreToWidth,
  verdictLabel, verdictNote,
} from './format.js';

const FALLBACK_DISCLAIMER = 'Survival-signal summary, not a prediction of price or revival.';

/** Reset for the shadow root only. Cuts off inheritance from the host page's CSS. */
export const SHADOW_RESET_CSS = `
:host { all: initial; display: block; }
`;

/** Price tag styles. Class selectors only -- the same string is used in the Shadow DOM and the popup. */
export const PRICE_TAG_CSS = `
.bzt, .bzt * { box-sizing: border-box; margin: 0; padding: 0; }
.bzt {
  position: relative;
  width: 320px;
  font-family: ${FONT_STACK.body};
  font-size: 13px;
  line-height: 1.45;
  color: ${PALETTE.asphalt};
  background: ${PALETTE.labelCream};
  border: 2px solid ${PALETTE.asphalt};
  border-radius: 10px;
  padding: 14px 16px 12px 16px;
  box-shadow: 0 10px 24px rgba(58, 58, 56, 0.28), 0 2px 0 ${PALETTE.cardboard};
  text-align: left;
}
.bzt--wide { width: 100%; }
/* The clipped top-left corner and the hole the string goes through */
.bzt__notch {
  position: absolute; top: -2px; left: -2px; width: 30px; height: 30px;
  background: linear-gradient(135deg, ${PALETTE.tagRed} 0 50%, transparent 50%);
  border-top-left-radius: 10px;
}
.bzt__hole {
  position: absolute; top: 7px; left: 7px; width: 9px; height: 9px;
  border-radius: 50%; background: ${PALETTE.labelCream};
  border: 2px solid ${PALETTE.tarpBlue};
}
.bzt__head {
  display: flex; align-items: baseline; gap: 8px;
  padding-left: 26px; margin-bottom: 10px;
}
.bzt__brand {
  font-family: ${FONT_STACK.display};
  font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase;
  color: ${PALETTE.tagRed};
}
.bzt__symbol {
  font-family: ${FONT_STACK.mono};
  font-size: 12px; font-weight: 700; color: ${PALETTE.asphalt};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;
}
.bzt__name { font-size: 11px; color: ${PALETTE.shadeGray}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bzt__close {
  margin-left: auto; border: 0; background: none; cursor: pointer;
  font-size: 16px; line-height: 1; color: ${PALETTE.shadeGray}; padding: 2px 4px;
}
.bzt__close:hover { color: ${PALETTE.tagRed}; }

.bzt__price { display: flex; align-items: flex-end; gap: 10px; }
.bzt__score {
  font-family: ${FONT_STACK.display};
  font-size: 46px; line-height: 0.9; letter-spacing: -0.01em;
}
.bzt__scoreUnit { font-family: ${FONT_STACK.mono}; font-size: 11px; color: ${PALETTE.shadeGray}; padding-bottom: 4px; }
.bzt__verdict {
  margin-left: auto; padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  border: 2px solid currentColor;
}
.bzt__verdict[data-verdict="dormant"] { color: ${PALETTE.tarpBlue}; }
.bzt__verdict[data-verdict="dead"] { color: ${PALETTE.tagRed}; }
.bzt__verdict[data-verdict="unclear"] { color: ${PALETTE.shadeGray}; }
.bzt__verdictNote { margin-top: 6px; font-size: 11.5px; color: ${PALETTE.shadeGray}; }

/* The verdict reason. "unclear" is one word for three different events, so without it
   "high total, nothing to sell into" just reads as vagueness. */
.bzt__reason {
  margin-top: 7px; padding: 6px 8px;
  border-left: 3px solid ${PALETTE.shadeGray};
  background: rgba(255, 255, 255, 0.55);
  border-radius: 0 5px 5px 0;
  display: grid; gap: 2px;
}
.bzt__reason[data-severity="alert"] { border-left-color: ${PALETTE.tagRed}; }
.bzt__reasonKey {
  font-family: ${FONT_STACK.mono}; font-size: 10px; letter-spacing: 0.05em;
  text-transform: uppercase; color: ${PALETTE.shadeGray};
}
.bzt__reason[data-severity="alert"] .bzt__reasonKey { color: ${PALETTE.tagRed}; font-weight: 700; }
.bzt__reasonText { font-size: 11.5px; color: ${PALETTE.asphalt}; }

.bzt__rule { height: 2px; margin: 11px 0 9px; background: repeating-linear-gradient(90deg, ${PALETTE.asphalt} 0 6px, transparent 6px 12px); opacity: 0.35; }

.bzt__sectionTitle {
  font-family: ${FONT_STACK.mono}; font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; color: ${PALETTE.shadeGray}; margin-bottom: 6px;
}
.bzt__axes { list-style: none; display: grid; gap: 8px; }
.bzt__axis { display: grid; grid-template-columns: 1fr auto auto; gap: 3px 8px; align-items: baseline; }
.bzt__axisLabel { font-size: 11.5px; }
/* Thickness carries the weight, but only the number gives the exact ratio. Print both. */
.bzt__axisWeight { font-family: ${FONT_STACK.mono}; font-size: 9.5px; color: ${PALETTE.shadeGray}; }
.bzt__axisValue { font-family: ${FONT_STACK.mono}; font-size: 11px; font-weight: 700; }
.bzt__axisTrack {
  grid-column: 1 / -1; border-radius: 4px;
  background: rgba(58, 58, 56, 0.12); overflow: hidden;
  /* Height arrives inline -- it is proportional to the weight (relic-spec section 7) */
}
.bzt__axisFill { height: 100%; border-radius: 4px; }
.bzt__axis[data-status="unknown"] .bzt__axisValue { color: ${PALETTE.shadeGray}; font-weight: 400; }
.bzt__axis[data-status="unknown"] .bzt__axisTrack {
  background-image: repeating-linear-gradient(45deg, ${PALETTE.shadeGray} 0 3px, transparent 3px 7px);
  background-color: rgba(110, 112, 118, 0.14);
  opacity: 0.75;
}

.bzt__chips { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.bzt__chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  border: 1.5px solid currentColor; background: rgba(255, 255, 255, 0.55);
}
.bzt__chip[data-severity="info"] { color: ${PALETTE.shadeGray}; }
.bzt__chip[data-severity="caution"] { color: ${PALETTE.dustYellow}; }
.bzt__chip[data-severity="alert"] { color: ${PALETTE.tagRed}; }
.bzt__chipNote { font-weight: 400; font-size: 10px; opacity: 0.85; }
.bzt__empty { font-size: 11.5px; color: ${PALETTE.shadeGray}; }

.bzt__meta { font-family: ${FONT_STACK.mono}; font-size: 10px; color: ${PALETTE.shadeGray}; display: grid; gap: 3px; }
.bzt__mint { word-break: break-all; color: ${PALETTE.asphalt}; }
.bzt__copy {
  border: 1.5px solid ${PALETTE.shadeGray}; background: none; cursor: pointer;
  font-family: ${FONT_STACK.mono}; font-size: 9.5px; color: ${PALETTE.shadeGray};
  border-radius: 5px; padding: 1px 6px; margin-left: 6px;
}
.bzt__copy:hover { color: ${PALETTE.tarpBlue}; border-color: ${PALETTE.tarpBlue}; }
.bzt__disclaimer {
  margin-top: 9px; padding-top: 8px; border-top: 1px dashed rgba(58, 58, 56, 0.3);
  font-size: 10.5px; color: ${PALETTE.shadeGray};
}
.bzt__error { font-size: 12px; color: ${PALETTE.tagRed}; font-weight: 700; }
.bzt__loading { font-size: 12px; color: ${PALETTE.shadeGray}; }
`;

/**
 * Turns one relic response into price tag HTML.
 * @param {object} relic a docs/api-contract.md `GET /relic/{mint}` response, after normalizeRelic
 * @param {{ showClose?: boolean, wide?: boolean, showCopy?: boolean }} [options]
 * @returns {string}
 */
export function buildPriceTagHtml(relic, options = {}) {
  const { showClose = false, wide = false, showCopy = false } = options;
  const rootClass = `bzt${wide ? ' bzt--wide' : ''}`;

  return `<div class="${rootClass}" data-bazr-verdict="${escapeHtml(relic?.verdict || 'unknown')}">`
    + '<div class="bzt__notch"></div><div class="bzt__hole"></div>'
    + buildHead(relic, showClose)
    + buildPrice(relic)
    + '<div class="bzt__rule"></div>'
    + buildAxes(relic)
    + '<div class="bzt__rule"></div>'
    + buildChips(relic)
    + '<div class="bzt__rule"></div>'
    + buildMeta(relic, showCopy)
    + buildDisclaimer(relic)
    + '</div>';
}

function buildHead(relic, showClose) {
  const symbol = relic?.symbol ? escapeHtml(relic.symbol) : 'UNKNOWN';
  const name = relic?.name ? `<span class="bzt__name">${escapeHtml(relic.name)}</span>` : '';
  const close = showClose
    ? '<button class="bzt__close" data-bazr-action="close" type="button" aria-label="Close">&times;</button>'
    : '';
  return '<div class="bzt__head">'
    + '<span class="bzt__brand">BAZR</span>'
    + `<span class="bzt__symbol">${symbol}</span>`
    + name
    + close
    + '</div>';
}

function buildPrice(relic) {
  const score = relic?.score;
  const hasScore = typeof score === 'number' && !Number.isNaN(score);
  const verdict = relic?.verdict || 'unknown';
  const unit = hasScore ? '/100 relic' : 'no observable axis';
  return '<div class="bzt__price">'
    + `<span class="bzt__score" style="color:${scoreColor(score)}">${escapeHtml(formatScore(score))}</span>`
    + `<span class="bzt__scoreUnit">${escapeHtml(unit)}</span>`
    + `<span class="bzt__verdict" data-verdict="${escapeHtml(verdict)}">${escapeHtml(verdictLabel(verdict))}</span>`
    + '</div>'
    + `<p class="bzt__verdictNote">${escapeHtml(verdictNote(verdict))}</p>`
    + buildReason(relic);
}

/**
 * The verdict reason. The three `unclear` cases are different events, and folding them together
 * leaves the reader unable to separate them. "high aggregate but cannot exit" is the sharp one:
 * it is unclear with a high score, so with no reason on screen it reads as a good number.
 * Both the raw API code and the explanation are rendered.
 */
function buildReason(relic) {
  const reason = relic?.reason;
  const info = describeReason(reason);
  if (!info) return '';
  return `<p class="bzt__reason" data-severity="${escapeHtml(info.severity)}" data-reason="${escapeHtml(reason)}">`
    + `<span class="bzt__reasonKey">${escapeHtml(reason)}</span>`
    + `<span class="bzt__reasonText">${escapeHtml(info.text)}</span>`
    + '</p>';
}

function buildAxes(relic) {
  const axes = Array.isArray(relic?.axes) ? relic.axes : [];
  const byKey = new Map(axes.map((axis) => [axis?.key, axis]));

  // The contract always sends five. A missing one is filled in as unknown, never folded to zero.
  const rows = AXIS_DISPLAY_ORDER.map((key) => byKey.get(key) || { key, status: 'unknown', score: null });

  // An axis outside the contract is appended, not dropped. Swallowing it would hide a backend change.
  for (const axis of axes) {
    if (axis && typeof axis.key === 'string' && !AXIS_DISPLAY_ORDER.includes(axis.key)) rows.push(axis);
  }

  // Heaviest axis first, ordered by the API's weight when it is there and by the relic-spec
  // section 7 table when it is not. sort is stable, so equal weights keep the order set above.
  rows.sort((a, b) => (axisWeight(b) ?? 0) - (axisWeight(a) ?? 0));

  return '<div class="bzt__sectionTitle">Signal axes -- bar thickness follows the weight</div>'
    + `<ul class="bzt__axes">${rows.map(renderAxis).join('')}</ul>`;
}

function renderAxis(axis) {
  const unknown = axis?.status !== 'ok' || typeof axis?.score !== 'number' || Number.isNaN(axis.score);
  const label = escapeHtml(axisLabel(axis));
  const title = axis?.blurb ? ` title="${escapeHtml(axis.blurb)}"` : '';

  // Heavier axes are drawn thicker. At one uniform thickness the screen stops showing that
  // lp_residual (.30) is what effectively decides the verdict (relic-spec sections 7 and 9).
  const weight = axisWeight(axis);
  const height = axisBarHeight(weight);
  const weightAttr = weight === null ? '' : String(weight);
  const weightText = escapeHtml(`w ${formatWeight(weight)}`);
  const head = `<li class="bzt__axis" data-status="${unknown ? 'unknown' : 'ok'}"`
    + ` data-axis="${escapeHtml(axis?.key || '')}" data-weight="${escapeHtml(weightAttr)}"${title}>`
    + `<span class="bzt__axisLabel">${label}</span>`
    + `<span class="bzt__axisWeight">${weightText}</span>`;

  if (unknown) {
    // Drawing a missing value as a zero-length bar makes every failed lookup look like a dead
    // token. No fill is drawn at all and the cell says "no data" (api-contract.md warns about it).
    return `${head}<span class="bzt__axisValue">no data</span>`
      + `<div class="bzt__axisTrack" style="height:${height}px" role="img" aria-label="no data"></div>`
      + '</li>';
  }

  const width = scoreToWidth(axis.score);
  return `${head}<span class="bzt__axisValue">${escapeHtml(formatScore(axis.score))}</span>`
    + `<div class="bzt__axisTrack" style="height:${height}px">`
    + `<div class="bzt__axisFill" style="width:${width}%;background:${scoreColor(axis.score)}"></div>`
    + '</div>'
    + '</li>';
}

function buildChips(relic) {
  const tags = Array.isArray(relic?.tags) ? relic.tags : [];
  if (tags.length === 0) {
    return '<div class="bzt__sectionTitle">Labels</div>'
      + '<p class="bzt__empty">No labels returned for this mint.</p>';
  }
  const chips = tags.map((tag) => {
    const severity = ['info', 'caution', 'alert'].includes(tag?.severity) ? tag.severity : 'info';
    const notes = [];
    const confidence = confidenceNote(tag?.confidence);
    if (confidence) notes.push(confidence);
    if (tag?.observed === false) notes.push('not directly observed');
    const noteHtml = notes.length
      ? `<span class="bzt__chipNote">${escapeHtml(notes.join(' / '))}</span>`
      : '';
    const label = escapeHtml(tag?.label || tag?.key || 'unlabeled');
    return `<li class="bzt__chip" data-severity="${escapeHtml(severity)}"`
      + ` data-confidence="${escapeHtml(tag?.confidence || 'unknown')}"`
      + ` data-key="${escapeHtml(tag?.key || '')}">`
      + `<span>${label}</span>${noteHtml}</li>`;
  });
  return '<div class="bzt__sectionTitle">Labels</div>'
    + `<ul class="bzt__chips">${chips.join('')}</ul>`;
}

function buildMeta(relic, showCopy) {
  const rows = [];
  const mint = escapeHtml(relic?.mint || '');
  const copyBtn = showCopy && relic?.mint
    ? `<button class="bzt__copy" type="button" data-bazr-action="copy" data-bazr-mint="${mint}">copy</button>`
    : '';
  if (mint) rows.push(`<div class="bzt__mint">${mint}${copyBtn}</div>`);

  if (relic?.scored_at) rows.push(`<div>scored ${escapeHtml(formatUtc(relic.scored_at))}</div>`);
  if (relic?.graduated_at) rows.push(`<div>graduated ${escapeHtml(formatUtc(relic.graduated_at))}</div>`);

  if (relic?.cache && typeof relic.cache === 'object') {
    const state = relic.cache.hit ? 'cache hit' : 'fresh fetch';
    const age = typeof relic.cache.age_s === 'number' ? ` (${formatAge(relic.cache.age_s)} old)` : '';
    rows.push(`<div>${escapeHtml(state + age)}</div>`);
  }

  const sources = Array.isArray(relic?.sources) ? relic.sources : [];
  if (sources.length) {
    const names = [...new Set(sources.map((s) => s?.name).filter(Boolean))];
    if (names.length) rows.push(`<div>sources: ${escapeHtml(names.join(', '))}</div>`);
  }

  if (rows.length === 0) return '';
  return `<div class="bzt__meta">${rows.join('')}</div>`;
}

function buildDisclaimer(relic) {
  const text = typeof relic?.disclaimer === 'string' && relic.disclaimer.trim()
    ? relic.disclaimer
    : FALLBACK_DISCLAIMER;
  return `<p class="bzt__disclaimer">${escapeHtml(text)}</p>`;
}

/** Shown while a lookup is in flight. The tag shell stays put so the layout does not jump. */
export function buildLoadingHtml(mint) {
  return '<div class="bzt">'
    + '<div class="bzt__notch"></div><div class="bzt__hole"></div>'
    + '<div class="bzt__head"><span class="bzt__brand">BAZR</span></div>'
    + '<p class="bzt__loading">Reading the price tag...</p>'
    + `<div class="bzt__meta"><div class="bzt__mint">${escapeHtml(mint || '')}</div></div>`
    + '</div>';
}

/** A failure is never papered over with a blank panel. The cause is shown as it came. */
export function buildErrorHtml(mint, message) {
  return '<div class="bzt">'
    + '<div class="bzt__notch"></div><div class="bzt__hole"></div>'
    + '<div class="bzt__head"><span class="bzt__brand">BAZR</span>'
    + '<button class="bzt__close" data-bazr-action="close" type="button" aria-label="Close">&times;</button></div>'
    + `<p class="bzt__error">${escapeHtml(message || 'Request failed.')}</p>`
    + `<div class="bzt__meta"><div class="bzt__mint">${escapeHtml(mint || '')}</div></div>`
    + `<p class="bzt__disclaimer">${escapeHtml(FALLBACK_DISCLAIMER)}</p>`
    + '</div>';
}

export { FALLBACK_DISCLAIMER };
