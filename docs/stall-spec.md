# Stall specification

**The implementation is the evidence.** Every field name, seed, constant and constraint
in this document was read out of
[`../anchor-program/programs/bazr-market/src/`](../anchor-program/programs/bazr-market/src/)
rather than written first. When the two disagree that is a defect, and the resolution is
to fix the program and then bring this document into line with it, never the reverse.

Scope split, so nothing is specified twice:

| Question | Answered in |
|---|---|
| What on-chain records exist, and who is allowed to write them? | this file |
| What JSON shape carries a stall over HTTP? | [`./api-contract.md`](./api-contract.md) |
| How is a relic score derived from observation? | [`./relic-spec.md`](./relic-spec.md) |
| What do the label strings mean? | [`./tag-spec.md`](./tag-spec.md) |

**Deployment status: devnet only.** The program is
`FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb`, declared in `lib.rs` and pinned for
`localnet` and `devnet` in `Anchor.toml`. Mainnet is not deployed. Deploying it requires
explicit approval from the project owner and a launched bond mint, because
`initialize_market` writes that mint into the config and changing it afterwards means
redeploying. A declared program ID is an address a program was built against, not proof
that anything is running at it; see [`./architecture.md`](./architecture.md) and
[`./security.md`](./security.md).

---

## 0. The single thing this specification protects

**A stall's failures are recorded at exactly the same size as its successes.**

`resolved_wins` and `resolved_losses` are both `u32`, and a resolution moves reputation
by the same magnitude in either direction, `REPUTATION_STEP`. The market-wide totals obey
the same rule: `total_resolved_wins` and `total_resolved_losses` are both `u64`.

That is an account layout, not an interface policy. A schema that counted only wins could
not be repaired later by a screen, so the constraint lives in the account itself. The
source comment on `Stall` says the same thing:

```
resolved_wins and resolved_losses are both u32 on purpose. BAZR's honesty gate
requires a stall's failures to be recorded at the same fidelity as its successes
-- a schema that counts only wins cannot be fixed later by the UI, so the
constraint lives here in the account layout.
```

Four invariants follow from that decision, and they are the reason for everything below.

| # | Invariant | Where it is enforced |
|---|---|---|
| 1 | A stall account is **never deallocated** | `close_stall` stamps `closed_at` instead of using `close = owner` |
| 2 | A listing is **never deleted** | `withdraw_listing` only marks the record `Withdrawn` |
| 3 | A stall **cannot grade its own calls** | `resolve_listing` puts `has_one = authority` on `Market` and requires that authority to sign |
| 4 | The reasoning is fixed **before the outcome is known** | `thesis_hash` is committed at listing time |

Invariant 1 carries the most weight of the four. The stall PDA is derived from `owner`,
so deallocating the account would let a stall with a losing record close, reopen at the
same address, and return with its counters back at zero.

---

## 1. Program derived addresses

`constants.rs` is the single source of truth for derivation. The web client, the indexer
and the program must all use the same bytes, and none of these seeds may change after a
first mainnet deployment because every existing address would move.

| Account | Seeds | Constant |
|---|---|---|
| `Market` | `["market"]` | `MARKET_SEED` |
| Bond escrow token account | `["bond_vault"]` | `BOND_VAULT_SEED` |
| `Stall` | `["stall", owner]` | `STALL_SEED` |
| `Listing` | `["listing", stall, mint]` | `LISTING_SEED` |
| `Crate` | `["crate", creator, crate_id_le]` | `CRATE_SEED` |

`crate_id_le` is the `u64` crate id serialised **little-endian**. A client that serialises
it the other way derives a different address, and the failure surfaces as an account that
cannot be found rather than as an error naming the cause.

