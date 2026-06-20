// Finds Solana mint address candidates and does the first round of validation locally.
// No chrome.* here. This file is the gate that keeps false positives from flooding a page.
//
// Why a regex alone is not enough:
//   A 32-44 character base58 pattern also matches fragments of transaction signatures, arbitrary
//   hashes, and short URL slugs. A Solana pubkey has a far stronger property -- it decodes to
//   exactly 32 bytes -- which narrows the field much more than length ever could. Even then it is
//   only a "pubkey" and not a "mint", so the background settles that against the API (resolveMints).

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const ALPHABET_INDEX = (() => {
  const map = new Map();
  for (let i = 0; i < ALPHABET.length; i += 1) map.set(ALPHABET[i], i);
  return map;
})();

/** A word boundary is mandatory -- without it the middle of an 88-char signature reads as an address. */
export const BASE58_PATTERN = '[1-9A-HJ-NP-Za-km-z]{32,44}';

// The boundary is **every alphanumeric**, not just the base58 alphabet.
// Anchoring on base58 alone lets the four characters base58 leaves out (0 O I l) act as boundaries:
//   "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10" (44 chars, trailing 0)
//   -> the first 43 characters get sliced out as a candidate, and they happen to decode to 32 bytes.
// What sits next to an address in real copy is whitespace or / ? = # ( , : -- non-alphanumerics --
// so the tighter boundary costs nothing and only rejects truncated or mistyped strings.
const CANDIDATE_RE = new RegExp(`(?<![0-9A-Za-z])${BASE58_PATTERN}(?![0-9A-Za-z])`, 'g');

/** Programs, wrapped SOL, and the like. They look like mints but are not things to price-tag. */
export const EXCLUDED_ADDRESSES = new Set([
  '11111111111111111111111111111111',              // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',   // SPL Token-2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // Associated Token Account
  'So11111111111111111111111111111111111111112',   // Wrapped SOL
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',   // Memo
  'ComputeBudget111111111111111111111111111111',   // Compute Budget
  'SysvarRent111111111111111111111111111111111',   // Sysvar Rent
  'SysvarC1ock11111111111111111111111111111111',   // Sysvar Clock
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',   // Metaplex Token Metadata
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter v6
]);

/**
 * Decodes a base58 string to bytes. Returns null on any character outside the alphabet.
 * @param {string} input
 * @returns {Uint8Array|null}
 */
export function decodeBase58(input) {
  if (typeof input !== 'string' || input.length === 0) return null;

  const bytes = [0];
  for (let i = 0; i < input.length; i += 1) {
    const value = ALPHABET_INDEX.get(input[i]);
    if (value === undefined) return null;

    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // A leading '1' is a 0x00 byte.
  for (let k = 0; k < input.length && input[k] === '1'; k += 1) bytes.push(0);

  return Uint8Array.from(bytes.reverse());
}

/**
 * Whether this is shaped like a Solana pubkey, meaning it decodes to exactly 32 bytes.
 * Whether it is a mint cannot be known here -- the background confirms that against the API.
 * @param {string} value
 * @returns {boolean}
 */
export function isPubkeyShaped(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 32 || value.length > 44) return false;
  const decoded = decodeBase58(value);
  if (!decoded || decoded.length !== 32) return false;
  return decoded.some((b) => b !== 0); // all zeros = System Program
}

/**
 * Whether this is worth trying to tag: pubkey-shaped, and not on the exclusion list.
 * @param {string} value
 * @returns {boolean}
 */
export function isMintCandidate(value) {
  return isPubkeyShaped(value) && !EXCLUDED_ADDRESSES.has(value);
}

/**
 * Pulls the distinct mint candidates out of a block of text.
 * @param {string} text
 * @returns {string[]}
 */
export function extractMintCandidates(text) {
  if (typeof text !== 'string' || text.length < 32) return [];
  const found = new Set();
  CANDIDATE_RE.lastIndex = 0;
  let match = CANDIDATE_RE.exec(text);
  while (match !== null) {
    if (isMintCandidate(match[0])) found.add(match[0]);
    match = CANDIDATE_RE.exec(text);
  }
  return [...found];
}

/**
 * Pulls mint candidates out of a URL path (for dexscreener/solscan/birdeye detail pages).
 * @param {string} href
 * @returns {string[]}
 */
export function extractMintCandidatesFromUrl(href) {
  if (typeof href !== 'string') return [];
  const segments = href.split(/[/?#&=]+/);
  return [...new Set(segments.filter(isMintCandidate))];
}
