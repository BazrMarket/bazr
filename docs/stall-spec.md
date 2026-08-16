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

## 2. Hard bounds

| Constant | Value | Meaning |
|---|---|---|
| `MAX_BPS` | `10_000` | 100 percent, in basis points |
| `MAX_RELIC_SCORE` | `1_000` | **the on-chain relic scale runs 0 to 1000**, see 2.1 |
| `MAX_STALL_URI_LEN` | `96` | maximum bytes in a stall's evidence URI |
| `MAX_CRATE_NAME_LEN` | `32` | maximum bytes in a crate name |
| `MAX_CRATE_MINTS` | `16` | maximum mints in one crate |
| `REPUTATION_STEP` | `100` | how far a resolution moves reputation. **A loss subtracts exactly what a win adds** |

### 2.1 The on-chain score scale is ten times the API scale

| Layer | Range | Canonical in |
|---|---|---|
| API and UI | `0..=100` | [`./api-contract.md`](./api-contract.md), [`./relic-spec.md`](./relic-spec.md) |
| On-chain `relic_score_at_listing` | **`0..=1000`**, a `u16` | `constants.rs`, `MAX_RELIC_SCORE` |

**Treating the two as one number is wrong by a factor of ten, and it is wrong quietly.**
An out-of-range value is rejected with `RelicScoreOutOfRange`, so a caller might expect a
mis-scaled value to be caught. It is not: an API-scale score of `47` is inside `0..=1000`
and is therefore accepted and written as 47 out of 1000, a tenth of what was meant. There
is no later opportunity to notice, because the listing is immutable once written.

Clients must convert explicitly in both directions: multiply when committing a listing,
divide when rendering one. Nothing on chain performs the conversion, and nothing on chain
can detect that it was skipped.

---

## 3. `Market`, the global configuration

`LEN = 224` bytes plus the 8-byte discriminator. One account per deployment, created once
by the authority through `initialize_market`.

| Field | Type | Meaning |
|---|---|---|
| `authority` | `Pubkey` | **Resolves listings, slashes stalls, pauses the market** |
| `bazr_mint` | `Pubkey` | The SPL or Token-2022 mint used for stall bonds |
| `bond_vault` | `Pubkey` | Bond escrow token account, owned by the market PDA |
| `stall_bond_amount` | `u64` | Bond a stall must escrow to open, in base units of `bazr_mint` |
| `total_stalls` | `u64` | Stalls currently open. Decremented on close and on slash |
| `total_listings` | `u64` | Listings ever created. **Never decremented, the ledger is append-only** |
| `total_crates` | `u64` | Crates ever created |
| `total_resolved_wins` | `u64` | Listings resolved `Survived`, across every stall |
| `total_resolved_losses` | `u64` | Listings resolved `Faded`. **Same width as wins: the market-wide failure count is never cheaper to store** |
| `total_bond_burned` | `u64` | Bond destroyed by slashing, in base units |
| `slash_bps` | `u16` | Share of a bond burned when a stall is slashed |
| `fee_bps` | `u16` | Reserved for the haggle router. **This program charges no fee** |
| `paused` | `bool` | When true, `open_stall` and `list_relic` are refused |
| `bump`, `vault_bump` | `u8` | Bumps for the market PDA and the vault PDA |
| `reserved` | `[u8; 65]` | Growth tail, see the note below |

`initialize_market` refuses a `stall_bond_amount` of zero with `InvalidBondAmount`, and
refuses either bps argument above `MAX_BPS` with `InvalidBps`.

`total_stalls` is a count of open stalls rather than a lifetime total, and two paths
reduce it: `close_stall` decrements with checked arithmetic, and `slash_stall` decrements
with `saturating_sub`. An indexer that wants a lifetime figure must count `StallOpened`
events instead of reading this field.

**Every account ends in a `reserved` tail.** A new field appended inside that tail can be
added without migrating existing accounts, but it reads as zero on accounts written before
it existed. Only a lifetime accumulator that legitimately starts at zero may ever be added
that way. A field added outside the tail changes the layout and invalidates every account
already on chain.

## 4. `Stall`

`LEN = 216` bytes plus the discriminator. PDA `["stall", owner]`.

| Field | Type | Meaning |
|---|---|---|
| `owner` | `Pubkey` | The address the PDA is derived from |
| `bond_amount` | `u64` | Bond currently escrowed. Zero once closed or slashed |
| `slashed_amount` | `u64` | Bond burned by a slash. **Permanent record, never reset** |
| `opened_at` | `i64` | Unix timestamp from the on-chain clock |
| `closed_at` | `i64` | Zero while open. Stamped by `close_stall` |
| `reputation` | `i64` | `+100` per win, `-100` per loss. **Signed on purpose: a stall that is wrong more often than right must be able to go below zero** |
| `listings_count` | `u32` | Listings ever created by this stall |
| `active_listings` | `u32` | Listings still `Pending` |
| `resolved_wins` | `u32` | Listings resolved `Survived` |
| `resolved_losses` | `u32` | Listings resolved `Faded`. **The same `u32`** |
| `slashed` | `bool` | **Permanent mark.** A slashed stall can never list again, close, or reclaim a bond |
| `bump` | `u8` | PDA bump |
| `uri` | `String` | Link to the stall's published reasoning. At most 96 bytes; the text itself lives off chain. **The only field on this account that may change after `open_stall`**, via `set_stall_uri`, and see 6.6 for why |
| `reserved` | `[u8; 26]` | Growth tail |

There is no field anywhere in this account from which a single summary figure could be
derived without also exposing both counts. That is deliberate, and section 9 explains why
the wire format keeps it that way.

## 5. `Listing`

`LEN = 152` bytes plus the discriminator. PDA `["listing", stall, mint]`, so a stall can
hold at most one listing per mint.

| Field | Type | Meaning |
|---|---|---|
| `stall` | `Pubkey` | The stall that made the call |
| `mint` | `Pubkey` | The token the call is about |
| `thesis_hash` | `[u8; 32]` | Hash of the off-chain reasoning, **committed at listing time** so the argument cannot be rewritten once the outcome is known. An all-zero hash is refused |
| `listed_at` | `i64` | Unix timestamp |
| `resolved_at` | `i64` | Zero while `Pending`. Also set by a withdrawal |
| `relic_score_at_listing` | `u16` | **`0..=1000`**, see 2.1. Pinned so the call cannot be reinterpreted later against a fresher score |
| `outcome` | `ListingOutcome` | See below |
| `bump` | `u8` | PDA bump |
| `reserved` | `[u8; 36]` | Growth tail |

### `ListingOutcome`

| Value | Meaning | Effect on the record |
|---|---|---|
| `Pending` | Still on the table. **The only state that can still change** | none |
| `Survived` | Resolved in the stall's favour | `resolved_wins + 1`, reputation `+100` |
| `Faded` | Resolved against the stall. **Recorded exactly like a win and never hidden** | `resolved_losses + 1`, reputation `-100` |
| `Withdrawn` | Pulled by the owner before resolution. **Counts as neither** | neither counter moves |

`Withdrawn` is not an escape hatch, because **the record survives**. The listing account
stays on chain with its `mint`, its committed `thesis_hash`, its `listed_at` and the
`resolved_at` stamp of the moment it was pulled. Anyone reading the stall's listings sees
that a call was made and abandoned, together with when. What withdrawal buys is exclusion
from the win and loss counters, not disappearance.

The one thing it costs the stall is that the thesis hash is already public and already
fixed, so a withdrawal cannot be presented afterwards as a call that was never made.

---

