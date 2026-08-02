<h1 align="center">BAZR</h1>

<p align="center"><strong>One degen's exit is another's entry.</strong></p>

<p align="center">
  <a href="https://github.com/BazrMarket/bazr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/BazrMarket/bazr/ci.yml?branch=main&label=build&style=flat-square" alt="Build"></a>
  <a href="https://bazr.market"><img src="https://img.shields.io/badge/site-bazr.market-1F6FB2?style=flat-square" alt="Site"></a>
  <a href="https://api.bazr.market/health"><img src="https://img.shields.io/badge/api-api.bazr.market-7FA650?style=flat-square" alt="API"></a>
  <a href="https://github.com/BazrMarket/bazr/blob/main/LICENSE"><img src="https://img.shields.io/github/license/BazrMarket/bazr?label=license&style=flat-square&color=C8A87C" alt="License"></a>
  <a href="https://github.com/BazrMarket/bazr/commits/main"><img src="https://img.shields.io/github/last-commit/BazrMarket/bazr?label=last%20commit&style=flat-square&color=6E7076" alt="Last commit"></a>
  <a href="https://www.anchor-lang.com/"><img src="https://img.shields.io/badge/anchor-0.31.1-1F6FB2?style=flat-square" alt="Anchor 0.31.1"></a>
  <a href="https://explorer.solana.com/address/FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb?cluster=devnet"><img src="https://img.shields.io/badge/solana-devnet%20only-D9B85C?style=flat-square&logo=solana&logoColor=white" alt="Solana devnet only"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/rust-2021-E8452F?style=flat-square&logo=rust&logoColor=white" alt="Rust 2021"></a>
</p>

<p align="center">
  <a href="https://developer.chrome.com/docs/extensions/develop"><img src="https://img.shields.io/badge/extension-MV3-3A3A38?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3"></a>
  <a href="https://github.com/BazrMarket/bazr/blob/main/docs/relic-spec.md"><img src="https://img.shields.io/badge/relic%20spec-published-C8A87C?style=flat-square" alt="Relic specification"></a>
  <a href="https://github.com/BazrMarket/bazr-sdk"><img src="https://img.shields.io/badge/sdk%20and%20cli-BazrMarket%2Fbazr--sdk-1F6FB2?style=flat-square&logo=github&logoColor=white" alt="SDK and CLI repository"></a>
  <a href="https://github.com/BazrMarket/bazr#nothing-here-is-on-a-package-registry"><img src="https://img.shields.io/badge/registry-not%20published-6E7076?style=flat-square" alt="Registry status"></a>
  <a href="https://x.com/bazrmarket"><img src="https://img.shields.io/badge/X-%40bazrmarket-000000?style=flat-square&logo=x&logoColor=white" alt="X"></a>
</p>

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

