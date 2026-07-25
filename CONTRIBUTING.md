<!-- bazr-honesty-allow-file: this file names the banned marketing terms in order to ban them -->

# Contributing to BAZR

BAZR is an aftermarket for Solana meme tokens that already graduated from a
launchpad. It summarises what survived, publishes the formula, and shows the
reasoning behind the number. Contributions that make that summary more honest
are the most welcome kind.

Read [DEPENDENCIES.md](DEPENDENCIES.md) before you start. It separates what this
repository builds from what it hands to other people, and Table 3 lists what does
not exist yet. Both halves are accurate, and knowing them will save you from
opening a pull request against something that is somewhere else entirely.

---

## What is in this repository, and what is not

| Path | What it is | State |
|---|---|---|
| `anchor-program/` | The `bazr-market` Anchor program: stall registry, listing ledger, bond escrow, crate vault. | Deployed on devnet at `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb`. One full cycle -- open a stall, list, resolve one listing each way, create and rebalance and freeze a crate -- has been run against devnet as real transactions. Not on mainnet. |
| `tag-extension/` | BAZR Tag, a Manifest V3 Chrome extension that overlays a price tag on mint addresses. | Complete and buildable. 203 unit tests. Not on the Chrome Web Store; it is loaded unpacked. |
| `docs/` | Relic specification, stall specification, tag specification, API contract, architecture, threat model, sourcing research. | Written, and they are the reference the code is measured against. |
| `idl/bazr_market.json` | The generated IDL for the deployed program, committed so a client can be built without running `anchor build` first. | Matches the source. CI proves it on every push. |
| `.github/` | The CI workflow and the IDL consistency check it runs. | Three jobs, all of which pass on a clean checkout. |

**The TypeScript SDK and the command-line tool are not here.** They live in
[BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk), and pull requests
for either belong in that repository. Neither is published to npm; both are built
from source. This repository is the on-chain program, the extension, and the
specifications the other repository implements against.

The web frontend and the backend service are not open source and are not in
either repository. What you can check from here is that the published formula and
the published contract match the code that implements them, and that live
responses match both.

---

## Development environment

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22 or newer | `tag-extension/`, and the IDL check. Node 20 runs the extension build, the honesty gate and the IDL check, but not `npm test`: passing a glob to `node --test` needs Node 22, and on Node 20.19.5 it fails with `Could not find .../test/**/*.test.js`. |
| npm | Whatever ships with your Node | Everything JavaScript. |
| Rust | Current stable, no pin | `cargo fmt` and `cargo check` in `anchor-program/`. Verified on 1.95.0. |
| Anchor CLI | 0.31.1 | `anchor build` and `anchor test` only. Pinned in `Anchor.toml` under `[toolchain]`. |
| Solana CLI | Current stable | Deploying, and running the devnet scripts. Not needed to compile or format. |

Lockfiles differ by package, so the install command does too.
`tag-extension/package-lock.json` **is** committed, so `npm ci` works there, it
is the reproducible form, and it is what CI runs. `npm install` works too and is
fine locally.
`anchor-program/` has no npm lockfile, so its TypeScript dependencies install
with `npm install` only -- `npm ci` requires a lockfile and will fail.
`anchor-program/Cargo.lock` **is** committed, which is why CI can run
`cargo check --locked`.

---

