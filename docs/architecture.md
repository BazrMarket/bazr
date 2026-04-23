# Architecture

BAZR is a Solana meme aftermarket. It looks at tokens that already graduated from a
launchpad and then went quiet, and it prices them by survival signals instead of by
momentum. The question it answers is narrow on purpose: is this token dead, dormant,
or is the evidence too thin to say.

This document describes the layers that ship as open source, the boundary between
them and the closed service, and the path a relic score takes from an on-chain
observation to a rendered verdict.

## Honest status first

The table below is the state of each directory in this repository rather than a
description of a finished system. Where a layer is not finished, this document
says so instead of writing it up as if it were.

| Path | Layer | State |
|---|---|---|
| `anchor-program/` | On-chain program `bazr-market`, Anchor 0.31.1 | Account model, error set, event set, constants and all eleven instruction handlers are in the tree, with an integration test suite beside them. |
| `idl/` | Generated Anchor IDL, `bazr_market.json` | Eleven instructions, four accounts, eleven events and twenty-five error codes, for a client that decodes the program without building it. |
| `tag-extension/` | Chrome extension, Manifest V3 | Background service worker, content script, popup, options page and shared modules are in the tree, with 203 unit tests passing under `npm test`. |
| `docs/` | Specifications, including this file | See [relic-spec.md](./relic-spec.md), [api-contract.md](./api-contract.md) and [research.md](./research.md). |

Two clients are deliberately not here. The TypeScript SDK and the `bazr`
command-line client are published as two packages of a separate repository,
[BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk). They are described
below wherever the data flow runs through them, and every mention names the
repository they live in, so no path in this document should be read as a path in
this tree unless it is named as one.

A build artifact is only as trustworthy as the source you can read. If a claim in
this document and the code disagree, the code is right and the document is a defect.

## System view

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#F2EFE3', 'primaryTextColor': '#3A3A38', 'primaryBorderColor': '#1F6FB2', 'lineColor': '#1F6FB2', 'secondaryColor': '#C8A87C', 'tertiaryColor': '#D9B85C', 'fontFamily': 'monospace'}}}%%
flowchart LR
    subgraph chain["Solana cluster"]
        RPC["Solana JSON-RPC<br/>accounts, transactions, logs"]
        PROG["bazr-market program<br/>stalls, listings, bonds, crates"]
    end

    PROV["Data providers<br/>Helius DAS, Jupiter, quote price feed"]

    subgraph service["Service side, not in this repository"]
        ENGINE["Scoring engine<br/>five axes, re-normalisation, verdict"]
        API["Public HTTP API<br/>contract lives in this repository"]
        WEB["Web front end<br/>wallet signing, evidence breakdown"]
    end

    subgraph clients["Clients"]
        EXT["tag-extension<br/>price-tag overlay<br/>this repository"]
        SDK["TypeScript SDK<br/>typed client, schema validation<br/>bazr-sdk repository"]
        CLI["bazr CLI<br/>scripted lookups<br/>bazr-sdk repository"]
    end

    RPC --> ENGINE
    PROV --> ENGINE
    PROG -- "emitted events" --> ENGINE
    ENGINE --> API
    API --> SDK
    API --> EXT
    API --> WEB
    SDK --> CLI
    WEB -- "wallet-signed transactions" --> PROG
```

## What each layer owns, and what it refuses to own

### On-chain program, `anchor-program/`

Owns the ledger that has to survive the service: stall registration, the bond escrow,
the append-only record of what each stall listed and how it turned out, and the crate
weighting records.

Does not own scoring. The program stores the relic score that a stall published at
listing time so the call cannot be edited afterwards; it never computes one, and it
cannot check one. It also holds no user trading funds: the only tokens it custodies
are stall bonds, in a vault owned by the market program derived address.

### Scoring engine

Owns the five axes, the re-normalisation over observable axes, and the verdict gates
described in [relic-spec.md](./relic-spec.md).

Does not own opinion. Every axis is defined over an observable on-chain fact. Price
direction and future return are not axes, and there is no field anywhere in the
contract that carries a prediction.

### Public HTTP API

Owns the wire format in [api-contract.md](./api-contract.md): snake case JSON, a
single error envelope, cursor pagination, rate limits that answer `429` with
`Retry-After` rather than returning a quiet empty body.

Does not own the formula. The contract carries `weight`, `contribution` and `status`
per axis precisely so a caller can recompute the aggregate and check it against the
spec instead of trusting the number.

### TypeScript SDK, published separately

Lives in [BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk) as its own
package. It is not in this tree.

Owns transport and trust boundaries on the client: URL building, per-attempt timeout,
retry with equal jitter, `Retry-After` handling on `429`, exponential backoff on `5xx`,
no retry on other `4xx` responses because retrying a wrong request cannot fix it. Every
response is validated against the contract schemas before it is returned, so a caller
that receives a value can rely on its shape.

Does not own chain access. The SDK opens no RPC connection, holds no key, and has one
runtime dependency, `zod`. It also re-implements the missing-axis rule locally in
`score.ts` so a rendering surface never has to fold an unobserved axis into a zero.

### Command-line client, published separately

Lives in the same [bazr-sdk](https://github.com/BazrMarket/bazr-sdk) repository as its
own package, and provides the `bazr` command. It is a thin wrapper over the SDK for
scripted lookups, so it opens no connection of its own and adds no scoring arithmetic:
anything it prints arrived through the SDK from the HTTP API. Nothing in this
repository provides a `bazr` command, so a reader who wants that source should go to
the other repository.

### Browser extension, `tag-extension/`

Owns a read-only overlay: it recognises Solana mint addresses on pages a user already
visits and hangs a price tag on them carrying the relic verdict and the axis breakdown.

Does not own a wallet connection, transaction signing, or any provider credential. Its
whole message surface is reads, settings and cache control, and the only network
origins compiled into it are the BAZR API origins.

## On-chain accounts

Four account types, all program derived addresses. The seed strings in
`anchor-program/programs/bazr-market/src/constants.rs` are the single source of truth
for derivation, and every client must derive from the same bytes.

| Account | Seeds | Size, bytes | What it records |
|---|---|---|---|
| `Market` | `["market"]` | 224 plus discriminator | `authority`, `bazr_mint`, `bond_vault`, `stall_bond_amount`, `total_stalls`, `total_listings`, `total_crates`, `total_resolved_wins`, `total_resolved_losses`, `total_bond_burned`, `slash_bps`, `fee_bps`, `paused`, `bump`, `vault_bump`, `reserved` |
| `Stall` | `["stall", owner]` | 216 plus discriminator | `owner`, `bond_amount`, `slashed_amount`, `opened_at`, `reputation`, `listings_count`, `active_listings`, `resolved_wins`, `resolved_losses`, `slashed`, `bump`, `uri`, `reserved` |
| `Listing` | `["listing", stall, mint]` | 152 plus discriminator | `stall`, `mint`, `thesis_hash`, `listed_at`, `resolved_at`, `relic_score_at_listing`, `outcome`, `bump`, `reserved` |
| `Crate` | `["crate", creator, crate_id_le]` | 680 plus discriminator | `creator`, `crate_id`, `created_at`, `last_rebalanced_at`, `rebalance_count`, `frozen`, `bump`, `name`, `mints`, `weights`, `reserved` |

Four properties of that layout are deliberate and worth reading as design, not detail.

- **Losses are stored at the same width as wins.** `Stall` carries `resolved_wins` and
  `resolved_losses` as two `u32` fields, and `Market` carries `total_resolved_wins` and
  `total_resolved_losses` as two `u64` fields. A schema that counted only wins could not
  be repaired later by the interface, so the constraint lives in the account itself. The
  same rule reaches the wire: the HTTP contract has no `win_rate` field, because a rate
  alone lets a stall hide losses behind a denominator.
- **Reputation is signed.** `Stall.reputation` is an `i64` moved by `REPUTATION_STEP`,
  which is 100, up on a win and down by exactly the same step on a loss. A stall that is
  wrong more often than right goes below zero.
- **Records are never deleted.** Withdrawing a listing sets the `Withdrawn` outcome
  rather than closing the account, so a stall cannot erase a call it no longer likes.
- **Every account ends in a `reserved` tail.** New fields can be added there without
  migrating existing accounts. A field added outside that tail would read zero on
  pre-existing accounts, so only lifetime accumulators that legitimately start at zero
  may ever be added that way.

Bounds that clients must respect: `MAX_STALL_URI_LEN` 96 bytes, `MAX_CRATE_NAME_LEN`
32 bytes, `MAX_CRATE_MINTS` 16, `MAX_BPS` 10000, `MAX_RELIC_SCORE` 1000.

**Scale warning.** On chain, `Listing.relic_score_at_listing` is a `u16` bounded by
`MAX_RELIC_SCORE`, which is 1000. The HTTP contract and the SDK report scores on a
0 to 100 scale. A client that reads both surfaces must convert between them rather
than assume one scale covers both.

### Instructions and events

`instructions/mod.rs` declares the program surface: `initialize_market`, `open_stall`,
`list_relic`, `resolve_listing`, `withdraw_listing`, `close_stall`, `slash_stall`,
`create_crate`, `rebalance_crate`, `freeze_crate`. Each of those ten has a handler file
beside that module and an entry point in `lib.rs`, and the generated IDL in
`idl/bazr_market.json` carries the same ten. That module is the authoritative list of
what the program declares, and the files beside it are the authoritative list of what
is written.

Indexers consume the events in `events.rs`. `ListingResolved` deliberately carries
`stall_resolved_wins`, `stall_resolved_losses` and `stall_reputation` together, so a
leaderboard can be built from the event stream without a second fetch and there is no
cheap path to a board that shows only the wins.

Events have no `reserved` tail, unlike accounts. Adding a field to an existing event
would break decoding of past logs, so a change of shape must be a new event type, with
the discriminator acting as the version. An indexer that meets an unknown discriminator
from this program should treat it as an error rather than skipping it quietly.

`Anchor.toml` pins `bazr_market` to `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb` for
`localnet` and `devnet`. A declared program ID is not a deployment record: it is the
address the program is built against. Verify any cluster deployment on an explorer
before trusting it, and see [security.md](./security.md) for what an upgrade authority
means for that trust.

