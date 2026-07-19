# Dependencies, and what is actually built here

A reasonable question to ask of any Solana project is: *is this a real system, or
a wrapper around somebody else's API with a logo on top?*

This file answers that without spin. It lists what this repository implements,
what it hands to other people, and what does not exist. Every path below is a
real path in this repository, and every claim can be checked by reading the file
named next to it. Where the answer is unflattering, it is in Table 3, and Table 3
is the part worth reading first.

The short version: this repository builds an on-chain market program, a browser
extension, and the specifications both are measured against. It does not build a
DEX, an AMM, an order book, an RPC node, or an indexer for raw chain data. Those
are deliberate purchases rather than gaps, and the reason is written next to each
one.

**Scope.** The TypeScript SDK and the command-line tool are in a separate
repository, [BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk). The
backend service and the web frontend are not open source. Nothing in the tables
below is claimed on their behalf.

---

## Table 1 -- Built in this repository

| What | Where | Why it is not a wrapper |
|---|---|---|
| On-chain account layouts | `anchor-program/programs/bazr-market/src/state/` | `Market`, `Stall`, `Listing` and `Crate` (in `bazr_crate.rs`, because `crate` is a Rust keyword and cannot name a module). Each `LEN` is an explicit field-by-field sum padded so `8 + LEN` lands on an 8-byte boundary, with a reserved tail so later releases can add fields without migrating existing accounts. |
| Failure recorded at the same fidelity as success, in the schema | `anchor-program/programs/bazr-market/src/state/stall.rs` | `resolved_wins` and `resolved_losses` are both `u32`, `reputation` is `i64` so a stall that is wrong more often than right goes below zero, and `REPUTATION_STEP` moves it by the same magnitude in either direction. This is a layout constraint, not an interface choice: a schema that counts only wins cannot be corrected later by a screen. |
| Eleven instruction handlers | `anchor-program/programs/bazr-market/src/instructions/` | `initialize_market`, `open_stall`, `list_relic`, `resolve_listing`, `withdraw_listing`, `close_stall`, `set_stall_uri`, `slash_stall`, `create_crate`, `rebalance_crate`, `freeze_crate`. Signer and authority separation is enforced per instruction -- resolution is an authority action, so a stall cannot grade its own calls. |
| Bond escrow and slash accounting | `anchor-program/programs/bazr-market/src/instructions/open_stall.rs`, `close_stall.rs`, `slash_stall.rs` | The bond vault is a token account at `["bond_vault"]` whose authority is the market program derived address, so only the program can sign a transfer out of it. Slashing burns `slash_bps` of the bond, returns the remainder, and sets a permanent mark that no later instruction clears. |
| Crate composition validation | `anchor-program/programs/bazr-market/src/instructions/create_crate.rs`, `rebalance_crate.rs` | Weights must sum to exactly 10000 bps, no weight may be zero, no mint may repeat, and at most 16 mints fit. `crate_id` is a `u64` serialised little-endian, so the client, the indexer and the program have to agree byte for byte or the PDA will not derive. |
| Domain error set, event set and constants | `anchor-program/programs/bazr-market/src/errors.rs`, `events.rs`, `constants.rs` | 25 named errors, 10 events, and the bond, reputation and length limits. `ListingResolved` carries both the win and the loss count, so an indexer cannot get one without the other. |
| Base58 decoding and Solana pubkey detection | `tag-extension/src/shared/base58.js` | A full base58 decoder, no library. The check is "decodes to exactly 32 bytes", not "matches a 32-44 character regex", because the regex form also matches transaction signature fragments, arbitrary hashes and short URL slugs. Carries an exclusion set so system, token, ATA, memo, compute budget, sysvar, metadata and router programs never get tagged as mints. |
| Request queue with a 429 backoff | `tag-extension/src/background/queue.js` | A concurrency ceiling and a backoff queue, written here because one screen of a timeline can carry more than twenty mints and fetching them straight through walks into a rate limit immediately. `sleep` and `now` are injected, so the unit tests drive the real module rather than a double. |
| Two-sided response cache | `tag-extension/src/background/cache.js` | Scored mints and confirmed non-mints are cached separately, with different lifetimes. The negative cache is the load-bearing half: most base58 strings on a timeline are not mints, and re-asking about them on every scroll would spend the whole budget on known non-answers. |
| Price tag renderer and formatters | `tag-extension/src/shared/render.js`, `format.js` | Pure functions that take a payload and return HTML strings and display text. No DOM and no `chrome.*`, which is what lets a plain Node test feed in a fixture and assert on the markup. The content script and the popup call the same functions, so the two cannot drift apart. |
| Content script scanning and overlay | `tag-extension/src/content/scanner.js`, `overlay.js`, `index.js` | The DOM walk is written by hand rather than through `document.createTreeWalker`, so the tests can pass in plain fake nodes. The overlay lives entirely inside a closed Shadow DOM, because the host page's global resets and z-index values must not break it, and it must not break them. |
| API client with an injected fetch | `tag-extension/src/shared/api.js` | Written against `docs/api-contract.md` and carrying no key, so the same file runs unchanged under the Node smoke test. Every network call goes through the MV3 service worker rather than the content script, which is what keeps the host page's CORS policy out of it. |
| Extension build with manifest validation | `tag-extension/scripts/build.mjs` | Four esbuild bundles, then the manifest is checked against the files the build actually produced: a manifest referencing a file that is not in the bundle fails the build rather than failing in Chrome. A missing input is never papered over with a stub -- the build exits 1 with a reason. |
| The honesty gate | `tag-extension/scripts/gate-honesty.sh` | Scans the extension tree for vocabulary that implies certainty or price movement. It prints `scanned`, `exempted`, `violations` and `verdict`, treats `scanned=0` as a self-failure rather than a pass, and names every excused file, so an exemption wide enough to swallow the tree fails loudly instead of printing a perfect mark. |
| IDL consistency check | `.github/scripts/check-idl.mjs` | Re-derives the program address and the instruction, account, event and error names from the Rust source and compares them with the committed `idl/bazr_market.json`. Names are compared as sets rather than as counts, because a renamed instruction is exactly the failure a count misses. Pure Node, no toolchain, run on every push. |
| Published specifications | `docs/relic-spec.md`, `stall-spec.md`, `tag-spec.md`, `api-contract.md`, `architecture.md`, `security.md`, `research.md` | The scoring formula, the on-chain layout rules, the label definitions, the wire contract, the system layout, the threat model and the sourcing research, in the open. The score is checkable rather than asserted. |

---

## Table 2 -- Depended on, not built here

### Network services

These are services the BAZR system reads from. **The code that calls them is in
the backend service, which is not in this repository.** What this repository
carries is the contract for their output and the source attribution that travels
with a score, not the calls themselves.

| Service | What it does for BAZR | Why not build it | Where it appears here |
|---|---|---|---|
| **Jupiter** | Swap routing and quotes over existing liquidity. | **This is the central design decision, not a shortcut.** BAZR does not run a DEX, an AMM, an order book or a perp venue, and it is not going to. Building one would put BAZR in competition with the venues it reads from, and aftermarket liquidity is thin enough that a new pool would make execution worse rather than better. | `docs/api-contract.md` (the quote contract, where `source` reports which router produced a route), `docs/relic-spec.md` and `docs/research.md` sourcing notes, `tag-extension/src/shared/constants.js` (`jup.ag` is a site the overlay attaches to), and `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` in the base58 exclusion set so the router program is never tagged as a mint. |
| **Helius** | RPC access plus holder enumeration and token authority lookups. Feeds `holder_dispersion` and `dev_wallet_state`. | Enumerating every holder of a mint from raw RPC means paging `getProgramAccounts` with filters, at a cost and latency that makes a per-request score impossible. It is an indexing problem that is already solved well. **Server side only.** A provider key must never reach a browser bundle or an extension build. | `docs/relic-spec.md`, `docs/research.md` and `docs/tag-spec.md` sourcing sections; the extension's test fixtures carry `helius` as a source attribution in example payloads, because the contract requires each axis to say where it came from. |
| **Solana RPC and the SPL token programs** | Chain reads, account fetches, token transfers and burns. | This is the chain. There is nothing to build. | `anchor-program/` through `anchor-spl`; the extension's exclusion set covers the System, SPL Token, Token-2022, associated token account, Memo, Compute Budget, Sysvar and Metaplex token metadata programs. |

Every response that carries a score also carries source attribution, so a reader
can see which upstream produced which axis and when it was fetched. That is what
the `sources` array in the relic contract is for.

### Libraries and toolchain

Declared in this repository's manifests. Nothing here is unusual, and none of it
is doing the scoring.

| Package | Manifest | Role |
|---|---|---|
| `anchor-lang` 0.31.1 | `anchor-program/programs/bazr-market/Cargo.toml` | Account validation, discriminators, PDA derivation, IDL generation. Writing raw Solana entrypoints by hand buys nothing except more places to omit an owner check. |
| `anchor-spl` 0.31.1, `token_2022` feature | same | SPL Token and Token-2022 CPI helpers, including the checked transfer that takes the mint decimals. |
| `@coral-xyz/anchor` 0.31.1 | `anchor-program/package.json` | Client side of the program, for `scripts/` and the localnet test suite. `@solana/web3.js` is reached through it and is deliberately not declared a second time. |
| `@solana/spl-token` 0.4.9 | `anchor-program/package.json` | Mint and token account setup in the scripts and tests. |
| `mocha`, `chai`, `ts-mocha`, `ts-node`, `typescript`, `prettier`, `@types/*` | `anchor-program/package.json` | The localnet test harness, the TypeScript runner for `scripts/`, and formatting. |
| `esbuild` 0.28.x | `tag-extension/package.json` | Bundles the extension. It is the extension's only declared dependency, it is build-time only, and the shipped extension has no runtime dependencies at all. |
| Node's built-in test runner | -- | The extension's 203 tests run on `node --test`. No test framework is installed. |
| Python 3 with Pillow | -- | Only for `npm run icons` in `tag-extension/`, which redraws the PNGs. Not needed to build, test or run anything, and not needed by CI. |
| Rust stable, Anchor CLI 0.31.1, Solana CLI | -- | Toolchain, not dependencies. `cargo fmt` and `cargo check` need only Rust. `anchor build`, `anchor test` and deployment need the rest. |

`anchor-program/Cargo.lock` is committed, so `cargo check --locked` resolves the
same versions everywhere. Lockfiles differ on the npm side, so the install
command does too. `tag-extension/package-lock.json` **is** committed, so
`npm ci` works there and is the reproducible form, and it is what CI runs.
`anchor-program/` has no npm lockfile, so its TypeScript dependencies install
with `npm install` only -- `npm ci` requires a lockfile and will fail.

---

## Table 3 -- What does not exist

Listed because an audit that finds these first and finds them undisclosed is
entitled to distrust everything above.

| Item | Actual state |
|---|---|
| **Mainnet deployment** | **Not deployed.** The program is on devnet only, at `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb`. A mainnet deployment needs explicit owner approval and a launched bond mint, because `initialize_market` writes that mint into the config and changing it afterwards means redeploying. |
| **Security audit** | **None.** No third party has reviewed the program. `docs/security.md` is the maintainers' own threat model, not an audit report. |
| **Verifiable build attestation** | **None published.** An upgradeable program can be replaced by whoever holds the upgrade authority, so reading this source does not bind the binary currently deployed at that address. |
| **Rust unit tests in the program** | **None.** There is no `#[cfg(test)]` module anywhere under `programs/`. The program's test suite is `anchor-program/tests/bazr-market.ts`, run by `anchor test --provider.cluster localnet`, which needs the Anchor toolchain and a local validator and is therefore not in CI. What CI runs against the program is `cargo fmt --all --check` and `cargo check --all-targets --locked`. |
| **Chrome Web Store listing** | **Not listed.** The extension is built from source and loaded unpacked, so there is no automatic update channel: a fix reaches a user when they rebuild. |
| **TypeScript SDK and command-line tool** | **Not in this repository.** They are in [BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk) and are built from source there. |
| **Anything on npm** | **Nothing is published.** Checked: `npm view bazr-cli`, `npm view @bazr/sdk`, `npm view @bazr/tag-extension` and `npm view bazr` all return 404. Do not write an install command for any of them anywhere. There is nothing to install. |
| **Backend service and web frontend** | **Not open source, and not in this repository or in `bazr-sdk`.** What can be verified from here is that the published formula and the published contract match this code, and that live responses match both. |
| **An npm lockfile in `anchor-program/`** | **Not committed**, so its TypeScript dependencies install with `npm install` and `npm ci` fails there. This is the one package without one: `tag-extension/package-lock.json` is committed and CI installs that package with `npm ci`, and `anchor-program/Cargo.lock` is committed too. |
| **A relic score computed in this repository** | **Not computed here.** The scoring model is specified in `docs/relic-spec.md` and consumed by the extension; the service computes it and the SDK recomputes it from the axis array. This repository publishes the formula and renders the result. It does not produce the number. |

---

## So what is actually BAZR

**The time axis.** The established Solana tools are built around new launches,
live trending and sniping -- the first hours of a token's life, where speed is the
product. BAZR only looks at what happens *after* graduation, where speed is worth
nothing and the only interesting question is whether anything survived. There is
no new-token feed here, no trending list and no sniping path, and that is a
constraint the project holds rather than a feature it has not got to yet. A tool
built for the first hour and a tool built for the third month disagree about
almost every design decision, starting with whether latency matters at all.

**The formula is published, and missing data is not folded into it.** The
weighting model, the five axes and the verdict thresholds are in
`docs/relic-spec.md` where anyone can read them. The decision most scoring
products get wrong is what to do with an axis that could not be measured: folding
it in as a zero is easy, and it makes a token whose holder lookup timed out render
identically to a token that was measured and found dead. BAZR removes the
unobserved axis from the denominator, re-normalises the rest, reports the
resulting coverage alongside the score, and returns the verdict `unclear` when
coverage is too low to support a claim. **Missing data and bad data are different
events, and the number must not collapse them into one.** That behaviour is worth
more than the exact weights, because weights can be argued about, while a score
that quietly means two different things cannot be argued about at all.

**Failure is recorded at the same size as success, in the layout.** A stall
owner's losses sit beside their wins as the same type, reputation is signed so a
curator who is wrong more often than right goes negative, and a slash is a
permanent mark rather than a resettable counter. The devnet deployment already
carries a loss as well as wins, which is the point: the record has to be able to
show one. This lives in the account struct rather than in an interface component,
because that is the level at which it cannot be quietly removed later. None of it
makes the product friendlier. It is the part that makes the score worth reading.
