// The API layer. Checks that it holds to the wire shape in docs/api-contract.md, and
// that it never swallows a failure quietly.
//
// fetch is injected, so every path runs without a network -- 404 / 429 / non-JSON /
// timeout all happen in the field, and if any one of them ends up as a blank panel
// the user never finds out why nothing works.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError, createApiClient, normalizeBaseUrl, normalizeRelic, parseRetryAfter,
} from '../src/shared/api.js';
import { AXIS_ORDER } from '../src/shared/constants.js';

// --- normalizeBaseUrl --------------------------------------------------------

test('normalizeBaseUrl: strips trailing slashes and keeps only origin plus path', () => {
  assert.equal(normalizeBaseUrl('https://api.example.test'), 'https://api.example.test');
  assert.equal(normalizeBaseUrl('https://api.example.test/'), 'https://api.example.test');
  assert.equal(normalizeBaseUrl('https://api.example.test///'), 'https://api.example.test');
  assert.equal(normalizeBaseUrl('  http://localhost:8030/  '), 'http://localhost:8030');
  assert.equal(normalizeBaseUrl('https://api.example.test/v1/'), 'https://api.example.test/v1');
});

test('normalizeBaseUrl: throws on anything but http/https (it must not break after it is saved)', () => {
  for (const bad of ['', '   ', 'not a url', 'ftp://api.example.test', 'javascript:alert(1)', null, undefined]) {
    assert.throws(() => normalizeBaseUrl(bad), ApiError, `should not be accepted: ${bad}`);
  }
});

// --- parseRetryAfter ---------------------------------------------------------

test('parseRetryAfter: reads both the seconds form and an HTTP-date', () => {
  const now = Date.parse('2026-03-11T07:00:00Z');
  assert.equal(parseRetryAfter('30', now), 30_000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter('Wed, 11 Mar 2026 07:00:30 GMT', now), 30_000);
  // A time already in the past clamps to 0, not a negative
  assert.equal(parseRetryAfter('Wed, 11 Mar 2026 06:59:00 GMT', now), 0);
});

test('parseRetryAfter: missing or unreadable gives null (never silently 0)', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(undefined), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('soon'), null);
});

// --- normalizeRelic ----------------------------------------------------------

test('normalizeRelic: with no axes at all it still fills five, as unknown', () => {
  const relic = normalizeRelic({ mint: 'x' });
  assert.equal(relic.axes.length, 5);
  assert.deepEqual(relic.axes.map((a) => a.key), AXIS_ORDER);
  for (const axis of relic.axes) {
    assert.equal(axis.status, 'unknown');
    assert.equal(axis.score, null, 'a missing reading collapsed into 0');
  }
});

test('normalizeRelic: any status other than ok lays the score down to null', () => {
  const relic = normalizeRelic({
    mint: 'x',
    axes: [{ key: 'lp_residual', status: 'unknown', score: 0, weight: 0.3 }],
  });
  const lp = relic.axes.find((a) => a.key === 'lp_residual');
  assert.equal(lp.status, 'unknown');
  assert.equal(lp.score, null, 'status is unknown yet a 0 score survived');
  assert.equal(lp.weight, 0.3, 'weight is kept even when the axis is unknown');
});

test('normalizeRelic: status ok with a non-numeric score gets demoted to unknown', () => {
  const relic = normalizeRelic({
    mint: 'x',
    axes: [{ key: 'lp_residual', status: 'ok', score: null }],
  });
  assert.equal(relic.axes.find((a) => a.key === 'lp_residual').status, 'unknown');
});

test('normalizeRelic: a score of 0 is not a missing reading -- it survives intact (control)', () => {
  const relic = normalizeRelic({
    mint: 'x',
    score: 0,
    axes: [{ key: 'lp_residual', status: 'ok', score: 0, weight: 0.3 }],
  });
  assert.equal(relic.score, 0);
  const lp = relic.axes.find((a) => a.key === 'lp_residual');
  assert.equal(lp.status, 'ok');
  assert.equal(lp.score, 0);
});

test('normalizeRelic: an axis outside the contract is appended, not discarded', () => {
  const relic = normalizeRelic({
    mint: 'x',
    axes: [{ key: 'brand_new_axis', status: 'ok', score: 40, weight: 0.05 }],
  });
  assert.equal(relic.axes.length, 6);
  assert.equal(relic.axes[5].key, 'brand_new_axis');
  assert.equal(relic.axes[5].score, 40);
});

test('normalizeRelic: keeps reason (the only field that separates the three unclear cases)', () => {
  assert.equal(normalizeRelic({ reason: 'high aggregate but cannot exit' }).reason, 'high aggregate but cannot exit');
  assert.equal(normalizeRelic({ reason: '   ' }).reason, null);
  assert.equal(normalizeRelic({}).reason, null);
});

test('normalizeRelic: tag severity/confidence do not take values outside the contract', () => {
  const relic = normalizeRelic({
    tags: [
      { key: 'a', severity: 'apocalyptic', confidence: 'certain' },
      { key: 'b', severity: 'alert', confidence: 'low', observed: false },
    ],
  });
  assert.equal(relic.tags[0].severity, 'info', 'an unrecognized severity passed through leaves the UI colour undefined');
  assert.equal(relic.tags[0].confidence, null, 'an unrecognized confidence is not invented');
  assert.equal(relic.tags[1].severity, 'alert');
  assert.equal(relic.tags[1].confidence, 'low');
  assert.equal(relic.tags[1].observed, false);
});

test('normalizeRelic: no verdict means unclear, never dormant or dead', () => {
  assert.equal(normalizeRelic({}).verdict, 'unclear');
  assert.equal(normalizeRelic({ verdict: 'dead' }).verdict, 'dead');
});

test('normalizeRelic: garbage input does not throw', () => {
  for (const input of [null, undefined, 42, 'text', []]) {
    const relic = normalizeRelic(input);
    assert.equal(relic.axes.length, 5);
    assert.equal(relic.score, null);
  }
});

// --- createApiClient ---------------------------------------------------------

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

test('createApiClient: calls GET /relic/{mint} and returns it normalized', async () => {
  const calls = [];
  const client = createApiClient({
    baseUrl: 'https://api.example.test/',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { mint: 'M', score: 41, verdict: 'dead', axes: [] });
    },
  });

  const relic = await client.getRelic('M');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/relic/M');
  assert.equal(calls[0].init.credentials, 'omit', 'the extension does not send cookies along');
  assert.equal(relic.score, 41);
  assert.equal(relic.axes.length, 5);
});

test('createApiClient: refresh=true goes out as a query param and the mint is URL-encoded', async () => {
  let seen = null;
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (url) => { seen = url; return jsonResponse(200, { mint: 'M' }); },
  });
  await client.getRelic('a/b?c', { refresh: true });
  assert.equal(seen, 'https://api.example.test/relic/a%2Fb%3Fc?refresh=true');
});

test('createApiClient: 404 becomes an ApiError with status 404 -- not papered over with an empty response', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => jsonResponse(404, { error: { code: 'unknown_mint', message: 'no such mint' } }),
  });
  await assert.rejects(client.getRelic('M'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'unknown_mint');
    assert.equal(error.message, 'no such mint');
    return true;
  });
});

test('createApiClient: 429 carries Retry-After through in milliseconds', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => jsonResponse(429, '', { 'Retry-After': '12' }),
  });
  await assert.rejects(client.getRelic('M'), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.retryAfterMs, 12_000);
    return true;
  });
});

test('createApiClient: a 200 that is not JSON does not slip through', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => jsonResponse(200, '<html>gateway</html>'),
  });
  await assert.rejects(client.getRelic('M'), (error) => {
    assert.equal(error.code, 'bad_json');
    return true;
  });
});

test('createApiClient: a network error throws with status 0 and the original text', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  await assert.rejects(client.getRelic('M'), (error) => {
    assert.equal(error.status, 0);
    assert.equal(error.code, 'network');
    assert.match(error.message, /ENOTFOUND/);
    return true;
  });
});

test('createApiClient: a timeout is told apart by the timeout code', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    timeoutMs: 5,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  await assert.rejects(client.getRelic('M'), (error) => {
    assert.equal(error.code, 'timeout');
    assert.match(error.message, /timed out after 5ms/);
    return true;
  });
});

test('createApiClient: ApiError.toPlain is an ordinary object that survives structured clone', () => {
  const plain = new ApiError('boom', { status: 429, code: 'rate_limited', retryAfterMs: 1000 }).toPlain();
  assert.deepEqual(plain, { message: 'boom', status: 429, code: 'rate_limited', retryAfterMs: 1000, detail: null });
  assert.equal(JSON.parse(JSON.stringify(plain)).status, 429);
});

test('createApiClient: getTags takes only the tags array, empty when there is none', async () => {
  const client = createApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (url) => (url.endsWith('/tags')
      ? jsonResponse(200, { mint: 'M', tags: [{ key: 'lp-thin' }] })
      : jsonResponse(200, {})),
  });
  assert.deepEqual(await client.getTags('M'), [{ key: 'lp-thin' }]);
});

test('createApiClient: with no fetchImpl it falls back to globalThis.fetch', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return jsonResponse(200, { mint: 'M' }); };
  try {
    const client = createApiClient({ baseUrl: 'https://api.example.test' });
    await client.getRelic('M');
    assert.deepEqual(calls, ['https://api.example.test/relic/M']);
  } finally {
    globalThis.fetch = original;
  }
});

test('createApiClient: with no fetch implementation at all it throws at construction time', () => {
  const original = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    assert.throws(
      () => createApiClient({ baseUrl: 'https://api.example.test' }),
      (error) => {
        assert.equal(error.code, 'no_fetch');
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
