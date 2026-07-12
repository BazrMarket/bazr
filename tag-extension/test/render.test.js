// Render fidelity -- the example responses from docs/api-contract.md go in as fixtures, and
// the price tag has to draw exactly that response.
//
// The most expensive rule this file protects is a single one:
//   **a status:"unknown" axis must be drawn as "no data", not as 0.**
// Fold a missing reading into a 0-score bar and every token whose lookup failed looks dead.
// So each case below checks three ways: that "no data" comes out, that 0 does not,
// and that no filled bar is built at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeRelic } from '../src/shared/api.js';
import { AXIS_ORDER, AXIS_WEIGHTS } from '../src/shared/constants.js';
import {
  FALLBACK_DISCLAIMER, buildErrorHtml, buildLoadingHtml, buildPriceTagHtml,
} from '../src/shared/render.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const loadFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

const contractExample = loadFixture('contract-example');
const unknownAxes = loadFixture('unknown-axes');
const highAggregate = loadFixture('high-aggregate-no-exit');

// --- HTML parser (turns the string output back into structure) --------------

const AXIS_RE = /<li class="bzt__axis"([^>]*)>([\s\S]*?)<\/li>/g;
const CHIP_RE = /<li class="bzt__chip"([^>]*)>([\s\S]*?)<\/li>/g;

function attr(attrs, name) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
}

/** @returns {Array<{key,status,weight,height,value,hasFill,fillWidth}>} in the order they appear on screen */
function parseAxes(html) {
  AXIS_RE.lastIndex = 0;
  const rows = [];
  let match = AXIS_RE.exec(html);
  while (match !== null) {
    const [, attrs, body] = match;
    const height = /class="bzt__axisTrack" style="height:(\d+)px"/.exec(body);
    const fill = /class="bzt__axisFill" style="width:(\d+)%/.exec(body);
    const value = /class="bzt__axisValue">([^<]*)</.exec(body);
    rows.push({
      key: attr(attrs, 'data-axis'),
      status: attr(attrs, 'data-status'),
      weight: attr(attrs, 'data-weight'),
      height: height ? Number(height[1]) : null,
      value: value ? value[1] : null,
      hasFill: Boolean(fill),
      fillWidth: fill ? Number(fill[1]) : null,
    });
    match = AXIS_RE.exec(html);
  }
  return rows;
}

function parseChips(html) {
  CHIP_RE.lastIndex = 0;
  const rows = [];
  let match = CHIP_RE.exec(html);
  while (match !== null) {
    const [, attrs, body] = match;
    rows.push({
      key: attr(attrs, 'data-key'),
      severity: attr(attrs, 'data-severity'),
      confidence: attr(attrs, 'data-confidence'),
      text: body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    match = CHIP_RE.exec(html);
  }
  return rows;
}

const render = (fixture, options) => buildPriceTagHtml(normalizeRelic(fixture), options);

// --- the fixtures check themselves first ------------------------------------
// If a fixture breaks the contract, every render check standing on it proves nothing.

test('fixture: the contract example holds all five axes, and the contributions sum to the top-level score', () => {
  const keys = contractExample.axes.map((a) => a.key).sort();
  assert.deepEqual(keys, [...AXIS_ORDER].sort());

  const sum = contractExample.axes.reduce((acc, a) => acc + a.contribution, 0);
  assert.equal(Math.round(sum), contractExample.score, `Sigma contribution=${sum} != score`);

  for (const axis of contractExample.axes) {
    assert.equal(axis.weight, AXIS_WEIGHTS[axis.key], `the weight of ${axis.key} differs from section 7 of relic-spec`);
  }
});

test('fixture: the missing-data fixture carries its unknown axes as score=null (not 0)', () => {
  const unknown = unknownAxes.axes.filter((a) => a.status === 'unknown');
  assert.equal(unknown.length, 2);
  for (const axis of unknown) assert.equal(axis.score, null, `the missing reading on ${axis.key} is not null`);
});

// --- rendering the contract example response --------------------------------

test('contract example: symbol, name, score and verdict come out exactly as sent', () => {
  const html = render(contractExample);
  assert.match(html, /<span class="bzt__symbol">EXAMPLE<\/span>/);
  assert.match(html, /<span class="bzt__name">Example<\/span>/);
  assert.match(html, /class="bzt__score"[^>]*>50</);
  assert.match(html, /class="bzt__verdict" data-verdict="unclear">Unclear</);
  assert.match(html, /data-bazr-verdict="unclear"/);
  assert.match(html, /\/100 relic/);
});

test('contract example: all five axes are drawn and every one shows a real score', () => {
  const axes = parseAxes(render(contractExample));
  assert.equal(axes.length, 5);

  const byKey = Object.fromEntries(axes.map((a) => [a.key, a]));
  assert.deepEqual(Object.keys(byKey).sort(), [...AXIS_ORDER].sort());

  for (const source of contractExample.axes) {
    const row = byKey[source.key];
    assert.equal(row.status, 'ok', `${source.key} was not drawn as ok`);
    assert.equal(row.value, String(source.score), `the displayed score for ${source.key} differs`);
    assert.equal(row.hasFill, true, `${source.key} has no filled bar`);
    assert.equal(row.fillWidth, source.score, `the bar width for ${source.key} does not match the score`);
  }
});

test('contract example: mint, scored_at, graduated_at, cache and sources all show up in the meta line', () => {
  const html = render(contractExample);
  assert.ok(html.includes(contractExample.mint), 'the mint address does not appear');
  assert.match(html, /scored 2026-03-11 07:00 UTC/);
  assert.match(html, /graduated 2025-11-02 10:11 UTC/);
  assert.match(html, /cache hit \(2m old\)/);
  assert.match(html, /sources: helius/);
});

test('contract example: the disclaimer renders word for word as the response sent it', () => {
  const html = render(contractExample);
  assert.match(html, /class="bzt__disclaimer"/);
  assert.ok(html.includes(contractExample.disclaimer), 'the original disclaimer text does not appear');
});

// --- [top priority] status:"unknown" -> "no data" ---------------------------

test('a missing axis is drawn as "no data" -- never folded into 0', () => {
  const axes = parseAxes(render(unknownAxes));
  const byKey = Object.fromEntries(axes.map((a) => [a.key, a]));

  for (const key of ['lp_residual', 'social_afterglow']) {
    const row = byKey[key];
    assert.equal(row.status, 'unknown', `${key} was not drawn as unknown`);
    assert.equal(row.value, 'no data', `${key} does not display "no data"`);
    assert.notEqual(row.value, '0', `${key} collapsed into 0`);
    assert.equal(row.hasFill, false, `${key} got a filled bar -- missing data looks like it has a value`);
    assert.equal(row.fillWidth, null);
  }
});

test('only the missing axes lose their bar -- the observed ones are drawn as usual', () => {
  const axes = parseAxes(render(unknownAxes));
  assert.equal(axes.length, 5, 'all five axes come out even when some are missing');

  const okRows = axes.filter((a) => a.status === 'ok');
  const unknownRows = axes.filter((a) => a.status === 'unknown');
  assert.equal(okRows.length, 3);
  assert.equal(unknownRows.length, 2);
  assert.equal(okRows.every((a) => a.hasFill), true);
  assert.equal(unknownRows.some((a) => a.hasFill), false);

  // Control: the observed axes still show their scores normally on the same screen
  const byKey = Object.fromEntries(axes.map((a) => [a.key, a]));
  assert.equal(byKey.holder_dispersion.value, '71');
  assert.equal(byKey.floor_shape.value, '27');
});

test('a response with no axes at all still produces five rows of "no data"', () => {
  const axes = parseAxes(buildPriceTagHtml(normalizeRelic({ mint: 'x', verdict: 'unclear', axes: [] })));
  assert.equal(axes.length, 5);
  assert.equal(axes.every((a) => a.status === 'unknown'), true);
  assert.equal(axes.every((a) => a.value === 'no data'), true);
  assert.equal(axes.some((a) => a.hasFill), false);
  assert.equal(axes.some((a) => a.value === '0'), false);
});

test('a null score prints as -- rather than 0, with "no observable axis" as the unit', () => {
  const html = buildPriceTagHtml(normalizeRelic({ mint: 'x', score: null, verdict: 'unclear', axes: [] }));
  assert.match(html, /class="bzt__score"[^>]*>--</);
  assert.match(html, /no observable axis/);
  assert.doesNotMatch(html, /class="bzt__score"[^>]*>0</);
});

// --- weights: the heavier axis is visibly the bigger one --------------------

test('axes are drawn heaviest first (lp_residual on top)', () => {
  const order = parseAxes(render(contractExample)).map((a) => a.key);
  assert.deepEqual(order, [
    'lp_residual',        // .30
    'floor_shape',        // .25
    'holder_dispersion',  // .20
    'dev_wallet_state',   // .15
    'social_afterglow',   // .10
  ]);
});

test('mini-bar thickness tracks the weight -- all five differ', () => {
  const axes = parseAxes(render(contractExample));
  const heights = axes.map((a) => a.height);

  assert.deepEqual(heights, [16, 14, 12, 10, 8], 'thickness does not follow the weight order');
  // Even two axes at the same thickness hide the fact that lp_residual is the decisive one
  assert.equal(new Set(heights).size, 5, 'two axes share a thickness');
  for (let i = 1; i < heights.length; i += 1) {
    assert.ok(heights[i] < heights[i - 1], `${axes[i].key} is not thinner than the axis above it`);
  }
});

test('the weight is written out as a number too (thickness alone does not convey a ratio)', () => {
  const html = render(contractExample);
  assert.match(html, /class="bzt__axisWeight">w 30%</);
  assert.match(html, /class="bzt__axisWeight">w 10%</);
  const axes = parseAxes(html);
  assert.deepEqual(axes.map((a) => a.weight), ['0.3', '0.25', '0.2', '0.15', '0.1']);
});

test('a missing axis is still drawn at its full weight -- what is missing has to be visible', () => {
  const byKey = Object.fromEntries(parseAxes(render(unknownAxes)).map((a) => [a.key, a]));
  assert.equal(byKey.lp_residual.height, 16, 'draw a missing axis thin and nobody can see what is missing');
  assert.equal(byKey.social_afterglow.height, 8);
});

// --- verdict reason: telling the three unclear cases apart ------------------

test('the reason is shown word for word as the response sent it (no liquidity read)', () => {
  const html = render(unknownAxes);
  assert.match(html, /class="bzt__reason"[^>]*data-reason="no liquidity read"/);
  assert.match(html, /class="bzt__reasonKey">no liquidity read</);
  assert.match(html, /data-severity="note"/);
});

test('[the response most easily misread] high aggregate but cannot exit is drawn as a warning', () => {
  const html = render(highAggregate);

  // The aggregate is 68 and the verdict is unclear. Hide the reason and it reads as "nice score".
  assert.match(html, /class="bzt__score"[^>]*>68</);
  assert.match(html, /data-verdict="unclear">Unclear</);
  assert.match(html, /data-reason="high aggregate but cannot exit"/);
  assert.match(html, /class="bzt__reason" data-severity="alert"/);
  assert.match(html, /not enough liquidity to sell into/);

  // And the axis behind that reason sits at the top showing 22
  const byKey = Object.fromEntries(parseAxes(html).map((a) => [a.key, a]));
  assert.equal(byKey.lp_residual.value, '22');
});

test('with no reason the reason block is not drawn at all', () => {
  const html = render(contractExample);
  assert.equal(contractExample.reason, undefined);
  assert.doesNotMatch(html, /class="bzt__reason"/);
});

test('an unrecognized reason code is passed through verbatim, never invented', () => {
  const html = buildPriceTagHtml(normalizeRelic({
    mint: 'x', verdict: 'unclear', reason: 'brand new backend reason', axes: [],
  }));
  assert.match(html, /class="bzt__reasonKey">brand new backend reason</);
  assert.match(html, /not recognized by this build/);
});

// --- label chips: the chance of a false positive is not hidden --------------

test('a low confidence is written on the chip', () => {
  const chips = parseChips(render(contractExample));
  assert.equal(chips.length, 3);

  const rug = chips.find((c) => c.key === 'rug-history');
  assert.equal(rug.confidence, 'low');
  assert.equal(rug.severity, 'alert');
  assert.match(rug.text, /low confidence/);

  const dev = chips.find((c) => c.key === 'dev-holds-N%');
  assert.equal(dev.confidence, 'medium');
  assert.match(dev.text, /medium confidence/);
});

test('a high confidence adds no clutter (control)', () => {
  const chips = parseChips(render(contractExample));
  const burned = chips.find((c) => c.key === 'lp-burned');
  assert.equal(burned.confidence, 'high');
  assert.doesNotMatch(burned.text, /confidence/);
  assert.equal(burned.text, 'LP burned');
});

test('severity and confidence ride separately (alert plus low has to be possible)', () => {
  const chips = parseChips(render(contractExample));
  const rug = chips.find((c) => c.key === 'rug-history');
  assert.equal(rug.severity, 'alert');
  assert.equal(rug.confidence, 'low');
});

test('with no labels at all it says so -- the section is not quietly dropped', () => {
  const html = buildPriceTagHtml(normalizeRelic({ mint: 'x', verdict: 'dead', axes: [], tags: [] }));
  assert.match(html, /No labels returned for this mint\./);
});

// --- the disclaimer is always there -----------------------------------------

test('the disclaimer renders even when the response has none', () => {
  const withoutDisclaimer = { ...contractExample };
  delete withoutDisclaimer.disclaimer;
  const html = render(withoutDisclaimer);
  assert.match(html, /class="bzt__disclaimer"/);
  assert.ok(html.includes(FALLBACK_DISCLAIMER));
});

test('the disclaimer is on the error screen too, loading being the one exception', () => {
  const errorHtml = buildErrorHtml('So1111111111111111111111111111111111111111', 'Rate limited by the API.');
  assert.match(errorHtml, /class="bzt__disclaimer"/);
  assert.match(errorHtml, /Rate limited by the API\./);
  assert.ok(errorHtml.includes(FALLBACK_DISCLAIMER));
});

test('the loading screen does not invent a score', () => {
  const html = buildLoadingHtml('So1111111111111111111111111111111111111111');
  assert.match(html, /Reading the price tag\.\.\./);
  assert.doesNotMatch(html, /class="bzt__score"/);
  assert.doesNotMatch(html, /class="bzt__verdict"/);
});

// --- injection defence ------------------------------------------------------

test('token metadata is arbitrary on-chain text -- all of it gets escaped', () => {
  const hostile = {
    ...contractExample,
    symbol: '<img src=x onerror=alert(1)>',
    name: '"><script>alert(2)</script>',
    tags: [{
      key: 'lp-burned',
      label: '<b>bold</b>',
      severity: 'info',
      observed: true,
      confidence: 'high',
      evidence: {},
    }],
  };
  const html = render(hostile);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test('a blurb going into a title attribute cannot leak a quote out of it', () => {
  const hostile = {
    ...contractExample,
    axes: [{ ...contractExample.axes[1], blurb: 'quote " and > angle' }],
  };
  const html = render(hostile);
  assert.match(html, /title="quote &quot; and &gt; angle"/);
});

// --- the popup and the overlay share one function ---------------------------

test('only the wide / showClose / showCopy options differ -- the body is identical', () => {
  const relic = normalizeRelic(contractExample);
  const compact = buildPriceTagHtml(relic);
  const wide = buildPriceTagHtml(relic, { wide: true, showCopy: true, showClose: true });

  assert.match(compact, /class="bzt"/);
  assert.match(wide, /class="bzt bzt--wide"/);
  assert.doesNotMatch(compact, /data-bazr-action="copy"/);
  assert.match(wide, /data-bazr-action="copy" data-bazr-mint="So1111111111111111111111111111111111111111"/);
  assert.match(wide, /data-bazr-action="close"/);

  // Axes and chips are the same whatever the options -- the two screens must not diverge
  assert.deepEqual(parseAxes(compact), parseAxes(wide));
  assert.deepEqual(parseChips(compact), parseChips(wide));
});
