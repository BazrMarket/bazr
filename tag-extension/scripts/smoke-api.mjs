#!/usr/bin/env node
/**
 * smoke-api.mjs -- talk to a live BAZR API and check the contract against it.
 *
 *   node scripts/smoke-api.mjs                                   # http://localhost:8030
 *   node scripts/smoke-api.mjs --base https://api.bazr.market
 *   node scripts/smoke-api.mjs --base http://localhost:8030 --mint <mint>
 *
 * The unit tests (`npm test`) read fixtures. This script reads the **real thing** --
 * neither one replaces the other. When every checker has agreed on the same falsehood,
 * only an actual run breaks it.
 *
 * It calls the exact client the extension itself uses (src/shared/api.js). Build a separate
 * path that only passes here and this smoke test proves nothing at all.
 *
 * The last three lines of stdout are fixed (other people grep them):
 *   checked=<checks performed>
 *   failed=<checks that failed>
 *   verdict=PASS|FAIL|SELF-FAIL
 *
 * Exit code: 0=PASS / 1=FAIL (contract violated) / 2=SELF-FAIL (the API was unreachable, so nothing was checked)
 * SELF-FAIL is never folded into PASS -- not looking and finding nothing wrong are different results.
 */

import { createApiClient, ApiError } from '../src/shared/api.js';
import { AXIS_ORDER, DEV_API_BASE, VERDICTS } from '../src/shared/constants.js';

/** The default lookup target. A real, public mint -- nothing secret about it. */
const DEFAULT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function parseArgs(argv) {
  const out = { base: DEV_API_BASE, mint: DEFAULT_MINT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' && argv[i + 1]) { out.base = argv[i + 1]; i += 1; }
    else if (argv[i] === '--mint' && argv[i + 1]) { out.mint = argv[i + 1]; i += 1; }
    else if (argv[i] === '--help' || argv[i] === '-h') { out.help = true; }
    else { out.unknown = argv[i]; }
  }
  return out;
}

const checks = [];
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  checks.push({ label, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
}

function summarize(verdict) {
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`checked=${checks.length}`);
  console.log(`failed=${failed}`);
  console.log(`verdict=${verdict}`);
}

/** Not reaching the API is not a contract violation. The two never share one word. */
function selfFail(reason) {
  console.error(reason);
  summarize('SELF-FAIL');
  process.exitCode = 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node scripts/smoke-api.mjs [--base <url>] [--mint <mint>]');
    return;
  }
  if (args.unknown) {
    selfFail(`unknown argument: ${args.unknown}`);
    return;
  }

  let client;
  try {
    client = createApiClient({ baseUrl: args.base });
  } catch (error) {
    selfFail(`the API base is not usable: ${error.message}`);
    return;
  }
  console.log(`base=${client.baseUrl}`);
  console.log(`mint=${args.mint}`);

  // ---- 1. /health ----------------------------------------------------------
  let health;
  try {
    health = await client.getHealth();
  } catch (error) {
    const hint = error instanceof ApiError && error.status === 0
      ? ' (the server looks down. Bring the API up at that base URL first.)'
      : '';
    selfFail(`GET /health could not be reached: ${error.message}${hint}`);
    return;
  }
  check('/health returns a status', typeof health?.status === 'string', `status=${health?.status}`);
  check('/health returns a version', typeof health?.version === 'string', `version=${health?.version}`);

  // ---- 2. /relic/{mint} ----------------------------------------------------
  let relic;
  try {
    relic = await client.getRelic(args.mint);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // A 404 is the contract working. The API simply does not know this mint, so the run cannot go on.
      selfFail(`the API does not know this mint (404). Pass a different address with --mint and run again: ${args.mint}`);
      return;
    }
    selfFail(`GET /relic/{mint} could not be reached: ${error.message} (status=${error.status ?? '?'})`);
    return;
  }

  check('the mint comes back unchanged', relic.mint === args.mint, `mint=${relic.mint}`);
  check('verdict is one of the three in the contract', VERDICTS.includes(relic.verdict), `verdict=${relic.verdict}`);
  check(
    'score is an integer 0-100, or null',
    relic.score === null || (Number.isFinite(relic.score) && relic.score >= 0 && relic.score <= 100),
    `score=${relic.score}`,
  );
  check('the response carries a disclaimer', typeof relic.disclaimer === 'string' && relic.disclaimer.length > 0);
  check('scored_at is present', typeof relic.scored_at === 'string' && relic.scored_at.length > 0);

  // There are always five axes, and a missing one is unknown rather than 0
  const keys = relic.axes.map((a) => a.key);
  check('all five axes arrive', AXIS_ORDER.every((key) => keys.includes(key)), `keys=${keys.join(',')}`);
  for (const axis of relic.axes) {
    if (axis.status === 'unknown') {
      check(
        `unobserved axis ${axis.key} scores null, not 0`,
        axis.score === null,
        `score=${axis.score}`,
      );
    } else {
      check(
        `observed axis ${axis.key} scores 0-100`,
        Number.isFinite(axis.score) && axis.score >= 0 && axis.score <= 100,
        `score=${axis.score}`,
      );
    }
  }

  // Labels do not hide how likely they are to be wrong
  for (const tag of relic.tags) {
    check(
      `label ${tag.key} states its confidence`,
      ['high', 'medium', 'low'].includes(tag.confidence),
      `confidence=${tag.confidence}`,
    );
  }
  console.log(`tags=${relic.tags.length}`);

  const failed = checks.filter((c) => !c.ok).length;
  summarize(failed === 0 ? 'PASS' : 'FAIL');
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  summarize('SELF-FAIL');
  process.exitCode = 2;
});
