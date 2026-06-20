# bazr_market

The on-chain half of BAZR. Anchor 0.31.1 / Solana.

The program is deployed on **devnet only**. Address
[`FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb`](https://explorer.solana.com/address/FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb?cluster=devnet),
and the generated IDL is committed to this repository at
[`../idl/bazr_market.json`](../idl/bazr_market.json), so a client can be built without
running `anchor build` first.

Three records, one bond escrow:

| Account   | PDA seeds                          | Holds |
|-----------|------------------------------------|-------|
| `Market`  | `["market"]`                       | Global config, counters, slash/fee bps, pause flag |
| `Stall`   | `["stall", owner]`                 | Bond, win/loss record, reputation, slash mark, evidence URI |
| `Listing` | `["listing", stall, mint]`         | Relic score at listing, thesis hash, outcome |
| `Crate`   | `["crate", creator, crate_id_le]`  | Mints + weights (bps, sum 10000), rebalance count, frozen flag |

Bond escrow is a token account PDA at `["bond_vault"]`, owned by the market PDA.
`crate_id` is a `u64` serialised **little-endian** -- the client, the indexer and
the program must agree byte for byte or the PDA will not match.

## Instructions

| Instruction        | Signer            | Notes |
|--------------------|-------------------|-------|
| `initialize_market`| market authority  | Once. Creates the config PDA and the bond vault |
| `open_stall`       | stall owner       | Escrows `stall_bond_amount` of the bond mint |
| `list_relic`       | stall owner       | Commits `relic_score` (0..=1000) and `thesis_hash` |
| `resolve_listing`  | **market authority** | `Survived` or `Faded`. A stall cannot grade its own calls |
| `withdraw_listing` | stall owner       | Marks `Withdrawn`. The record is not deleted |
| `close_stall`      | stall owner       | Returns the bond. Refused if slashed or listings are pending |
| `set_stall_uri`    | stall owner       | Repoints the evidence URI. Reaches no counter. Refused if slashed |
| `slash_stall`      | market authority  | Burns `slash_bps` of the bond, returns the rest, marks permanently |
| `create_crate`     | crate creator     | Weights must sum to 10000 bps, no duplicate mints, max 16 |
| `rebalance_crate`  | crate creator     | Same validation as create. Increments `rebalance_count` |
| `freeze_crate`     | crate creator     | One-way. Composition becomes final |

## What the layout guarantees

These are the honesty constraints from [`../docs/stall-spec.md`](../docs/stall-spec.md)
section 0, enforced in the account schema rather than in the UI, because a schema is the
layer that cannot be quietly changed later. The equivalent constraints on the score
itself are in [`../docs/relic-spec.md`](../docs/relic-spec.md) section 0.

- `resolved_wins` and `resolved_losses` are both `u32`, and a loss subtracts
  exactly the reputation a win adds. `ListingResolved` carries both counts, so
  an indexer gets the losses without a second fetch.
- A `Listing` is never closed. Withdrawing sets `Withdrawn`.
- A `Stall` is never deallocated. `close_stall` stamps `closed_at` and returns
  the bond, but the PDA is derived from the owner -- deallocating it would let a
  losing record be reset by reopening at the same address.
- `slashed` and `slashed_amount` are permanent.
- `uri` is the one field that may change after `open_stall`, and `set_stall_uri`
  reaches no counter. `StallUriUpdated` carries the old value next to the new
  one, so a repoint is visible in the log rather than silent.

## Events

`MarketInitialized` `StallOpened` `RelicListed` `ListingResolved`
`ListingWithdrawn` `StallClosed` `StallSlashed` `StallUriUpdated`
`CrateCreated` `CrateRebalanced` `CrateFrozen`

An event has no `reserved` tail, so adding a field to one breaks decoding of
past logs. To carry new data, emit a **new event type** (the discriminator is
then the version) and have the indexer treat an unknown discriminator from this
program as an error rather than skipping it.

## Build and test

```bash
yarn install                 # test runner and TypeScript client dependencies
anchor build                 # -> target/deploy/bazr_market.so, target/idl/bazr_market.json
anchor test --provider.cluster localnet
```

`anchor build` requires the Anchor toolchain -- `anchor-cli` 0.31.1 and the Solana
platform tools it drives. There is no vendored fallback in this repository; without that
toolchain the build does not run at all. `anchor test` starts a local validator and is
meant for localnet only, so pass `--provider.cluster localnet` explicitly rather than
inheriting whatever cluster the machine's `solana config` currently points at.

## Devnet

The program keypair is not committed, so `anchor build` in a fresh clone mints a new one
and a deploy made from it lands at a **different** address than the one listed below. The
address below is the deployment this repository's authors made.

```bash
anchor build

# Deploy. The keypair is yours to supply; this repository contains none.
solana program deploy target/deploy/bazr_market.so \
  --program-id target/deploy/bazr_market-keypair.json \
  --url https://api.devnet.solana.com \
  --keypair /path/to/your-deployer.json

# One full cycle as real transactions, then read the accounts back.
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=/path/to/your-deployer.json \
npx ts-node scripts/devnet-cycle.ts

# Read-only. Re-fetches the accounts the cycle wrote and sends nothing.
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=/path/to/your-deployer.json \
npx ts-node scripts/verify-devnet.ts
```

| | |
|---|---|
| Program ID | `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb` |
| On-chain IDL | `JAMv36dzMFcKsWEjcid2Q11n9Rdk85AKMwz3H98CpeSt` (ten instructions -- one behind this source) |
| Market PDA (devnet) | `Axy4um2WmvEsWLTNqWJabQu8GTX1AcRPrNLHNekPSFNj` |
| Devnet test bond mint | `F3wuUjqaXVByoaV5vryqgziGxqbrHxYNw3P2wckrsS7Q` (Token-2022) |

Every address in that table is on devnet; append `?cluster=devnet` when opening any of
them in an explorer. The bond mint is a throwaway devnet test token. It has no value, and
nothing about it should be read as a launch.

Mainnet is not deployed and must not be prepared. It needs explicit user
approval **and** a launched token CA, because the market config stores the bond
mint -- initialising it before the CA exists means redeploying to fix it.

