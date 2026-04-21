# Security model and limits

This is a technical document about what BAZR defends against, what it does not, and
where its numbers can be wrong. It is not the place to report a vulnerability: the
disclosure process lives in [SECURITY.md](../SECURITY.md) at the repository root.

Read [architecture.md](./architecture.md) first if you have not. This document assumes
the layer split described there, and in particular that the service backend and the web
front end are outside this repository.

## Threat model

| Defended against | How |
|---|---|
| A curator rewriting a call after the outcome is known | The thesis text is committed as a hash in `Listing.thesis_hash` at listing time. The account is never deleted; withdrawal sets the `Withdrawn` outcome instead of closing it. |
| A record that shows only the wins | `Stall` stores `resolved_wins` and `resolved_losses` at the same width, `Market` mirrors both totals, `ListingResolved` carries both, and the HTTP contract has no `win_rate` field. |
| A failed data lookup rendering as "this token is dead" | An unobservable axis is marked `unknown` and dropped from the weighting rather than folded in as a zero, and thin coverage produces `unclear` instead of a verdict. |
| Bond tokens being moved by anyone other than the program | The bond vault is a token account at `["bond_vault"]` whose authority is the market program derived address, so only the program can sign a transfer out of it. |
| A substituted mint or a decimals mismatch during a bond transfer | Every account carries seed and bump constraints, the mint and token-account owner are checked against `Market` before the transfer, and the transfer itself uses the checked variant with the mint decimals. |
| Silent integer overflow in on-chain accounting | The release profile sets `overflow-checks = true`, and counters use checked arithmetic that raises `MathOverflow` rather than wrapping. |
| A client accepting a half-parsed or malformed API response | The SDK validates every response against the contract schemas and throws a typed error carrying the failing URL, method and issue list. Nothing is swallowed into an empty object. |
| Provider credentials reaching a browser | No client in this repository contacts a data provider. The SDK takes a base URL and a fetch implementation; the extension compiles in only the BAZR API origins. |

| Not defended against | Why you need to know |
|---|---|
| Price risk of any kind | Nothing here forecasts a price, and no combination of these signals makes a token safe to buy. |
| A dishonest or compromised market authority | One key resolves listings, slashes stalls and pauses the market. See the section below. |
| A replaced program binary | An upgradeable program can be swapped by whoever holds the upgrade authority. Reviewing this source does not bind what is deployed. |
| Manipulated on-chain activity | Wash trading, wallet splitting and bot-driven attention all move the inputs. Per-axis failure paths are listed below. |
| A data provider returning wrong data | If an upstream index is stale or incorrect, the score is wrong in the same direction, and nothing in the response can detect that on its own. |
| A service that does not implement the published spec | From this repository you can verify the formula and the contract and compare live outputs against them. You cannot inspect the running implementation. |
| Sites impersonating BAZR, browser malware, or a compromised user machine | Standard client-side risks. An overlay on a page you already trust does not make that page trustworthy. |
| Execution risk on any swap you make | Slippage, sandwiching and failed transactions belong to the venue you trade on, not to a score. |

## On-chain risk

### The authority is the largest trust assumption

`Market.authority` is a single key that can resolve a listing as `Survived` or `Faded`,
slash a stall, and pause the market so that no new stall or listing is accepted. Those
powers are enumerated and every use emits an event, so the authority's actions are
publicly auditable after the fact. Auditable is not the same as prevented. A dishonest
or compromised authority can mis-resolve listings and destroy bonds, and no on-chain
rule in this program stops it.

The honest description of a stall bond is therefore a deposit held under the authority's
judgment, not a trustless escrow. Anyone weighing whether to open a stall should read it
that way.

### Bond and slash mechanics

Opening a stall transfers `Market.stall_bond_amount` of the market's bond mint from the
owner into the bond vault. Slashing burns `Market.slash_bps` basis points of that bond,
returns the remainder, and sets `Stall.slashed` permanently: a slashed stall can never
list again or reclaim a bond. `Stall.slashed_amount` and `Market.total_bond_burned`
record the destruction and are never reset, so the punishment is as visible as the
reputation it removed.

`Market.fee_bps` exists in the account and is reserved for the routing layer. The market
program itself does not charge it. Read that field as a reservation, not as a fee path
hidden in these instructions.

A `Crate` takes no custody at all. It is a weighting record whose `weights` must sum to
exactly 10000 basis points on creation and on every rebalance, so a crate cannot quietly
under-allocate, and no user funds sit behind it.

### Upgrade authority

Anchor programs deploy upgradeable by default. Until the upgrade authority is revoked or
moved to a multi-signature or governance holder, whoever holds it can replace the
deployed bytecode with something that shares none of the properties described here.

Before trusting a deployment, check the on-chain state directly rather than the
repository:

```bash
solana program show FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb
```

That prints the current upgrade authority and the deployed data hash. Compare the hash
against a build you produced yourself, and treat a live upgrade authority as an open
trust assumption for as long as it exists.

### Audit status

The program has not been through an external security audit. Nothing in this repository
should be read as implying one. Account layouts, seeds and instruction surfaces are also
still moving; see the status table in [architecture.md](./architecture.md).

