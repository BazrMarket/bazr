// Wiring checks for the extension pages (popup and options).
//
// One class of defect has to be caught without a browser: **a typo in an id**.
// When getElementById returns null the first access throws, and that exception only
// lands in the extension page console. The screen simply does nothing -- the classic
// spot where "it is in the code" is not the same thing as "it works".
//
// So this compares the set of ids in the HTML against the set of ids the JS looks up.
// MV3 CSP violations (inline scripts, onclick) and Hangul in the UI are checked alongside.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');
const read = (...parts) => readFileSync(path.join(SRC, ...parts), 'utf8');

const PAGES = [
  {
    name: 'popup',
    html: read('popup', 'popup.html'),
    js: read('popup', 'popup.js'),
    css: 'popup.css',
    script: 'popup.js',
  },
  {
    name: 'options',
    html: read('options', 'options.html'),
    js: read('options', 'options.js'),
    css: 'options.css',
    script: 'options.js',
  },
];

function collect(text, pattern, group = 1) {
  const re = new RegExp(pattern, 'g');
  const out = new Set();
  let match = re.exec(text);
  while (match !== null) {
    out.add(match[group]);
    match = re.exec(text);
  }
  return out;
}

/** ids that exist statically in the HTML */
const htmlIds = (html) => collect(html, '\\bid="([^"]+)"');

/**
 * The ids the JS looks up. Only quoted literals count --
 * backtick templates (`site-${id}`) are built at runtime, so they are out of scope for a static comparison.
 */
function referencedIds(js) {
  return new Set([
    ...collect(js, "\\bel\\(\\s*'([^']+)'\\s*\\)"),
    ...collect(js, '\\bel\\(\\s*"([^"]+)"\\s*\\)'),
    ...collect(js, "getElementById\\(\\s*'([^']+)'\\s*\\)"),
    ...collect(js, 'getElementById\\(\\s*"([^"]+)"\\s*\\)'),
  ]);
}

for (const page of PAGES) {
  test(`${page.name}: every id the JS looks up exists in the HTML`, () => {
    const available = htmlIds(page.html);
    const wanted = referencedIds(page.js);
    assert.ok(wanted.size > 0, 'no id reference was found at all -- the regex is not covering its target');

    const missing = [...wanted].filter((id) => !available.has(id)).sort();
    assert.deepEqual(missing, [], `it is looking up an id the HTML does not have (that screen dies quietly)`);
  });

  test(`${page.name}: label[for] and aria references point at ids that exist`, () => {
    const available = htmlIds(page.html);
    const refs = [
      ...collect(page.html, '\\bfor="([^"]+)"'),
      ...collect(page.html, '\\baria-describedby="([^"]+)"'),
      ...collect(page.html, '\\baria-labelledby="([^"]+)"'),
    ];
    const missing = refs.filter((id) => !available.has(id)).sort();
    assert.deepEqual(missing, [], 'something inside the HTML points at an id that does not exist');
  });

  test(`${page.name}: no id appears twice`, () => {
    const all = [...page.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const duplicates = all.filter((id, i) => all.indexOf(id) !== i);
    assert.deepEqual(duplicates, [], 'which one getElementById picks is left undefined');
  });

  test(`${page.name}: MV3 CSP -- no inline script and no inline handler`, () => {
    // <script src="..."> is fine, <script>body</script> is not
    const scripts = [...page.html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /\bsrc="/, 'an inline script does not run under the MV3 CSP');
      assert.equal(body.trim(), '', 'there is content inside a script tag');
    }
    assert.doesNotMatch(page.html, /\son[a-z]+="/, 'inline event handlers (onclick and friends) violate the CSP');
    assert.doesNotMatch(page.html, /javascript:/i);
  });

  test(`${page.name}: references the files the build puts beside it, by relative path`, () => {
    assert.ok(page.html.includes(`href="${page.css}"`), `the ${page.css} reference is missing or on a different path`);
    assert.ok(page.html.includes(`src="${page.script}"`), `the ${page.script} reference is missing or on a different path`);
    // An absolute path or an external origin would point outside the build output
    assert.doesNotMatch(page.html, /(href|src)="\//);
    assert.doesNotMatch(page.html, /(href|src)="https?:/);
  });

  test(`${page.name}: everything on screen is 100% English`, () => {
    // Looks at the whole HTML that actually reaches the screen, not at the comments (HTML comments
    // are not themselves forbidden, but they never render, so they are stripped before the check)
    const visible = page.html.replace(/<!--[\s\S]*?-->/g, '');
    const hangul = visible.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g);
    assert.equal(hangul, null, `the HTML contains Hangul: ${hangul?.slice(0, 5).join('')}`);
  });

  test(`${page.name}: the screen strings the JS builds carry no Hangul either`, () => {
    // Checks what is left once the comments (// and /* */) are stripped -- comments never render.
    const code = page.js
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
      .join('\n');
    const hangul = code.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g);
    assert.equal(hangul, null, `a code string contains Hangul: ${hangul?.slice(0, 5).join('')}`);
  });

  test(`${page.name}: nothing on screen is hype`, () => {
    const forbidden = /\b(guaranteed|100x|1000x|moonshot|next pump|buy signal|revival|will recover)\b/i;
    assert.doesNotMatch(page.html.replace(/<!--[\s\S]*?-->/g, ''), forbidden);
  });

  test(`${page.name}: there is no API key field -- anyone can open an extension bundle`, () => {
    assert.doesNotMatch(page.html, /type="password"/);
    assert.doesNotMatch(page.html, /\bid="[^"]*(api-key|apikey|token|secret)[^"]*"/i);
  });
}

// --- does the options page really cover all four things ---------------------

test('the options page covers API base, auto overlay, per-site allow and clear cache', () => {
  const js = read('options', 'options.js');
  const html = read('options', 'options.html');

  // 1) API base
  assert.match(js, /apiBase:/, 'it does not save the API base');
  assert.match(html, /id="api-base"/);
  // 2) auto overlay
  assert.match(js, /autoOverlay:/, 'it does not save the auto overlay toggle');
  assert.match(html, /id="auto-overlay"/);
  // 3) per-site allow
  assert.match(js, /siteEnabled:/, 'it does not save the per-site toggles');
  assert.match(js, /SUPPORTED_SITES/, 'building the site list anywhere but the constants splits the source of truth in two');
  assert.match(html, /id="site-list"/);
  // 4) clear cache
  assert.match(js, /MSG\.CACHE_CLEAR/, 'it never asks the background worker to clear the cache');
  assert.match(html, /id="cache-clear"/);
});

test('for an origin outside the manifest the options page asks for permission before saving', () => {
  const js = read('options', 'options.js');
  assert.match(js, /needsOptionalPermission/);
  assert.match(js, /chrome\.permissions\.request/);

  // The permission request has to come before the save. The other way round leaves "saved, but no request ever goes out".
  const permissionAt = js.indexOf('chrome.permissions.request');
  const saveAt = js.indexOf('saveSettings({ apiBase: normalized }');
  assert.ok(permissionAt > -1 && saveAt > -1);
  assert.ok(permissionAt < saveAt, 'the save happens before the permission request');
});

test('the options page renders the disclaimer', () => {
  assert.match(read('options', 'options.html'), /id="disclaimer"/);
  assert.match(read('options', 'options.js'), /FALLBACK_DISCLAIMER/);
});

// --- the overlay lives inside a Shadow DOM ----------------------------------

test('every piece of UI the content script inserts is a closed Shadow DOM', () => {
  const overlay = read('content', 'overlay.js');
  const attachCount = (overlay.match(/attachShadow\(/g) || []).length;
  const closedCount = (overlay.match(/attachShadow\(\{\s*mode:\s*'closed'\s*\}\)/g) || []).length;
  assert.ok(attachCount > 0, 'no Shadow DOM at all -- this and the host page CSS will break each other');
  assert.equal(closedCount, attachCount, `${closedCount} of ${attachCount} attachShadow calls are closed`);
});

test('the content script only reaches chrome.runtime through the safe wrapper (context invalidation)', () => {
  const index = read('content', 'index.js');
  assert.match(index, /function safeSendMessage/);
  assert.match(index, /chrome\?\.runtime\?\.id/, 'calling without checking runtime.id throws after an extension reload');
  assert.match(index, /chrome\.runtime\.lastError/);
  assert.match(index, /showContextInvalidatedNotice/, 'not telling the user the link is gone means dying quietly');

  // Nothing may call sendMessage directly, outside the wrapper
  const direct = (index.match(/chrome\.runtime\.sendMessage\(/g) || []).length;
  assert.equal(direct, 1, `sendMessage is called outside safeSendMessage (${direct} call sites)`);
});

// --- is failure visible on screen -------------------------------------------

test('the content script does not swallow a failed lookup', () => {
  const index = read('content', 'index.js');
  const overlay = read('content', 'overlay.js');

  assert.match(overlay, /export function showApiFailureNotice/, 'there is no failure notice at all');
  assert.match(index, /apiFailureNotice/, 'nothing turns a failure into words');
  assert.match(index, /function reportApiFailure/);

  // Both paths that produce failures have to report them:
  //   1) batch lookups (many addresses on a timeline)
  //   2) the page-level price tag on a detail page
  const calls = (index.match(/reportApiFailure\(/g) || []).length;
  assert.ok(calls >= 3, `only ${calls} reportApiFailure call sites (1 definition plus at least 2 failure paths)`);

  // The batch path must not just drop the error and move on
  assert.match(index, /result\.error/, 'the error on a batch result is never read');
  // The detail page path must not stop at an early return
  assert.match(index, /if \(response\?\.error\) reportApiFailure\(response\.error\)/);
});

test('failure notices carry a cooldown so they do not become noise', () => {
  const index = read('content', 'index.js');
  assert.match(index, /FAILURE_NOTICE_COOLDOWN_MS/);
  assert.match(index, /function noteApiSuccess/, 'if success never lifts the cooldown, the next outage goes unreported');
});

test('API strings that go into a notice are set through textContent only', () => {
  const overlay = read('content', 'overlay.js');
  // Notice titles and bodies come from API error messages. Put them in with innerHTML and they get injected as is.
  const noticeBlock = overlay.slice(overlay.indexOf('export function showNotice'));
  assert.doesNotMatch(noticeBlock, /innerHTML/, 'there is an innerHTML on the notice path');
  assert.match(noticeBlock, /titleEl\.textContent = title/);
  assert.match(noticeBlock, /bodyEl\.textContent = body/);
});

test('the service worker returns true for async replies (skip it and the channel closes first)', () => {
  const background = read('background', 'index.js');
  assert.match(background, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(background, /return true;/);
  assert.match(background, /chrome\.alarms\.create/, 'setInterval dies with the service worker');
});
