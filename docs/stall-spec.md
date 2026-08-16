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

## 6. Instructions and who may sign them

**Authority is the substance of this specification.** Who can write what is the whole of
the trust argument.

| Instruction | Signer | What it does | Principal refusals |
|---|---|---|---|
| `initialize_market` | market authority | Creates the config PDA and the bond vault. Once per deployment | zero bond amount, bps above 10000 |
| `open_stall` | stall owner | Escrows `stall_bond_amount` and opens the stall | market paused, balance below the bond, empty URI, URI above 96 bytes, mint or token-account owner mismatch |
| `list_relic` | stall owner | Commits a score and a thesis hash to a new listing | market paused, stall slashed, stall already closed, score above 1000, all-zero thesis hash |
| **`resolve_listing`** | **market authority only** | Records the listing as `Survived` or `Faded` | listing not `Pending`, outcome given as `Pending` or `Withdrawn` |
| `withdraw_listing` | stall owner | Marks the listing `Withdrawn`, account retained | listing not `Pending` |
| `close_stall` | stall owner | Returns the bond and stamps `closed_at` | stall slashed, already closed, bond already released, **`active_listings != 0`** |
| `set_stall_uri` | stall owner | Repoints the evidence URI. Touches no counter | stall slashed, empty URI, URI above 96 bytes |
| `slash_stall` | **market authority only** | Burns `slash_bps` of the bond, returns the rest, marks permanently | already slashed, bond already released, `slash_bps` above 10000 |
| `create_crate` | crate creator | Issues a weighted basket | empty or oversized name, empty basket, more than 16 mints, mint and weight lists of different length, any zero weight, duplicate mint, weights not summing to 10000 |
| `rebalance_crate` | crate creator | Replaces the composition, increments `rebalance_count` | crate frozen, plus every basket rule above |
| `freeze_crate` | crate creator | Makes the composition final. One-way | already frozen |

One property of that table is worth reading twice. Exactly two instructions require an
existing market authority to sign, `resolve_listing` and `slash_stall`, and those two are
precisely the ones a stall would most want for itself. Everything else is signed by the
party whose own record it affects. `initialize_market` is a third authority instruction
only in the sense that whoever signs it becomes the authority; there is no prior authority
for it to check.

### 6.1 Why `resolve_listing` is authority-only

The source comment states the reason without decoration:

```
Resolution is an authority action, not a stall action. A stall owner grading
their own calls would make the win/loss record worthless.
```

`ResolveListing` puts `has_one = authority` on the `market` account and takes `authority`
as a `Signer`, so the check is structural rather than a runtime branch that a different
call path could avoid. A stall owner therefore cannot sign a resolution of their own
listing, with one honest caveat: the program compares keys, not roles, so a deployment
that made a stall owner the market authority would defeat the whole gate. Nothing on chain
prevents that configuration, and nothing on chain can detect it after the fact.

Resolution is also one-way. The handler requires the current outcome to be `Pending`, so a
resolved listing cannot be re-resolved, and `Pending` and `Withdrawn` are both rejected as
target outcomes with `InvalidResolution`. The authority can decide how a call ended; it
cannot decide that a call never ended, and it cannot change its mind afterwards.

**This is a centralisation point and the document does not hide it.** One key decides
outcomes. What is bought with that concession is that a stall cannot manufacture its own
track record, and the resulting ruling is published as a `ListingResolved` event that
carries the wins, the losses and the reputation together, so anyone can reconstruct the
whole record from the log stream. What is not bought is protection against a dishonest or
compromised authority; [`./security.md`](./security.md) treats that as the largest trust
assumption in the system, and section 11 below lists the key custody question as open.

### 6.2 Why `close_stall` does not deallocate the account

```
The stall account is deliberately NOT deallocated. Its PDA is derived from the
owner, so closing with `close = owner` would let a stall with a losing record
reopen at the same address with the counters back at zero.
```

Closing returns the escrowed bond in full, sets `bond_amount` to zero and stamps
`closed_at`. The wins, the losses, the reputation and the slash mark all stay exactly
where they were. Reopening is refused because `open_stall` uses `init` on the same PDA,
which fails while the account exists.

The `active_listings == 0` requirement has the same motive: **a stall cannot leave with
open calls outstanding.** Every listing it made must first be resolved by the authority or
withdrawn by the owner, and both of those leave a permanent record. The refusal surfaces
as `StallHasActiveListings`.

`StallClosed` carries `resolved_wins`, `resolved_losses` and `reputation` in the event
body, so the closing record is in the log stream and not only in an account that a reader
would have to know to go and fetch.

### 6.3 A slash is a real burn

`slash_stall` destroys `slash_bps` of the bond with an SPL burn CPI. Total supply of the
bond mint actually falls, which makes the loss verifiable on chain rather than an internal
bookkeeping entry, and the remainder is returned to the owner in the same transaction. The
market PDA signs both movements as the vault authority.

The proportion is computed in `u128`. `bond * 10000` exceeds the range of a `u64` for a
large bond, so without the widening the slash would abort on the multiply instead of
burning a correct share, and a bond big enough to matter would be the one that could not
be slashed. The division back down and the narrowing to `u64` are both checked, so a value
that somehow survives the widening still raises `MathOverflow` rather than truncating.

`slashed = true` is permanent and `slashed_amount` keeps the burned quantity forever. A
slashed stall cannot list, cannot close, and cannot reclaim a bond, so the mark sits beside
the win and loss record for as long as the account exists, which is indefinitely.

The instruction takes a `reason_code: u8` argument. It is not interpreted on chain and it
is not validated; it is written straight into the `StallSlashed` event so an indexer can
group slashes by cause. The mapping from code to cause is off-chain policy, and this
program neither defines nor enforces it.

### 6.4 Two edge cases in the refusal rules

**A slashed stall can still withdraw its pending listings.** `withdraw_listing` checks only
that the listing is `Pending` and that the signer owns the stall; it does not consult
`slashed` or `closed_at`. The effect is necessary rather than incidental: `close_stall`
refuses a slashed stall outright, so without this path those listings would sit `Pending`
for ever with no way to reach a terminal state. Withdrawing still leaves the record and
its committed thesis hash in place, and it still adds nothing to either counter.

**A closed stall is refused by `list_relic` with `BondAlreadyReleased`.** The constraint
being violated is `closed_at == 0`, so the error name describes the bond rather than the
closure. Clients should map that code to a message about the stall being closed rather
than echoing the raw text, which will read as unrelated to what the caller attempted.

### 6.5 Error surface

Twenty-five errors, in Anchor's custom range beginning at 6000. Codes are assigned by
declaration order in `errors.rs`, so reordering that enum renumbers everything below the
change. Treat the name as canonical and the number as the wire form of that name for this
build; a client that switches on the number should pin the IDL it was built against.

| Code | Name | Message |
|---|---|---|
| 6000 | `MarketPaused` | Market is paused; no new stalls or listings are accepted |
| 6001 | `InvalidBps` | Basis points value must be between 0 and 10000 |
| 6002 | `InvalidBondAmount` | Stall bond amount must be greater than zero |
| 6003 | `InsufficientBond` | Bond token balance is below the stall bond required by the market |
| 6004 | `BondMintMismatch` | Token account mint does not match the market bond mint |
| 6005 | `TokenOwnerMismatch` | Token account owner does not match the stall owner |
| 6006 | `StallSlashed` | Stall has been slashed; it can no longer list, close or reclaim its bond |
| 6007 | `StallHasActiveListings` | Stall still has unresolved listings; resolve or withdraw them first |
| 6008 | `BondAlreadyReleased` | Stall bond has already been released |
| 6009 | `UriTooLong` | Evidence URI exceeds the maximum length of 96 bytes |
| 6010 | `UriEmpty` | Evidence URI must not be empty |
| 6011 | `RelicScoreOutOfRange` | Relic score must be between 0 and 1000 |
| 6012 | `EmptyThesisHash` | Thesis hash must not be all zeroes; a listing requires published reasoning |
| 6013 | `ListingNotPending` | Listing is not pending; it has already been resolved or withdrawn |
| 6014 | `InvalidResolution` | Resolution outcome must be Survived or Faded |
| 6015 | `CrateNameEmpty` | Crate name must not be empty |
| 6016 | `CrateNameTooLong` | Crate name exceeds the maximum length of 32 bytes |
| 6017 | `EmptyBasket` | Crate must hold at least one mint |
| 6018 | `TooManyMints` | Crate holds more than the maximum of 16 mints |
| 6019 | `BasketLengthMismatch` | Mint list and weight list must have the same length |
| 6020 | `ZeroWeight` | Every crate weight must be greater than zero |
| 6021 | `WeightsNotFullyAllocated` | Crate weights must sum to exactly 10000 basis points |
| 6022 | `DuplicateMint` | Crate contains the same mint more than once |
| 6023 | `CrateFrozen` | Crate is frozen; the issuer can no longer rebalance it |
| 6024 | `MathOverflow` | Arithmetic overflow |

---

### 6.6 Why the evidence URI is the one mutable field

`set_stall_uri` looks like a hole in section 0's first invariant, so it is worth stating
exactly what it can and cannot reach. It rewrites `Stall.uri` and nothing else.
`resolved_wins`, `resolved_losses`, `reputation`, `slashed` and `slashed_amount` are not
writable from that instruction, and the account struct it takes carries no path to them.

The reason it exists is the invariant, not an exception to it. Links rot: a domain lapses,
a host moves, a path changes. Without this instruction the only way to correct a dead
evidence link would be to close the stall and open a new one - and section 6.2 forbids
exactly that, because reopening at the same PDA is how a losing record would get reset.
A stall owner staring at a broken link and a permanent record has a motive to want that
reset. Making the pointer mutable is what lets the record stay immutable.

It costs nothing in integrity, because the URI was never the commitment. The per-listing
`thesis_hash` is, and it is fixed before the outcome is known. The page behind any URI can
be rewritten off chain at any moment by whoever hosts it, so freezing the pointer on chain
would buy the appearance of tamper-resistance and none of the substance.

Two refusals bound it. A slashed stall is refused, matching `list_relic` and `close_stall`:
a slash ends the stall's ability to act on its own record at all. A closed stall is
allowed, because its counters are already final and an unreachable evidence link serves
nobody. `StallUriUpdated` carries `old_uri` alongside `new_uri`, for the same reason
`ListingResolved` carries losses next to wins - the unflattering half is not cheaper to
drop than to keep, so an indexer gets the full repoint history without opting in.

---

## 7. Events

These are what an indexer reads. The design point is that `ListingResolved` carries the
wins, the losses **and** the reputation in one payload, so building a board that shows
only the wins costs a downstream consumer extra work rather than saving it any.

```
MarketInitialized  StallOpened  RelicListed  ListingResolved  ListingWithdrawn
StallClosed  StallSlashed  StallUriUpdated  CrateCreated  CrateRebalanced
CrateFrozen
```

`ListingResolved` fields:

```
listing / stall / mint / outcome / resolved_at /
stall_resolved_wins / stall_resolved_losses / stall_reputation
```

`StallClosed` likewise carries `resolved_wins`, `resolved_losses` and `reputation`
alongside `bond_returned` and `closed_at`. `StallSlashed` carries `bond_amount`,
`burned_amount`, `returned_amount`, `slash_bps` and `reason_code`.

Unlike accounts, **events have no `reserved` tail.** Adding a field to an existing event
breaks decoding of every log already emitted, so new data must arrive as a new event type
with the discriminator acting as the version. An indexer that meets an unknown
discriminator from this program should raise an error rather than skip the record quietly,
because a silently skipped resolution is a loss that never reaches the record.

