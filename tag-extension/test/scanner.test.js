// The DOM scanner. Verified by feeding it DOM-like objects directly, without jsdom
// (which is exactly why scanner.js does not use createTreeWalker).
//
// Controls are the point here too. Ask only "does it find addresses" and a scanner that
// walks scripts, input fields and the markers we just inserted still scores full marks.
// So every case below pairs **what must be found** with **what must not be touched**.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIP_TAGS, TAGGED_ATTR, collectTargets, detectPageMint, isAlreadyTagged,
  isOwnNode, markTagged, shouldSkipElement,
} from '../src/content/scanner.js';

const MINT_A = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_B = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const NOT_A_PUBKEY = '1rZYMtKzFxdpVYbYDGZx9pXgRzmkHUfYf87UXam67t5k'; // 44 chars but 33 bytes
const SIGNATURE_88 = 'ZgT8Xasgup5eHtX63WHzR25GZeDi5rsa5k5iRWwJdkTSXWbkDUMk32D4X6ZcFkdr7JRSMvZQZQqeXtonZNT2qxji';

// --- minimal DOM ------------------------------------------------------------

function textNode(content) {
  return { nodeType: 3, textContent: content, childNodes: [] };
}

function elem(tagName, { attrs = {}, children = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName,
    _attrs: { ...attrs },
    childNodes: [],
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    setAttribute(name, value) { this._attrs[name] = String(value); },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name); },
  };
  for (const child of children) {
    child.parentNode = node;
    child.parentElement = node;
    node.childNodes.push(child);
  }
  return node;
}

const addressesOf = (targets) => targets.map((t) => t.address).sort();

// --- basic walk: fires ------------------------------------------------------

test('fires -- finds an address in body text and hands back the parent to hang the marker on', () => {
  const paragraph = elem('P', { children: [textNode(`still holding ${MINT_A} lol`)] });
  const root = elem('DIV', { children: [paragraph] });

  const targets = collectTargets(root);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].address, MINT_A);
  assert.equal(targets[0].kind, 'text');
  assert.equal(targets[0].host, paragraph, 'the host has to be the text node parent, or the marker cannot go beside it');
});

test('fires -- catches the case where the screen shows it truncated and only an attribute has it in full', () => {
  const row = elem('DIV', {
    attrs: { 'data-address': MINT_A },
    children: [textNode('EPjF...Dt1v')],
  });
  const targets = collectTargets(elem('DIV', { children: [row] }));
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, 'attr');
  assert.equal(targets[0].host, row);
  assert.equal(targets[0].node, row, 'for an attr target the node and the host are the same element');
});

test('fires -- picks up addresses sitting in title and aria-label', () => {
  const a = elem('SPAN', { attrs: { title: MINT_A } });
  const b = elem('SPAN', { attrs: { 'aria-label': `Token ${MINT_B}` } });
  const targets = collectTargets(elem('DIV', { children: [a, b] }));
  assert.deepEqual(addressesOf(targets), [MINT_A, MINT_B].sort());
});

test('fires -- walks a deeply nested tree all the way down', () => {
  let node = elem('SPAN', { children: [textNode(MINT_A)] });
  for (let i = 0; i < 30; i += 1) node = elem('DIV', { children: [node] });
  assert.deepEqual(addressesOf(collectTargets(node)), [MINT_A]);
});

// --- controls: misses -------------------------------------------------------

test('misses -- addresses inside SCRIPT / STYLE / TEXTAREA are left alone', () => {
  const children = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].map(
    (tag) => elem(tag, { children: [textNode(MINT_A)] }),
  );
  assert.deepEqual(collectTargets(elem('DIV', { children })), []);
});

test('misses -- input elements are skipped even when the value is an address (the user may be typing)', () => {
  const input = elem('INPUT', { attrs: { title: MINT_A } });
  assert.deepEqual(collectTargets(elem('DIV', { children: [input] })), []);
  assert.equal(shouldSkipElement(input), true);
});

test('misses -- every entry in SKIP_TAGS really is filtered out', () => {
  for (const tag of SKIP_TAGS) {
    const node = elem(tag, { attrs: { title: MINT_A }, children: [textNode(MINT_B)] });
    assert.deepEqual(collectTargets(elem('DIV', { children: [node] })), [], `${tag} was not filtered`);
  }
});

test('misses -- our own markers, panels and notices are not re-scanned (stops a MutationObserver loop)', () => {
  for (const attr of ['data-bazr-marker', 'data-bazr-panel', 'data-bazr-notice']) {
    const own = elem('SPAN', { attrs: { [attr]: '1' }, children: [textNode(MINT_A)] });
    assert.equal(isOwnNode(own), true);
    assert.deepEqual(collectTargets(elem('DIV', { children: [own] })), [], `${attr} got scanned again`);
  }
});

test('misses -- lookalikes and 88-char signatures stay out on the DOM path as well', () => {
  const root = elem('DIV', {
    children: [
      elem('P', { children: [textNode(NOT_A_PUBKEY)] }),
      elem('P', { children: [textNode(SIGNATURE_88)] }),
      elem('P', { attrs: { 'data-address': NOT_A_PUBKEY } }),
    ],
  });
  assert.deepEqual(collectTargets(root), []);
});

test('misses -- an address that is already tagged is not offered again', () => {
  const paragraph = elem('P', {
    attrs: { [TAGGED_ATTR]: MINT_A },
    children: [textNode(`${MINT_A} and ${MINT_B}`)],
  });
  const targets = collectTargets(elem('DIV', { children: [paragraph] }));
  assert.deepEqual(addressesOf(targets), [MINT_B], 'an already tagged address came back');
});

test('misses -- the same address on the same element comes out once per scan', () => {
  const paragraph = elem('P', {
    attrs: { title: MINT_A, 'data-mint': MINT_A },
    children: [textNode(`${MINT_A} ${MINT_A}`)],
  });
  const targets = collectTargets(elem('DIV', { children: [paragraph] }));
  assert.equal(targets.length, 1);
});

// --- tag bookkeeping --------------------------------------------------------

test('markTagged / isAlreadyTagged: several addresses accumulate on one element', () => {
  const node = elem('DIV');
  assert.equal(isAlreadyTagged(node, MINT_A), false);

  markTagged(node, MINT_A);
  assert.equal(isAlreadyTagged(node, MINT_A), true);
  assert.equal(isAlreadyTagged(node, MINT_B), false);

  markTagged(node, MINT_B);
  assert.equal(isAlreadyTagged(node, MINT_A), true);
  assert.equal(isAlreadyTagged(node, MINT_B), true);
  assert.equal(node.getAttribute(TAGGED_ATTR).split(',').length, 2);

  markTagged(node, MINT_A); // adding a duplicate does not grow the list
  assert.equal(node.getAttribute(TAGGED_ATTR).split(',').length, 2);
});

test('markTagged: does not throw on a node without setAttribute', () => {
  assert.doesNotThrow(() => markTagged(null, MINT_A));
  assert.doesNotThrow(() => markTagged({}, MINT_A));
  assert.equal(isAlreadyTagged(null, MINT_A), false);
});

// --- walk ceiling -----------------------------------------------------------

test('the maxNodes ceiling really does cut the walk short (a Twitter timeline runs to tens of thousands of nodes)', () => {
  const many = [];
  for (let i = 0; i < 200; i += 1) many.push(elem('P', { children: [textNode(MINT_A)] }));
  const root = elem('DIV', { children: many });

  const all = collectTargets(root, { maxNodes: 100_000 });
  const capped = collectTargets(root, { maxNodes: 10 });
  assert.ok(all.length > capped.length, `the ceiling did not bite (all=${all.length}, capped=${capped.length})`);
  assert.ok(capped.length > 0, 'even when the ceiling bites, what was already seen still comes out');
});

test('empty and malformed input do not throw', () => {
  assert.deepEqual(collectTargets(null), []);
  assert.deepEqual(collectTargets(undefined), []);
  assert.deepEqual(collectTargets(elem('DIV')), []);
  assert.deepEqual(collectTargets({ body: elem('DIV', { children: [textNode(MINT_A)] }) }).length, 1);
});

// --- page-level address -----------------------------------------------------

test('detectPageMint: pulls the address out of a detail page URL', () => {
  assert.equal(detectPageMint(`https://solscan.io/token/${MINT_A}`), MINT_A);
  assert.equal(detectPageMint(`https://dexscreener.com/solana/${MINT_B}?maker=x`), MINT_B);
  assert.equal(detectPageMint(`https://birdeye.so/token/${MINT_A}?chain=solana`), MINT_A);
});

test('detectPageMint: no address means null (it does not grab whatever it finds)', () => {
  assert.equal(detectPageMint('https://dexscreener.com/solana'), null);
  assert.equal(detectPageMint('https://x.com/home'), null);
  assert.equal(detectPageMint(`https://solscan.io/tx/${SIGNATURE_88}`), null);
  assert.equal(detectPageMint(''), null);
  assert.equal(detectPageMint(null), null);
});
