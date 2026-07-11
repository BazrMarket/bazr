// Display formatters. The strings built here go straight to the UI, which makes this file
// the place where the honesty rules are enforced in code.
//
// Two of them in particular:
//   1) a missing reading (null) never gets the same colour or the same wording as 0
//   2) an unreadable weight is never drawn as if every axis weighed the same

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AXIS_BAR_HEIGHT, AXIS_DISPLAY_ORDER, AXIS_WEIGHTS, PALETTE, REQUEST_TIMEOUT_MS,
  VERDICTS, VERDICT_REASONS,
} from '../src/shared/constants.js';
import {
  apiFailureNotice, axisBarHeight, axisLabel, axisWeight, confidenceNote, describeError,
  describeReason, escapeHtml, formatAge, formatScore, formatUtc, formatWeight, isKnownVerdict,
  scoreColor, scoreToWidth, severityColor, verdictLabel, verdictNote,
} from '../src/shared/format.js';

// --- weights, as written down -----------------------------------------------

test('the weights sum to 1.00 and match section 7 of relic-spec', () => {
  assert.deepEqual(AXIS_WEIGHTS, {
    lp_residual: 0.30,
    floor_shape: 0.25,
    holder_dispersion: 0.20,
    dev_wallet_state: 0.15,
    social_afterglow: 0.10,
  });
  const sum = Object.values(AXIS_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 100) / 100, 1.00);
});

test('display order runs heaviest first and holds all five axes', () => {
  assert.deepEqual(AXIS_DISPLAY_ORDER, [
    'lp_residual', 'floor_shape', 'holder_dispersion', 'dev_wallet_state', 'social_afterglow',
  ]);
  assert.equal(new Set(AXIS_DISPLAY_ORDER).size, 5);
});

test('axisWeight: the API value wins, otherwise fall back to the relic-spec value', () => {
  assert.equal(axisWeight({ key: 'lp_residual', weight: 0.33 }), 0.33);
  assert.equal(axisWeight({ key: 'lp_residual' }), 0.30, 'an unreadable weight has to fall back to the spec');
  assert.equal(axisWeight({ key: 'social_afterglow', weight: null }), 0.10);
  assert.equal(axisWeight({ key: 'brand_new_axis' }), null, 'the weight of an unknown axis is not invented');
  assert.equal(axisWeight(null), null);
});

test('axisBarHeight: heavier weight means a thicker bar, and all five differ', () => {
  const heights = AXIS_DISPLAY_ORDER.map((key) => axisBarHeight(AXIS_WEIGHTS[key]));
  assert.deepEqual(heights, [16, 14, 12, 10, 8]);
  assert.equal(new Set(heights).size, 5);
});

test('axisBarHeight: an unknown weight draws thinnest -- there is no basis for drawing it heavy', () => {
  assert.equal(axisBarHeight(null), AXIS_BAR_HEIGHT.min);
  assert.equal(axisBarHeight(undefined), AXIS_BAR_HEIGHT.min);
  assert.equal(axisBarHeight(Number.NaN), AXIS_BAR_HEIGHT.min);
});

test('axisBarHeight: stays inside its bounds', () => {
  assert.equal(axisBarHeight(-5), AXIS_BAR_HEIGHT.min);
  assert.equal(axisBarHeight(0), AXIS_BAR_HEIGHT.min);
  assert.equal(axisBarHeight(100), AXIS_BAR_HEIGHT.max);
});

test('formatWeight: a ratio becomes a percentage, and unknown says so', () => {
  assert.equal(formatWeight(0.30), '30%');
  assert.equal(formatWeight(0.125), '12.5%');
  assert.equal(formatWeight(null), 'weight unknown');
});

// --- missing readings never blur into 0 -------------------------------------

test('scoreColor: null is grey -- paint it like a 0 (red) and a failed lookup reads as death', () => {
  assert.equal(scoreColor(null), PALETTE.shadeGray);
  assert.equal(scoreColor(undefined), PALETTE.shadeGray);
  assert.equal(scoreColor(Number.NaN), PALETTE.shadeGray);
  assert.equal(scoreColor(0), PALETTE.tagRed);
  assert.notEqual(scoreColor(null), scoreColor(0), 'missing and 0 in the same colour cannot be told apart');
});

test('scoreColor: band boundaries', () => {
  assert.equal(scoreColor(70), PALETTE.grass);
  assert.equal(scoreColor(69), PALETTE.dustYellow);
  assert.equal(scoreColor(40), PALETTE.dustYellow);
  assert.equal(scoreColor(39), PALETTE.tagRed);
});

test('formatScore: null prints as --, 0 prints as 0', () => {
  assert.equal(formatScore(null), '--');
  assert.equal(formatScore(undefined), '--');
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(50.4), '50');
});

test('scoreToWidth: clamps to 0-100, and a missing reading is 0 wide (not drawing the bar is handled elsewhere)', () => {
  assert.equal(scoreToWidth(57), 57);
  assert.equal(scoreToWidth(-10), 0);
  assert.equal(scoreToWidth(140), 100);
  assert.equal(scoreToWidth(null), 0);
});

// --- verdict ----------------------------------------------------------------

test('there are only the three verdicts in the contract -- no hype verdict rides along', () => {
  assert.deepEqual(VERDICTS, ['dormant', 'dead', 'unclear']);
  for (const bad of ['revival', 'moon', 'gem', 'jackpot']) {
    assert.equal(isKnownVerdict(bad), false, `${bad} passed as a verdict`);
  }
});

test('verdictLabel / verdictNote: unknown values are not invented', () => {
  assert.equal(verdictLabel('dormant'), 'Dormant');
  assert.equal(verdictLabel('dead'), 'Dead');
  assert.equal(verdictLabel('unclear'), 'Unclear');
  assert.equal(verdictLabel('revival'), 'Unknown');
  assert.match(verdictNote('revival'), /No verdict returned/);
});

test('verdictNote: no verdict speaks about the future or about odds', () => {
  const forbidden = /\b(will|guarantee|guaranteed|probability|predict|prediction|recover|revival)\b/i;
  for (const verdict of [...VERDICTS, 'unknown']) {
    assert.doesNotMatch(verdictNote(verdict), forbidden, `the wording for ${verdict} reads like a forecast`);
  }
});

// --- reason -----------------------------------------------------------------

test('describeReason: knows every code in section 9 of relic-spec', () => {
  for (const code of Object.keys(VERDICT_REASONS)) {
    const info = describeReason(code);
    assert.equal(info.known, true, `${code} is not recognized`);
    assert.ok(info.text.length > 0);
    assert.ok(['alert', 'note'].includes(info.severity));
  }
});

test('describeReason: only the cannot-exit reasons are alerts (the rest are notes)', () => {
  assert.equal(describeReason('high aggregate but cannot exit').severity, 'alert');
  assert.equal(describeReason('no exit liquidity, no trading floor').severity, 'alert');
  assert.equal(describeReason('no liquidity read').severity, 'note');
  assert.equal(describeReason('insufficient coverage').severity, 'note');
});

test('describeReason: absent gives null, and an unknown code says it is unknown', () => {
  assert.equal(describeReason(null), null);
  assert.equal(describeReason(''), null);
  assert.equal(describeReason('   '), null);
  const unknown = describeReason('something new');
  assert.equal(unknown.known, false);
  assert.match(unknown.text, /not recognized/);
});

// --- confidence -------------------------------------------------------------

test('confidenceNote: low and medium are surfaced, only high stays quiet', () => {
  assert.equal(confidenceNote('low'), 'low confidence');
  assert.equal(confidenceNote('medium'), 'medium confidence');
  assert.equal(confidenceNote('high'), '');
  assert.equal(confidenceNote(null), 'confidence unknown');
  assert.equal(confidenceNote('bogus'), 'confidence unknown');
});

test('severityColor: how bad it is and how sure we are are separate axes', () => {
  assert.equal(severityColor('alert'), PALETTE.tagRed);
  assert.equal(severityColor('caution'), PALETTE.dustYellow);
  assert.equal(severityColor('info'), PALETTE.shadeGray);
  assert.equal(severityColor(undefined), PALETTE.shadeGray);
});

// --- axis labels ------------------------------------------------------------

test('axisLabel: the label the API sent wins, with a fallback when there is none', () => {
  assert.equal(axisLabel({ key: 'lp_residual', label: 'Liquidity left' }), 'Liquidity left');
  assert.equal(axisLabel({ key: 'lp_residual', label: '   ' }), 'LP residual');
  assert.equal(axisLabel({ key: 'lp_residual' }), 'LP residual');
  assert.equal(axisLabel({ key: 'brand_new_axis' }), 'brand_new_axis');
  assert.equal(axisLabel(null), 'Unknown axis');
});

// --- escaping ---------------------------------------------------------------

test('escapeHtml: blocks all five characters', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
});

test('escapeHtml: & goes first, so nothing gets double-escaped', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

// --- time -------------------------------------------------------------------

test('formatAge: seconds, minutes, hours, days', () => {
  assert.equal(formatAge(0), '0s');
  assert.equal(formatAge(59), '59s');
  assert.equal(formatAge(120), '2m');
  assert.equal(formatAge(3600), '1h');
  assert.equal(formatAge(86_400 * 3), '3d');
});

test('formatAge: an unreadable value is unknown (never invented as 0s)', () => {
  assert.equal(formatAge(null), 'unknown');
  assert.equal(formatAge(-1), 'unknown');
  assert.equal(formatAge('soon'), 'unknown');
});

test('formatUtc: always prints in UTC, and passes the raw value through when it cannot parse', () => {
  assert.equal(formatUtc('2026-03-11T07:00:00Z'), '2026-03-11 07:00 UTC');
  assert.equal(formatUtc('2025-11-02T10:11:12Z'), '2025-11-02 10:11 UTC');
  assert.equal(formatUtc('not a date'), 'not a date');
  assert.equal(formatUtc(''), '');
  assert.equal(formatUtc(null), '');
});

// --- error wording ----------------------------------------------------------

// --- timeout ----------------------------------------------------------------

test('the request timeout is bounded at both ends', () => {
  // Too short and a slow but healthy response is cut off, which reads to the user
  // as "the API is unreachable" rather than "this one is taking a while".
  assert.ok(REQUEST_TIMEOUT_MS >= 5_000, 'too short a timeout cuts off a healthy response');
  // It must not be an unbounded wait either -- that stalls the queue
  assert.ok(REQUEST_TIMEOUT_MS <= 60_000, 'too long a timeout stalls the queue');
});

// --- failure notices: showing nothing at all is the worst failure of the lot -

test('apiFailureNotice: when the server is unreachable, say so in words a person can read', () => {
  const notice = apiFailureNotice(
    { status: 0, code: 'network', message: 'Failed to fetch' },
    { apiBase: 'https://api.bazr.market' },
  );
  assert.equal(notice.kind, 'error');
  assert.match(notice.title, /cannot reach/i);
  assert.ok(notice.body.includes('api.bazr.market'), 'which host went down is not visible');
  assert.match(notice.body, /settings/i, 'the user is not told what they can do about it');
});

test('apiFailureNotice: timeout, 5xx and 429 are handled as three different events', () => {
  const timeout = apiFailureNotice({ status: 0, code: 'timeout' });
  const server = apiFailureNotice({ status: 503 });
  const limited = apiFailureNotice({ status: 429, retryAfterMs: 30_000 });

  assert.match(timeout.title, /timed out/i);
  assert.match(server.title, /returned an error/i);
  assert.match(server.body, /503/);
  assert.match(limited.title, /rate limited/i);
  assert.match(limited.body, /30s/, 'Retry-After is not shown to the user');

  // Rate limiting is not an outage. Raise it as a red error and the user thinks the extension broke
  assert.equal(limited.kind, 'warn');
  assert.equal(timeout.kind, 'error');
  assert.equal(server.kind, 'error');

  const titles = [timeout.title, server.title, limited.title];
  assert.equal(new Set(titles).size, 3, 'different failures got flattened into the same wording');
});

test('apiFailureNotice: no failure ever reads as a verdict on the token', () => {
  // Read "lookup failed" as "dead token" and the most expensive bug in this extension reaches the UI
  for (const error of [{ status: 0, code: 'network' }, { status: 0, code: 'timeout' }, { status: 503 }]) {
    const notice = apiFailureNotice(error);
    assert.match(notice.body, /not judged|not a verdict/i, `it does not say this is not a verdict: ${notice.body}`);
  }
});

test('[control] apiFailureNotice: a 404 raises nothing -- not being a mint is normal', () => {
  assert.equal(apiFailureNotice({ status: 404 }), null);
  assert.equal(apiFailureNotice({ status: 404, code: 'unknown_mint' }), null);
  assert.equal(apiFailureNotice(null), null);
  assert.equal(apiFailureNotice(undefined), null);
});

test('apiFailureNotice: an unknown apiBase does not leave empty brackets behind', () => {
  const notice = apiFailureNotice({ status: 0, code: 'network' });
  assert.doesNotMatch(notice.body, /\(\)/, 'empty brackets go straight to the screen');
});

test('apiFailureNotice: every string is English', () => {
  const errors = [
    { status: 0, code: 'network' }, { status: 0, code: 'timeout' },
    { status: 429, retryAfterMs: 1000 }, { status: 503 }, { status: 418, message: 'teapot' },
  ];
  for (const error of errors) {
    const notice = apiFailureNotice(error, { apiBase: 'https://example.test' });
    assert.doesNotMatch(`${notice.title} ${notice.body}`, /[\uAC00-\uD7A3]/, 'the notice contains Hangul');
  }
});

test('describeError: does not flatten the cause', () => {
  assert.match(describeError({ status: 429, retryAfterMs: 30_000 }), /Rate limited.*Retry in 30s/);
  assert.match(describeError({ status: 429 }), /Rate limited/);
  assert.match(describeError({ status: 404 }), /does not know this mint/);
  assert.match(describeError({ status: 0, message: 'ENOTFOUND' }), /Cannot reach the API: ENOTFOUND/);
  assert.match(describeError({ status: 503, message: 'upstream down' }), /API error 503: upstream down/);
  assert.equal(describeError(null), 'Unknown error.');
});
