# BAZR API contract

This document fixes the **wire format** of the BAZR API: the exact JSON that
crosses the network between the scoring service and its clients. It is the
single reference that the TypeScript SDK, the CLI, the browser extension and
the web front end all implement. If one side changes a field name or a value,
every other side breaks, so the change is made here first.

Scope split, so nothing is specified twice:

| Question | Answered in |
|---|---|
| What does an axis mean and how is its score derived? | [`./relic-spec.md`](./relic-spec.md) |
| What JSON shape carries that score over HTTP? | this file |
| What evidence backs the thresholds? | [`./research.md`](./research.md) |

The TypeScript SDK mirrors this file field for field in its `src/schemas.ts`,
which lives in a separate repository,
[BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk). Every response is
parsed against those schemas before the SDK returns it, so a renamed or dropped
field raises a loud validation error instead of flowing onward as `undefined`.

The scoring service itself is not part of this repository. What is published
here are the on-chain program, the browser extension, and the specifications
every client follows. The TypeScript SDK and the `bazr` command-line client are
published in [bazr-sdk](https://github.com/BazrMarket/bazr-sdk) instead, so an
SDK file named in this document is a file in that repository, never in this one.

## What a relic score is, and is not

A relic score is a **survival-signal summary**: a weighted read of observable
on-chain state for a token that has already graduated off its launchpad. It
describes what can be measured right now about liquidity, holders, creator
control and trading continuity.

It is not a forecast. It does not estimate a future price, and it does not
claim that a token will trade again. Every relic response carries a
`disclaimer` string and clients are expected to render it verbatim:

```
Survival-signal summary, not a prediction of price or revival.
```

Values such as `revival`, or anything phrased as an outcome prediction, must
never be added to the `Verdict` enum. The three verdicts below describe
observed state, not expected state.

## Base URL

```
dev   http://localhost:8030
prod  https://<deployment-host>          (injected as NEXT_PUBLIC_API_BASE)
```

The SDK ships `http://localhost:8030` as `DEFAULT_BASE_URL` and trims trailing
slashes from whatever it is given. A base URL must start with `http://` or
`https://`.

## Conventions

- Every response is `application/json` with `snake_case` keys.
- Integer amounts denominated in base units (lamports and token atoms) cross
  the wire as **strings**. They exceed the safe integer range of a float64, so
  a number would silently lose precision.
- Timestamps are ISO 8601 strings in UTC, for example `2026-03-11T07:00:00Z`.
- Errors use one envelope with an appropriate HTTP status:
  ```jsonc
  { "error": { "code": "...", "message": "...", "detail": { } } }
  ```
- CORS is a four-domain allowlist with `allow_credentials=True`. A wildcard
  origin is not permitted.

## Request path

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#F2EFE3', 'primaryTextColor': '#3A3A38', 'primaryBorderColor': '#1F6FB2', 'lineColor': '#1F6FB2', 'secondaryColor': '#C8A87C', 'tertiaryColor': '#D9B85C', 'fontFamily': 'monospace'}}}%%
flowchart LR
  CLIENT["client<br/>SDK / CLI / extension / web"]
  API["BAZR API<br/>JSON, snake_case"]
  CACHE["response cache<br/>reported as cache.hit and cache.age_s"]
  ENGINE["scoring engine<br/>five axes, re-normalised"]
  CHAIN["Solana RPC"]
  DAS["Helius DAS"]
  JUP["Jupiter quote API"]

  CLIENT -->|"GET /relic/{mint}"| API
  API --> CACHE
  CACHE -->|"hit"| API
  CACHE -->|"miss, or ?refresh=true"| ENGINE
  ENGINE --> CHAIN
  ENGINE --> DAS
  ENGINE --> JUP
  ENGINE -->|"axes, tags, sources[]"| API
  API -->|"validated against the schemas"| CLIENT
```

External data providers are named in the response rather than hidden. Every
relic response carries a `sources[]` array, and every haggle quote carries a
`source` string naming what produced the route.

## Common types

### `Verdict`

```
"dormant" | "dead" | "unclear"
```

Exactly three values. `unclear` is a real answer, used when the observable
axes disagree or too few of them could be read.

### `AxisKey`

```
"holder_dispersion" | "lp_residual" | "dev_wallet_state" | "floor_shape" | "social_afterglow"
```

Five keys, always. A relic response includes all five, including the ones that
could not be observed.

### `Axis`

```jsonc
{
  "key": "holder_dispersion",
  "label": "Holder dispersion",
  "blurb": "How spread out the remaining holders are, excluding CEX and LP wallets.",
  "score": 62,                          // 0-100. null when status is "unknown"
  "weight": 0.20,                       // pre-normalisation weight
  "contribution": 15.5,                 // what this axis actually added to the score
  "status": "ok",                       // "ok" | "unknown"
  "detail": { }                         // per-axis raw observations, rendered as evidence
}
```

`weight` is the pre-normalisation weight defined in
[`./relic-spec.md`](./relic-spec.md), which is the source of truth for these
numbers:

| Axis | Weight |
|---|---|
| `lp_residual` | 0.30 |
| `floor_shape` | 0.25 |
| `holder_dispersion` | 0.20 |
| `dev_wallet_state` | 0.15 |
| `social_afterglow` | 0.10 |
| total | 1.00 |

**An axis with `status: "unknown"` is dropped from the weighting and the
remaining weights are re-normalised. It is never folded in as a zero.** Missing
data and bad data are different events. Collapsing them would render every
token whose lookup failed as if it were dead. The SDK implements this in its
`src/score.ts`, in the [bazr-sdk](https://github.com/BazrMarket/bazr-sdk)
repository, and reports which axes were observed, which came back unknown, and
which were absent from the payload entirely.

### `Tag`

```jsonc
{
  "key": "lp-burned",
  "label": "LP burned",
  "severity": "info",        // "info" | "caution" | "alert"
  "observed": true,          // whether this is an observation rather than an inference
  "confidence": "high",      // "high" | "medium" | "low"
  "evidence": { }            // signatures, account addresses, measured values
}
```

`severity` is the size of the risk; `confidence` is how certain the call is.
They are independent, and clients render them separately so that a low-confidence
finding reads as an observation rather than a verdict. `key` is a free-form
string on the wire: clients must handle keys they do not recognise instead of
rejecting the response.

Rug and bundle findings are surfaced, not suppressed.

## Endpoints

### `GET /health`

```jsonc
{ "status": "ok", "version": "0.1.0", "uptime_s": 1234 }
```

### `GET /health/detailed`

Connection state and last success time for the database, cache and RPC
dependencies. Failures are reported as failures rather than smoothed over.

The top level names the chain twice, never once. `data_cluster` and
`program_cluster` are separate fields carrying the same meaning and the same
omission rule as in `GET /market/stats` below.

```jsonc
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_s": 1234,
  "data_cluster": "mainnet",       // chain the scored tokens are read from
  "program_cluster": "devnet",     // chain the program is deployed on; key absent when nothing is
  "checks": { }                    // per-dependency state and last success time
}
```

### `GET /relic/{mint}`

Query: `?refresh=true` bypasses the cache and is rate limited far more tightly
than a plain read.

```jsonc
{
  "mint": "So1111...",
  "symbol": "EXAMPLE",
  "name": "Example",
  "score": 47,                        // 0-100. null when not one axis could be observed
  "verdict": "unclear",
  "axes": [ /* Axis[] -- all five, unobservable ones included as status "unknown" */ ],
  "tags": [ /* Tag[] */ ],
  "graduated_at": "2025-11-02T10:11:12Z",   // null when it cannot be established
  "scored_at": "2026-03-11T07:00:00Z",
  "cache": { "hit": true, "age_s": 120 },
  "sources": [ { "name": "helius", "endpoint": "getTokenAccounts", "fetched_at": "..." } ],
  "disclaimer": "Survival-signal summary, not a prediction of price or revival."
}
```

`score` is `null`, never `0`, when nothing could be observed.

### `GET /relic/{mint}/tags`

```jsonc
{ "mint": "...", "tags": [ /* Tag[] */ ] }
```

### `GET /stall`

Query: `?sort=record|recent|listings` and `?limit=` and `?cursor=`.

```jsonc
{
  "stalls": [
    {
      "owner": "Curat0r...",
      "pubkey": "StallPDA...",
      "bond_amount": "1000000000",
      "opened_at": "...",
      "listings_count": 24,
      "resolved_wins": 9,
      "resolved_losses": 11,
      "resolved_pending": 4,
      "slashed": false,
      "uri": "https://..."
    }
  ],
  "next_cursor": null
}
```

**There is deliberately no `win_rate` field.** Wins and losses ship as raw
counts of equal standing, and clients display both. A single rate lets a track
record hide its losses behind a denominator.

### `GET /stall/{owner}`

The stall record above, extended with that stall's `listings[]`. Each listing
carries `mint`, `relic_score_at_listing`, `thesis`, `outcome`, `listed_at` and
`resolved_at`. `outcome` is free-form on the wire and is one of `win`, `loss`,
`pending`, or `null` while unresolved.

### `GET /crate` and `GET /crate/{id}`

```jsonc
{
  "id": 3,
  "creator": "...",
  "name": "Q4 2025 survivors",
  "components": [ { "mint": "...", "weight_bps": 2500, "relic_score": 51 } ],
  "created_at": "...",
  "last_rebalanced_at": "...",
  "rebalance_count": 2,
  "frozen": false
}
```

`GET /crate` returns a collection. The SDK accepts both a bare array and a
`{ "crates": [...], "next_cursor": ... }` envelope and normalises them to the
envelope shape.

### `POST /haggle/quote`

```jsonc
// request
{ "input_mint": "So111...", "output_mint": "...", "amount": "1000000", "slippage_bps": 100 }

// response
{
  "in_amount": "1000000",
  "out_amount": "412300000",
  "price_impact_bps": 340,
  "min_out": "408177000",
  "route": [ { "amm": "...", "in_mint": "...", "out_mint": "...", "fee_bps": 25 } ],
  "source": "jupiter",
  "warning": "Thin liquidity: price impact above 3%."   // null when there is nothing to warn about
}
```

BAZR does not operate its own DEX, order book or perpetuals venue. This
endpoint computes over existing liquidity routes. When Jupiter is used
underneath, `source` says `jupiter`. Whatever produced the route is named.

Thin liquidity is the normal case in this segment of the market, so
`price_impact_bps` and `warning` are part of the contract rather than an
optional extra.

### `GET /market/stats`

Real measurements only. A value that does not exist is omitted or sent as
`null`, and clients render nothing for it rather than substituting a
placeholder.

```jsonc
{
  "relics_scored": 0,
  "stalls": 0,
  "aftermarket_volume_usd": null,
  "crates_live": 0,
  "anchor_version": "0.31.1",
  "data_cluster": "mainnet",       // chain the scored tokens are read from
  "program_cluster": "devnet"      // chain the Anchor program is deployed on
}
```

The block above illustrates the shape. The numbers a given deployment returns
are whatever it has actually counted.

There are two chains here, and the response names both. `data_cluster` is the
chain the scoring RPC reads, because that is where graduated tokens live.
`program_cluster` is the chain the Anchor program is deployed on. Those are not
the same fact, and a single `cluster` field reporting only the first is how a
header comes to advertise a devnet program as running on mainnet.

`program_cluster` is **absent from the response rather than `null` when nothing
is deployed**: with no deployment there is no cluster to name. Clients treat it
as an optional field. Do not substitute a default for it, and in particular
never fill it in from `data_cluster` — that substitution produces exactly the
false claim this split exists to prevent. `anchor_version` describes the same
deployment, so a client that has no `program_cluster` has nothing for that
version string to be about either.

