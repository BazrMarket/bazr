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

