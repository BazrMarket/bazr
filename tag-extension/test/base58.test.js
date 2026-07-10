// Address detection, with matched controls.
//
// This file exists for one reason: **it checks the misses as well as the hits.**
// Check only the hits and a detector that tags every base58 string it sees still
// scores full marks. So the two tables below move together -- grow FIRES, grow MISSES.
//
// The layers are kept apart too. Which layer rejected a string is part of the verdict:
//   1) regex candidate sweep  extractMintCandidates  (boundaries, length)
//   2) local structure check  isPubkeyShaped         (does it decode to exactly 32 bytes)
//   3) exclusion list         isMintCandidate        (programs, WSOL and other non-mint pubkeys)
// The background worker settles the real mints through the API. This is the filter ahead of it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXCLUDED_ADDRESSES, decodeBase58, extractMintCandidates,
  extractMintCandidatesFromUrl, isMintCandidate, isPubkeyShaped,
} from '../src/shared/base58.js';

// --- Control tables ---------------------------------------------------------
// All public information (real mints, program addresses) or fixed synthetic values. No secrets.

/** Must fire: real addresses that decode to exactly 32 bytes */
const FIRES = {
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',   // 44 chars
  bonkMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',   // 44 chars
  bazrProgram: 'FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb', // 44 chars (not a mint, but pubkey-shaped)
  leadingOne: '1nc1nerator11111111111111111111111111111111',   // 43 chars. A leading '1' is a 0x00 byte
};

/** Must not fire: base58-looking strings that are not 32 bytes, are too short, or are excluded */
const MISSES = {
  // Length sits inside the 32-44 window and the alphabet is base58, yet the decoded length is not 32.
  // These two rows are the whole reason the regex alone cannot be trusted.
  decodesTo33Bytes: '1rZYMtKzFxdpVYbYDGZx9pXgRzmkHUfYf87UXam67t5k',  // 44 chars -> 33 bytes
  decodesTo31Bytes: '2TYdkhGMzwi7GRaySHvbzfzVn3khG7Qsa7z9LX6Kro8',   // 43 chars -> 31 bytes
  decodesTo29Bytes: 'Ab1Cd2Ef3Gh4Jk5Mn6Pq7Rs8Tu9Vw1Xy2Zab3Cde',       // 40 chars -> 29 bytes
  decodesTo24Bytes: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',               // 32 chars -> 24 bytes

  // Short strings
  tooShort31: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4',   // 31 chars -- one under the window
  tooShort12: 'EPjFWdd5Aufq',
  tooShort3: 'abc',

  // Carries characters outside the base58 alphabet (0 O I l)
  hasZeroOIl: 'EPjFWdd5AufqSSqeM2qNIxzybapC8G4wEGGkZwyTDtOl',

  // Well-known pubkeys that are not mints (structure passes, the exclusion list catches them)
  wrappedSol: 'So11111111111111111111111111111111111111112',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  systemProgram: '11111111111111111111111111111111',
};

/** 88-char transaction signature (fixed synthetic value). No 44-char slice of it may come out as an address. */
const SIGNATURE_88 = 'ZgT8Xasgup5eHtX63WHzR25GZeDi5rsa5k5iRWwJdkTSXWbkDUMk32D4X6ZcFkdr7JRSMvZQZQqeXtonZNT2qxji';

// --- Layer 1: the decoder itself --------------------------------------------

test('decodeBase58: real addresses decode to 32 bytes (the case for firing)', () => {
  for (const [name, value] of Object.entries(FIRES)) {
    const decoded = decodeBase58(value);
    assert.ok(decoded, `${name}: failed to decode`);
    assert.equal(decoded.length, 32, `${name}: should be 32 bytes`);
  }
});

test('decodeBase58: a character outside the alphabet gives null (0 O I l)', () => {
  assert.equal(decodeBase58('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10'), null);
  assert.equal(decodeBase58(MISSES.hasZeroOIl), null);
  assert.equal(decodeBase58(''), null);
  assert.equal(decodeBase58(null), null);
});

test('decodeBase58: one leading 1 is one 0x00 byte (why a 43-char address is 32 bytes)', () => {
  const decoded = decodeBase58(FIRES.leadingOne);
  assert.equal(decoded.length, 32);
  assert.equal(decoded[0], 0);
});

// --- Layer 2: structure check -----------------------------------------------

test('isPubkeyShaped: fires -- every address that decodes to 32 bytes is true', () => {
  for (const [name, value] of Object.entries(FIRES)) {
    assert.equal(isPubkeyShaped(value), true, `${name} was not seen as pubkey-shaped`);
  }
  // Excluded addresses are pubkeys by structure too. Nailing down here that a different layer filters them.
  assert.equal(isPubkeyShaped(MISSES.wrappedSol), true);
  assert.equal(isPubkeyShaped(MISSES.tokenProgram), true);
});

test('isPubkeyShaped: misses -- anything that is not 32 bytes is false (lookalikes, short strings)', () => {
  const shouldFail = [
    'decodesTo33Bytes', 'decodesTo31Bytes', 'decodesTo29Bytes', 'decodesTo24Bytes',
    'tooShort31', 'tooShort12', 'tooShort3', 'hasZeroOIl', 'systemProgram',
  ];
  for (const name of shouldFail) {
    assert.equal(isPubkeyShaped(MISSES[name]), false, `${name} was wrongly taken for a pubkey`);
  }
  assert.equal(isPubkeyShaped(SIGNATURE_88), false, 'an 88-char signature passed as a pubkey');
});

// --- Layer 3: exclusion list ------------------------------------------------

test('isMintCandidate: misses -- well-known programs and WSOL are pubkeys but not candidates', () => {
  assert.equal(isMintCandidate(MISSES.wrappedSol), false);
  assert.equal(isMintCandidate(MISSES.tokenProgram), false);
  for (const address of EXCLUDED_ADDRESSES) {
    assert.equal(isMintCandidate(address), false, `excluded address ${address} passed as a candidate`);
  }
});

test('isMintCandidate: fires -- a 32-byte address that is not excluded is a candidate', () => {
  assert.equal(isMintCandidate(FIRES.usdcMint), true);
  assert.equal(isMintCandidate(FIRES.bonkMint), true);
});

// --- Text extraction: fires -------------------------------------------------

test('extractMintCandidates: fires -- pulls addresses out of prose, brackets and line breaks', () => {
  const text = `gm. still holding ${FIRES.usdcMint} from last cycle\n`
    + `and (${FIRES.bonkMint}), plus a dead one: ${FIRES.bazrProgram}.`;
  const found = extractMintCandidates(text);
  assert.deepEqual(
    found.sort(),
    [FIRES.usdcMint, FIRES.bonkMint, FIRES.bazrProgram].sort(),
  );
});

test('extractMintCandidates: fires -- the same address many times comes back once', () => {
  const text = `${FIRES.usdcMint} ${FIRES.usdcMint} ${FIRES.usdcMint}`;
  assert.deepEqual(extractMintCandidates(text), [FIRES.usdcMint]);
});

// --- Text extraction: misses (this is what keeps false positives out) -------

test('extractMintCandidates: misses -- nothing comes out of an 88-char transaction signature', () => {
  assert.deepEqual(extractMintCandidates(SIGNATURE_88), []);
  assert.deepEqual(extractMintCandidates(`tx ${SIGNATURE_88} confirmed`), []);
});

test('extractMintCandidates: misses -- lookalikes (31/33 bytes decoded) are not pulled', () => {
  const text = `${MISSES.decodesTo33Bytes} ${MISSES.decodesTo31Bytes} ${MISSES.decodesTo29Bytes}`;
  assert.deepEqual(extractMintCandidates(text), []);
});

test('extractMintCandidates: misses -- short strings are not pulled (31 chars and under)', () => {
  const text = `${MISSES.tooShort31} ${MISSES.tooShort12} ${MISSES.tooShort3}`;
  assert.deepEqual(extractMintCandidates(text), []);
});

test('extractMintCandidates: misses -- hashes, UUIDs and plain prose are not pulled', () => {
  const noise = [
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'The quick brown fox jumps over the lazy dog again and again and again.',
    'https://example.com/a/very/long/path/that/keeps/going/and/going/forever',
  ];
  for (const value of noise) {
    assert.deepEqual(extractMintCandidates(value), [], `a candidate came out of noise: ${value}`);
  }
});

test('extractMintCandidates: misses -- an address glued to alphanumerics is not sliced out', () => {
  // 0 O I l are the characters base58 drops, so if they pass for boundaries the leading
  // slice of a longer string becomes a candidate. These four lines are that regression control.
  assert.deepEqual(extractMintCandidates(`${FIRES.usdcMint}0`), []);
  assert.deepEqual(extractMintCandidates(`0${FIRES.usdcMint}`), []);
  assert.deepEqual(extractMintCandidates(`${FIRES.usdcMint}O`), []);
  assert.deepEqual(extractMintCandidates(`l${FIRES.usdcMint}`), []);
});

test('extractMintCandidates: misses -- excluded addresses stay out inside a sentence too', () => {
  const text = `swap ${MISSES.wrappedSol} via ${MISSES.tokenProgram} on the ${MISSES.systemProgram}`;
  assert.deepEqual(extractMintCandidates(text), []);
});

test('extractMintCandidates: misses -- input under 32 chars never reaches the regex', () => {
  assert.deepEqual(extractMintCandidates('short'), []);
  assert.deepEqual(extractMintCandidates(''), []);
  assert.deepEqual(extractMintCandidates(null), []);
  assert.deepEqual(extractMintCandidates(undefined), []);
});

// --- URL extraction ---------------------------------------------------------

test('extractMintCandidatesFromUrl: fires -- pulls from path and query segments', () => {
  assert.deepEqual(
    extractMintCandidatesFromUrl(`https://solscan.io/token/${FIRES.usdcMint}?cluster=mainnet`),
    [FIRES.usdcMint],
  );
  assert.deepEqual(
    extractMintCandidatesFromUrl(`https://dexscreener.com/solana/${FIRES.bonkMint}`),
    [FIRES.bonkMint],
  );
});

test('extractMintCandidatesFromUrl: misses -- a URL with no address gives an empty array', () => {
  assert.deepEqual(extractMintCandidatesFromUrl('https://dexscreener.com/solana'), []);
  assert.deepEqual(extractMintCandidatesFromUrl('https://x.com/bazrmarket/status/1234567890123456789'), []);
  assert.deepEqual(extractMintCandidatesFromUrl(''), []);
  assert.deepEqual(extractMintCandidatesFromUrl(null), []);
});

// --- Regex state leaking ----------------------------------------------------

test('extractMintCandidates: lastIndex on the global regex does not leak between calls', () => {
  // Keep a /g regex as a module constant and lastIndex survives, so the second call quietly returns nothing.
  const text = `holding ${FIRES.usdcMint} still`;
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(extractMintCandidates(text), [FIRES.usdcMint], `call ${i + 1} diverged`);
  }
});
