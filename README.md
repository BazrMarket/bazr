<h1 align="center">BAZR</h1>

<p align="center"><strong>One degen's exit is another's entry.</strong></p>

<p align="center">
  <a href="https://github.com/BazrMarket/bazr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BazrMarket/bazr/ci.yml?branch=main&label=build&style=flat-square" alt="Build"></a>
  <a href="https://bazr.market"><img src="https://img.shields.io/badge/site-bazr.market-1F6FB2?style=flat-square" alt="Site"></a>
  <a href="https://api.bazr.market/health"><img src="https://img.shields.io/badge/api-api.bazr.market-7FA650?style=flat-square" alt="API"></a>
  <a href="https://github.com/BazrMarket/bazr/blob/main/LICENSE"><img src="https://img.shields.io/github/license/BazrMarket/bazr?label=license&style=flat-square&color=C8A87C" alt="License"></a>
  <a href="https://github.com/BazrMarket/bazr/commits/main"><img src="https://img.shields.io/github/last-commit/BazrMarket/bazr?label=last%20commit&style=flat-square&color=6E7076" alt="Last commit"></a>
  <a href="https://www.anchor-lang.com/"><img src="https://img.shields.io/badge/anchor-0.31.1-1F6FB2?style=flat-square" alt="Anchor 0.31.1"></a>
  <a href="#the-on-chain-program"><img src="https://img.shields.io/badge/solana-no%20live%20deployment-D9B85C?style=flat-square&logo=solana&logoColor=white" alt="No live Solana deployment"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/rust-2021-E8452F?style=flat-square&logo=rust&logoColor=white" alt="Rust 2021"></a>
</p>

<p align="center">
  <a href="https://developer.chrome.com/docs/extensions/develop"><img src="https://img.shields.io/badge/extension-MV3-3A3A38?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3"></a>
  <a href="https://github.com/BazrMarket/bazr/blob/main/docs/relic-spec.md"><img src="https://img.shields.io/badge/relic%20spec-published-C8A87C?style=flat-square" alt="Relic specification"></a>
  <a href="https://github.com/BazrMarket/bazr-sdk"><img src="https://img.shields.io/badge/sdk%20and%20cli-BazrMarket%2Fbazr--sdk-1F6FB2?style=flat-square&logo=github&logoColor=white" alt="SDK and CLI repository"></a>
  <a href="https://github.com/BazrMarket/bazr#nothing-here-is-on-a-package-registry"><img src="https://img.shields.io/badge/registry-not%20published-6E7076?style=flat-square" alt="Registry status"></a>
  <a href="https://x.com/bazrmarket"><img src="https://img.shields.io/badge/X-%40bazrmarket-000000?style=flat-square&logo=x&logoColor=white" alt="X"></a>
</p>

**BAZR token contract address, Solana mainnet-beta:**

```
7YhmLtcwtqdTkoGZWMJ7AkQzoFdUJK4FTEk6b1gpump
```

Token-2022 mint, 6 decimals, fixed supply of 1,000,000,000. Mint authority and
freeze authority are both revoked, so no further supply can be minted and no
account can be frozen. Both facts are readable straight off the chain on
[solscan.io](https://solscan.io/token/7YhmLtcwtqdTkoGZWMJ7AkQzoFdUJK4FTEk6b1gpump) and
[solana.fm](https://solana.fm/address/7YhmLtcwtqdTkoGZWMJ7AkQzoFdUJK4FTEk6b1gpump).

The Anchor program described further down is a different address, and it is
not deployed on any cluster right now. The two are not interchangeable.

---

BAZR is an aftermarket for Solana meme tokens that already graduated from a
launchpad. The launchpads compete over the first ten minutes of a token's life.
BAZR only looks at what happens after that, and puts a number on how much of the
token is still standing.

This repository holds the open parts: the on-chain program, the browser
extension, the published IDL, and the full specification of how the score is
computed. The typed SDK and the terminal client live next door in
[BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk).

## A relic score is a summary of survival signals

**It is not a prediction of revival, recovery, or price.** Read that before
anything else in this repository, because every design decision below follows
from it.

The score answers one question: *how much of this token's structure is still
intact?* Liquidity that can still be exited, holders that are not one wallet, a
creator wallet that is not sitting on the supply, trades that still happen at
all. Those are observations about the present, and observations about the
present are not forecasts about the future.

Three consequences, all of them enforced in the spec rather than left to good
intentions:

- **The verdict has an "I do not know" state.** A token is scored `dormant`,
  `dead`, or `unclear`. When the signals genuinely conflict, or when too little
  could be observed, the answer is `unclear`. Manufacturing confidence that is
  not there is the fastest way to make this number worthless.
- **Missing data is not bad data.** An axis that could not be read is dropped
  from the weighting and the remaining weights are re-normalised. It is never
  folded in as a zero. Folding it to zero would mean every token whose lookup
  failed renders as dead, which turns the score into a measurement of our own
  uptime rather than of the token.
- **The formula is public.** Every weight, every threshold, and every clamp is
  in [`docs/relic-spec.md`](docs/relic-spec.md). You can recompute a score by
  hand and check ours against it.

Do not use a relic score as a reason to buy or sell anything. The known ways it
can be wrong are written down in [`docs/security.md`](docs/security.md), and we
would rather you read those than trust the number.

## The five axes and their weights

Every relic score is a weighted mean over five axes. The weights are fixed,
published, and shipped on the wire with every response, so no client has to
keep a second copy that can drift:

| Axis | Weight | What it observes |
| --- | --- | --- |
| `lp_residual` | **0.30** | Quote-side liquidity that is still there, and whether the LP is burned or locked |
| `floor_shape` | **0.25** | Whether trading still happens at all, and how recently |
| `holder_dispersion` | **0.20** | How concentrated the remaining supply is, excluding pool, exchange, burn and insider wallets |
| `dev_wallet_state` | **0.15** | Mint and freeze authority, and how much the creator still holds |
| `social_afterglow` | **0.10** | Breadth of distinct participants and new holder inflow |
| | **1.00** | |

The ordering is not arbitrary. `lp_residual` carries the most weight because if
there is no exit liquidity, nothing else about the token matters much.
`social_afterglow` carries the least because it is the easiest signal to
manufacture, and a weight of 0.10 caps how far a manipulated signal can move the
result.

Weights are given before re-normalisation. The derivation of each axis,
including every clamp and interpolation, is in
[`docs/relic-spec.md`](docs/relic-spec.md) section 7.

## Aggregation and verdicts

```text
available = { axis : axis.status == "ok" }
W_avail   = sum(weight of available)

relic     = sum(weight * score for available) / W_avail        # 0..100
```

An axis with `status: "unknown"` leaves the numerator *and* the denominator. It
is not counted as zero. Every response also carries the coverage figure, so a
caller can see how much of the picture was actually observed.

Here is that rule on live data. Wrapped SOL, from the deployed service:

```bash
curl -s --retry 2 --retry-connrefused \
  https://api.bazr.market/relic/So11111111111111111111111111111111111111112
```

The service sleeps when idle, so the first call after a quiet spell can stall or
fail outright before it answers. Measured on 2026-08-19: this exact request
failed on the first attempt, then returned 200 in 0.38s on the retry, and
`/relic/<mint>/tags` took 27.4s from cold. The `--retry` flags above absorb that.
One failure is a cold start, not an outage.

```text
score    71          verdict  dormant

lp_residual         60    weight 0.30   ok
dev_wallet_state   100    weight 0.15   ok
social_afterglow    60    weight 0.10   ok
holder_dispersion   --    weight 0.20   unknown
floor_shape         --    weight 0.25   unknown

(0.30*60 + 0.15*100 + 0.10*60) / 0.55 = 70.9  ->  71
```

Two of the five axes could not be observed, so 45 percent of the weight is
missing. The score is the weighted mean of the three that could be observed,
re-normalised over the 0.55 that remained. Folding the two unobserved axes in as
zeros would have produced 39, and a token that was never measured would be
indistinguishable from a token measured and found dead.

The verdict is then decided in order, first rule to match wins:

| Condition | Verdict |
| --- | --- |
| `lp_residual` unknown, or `W_avail < 0.50` | `unclear` (not enough was observed) |
| `lp_residual <= 10` and `floor_shape` unknown or `<= 10` | `dead` |
| `relic <= 33` | `dead` |
| `relic >= 60` and `lp_residual >= 40` | `dormant` |
| `relic >= 60` but `lp_residual < 40` | `unclear` (high total, but no way out) |
| `34 <= relic <= 59` | `unclear` |

The last two rows are the ones worth arguing about, so here is the reasoning.
The 34-59 band is where the survival signals genuinely disagree with each other;
forcing a `dead` or a `dormant` out of it would be inventing a conclusion. And a
high aggregate with thin liquidity is not `dormant`, because dormant is supposed
to mean *tradeable again* -- when the aggregate and the deciding axis disagree,
the deciding axis wins.

## Architecture

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#F2EFE3', 'primaryTextColor': '#3A3A38', 'primaryBorderColor': '#1F6FB2', 'lineColor': '#1F6FB2', 'secondaryColor': '#C8A87C', 'tertiaryColor': '#D9B85C', 'fontFamily': 'monospace'}}}%%
graph TD
  CHAIN["Solana<br/>bazr_market, not deployed"]
  PROG["anchor-program/<br/>stalls, listings, crates, bonds"]
  IDL["idl/bazr_market.json<br/>published interface"]
  IDX["Scoring service<br/>not in this repository"]
  API["api.bazr.market<br/>contract in docs/"]
  SDK["@bazr/sdk<br/>BazrMarket/bazr-sdk"]
  EXT["tag-extension/<br/>BAZR Tag, MV3"]
  CLI["bazr-cli<br/>BazrMarket/bazr-sdk"]

  PROG --> CHAIN
  PROG --> IDL
  CHAIN --> IDX
  IDX --> API
  API --> SDK
  IDL --> SDK
  SDK --> CLI
  API --> EXT

  style API fill:#1F6FB2,stroke:#3A3A38,color:#F2EFE3
  style CHAIN fill:#D9B85C,stroke:#3A3A38,color:#3A3A38
  style IDL fill:#C8A87C,stroke:#3A3A38,color:#3A3A38
```

The scoring service and the web frontend are deliberately not open source. What
is here is everything needed to verify the score and to build against it: the
formula, the wire contract, the on-chain program that records stall reputation,
its IDL, and a client that renders the result.

See [`docs/architecture.md`](docs/architecture.md) for the layer-by-layer
breakdown and [`DEPENDENCIES.md`](DEPENDENCIES.md) for an accounting of what is
ours and what is someone else's.

## What is in this repository

```text
anchor-program/    Anchor program bazr_market -- market, stalls, listings, crates
idl/               bazr_market.json, the published program interface
tag-extension/     BAZR Tag -- MV3 extension that overlays scores on addresses
docs/              relic-spec, stall-spec, tag-spec, api-contract,
                   research, architecture, security
```

| Component | State |
| --- | --- |
| `anchor-program/` | Eleven instructions, four account types, `Cargo.lock` committed. **Not deployed on any cluster** -- the source is complete, the deployment is gone |
| `idl/` | Produced by `anchor build` from the source in this tree. The IDL account it was published to on devnet has since been closed -- see below |
| `tag-extension/` | Builds, tests, and an honesty gate. **Not on the Chrome Web Store** |
| `docs/` | Complete for the score formula, stall rules, tag rules, API contract, and the research behind the axes |
| `@bazr/sdk`, `bazr-cli` | In [BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk). Build from source; see below |

### Nothing here is on a package registry

**`@bazr/sdk` is not on npm. `bazr-cli` is not on npm. BAZR Tag is not on the
Chrome Web Store.** `npm view bazr-cli` answers `E404`, and there is no store
listing to link to, so this README deliberately carries no global-install line
for either of them. Every install path in this repository and in
[BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk) builds from source,
and that is not a workaround shown for completeness -- it is the only path that
exists.

## The on-chain program

**There is no live `bazr_market` deployment.** The program was closed on
devnet and on mainnet-beta, both on 2026-08-20, and nothing at either address
can execute. No user funds were ever at risk from it. What is gone is the
deployment, not the code: the Rust source, the tests and the committed IDL in
this repository are untouched and complete, and the program can be rebuilt and
redeployed from this tree at any time.

Neither cluster is untouched either, so here is exactly what happened on each.

### mainnet-beta

On 2026-08-20 the program was deployed to mainnet-beta and closed again six
minutes later. Three signatures, all signed by the project's own deploy
wallet `FrEmSWh1WSb4P44yX1mUmK4Gr6n6mF2tmzSUwuwn2BT8`:

| What | Signature | Slot |
| --- | --- | --- |
| Deploy | `2FFi9hNjjM3cthjn36u1Qj4QgjbkxD7mW278stPmrPV9Nv7oesKt2ZpdU3uKFxzqqSoCpymEwpwrHCUzZFSPNb37` | 440413853 |
| Close IDL account | `38dDsxbiuEXspW54qzgHSY3q3oAweXXkm9EJ7ey4U4S8hMqiGRMWEBEWvjKBVsAcWQUgciSpvUQmWtuz8njNEXeH` | 440414742 |
| Close program | `3f6L7pxaScosoMpPcKUjjALSeDr8GuGscmLv7nnYYfYXAUsnAjRH4EFKpEm6ettFc6rt2gJYi8roMkAujXhS9P8H` | 440414746 |

Most of the rent came back to that wallet: 3.2397706 SOL released by the
`ProgramData` account and 0.0720867 SOL by the IDL account, 3.3118573 SOL
together. It did not all come back. The 36-byte program account still exists,
so the 0.0011414 SOL of rent holding it open is still on mainnet and stays
there while the address is occupied. The whole episode cost roughly 0.0036 SOL
-- about 0.0024 SOL of transaction fees across 482 signatures from that wallet,
most of them buffer writes during the deploy, plus that stranded 0.0011414 SOL.
The wallet is the project's own; no user ever sent anything to it.

### devnet

The program had run on devnet since 2026-08-18, and it was closed there on
2026-08-20 as well. Two signatures, signed by the devnet upgrade authority
`6QzfMfJa7q3on9fvSiRZuZQoWfCWDLK4nVot4NASxPeg`:

| What | Signature | Slot |
| --- | --- | --- |
| Close IDL account | `4CGBfZAwKBb7Wsq5zdWVNYYWNSGJrCX87mxrdXJZXhn9HqHtM1CWBWGS5x9GS4Wp5MhCctRUGSrpmb5S7idpo1UE` | 485678609 |
| Close program | `4fE2y7GMhC6tpye4r6EiVBf3orU2NRgRri1TXuukDH3scEBkSTY6MMKsJBwncBbkgy4kPHexL87DznmCt4urSNFn` | 485678620 |

Most of the rent came back to that wallet. The `ProgramData` account held
3.32017752 SOL and the IDL account
`JAMv36dzMFcKsWEjcid2Q11n9Rdk85AKMwz3H98CpeSt` held 0.06844464 SOL, 3.38862216
SOL between them; 3.38861216 SOL of that landed in the wallet, 0.00001 SOL
short because each of the two closing transactions paid a 0.000005 SOL fee.
It did not all come back. The 36-byte program account still exists, so the
0.00114144 SOL of rent holding it open is still on devnet and stays there while
the address is occupied. That wallet is the project's own as well; no user ever
sent anything to it.

### What is left at the address

The same thing on both clusters: a 36-byte `Program` stub whose `ProgramData`
account no longer exists, so **it cannot execute**. Reading the program ID
alone will not tell you this -- the stub still reports `executable: true`.
The `ProgramData` address is derived from the program ID, so it is the same
`2fLjtAE5SyF5zYxCnPC6To7KJixE7t2qTGbW7UefLRPj` on both chains, and on both
chains it now returns `null`.

| Field | Value |
| --- | --- |
| Program ID | `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb` |
| `ProgramData` | `2fLjtAE5SyF5zYxCnPC6To7KJixE7t2qTGbW7UefLRPj` -- absent on both clusters |
| devnet | closed 2026-08-20 |
| mainnet-beta | closed 2026-08-20 |
| Rent still locked up | 0.00114144 SOL on devnet and 0.0011414 SOL on mainnet, one stub each |
| Anchor | 0.31.1 |

`solana program close` closes the `ProgramData` account and nothing else. The
`Program` account and the rent keeping it alive stay where they are, on both
chains, which is why no version of this page says the rent came back in full.

Anyone can check that for themselves without trusting this table:

```bash
solana program show FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb --url devnet
solana program show FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb --url mainnet-beta
```

Both answer `Error: Program FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb has
been closed`.

Closing a program removes the executable, not the accounts it had written. The
market PDA `Axy4um2WmvEsWLTNqWJabQu8GTX1AcRPrNLHNekPSFNj` and the stall and
crate accounts from the devnet run are still readable on devnet. Nothing can
modify them any more, because there is no program left to run.

The scoring pipeline and the program were on different clusters on purpose, and
the API reports them as two separate fields rather than collapsing them into
one `cluster`: `data_cluster` says which chain token data is read from, and
`program_cluster` says which chain the program is deployed on. With no
deployment there is no cluster to name, so **`program_cluster` is now absent
from the API response entirely** -- absent, not `null`, and never filled in
from `data_cluster`. Collapsing those two would let "reads mainnet" be
presented as "deployed on mainnet", which is exactly the claim this project
refuses to make.

### A stall's losses are stored the same way as its wins

This is a layout decision, not a UI preference, which is why it appears in the
README of the program repository and not in a style guide.

`Stall` holds `resolved_wins` and `resolved_losses` as the same type, and
`reputation` is signed, so a curator who is wrong more often than right goes
below zero. A listing is never deleted -- withdrawing marks it `Withdrawn`. A
stall account is never deallocated, so a losing record cannot be reset by
closing and reopening at the same address. Resolution is an authority action, so
a stall cannot grade its own calls.

The API returns those two counters as raw numbers and deliberately exposes **no
pre-computed win rate**, because a single ratio is the easiest place for a bad
record to hide behind its denominator. The stall written during the devnet run
reads `resolved_wins 2 / resolved_losses 1`, and both halves of that are still
on chain -- the close removed the program, not the accounts it had written.

See [`docs/stall-spec.md`](docs/stall-spec.md) for the full account layout and
the bond and slash rules.

## Build from source

Node 20 or newer for the extension. The Anchor program additionally needs Rust
and the Solana platform toolchain.

```bash
git clone https://github.com/BazrMarket/bazr.git
cd bazr

# Browser extension: build, test, and the honesty gate
cd tag-extension
npm install
npm run build
npm test
npm run gate
```

That produces `tag-extension/dist/`, which loads unpacked in any Chromium
browser at `chrome://extensions` with developer mode on. There is no store
listing, so unpacked is the only way to run it.

For the program, with Anchor 0.31.1 installed:

```bash
cd anchor-program
anchor build
anchor test
```

`anchor build` regenerates the IDL. If the result differs from
[`idl/bazr_market.json`](idl/bazr_market.json), the committed IDL is stale and
that is a bug worth reporting -- the whole point of publishing it is that a
client can be built against it without trusting us. CI checks exactly that on
every push, comparing the program ID and the instruction, account, event and
error names in the committed IDL against the Rust source.

### Four places described this program, and they agreed

An ABI is only useful if every copy of it says the same thing. Four copies
existed while the program was deployed. Two of them were on chain and were
closed on 2026-08-20, so **only the two in this repository can still be checked
today.** Saying "they agree" about copies a reader can no longer fetch would be
asking for trust, so the table says which is which.

| Where | Instructions | How to check it yourself |
| --- | --- | --- |
| Rust source in this tree | 11 | `grep 'pub fn' anchor-program/programs/bazr-market/src/lib.rs` |
| Committed [`idl/bazr_market.json`](idl/bazr_market.json) | 11 | `jq '.instructions \| length' idl/bazr_market.json` |
| Program that ran on devnet | 11 | closed 2026-08-20 -- not fetchable any more |
| IDL account published on devnet | 11 | closed 2026-08-20 -- `anchor idl fetch` now fails |

Counting instructions is the weak version of this check anyway: two copies can
hold the same number and still differ. While the IDL account existed, the
content comparison was the real one -- `anchor idl fetch` against
`idl/bazr_market.json`, normalised and hashed -- and a client reading its ABI
from the chain got the same `set_stall_uri` and `StallUriUpdated` this
repository documents.

`set_stall_uri` was deployed and executed on devnet, and that transaction is
still on chain even though the program is not. It is
`5Ez13hJnUG6qxNcB2Wu9BrViXhf4khe2t6LnX9c8RXLg7Ba1MUkCRGmTzg9wKJqp3qRyxUaJ8DrT7r6ZxeJWvVCi`,
and its log still carries `Program log: Instruction: SetStallUri` followed by
`success`:

```bash
solana confirm -v 5Ez13hJnUG6qxNcB2Wu9BrViXhf4khe2t6LnX9c8RXLg7Ba1MUkCRGmTzg9wKJqp3qRyxUaJ8DrT7r6ZxeJWvVCi --url devnet
```

The IDL account is a zlib-compressed payload; the 8-byte discriminator, a
32-byte authority and a 4-byte length come first, and the rest inflates to JSON.
Nothing here asks you to take our word for the instruction count -- decode it and
count.

The committed IDL tracks the source rather than whatever was last published to
the chain, because that is what a client builds against and CI can prove it
matches the source on every push. CI cannot prove anything about a cluster it
does not talk to, which is exactly why the mismatch above is written down here
rather than left for someone to hit at runtime.

CI does not run `anchor build`. Producing the BPF artifact needs the Solana
platform toolchain, which is a slow and brittle thing to install on a hosted
runner, and a red build teaches everyone to stop reading the build. What CI runs
instead is three jobs that need no Solana toolchain at all: `cargo fmt --check`
and `cargo check --all-targets --locked` over the program crate; the extension's
unit tests, honesty gate and production build; and a check that the program ID
is the same string in `declare_id!`, in `Anchor.toml`, and in the committed IDL,
and that the instruction, account, event and error names in that IDL still match
the ones in the Rust source. That last job is what would catch a stale IDL. See
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Reading a score

The wire format is specified in [`docs/api-contract.md`](docs/api-contract.md)
and is stable enough to code against directly:

```bash
curl -s --retry 2 --retry-connrefused https://api.bazr.market/relic/<mint>
curl -s --retry 2 --retry-connrefused https://api.bazr.market/relic/<mint>/tags
curl -s --retry 2 --retry-connrefused https://api.bazr.market/market/stats
```

The `--retry` flags are not decoration. The service sleeps when idle and the
first call can fail before it answers; see the cold-start note above for the
measured numbers.

Every scored response carries `axes` with a per-axis `status`, `weight`, and
`detail`; the `sources` that produced each observation and when they were
fetched; `scored_at`; and a `disclaimer` field that says, in the payload itself,
`Survival-signal summary, not a prediction of price or revival.`

For a typed client that validates all of that against the contract before it
reaches your code, use [BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk).
It builds from source and its README carries the re-normalisation maths as an
executable assertion.

## What BAZR does not build

This is a scope commitment, not a roadmap gap.

- **No new-token feed, no live trending, no sniping.** Those belong to the first
  ten minutes of a token's life, and that market is thoroughly served. BAZR's
  time axis starts after graduation and never moves earlier.
- **No in-house DEX, order book, or perps.** Routing goes over liquidity that
  already exists. When a quote comes from Jupiter, the response says so in its
  `source` field rather than presenting the route as ours.
- **No hidden failure record.** Covered above: losses are stored at the same
  width as wins, and there is no win-rate field to round them away.
- **No revival prediction.** There is no probability of recovery in the
  contract, no field that could be read as one, and no verdict that means "this
  will come back".

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/relic-spec.md`](docs/relic-spec.md) | The scoring formula. Every weight, threshold, and clamp |
| [`docs/stall-spec.md`](docs/stall-spec.md) | Stall accounts, bonds, slashing, and how a record is resolved |
| [`docs/tag-spec.md`](docs/tag-spec.md) | Rug, bundle, LP-lock, and creator-holding label rules |
| [`docs/api-contract.md`](docs/api-contract.md) | Wire format shared by the API, SDK, extension, and web |
| [`docs/research.md`](docs/research.md) | Source material behind the axes, with verified and unverified claims marked separately |
| [`docs/architecture.md`](docs/architecture.md) | Layer responsibilities and data flow |
| [`docs/security.md`](docs/security.md) | Threat model, and the specific ways a relic score can be wrong |
| [`DEPENDENCIES.md`](DEPENDENCIES.md) | What is implemented here versus delegated to Jupiter, Helius, and Solana RPC |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Two rules catch most first-time
submissions: commit messages are plain sentences with no `type:` prefix, and any
change to scoring behaviour has to change
[`docs/relic-spec.md`](docs/relic-spec.md) first, because that file is the
specification and the code follows it.

## Security

Report vulnerabilities through
[GitHub Security Advisories](https://github.com/BazrMarket/bazr/security/advisories/new)
rather than a public issue. Full policy in [`SECURITY.md`](SECURITY.md).

A scoring false positive counts as a reportable issue. If a token is scored in a
way the spec does not justify, that is a defect in this project, and a report
with the mint address and the observed values is genuinely useful to us.

## License

MIT. See [`LICENSE`](LICENSE).
