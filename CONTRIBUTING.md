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

## Working on `tag-extension/`

The full loop, and all four of these pass on a clean checkout:

```bash
cd tag-extension
npm install
npm test          # node --test over test/**/*.test.js -- 203 tests
npm run gate      # scans for hype vocabulary, prints scanned/exempted/violations/verdict
npm run build     # production bundle plus build/unpacked and the zip
```

`npm run smoke -- --base <url>` calls a live API and checks the responses against
the contract. It is useful by hand and is deliberately not in CI: a failure there
would report on the service being down rather than on your change.

When you extend it:

- **Keep `src/shared/` runnable under plain Node.** Nothing there may reach for a
  global `chrome`: where a browser API is unavoidable it arrives as an injected
  parameter with a default, as in `readSettings(storage = chrome.storage.local)`,
  so a test can pass a fake. That is what lets the tests import these modules
  directly with no browser harness. Everything else in `src/shared/` touches no
  `chrome.*` at all, and it is worth keeping it that way.
- **Address detection stays strict.** The check is "decodes to exactly 32 bytes",
  not "matches a 32-44 character base58 regex" -- the regex form also matches
  transaction signature fragments, arbitrary hashes and URL slugs. Candidates are
  additionally confirmed against the API before anything is drawn.
- **New system or protocol addresses go in `EXCLUDED_ADDRESSES`.** Tagging the SPL
  Token program with a relic score is a bug.
- **Request the narrowest host permissions that work.** The extension draws on
  other people's pages and must not become a reason to distrust them. Anything
  beyond the two compiled-in API origins goes through
  `optional_host_permissions`, requested at the moment the user saves the change.
- **No API key, ever.** Anyone can unzip an extension, so a key inside one is a
  published key. There is no slot for one in the settings schema, and a test
  asserts that.
- **An unobservable axis renders as `unknown`, never as 0.** Collapsing "could not
  be seen" into "is bad" would draw every token with a failed lookup as dead.

`npm run icons` redraws `public/icons/*.png` and needs Python 3 with Pillow.
Commit the regenerated PNGs when you run it.

## Working on `docs/`

The specifications are the published claim, and the code is the implementation of
that claim. Where a document and the code disagree, that is a defect in one of
them, and each document says which side it expects to be corrected. Keep that
property: a specification that quietly drifts behind the code is worse than none,
because people read it and believe it.

---

## Changing the score

**A pull request that changes how a relic score is produced must change
[`docs/relic-spec.md`](docs/relic-spec.md) first, in the same pull request.**

This covers axis weights, axis definitions, verdict thresholds, coverage rules,
and anything that can move a token between `dormant`, `dead` and `unclear`. The
specification is the reason to trust the number. If the code moves and the
specification does not, the published formula is no longer the formula being run,
and there is nothing left to check.

The same rule applies to `docs/stall-spec.md` for on-chain layout changes and to
`docs/api-contract.md` for wire-format changes.

Two rules inside the model are not up for negotiation. Propose a change to either
with a full argument rather than a patch:

1. **An unobserved axis is removed from the weighting denominator and the
   remaining weights are re-normalised. It is never folded in as a zero.**
   Missing data and bad data are different events. Folding an unobserved axis to
   zero makes a token whose lookup failed render identically to a token that was
   measured and found dead.
2. **Low coverage produces the verdict `unclear`, not a low score.** `unclear` is
   a real answer. Padding it into a number that looks complete is the failure
   mode this project exists to avoid.

Also not negotiable, in the on-chain schema: a stall's losses are stored at the
same width as its wins, and `reputation` is signed.

---

## Commit messages

**Write a plain English imperative sentence. No prefix, no colon, no scope.**

This project does not use Conventional Commits. Do not open a message with
`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf` or
`style`. More generally, **the message must not begin with a token followed by a
colon**, in any form, including `word:`, `word(scope):` and `word(scope)!:`.

Capitalise the first word. No trailing period. Roughly 72 characters or fewer.
Say what the commit does, as if completing the sentence "this commit will ...".

### Do this

```
Remove unknown axes from the weighting denominator
Store stall losses at the same width as wins
Decode base58 fully instead of matching on length
Compare the committed IDL against the program source in CI
Publish the axis weights alongside the score
```

### Not this

```
feat: remove unknown axes from the weighting denominator
fix(program): store stall losses at the same width as wins
chore: bump esbuild
docs: update the relic spec
extension: add the popup history list
```

The last one contains no Conventional Commits keyword and is still wrong. The
banned shape is a token followed by `:` at the start of the line, whatever the
token is.

Check your own branch before opening a pull request. This should print nothing:

```bash
git log --format=%s origin/main..HEAD | grep -E '^[A-Za-z][A-Za-z0-9_-]*(\([^)]*\))?!?:'
```

---

## The honesty gate

`tag-extension/scripts/gate-honesty.sh` enforces section 0 of
[`docs/relic-spec.md`](docs/relic-spec.md) mechanically: the vocabulary of
certainty, price multiples and imminent movement stays out of the code and out
of anything the interface renders. Run the control group first, then the gate:

```bash
cd tag-extension
npm run gate -- --selftest
npm run gate
```

The control group comes first because a detector that always fails passes an
audit exactly as easily as one that always succeeds. It checks both directions
-- that the scanner fires on seeded copy and stays quiet on clean source -- and
that neither exemption spreads to the file next door. It prints one line per
case and then a total:

```
selftest ok=14 fail=0
```

The gate itself prints four lines, and on a clean tree they read:

```
scanned=38
exempted=14
violations=0
verdict=PASS
```

Read all four, not only the last. `scanned=0` is a self-failure and exits 2,
because having looked at nothing and having found nothing print the same thing.
So is an exemption rule wide enough to swallow the whole tree. When there are
violations the `file:line:text` hits come out **before** the verdict, so the
lines that matter survive a truncated log. Exit codes are 0 for PASS, 1 for
FAIL and 2 for SELF-FAIL; treat 2 as a failure, never as a pass.

Two exemptions exist, and both are announced on stderr rather than applied
quietly. Files whose job is to name the banned vocabulary in order to reject it
-- anything under `test/`, `*.test.*` and `*.spec.*` sources, and `gate-*.sh`
scripts -- are excused, because counting a control group's own assertions as
violations would make writing one a punishable act. So is any file carrying the
literal marker `bazr-honesty-allow-file`, which is why this file carries it. A
specification document is deliberately **not** excused: prose about the product
is exactly where the strictest reading belongs.

The gate covers `tag-extension/`. The rest of the repository is on you and on
review.

---

## No emoji

**No emoji anywhere.** Not in commit messages, code, comments, documentation,
pull request titles or descriptions, test names, log output, or anything the
interface renders. This includes GitHub shortcodes such as `:fire:`, and it
includes symbol characters used as status marks. Write `PASS` and `FAIL`, or `O`
and `X`.

The reasons, since "house style" is not one:

- They render differently on every platform, and some do not render at all.
- They break `grep`, alignment and terminal width arithmetic.
- A number that claims to be an observation should not be decorated like an
  advertisement.

To check a file:

```bash
grep -nP '[\x{1F000}-\x{1FAFF}\x{2190}-\x{21FF}\x{2300}-\x{23FF}\x{2460}-\x{24FF}\x{25A0}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{200D}]' path/to/file
```

---

## Language and claims

- **Everything in this repository is written in English.** Code, comments,
  documentation, commit messages and pull request text.
- **No marketing language about price.** The words `guaranteed`, `100x`, `moon`,
  `gem`, `alpha`, and phrases such as "next pump", do not belong in a repository
  whose product is a survival measurement. The extension's honesty gate enforces
  this over `tag-extension/`; the rest of the repository is on you.
- **A relic score is an observational summary, not a prediction.** It is not a
  rating, not a recommendation, and not a statement that a token is safe. Do not
  write it up as one.
- **Do not describe something as working when it does not.** If a command,
  package, deployment or listing does not exist, say so plainly, the way
  [DEPENDENCIES.md](DEPENDENCIES.md) Table 3 does. Documentation that oversells
  is found in a minute and costs more than the missing feature would have.
- **Failures are displayed at the same size as successes.** That applies to stall
  records, to rug and bundle observations, and to this documentation.

---

## Pull requests

One change per pull request. Describe what you changed and how you verified it,
including the commands you ran and their output. "It should work" is not a
verification.

Before you open it:

- [ ] `cd anchor-program && cargo fmt --all --check && cargo check --all-targets --locked`
      passes, if you touched `anchor-program/`
- [ ] `cd tag-extension && npm install && npm test && npm run gate && npm run build`
      passes, if you touched `tag-extension/`
- [ ] `npm run gate -- --selftest` printed `fail=0` before you trusted the gate,
      and `npm run gate` printed `verdict=PASS` with `scanned` not `0`
- [ ] `node .github/scripts/check-idl.mjs` prints `verdict=PASS`, if you touched
      the program source or the IDL
- [ ] Any test you added passes locally and makes no live network calls
- [ ] Zero emoji, in every file you touched and in the pull request text
- [ ] Zero commit messages beginning with a token and a colon
- [ ] Zero secrets: no API keys, no RPC URL carrying a key, no private keys, no
      `.env` file, no real wallet in a fixture
- [ ] `docs/relic-spec.md` updated in the same pull request, if you changed how a
      score or a verdict is produced
- [ ] English only
- [ ] No claim in the documentation that the code does not support

### Security issues do not go here

Do not open a public issue or pull request for a vulnerability. Report it
privately through GitHub Security Advisories. See [SECURITY.md](SECURITY.md).

A false positive in the scoring model is also a security report, and it belongs
in that same private channel with the full mint address and the observed axis
breakdown.

---

