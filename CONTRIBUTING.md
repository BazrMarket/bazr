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

## Working on `anchor-program/`

These two commands need only a Rust toolchain, and both are what CI runs:

```bash
cd anchor-program
cargo fmt --all --check
cargo check --all-targets --locked
```

`cargo check` reports warnings that come out of Anchor's derive macros --
`unexpected_cfgs`, and one deprecated `AccountInfo::realloc`. They are generated
code, the program source cannot silence them, and that is why CI does not run
clippy with `-D warnings`. Do not add `#![allow(...)]` at the crate root to hide
them; it would hide the next real one as well.

Producing the program binary and the IDL needs the full Anchor toolchain:

```bash
anchor build     # -> target/deploy/bazr_market.so, target/idl/bazr_market.json
anchor test --provider.cluster localnet
```

Pass `--provider.cluster localnet` explicitly rather than inheriting whatever
`solana config` happens to point at, since that setting is shared by every
project on the machine.

**If you regenerate the IDL, commit it and re-run the check:**

```bash
cp target/idl/bazr_market.json ../idl/bazr_market.json
node ../.github/scripts/check-idl.mjs
```

That script re-derives the program address, and the instruction, account, event
and error names, from the Rust source and compares them with the committed IDL.
It prints `mismatches=` and `verdict=`, exits 1 on a mismatch, and exits 2 when
it could not read something -- because having found nothing wrong and having
looked at nothing must not share an exit code.

What the account layouts are protecting, and what a review will ask about:

- **Losses are stored exactly like wins.** `resolved_wins` and `resolved_losses`
  are both `u32`, `reputation` is signed, and a resolution moves reputation by
  the same magnitude either way. On devnet the deployed stall currently reads
  `RESOLVED_WINS 2 / RESOLVED_LOSSES 1`, and both numbers are meant to be equally
  easy to read. A schema that counts only success cannot be repaired later by an
  interface, so the constraint lives in the account.
- **Nothing is deallocated.** A listing is marked `Withdrawn` rather than closed,
  and a stall account survives `close_stall`, because the PDA is derived from the
  owner and deallocating it would let a losing record be reset by reopening at
  the same address.
- **Every `LEN` is an explicit field-by-field sum**, padded so `8 + LEN` lands on
  an 8-byte boundary, and every account keeps its `reserved` tail. A field added
  outside that tail must be a lifetime accumulator that legitimately starts at
  zero; a field holding a current total would read `0` on existing accounts and
  under-report.
- **Events have no reserved tail.** Adding a field to an existing event breaks
  decoding of past logs. Emit a new event type instead, so the discriminator
  carries the version.
- **Arithmetic is checked.** Use the checked operations and return `MathOverflow`.
  `overflow-checks = true` in the release profile is the second line of defence,
  not the first.
- Do not mix inline modules (`pub mod name { ... }`) with file references
  (`pub mod name;`) in one file. `cargo fmt` goes looking for the file and fails.

Deploy keypairs are supplied from outside the repository and passed to each
command explicitly (`--keypair`, `--provider.wallet`, `ANCHOR_WALLET`). Never
commit one, and never change the global `solana config` to avoid typing a path.

