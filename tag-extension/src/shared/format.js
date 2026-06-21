// Display formatters. No chrome.* here -- the Node unit tests import this file directly.
// The strings below are what the UI shows, so keep them observational: nothing may read as a forecast.

import {
  AXIS_BAR_HEIGHT, AXIS_FALLBACK_LABEL, AXIS_WEIGHTS, PALETTE, VERDICTS, VERDICT_REASONS,
} from './constants.js';

/**
 * Every API string that reaches innerHTML has to come through here first.
 * A token name or symbol is on-chain metadata, which means arbitrary text -- miss the escaping
 * once and it is an injection.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Label for the verdict badge. docs/relic-spec.md defines what each one means. */
export function verdictLabel(verdict) {
  switch (verdict) {
    case 'dormant': return 'Dormant';
    case 'dead': return 'Dead';
    case 'unclear': return 'Unclear';
    default: return 'Unknown';
  }
}

/** The line under the badge. It summarizes what was observed; it never predicts a comeback. */
export function verdictNote(verdict) {
  switch (verdict) {
    case 'dormant':
      return 'Activity has stopped, but the structure is still standing.';
    case 'dead':
      return 'Liquidity and holders have largely unwound.';
    case 'unclear':
      return 'Signals disagree or coverage is incomplete.';
    default:
      return 'No verdict returned for this mint.';
  }
}

export function isKnownVerdict(verdict) {
  return VERDICTS.includes(verdict);
}

/**
 * Score color. null is gray -- painting a missing value as zero (red) makes a failed lookup
 * look like a dead token.
 * @param {number|null|undefined} score
 */
export function scoreColor(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return PALETTE.shadeGray;
  if (score >= 70) return PALETTE.grass;
  if (score >= 40) return PALETTE.dustYellow;
  return PALETTE.tagRed;
}

export function severityColor(severity) {
  switch (severity) {
    case 'alert': return PALETTE.tagRed;
    case 'caution': return PALETTE.dustYellow;
    case 'info':
    default: return PALETTE.shadeGray;
  }
}

/** Falls back only when the API sent no label. Whatever it did send is used as it came. */
export function axisLabel(axis) {
  if (axis && typeof axis.label === 'string' && axis.label.trim()) return axis.label;
  return AXIS_FALLBACK_LABEL[axis?.key] || axis?.key || 'Unknown axis';
}

/**
 * Pre-normalization weight for this axis. The API value wins; the relic-spec section 7 table is
 * the fallback. With neither, null -- which means "weight unknown", not zero.
 * @returns {number|null}
 */
export function axisWeight(axis) {
  if (axis && typeof axis.weight === 'number' && !Number.isNaN(axis.weight)) return axis.weight;
  const canonical = AXIS_WEIGHTS[axis?.key];
  return typeof canonical === 'number' ? canonical : null;
}

/**
 * Weight -> mini bar height in px. A heavier axis has to look visibly thicker, or the screen
 * never shows that lp_residual (.30) is the one deciding the verdict.
 * An unknown weight draws thinnest -- there is no basis for drawing an unknown as heavy.
 */
export function axisBarHeight(weight) {
  const { min, max, base, perWeight } = AXIS_BAR_HEIGHT;
  if (typeof weight !== 'number' || Number.isNaN(weight)) return min;
  return Math.round(Math.max(min, Math.min(max, base + weight * perWeight)));
}

/** 0.30 -> "30%". The number is printed as well as drawn -- thickness alone is not a readable ratio. */
export function formatWeight(weight) {
  if (typeof weight !== 'number' || Number.isNaN(weight)) return 'weight unknown';
  return `${Math.round(weight * 1000) / 10}%`;
}

/**
 * What a verdict's `reason` code means. An unrecognized code is never explained away; it is
 * passed through as it arrived, so a new code from the backend shows up on screen instead of
 * being quietly absorbed.
 * @returns {{ severity: 'alert'|'note', text: string, known: boolean }|null}
 */
export function describeReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) return null;
  const key = reason.trim();
  const known = VERDICT_REASONS[key];
  if (known) return { severity: known.severity, text: known.text, known: true };
  return { severity: 'note', text: 'Reason reported by the API but not recognized by this build.', known: false };
}

/** 0-100 as a bar width in percent. A missing score draws no bar at all and never gets here. */
export function scoreToWidth(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function formatScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return '--';
  return String(Math.round(score));
}

/**
 * An age in seconds, written short.
 * @param {number|null|undefined} seconds
 */
export function formatAge(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return 'unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** ISO 8601 -> "2026-03-11 07:00 UTC". If it will not parse, the raw value is returned, not hidden. */
export function formatUtc(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`
    + ` ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())} UTC`;
}

/** Low confidence is written on the chip. The chance of a false positive is not hidden. */
export function confidenceNote(confidence) {
  switch (confidence) {
    case 'low': return 'low confidence';
    case 'medium': return 'medium confidence';
    case 'high': return '';
    default: return 'confidence unknown';
  }
}

/**
 * The failure notice the overlay puts on screen. **Drawing nothing at all is the worst failure
 * there is** -- the reader cannot tell a dead extension from a page that simply has no mints on it.
 *
 * Pure function. It touches neither the DOM nor chrome.*, so the unit tests cover every branch.
 *
 * @param {{status?:number, code?:string, message?:string, retryAfterMs?:number}|null} error
 * @param {{ apiBase?: string }} [options]
 * @returns {{ title: string, body: string, kind: 'error'|'warn', retryable: boolean }|null}
 *   null means there is nothing to announce (the address just is not a mint -- working as intended)
 */
export function apiFailureNotice(error, { apiBase } = {}) {
  if (!error) return null;
  // A 404 means "this address is not a mint", which is the extension working. No toast for that.
  if (error.status === 404) return null;

  const where = apiBase ? ` (${apiBase})` : '';

  if (error.status === 429) {
    const wait = error.retryAfterMs
      ? ` Price tags resume in about ${formatAge(Math.ceil(error.retryAfterMs / 1000))}.`
      : ' Price tags resume shortly.';
    return {
      title: 'BAZR Tag is rate limited',
      body: `The API asked this extension to slow down.${wait} Nothing is wrong with this page.`,
      kind: 'warn',
      retryable: true,
    };
  }

  if (error.code === 'timeout') {
    return {
      title: 'BAZR Tag timed out',
      body: `The API did not answer in time${where}. The first lookup for a token reads the chain and can be slow;`
        + ' a retry is usually served from cache. Addresses on this page were left untagged, not judged.',
      kind: 'error',
      retryable: true,
    };
  }

  if (error.status === 0) {
    return {
      title: 'BAZR Tag cannot reach its API',
      body: `No response from the configured API${where}. Addresses on this page were left untagged, not judged.`
        + ' Check the API base in this extension\'s settings.',
      kind: 'error',
      retryable: true,
    };
  }

  if (error.status >= 500) {
    return {
      title: 'The BAZR API returned an error',
      body: `HTTP ${error.status}${where}. This is a server-side failure, not a verdict about any token here.`,
      kind: 'error',
      retryable: true,
    };
  }

  return {
    title: 'BAZR Tag could not read a price tag',
    body: `${describeError(error)}${where} Addresses on this page were left untagged, not judged.`,
    kind: 'error',
    retryable: false,
  };
}

/** Human-readable API error text. The cause is never blurred into something generic. */
export function describeError(error) {
  if (!error) return 'Unknown error.';
  if (error.status === 429) {
    const wait = error.retryAfterMs ? ` Retry in ${formatAge(Math.ceil(error.retryAfterMs / 1000))}.` : '';
    return `Rate limited by the API.${wait}`;
  }
  if (error.status === 404) return 'The API does not know this mint.';
  if (error.status === 0) return `Cannot reach the API: ${error.message || 'network error'}`;
  if (error.status) return `API error ${error.status}: ${error.message || 'no message'}`;
  return error.message || 'Unknown error.';
}
