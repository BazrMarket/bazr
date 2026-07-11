// The request queue. A single screen of a Twitter timeline can carry 20-plus addresses, and
// fetching them straight out blows past the anonymous rate limit (30 req/min) at once. Two things to check:
//   1) does the concurrency ceiling actually hold
//   2) on a 429, does **the whole queue** back off (put one task to sleep and the rest keep hammering)

import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../src/shared/api.js';
import { createRequestQueue } from '../src/background/queue.js';

/** Fake clock. sleep does not actually wait, it just pushes time forward. */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms) => { current += ms; },
    advance: (ms) => { current += ms; },
  };
}

/**
 * A gated clock. sleep does not wake up **until the test releases it**.
 * A self-waking clock cannot prove "no request goes out during backoff" --
 * one turn of the microtask queue and it is already awake, so the test passes with no gate at all.
 */
function gatedClock() {
  let current = 0;
  const waits = [];
  return {
    now: () => current,
    sleep: (ms) => new Promise((resolve) => { waits.push({ ms, resolve }); }),
    pending: () => waits.length,
    releaseAll() {
      while (waits.length > 0) {
        const wait = waits.shift();
        current += wait.ms;
        wait.resolve();
      }
    },
  };
}

/** Turn the event loop n times. */
async function tick(n = 10) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

/** Release the gated clock until it stays released (drain can go back to sleep, so repeat). */
async function runClock(clock, rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    clock.releaseAll();
    await tick(5);
    if (clock.pending() === 0) return;
  }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('the concurrency ceiling is never exceeded', async () => {
  const clock = fakeClock();
  const queue = createRequestQueue({ concurrency: 3, now: clock.now, sleep: clock.sleep });

  let running = 0;
  let peak = 0;
  const gates = [];

  const jobs = [];
  for (let i = 0; i < 12; i += 1) {
    const gate = deferred();
    gates.push(gate);
    jobs.push(queue.push(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
      return i;
    }));
  }

  // Turn the event loop a few times so the first batch settles into place
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  assert.equal(peak, 3, `concurrent execution reached ${peak}`);
  assert.equal(queue.inFlight(), 3);
  assert.equal(queue.size(), 9);

  for (const gate of gates) gate.resolve();
  assert.deepEqual(await Promise.all(jobs), [...Array(12).keys()]);
  assert.equal(queue.inFlight(), 0);
  assert.equal(queue.size(), 0);
});

test('results and errors come back to whoever pushed them', async () => {
  const clock = fakeClock();
  const queue = createRequestQueue({ concurrency: 2, now: clock.now, sleep: clock.sleep });

  assert.equal(await queue.push(async () => 'ok'), 'ok');
  await assert.rejects(queue.push(async () => { throw new Error('boom'); }), /boom/);
});

test('a 429 backs off the whole queue -- not just the one task', async () => {
  const clock = gatedClock();
  const queue = createRequestQueue({
    concurrency: 4, now: clock.now, sleep: clock.sleep, maxRetries: 0,
  });

  const rateLimited = queue.push(async () => {
    throw new ApiError('Rate limited.', { status: 429, retryAfterMs: 30_000 });
  });
  await assert.rejects(rateLimited, (error) => error.status === 429);

  assert.equal(queue.backoffRemaining(), 30_000, 'took a 429 and the queue is not resting');

  // Work that arrives during backoff does not go out until the time has passed.
  // The point is that it must stay put even with room to spare (concurrency 4, in-flight 0).
  let started = false;
  const later = queue.push(async () => { started = true; return 'later'; });
  await tick(20);
  assert.equal(queue.inFlight(), 0);
  assert.equal(started, false, 'a request went out mid-backoff');
  assert.ok(clock.pending() > 0, 'the queue is not asleep -- meaning no backoff was applied');

  // Once the time passes it goes out again
  await runClock(clock);
  assert.equal(await later, 'later');
  assert.equal(started, true);
  assert.equal(queue.backoffRemaining(), 0);
});

test('a 429 is retried maxRetries times and then thrown on as is', async () => {
  const clock = fakeClock();
  const queue = createRequestQueue({
    concurrency: 1, now: clock.now, sleep: clock.sleep, maxRetries: 1,
  });

  let attempts = 0;
  await assert.rejects(
    queue.push(async () => {
      attempts += 1;
      throw new ApiError('Rate limited.', { status: 429, retryAfterMs: 1000 });
    }),
    (error) => error.status === 429,
  );
  assert.equal(attempts, 2, 'retry count is off contract (1 initial + 1 retry)');
});

test('when the 429 retry succeeds, that value is returned', async () => {
  const clock = fakeClock();
  const queue = createRequestQueue({
    concurrency: 1, now: clock.now, sleep: clock.sleep, maxRetries: 1,
  });

  let attempts = 0;
  const value = await queue.push(async () => {
    attempts += 1;
    if (attempts === 1) throw new ApiError('Rate limited.', { status: 429, retryAfterMs: 500 });
    return 'second try';
  });
  assert.equal(value, 'second try');
  assert.equal(attempts, 2);
});

test('errors other than 429 do not trigger a backoff (control)', async () => {
  const clock = fakeClock();
  const queue = createRequestQueue({ concurrency: 2, now: clock.now, sleep: clock.sleep });

  await assert.rejects(
    queue.push(async () => { throw new ApiError('not found', { status: 404 }); }),
    (error) => error.status === 404,
  );
  assert.equal(queue.backoffRemaining(), 0, 'a 404 must not stall the entire queue');
});

test('with no Retry-After it rests for a conservative default', async () => {
  const clock = fakeClock();
  const queue = createRequestQueue({
    concurrency: 1, now: clock.now, sleep: clock.sleep, maxRetries: 0,
  });
  await assert.rejects(
    queue.push(async () => { throw new ApiError('Rate limited.', { status: 429 }); }),
    (error) => error.status === 429,
  );
  assert.ok(queue.backoffRemaining() > 0, 'treating a missing Retry-After as 0 means hammering again immediately');
});

test('backoff is capped (a server asking for a day would stop the queue for a day)', () => {
  const clock = fakeClock();
  const queue = createRequestQueue({
    concurrency: 1, now: clock.now, sleep: clock.sleep, maxBackoffMs: 60_000,
  });
  assert.equal(queue.applyBackoff(86_400_000), 60_000);
  assert.equal(queue.backoffRemaining(), 60_000);
});

test('only a longer backoff extends the current one (a shorter one must not wake it early)', () => {
  const clock = fakeClock();
  const queue = createRequestQueue({ concurrency: 1, now: clock.now, sleep: clock.sleep });
  queue.applyBackoff(30_000);
  queue.applyBackoff(5_000);
  assert.equal(queue.backoffRemaining(), 30_000);
});

test('backoff lifts by itself as time passes', () => {
  const clock = fakeClock();
  const queue = createRequestQueue({ concurrency: 1, now: clock.now, sleep: clock.sleep });
  queue.applyBackoff(10_000);
  assert.equal(queue.backoffRemaining(), 10_000);
  clock.advance(4_000);
  assert.equal(queue.backoffRemaining(), 6_000);
  clock.advance(99_000);
  assert.equal(queue.backoffRemaining(), 0);
});
