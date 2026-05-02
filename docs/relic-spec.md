# Relic score specification

**The relic score is a survival-signal summary, not a prediction.** It compresses five
observable on-chain properties of a graduated Solana meme token into one number between
0 and 100 and one of three verdicts. It does not forecast price, it does not estimate the
probability that a token trades again, and it must never be presented as a reason to buy
or sell anything.

Every value in this document is a function of observation. Nothing here is calibrated
against future returns, because no return data is used anywhere in the pipeline.

This file is the reference specification. The wire format is defined in
[`./api-contract.md`](./api-contract.md), the label rules in
[`./tag-spec.md`](./tag-spec.md), and the re-normalisation is implemented in
the TypeScript SDK's `src/score.ts`, which lives in a separate repository,
[BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk). If this document and the
implementation disagree, that is a bug in one of them, and this document is the side
that gets corrected first.

---

## 0. Honesty constraints

These constraints govern the whole specification. They are design requirements, not
disclaimers bolted on afterwards.

1. **The score summarises survival signals.** Vocabulary that implies certainty, price
   multiples, imminent price movement, or a trade recommendation is excluded from every
   field, label, blurb and rendered string. The verdict enum is deliberately closed:
   `dormant | dead | unclear`, and nothing else may be added to it.
2. **All five axes are defined over observable on-chain facts.** Price direction and
   future return are not inputs to any axis.
3. **A score is a point-in-time snapshot.** Every response carries `scored_at` plus the
   `fetched_at` of each source, so a stale read is visible rather than implied.
4. **Every axis is decomposed in the response.** The client can show precisely how much
   each axis contributed, which is why each axis must always emit a `detail` object
   describing what was actually observed.
5. **Missing data is `unknown`, never 0.** "We could not observe this" and "this is bad"
   are different events. Collapsing them makes every token whose data lookup failed
   render as dead. Section 8 defines how missing axes are handled instead.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#F2EFE3', 'primaryTextColor': '#3A3A38', 'primaryBorderColor': '#1F6FB2', 'lineColor': '#1F6FB2', 'secondaryColor': '#C8A87C', 'tertiaryColor': '#D9B85C', 'fontFamily': 'monospace'}}}%%
flowchart LR
  OBS["On-chain observation"] --> AXES["Five axis scores<br/>0-100 or unknown"]
  AXES --> RN["Re-normalise weights<br/>over observable axes"]
  AXES --> COV["Coverage: W_avail"]
  RN --> SCORE["relic score 0-100"]
  SCORE --> VERDICT["Verdict"]
  COV --> VERDICT
  VERDICT --> OUT["dormant / dead / unclear"]
```

---

## 1. Notation and shared helpers

```text
clamp(x, lo, hi) = max(lo, min(hi, x))

lerp(x, x0, x1, y0, y1):              # map x from [x0,x1] onto [y0,y1], clamped at both ends
    if x1 == x0: return y0
    t = clamp((x - x0) / (x1 - x0), 0, 1)
    return y0 + t * (y1 - y0)

loglerp(x, x0, x1, y0, y1) = lerp(log10(max(x,1)), log10(x0), log10(x1), y0, y1)
```

`loglerp` exists because liquidity and holder counts are heavy-tailed. A linear map over
those quantities spends almost its entire output range on the top percentile.

- Token amounts are normalised by decimals (`raw / 10^decimals`) before use.
- USD conversion multiplies by the quote asset price (WSOL to USD, USDC = 1). The SOL/USD
  reference price is an external dependency; when it cannot be observed, the dependent
  axis becomes `unknown`. It is never filled in with an estimate.
- Default trailing window: `W = 30 days`. Recency is evaluated on UTC day boundaries.
- Axis scores are integers in `0..100`, where higher means a stronger survival signal or
  lower residual risk. When an axis cannot be computed it is `unknown`, not 0.

### 1.1 Exclusion set

Several axes need to know which token accounts do not represent a real holder.

```text
EXCLUDE(mint) = AMM_POOL_VAULTS(mint)     # base/quote vault ATAs of every discovered pool
              + KNOWN_CEX(mint)           # maintained label list; may be empty
              + BURN_ADDRS                # e.g. 1nc1nerator11111111111111111111111111111111
              + INSIDER_CLUSTER(mint)     # bundle/sniper clusters from the tag labeler, optional input
```

- `AMM_POOL_VAULTS` covers PumpSwap `pool_base_token_account`, Raydium vaults and any
  other discovered pool. **Excluding these is mandatory.** A pool vault holds a large
  share of the float by construction, so leaving it in makes an ordinary token look
  totally captured by a single wallet. Published work on holder concentration reports
  that failing to exclude protocol-controlled addresses inflates measured concentration
  by a median factor of 2.3x and up to 18x.
- When `KNOWN_CEX` is empty, scoring proceeds and sets `cex_list_missing = true` in the
  axis detail. The effect on this domain is small, but it is surfaced rather than hidden.
- `INSIDER_CLUSTER` is optional. It is populated by the `bundle-launch` and
  `sniper-cluster` labels described in [`./tag-spec.md`](./tag-spec.md), and those labels
  are heuristic, so this input carries their false-positive risk into axis 1.

---

## 2. Axis 1 - `holder_dispersion`

**Observation target:** how widely real holders are spread across the *effective float*,
after pool, exchange, burn and insider wallets are removed.

| Field | Value |
| --- | --- |
| `label` | `Holder spread` |
| `blurb` | `How widely the real holders are spread, after removing pool, exchange, burn and insider wallets.` |

### Inputs

```text
accounts = getTokenAccounts(mint), fully paginated (1000/page, burnt=false, amount>0)
holders  = accounts aggregated by owner, minus EXCLUDE(mint)
float    = sum(holders.amount)                       # effective circulating supply
sort holders desc by amount
top1     = holders[0].amount / float
top10    = sum(holders[0..9].amount) / float
n_eff    = count(holders where amount/float >= 1e-4) # ignore dust
HHI      = 10000 * sum((amount_i/float)^2)           # reported for transparency, not scored
```

### Scoring

```text
base = lerp(top10, 0.20, 0.85, 100, 0)      # top10 at 20% -> 100, at 85% -> 0
if top1 >= 0.35: base = min(base, 25)        # single wallet above 35%
if top1 >= 0.50: base = min(base, 10)        # single wallet holds effective control
if n_eff < 50:   base = min(base, lerp(n_eff, 10, 50, 20, 60))
holder_dispersion = round(clamp(base, 0, 100))
```

The `n_eff` cap exists because a token can be perfectly "dispersed" across eight wallets.
Dispersion of a tiny holder set is not the same signal as dispersion of a large one.

**`unknown` when:** `getTokenAccounts` fails, `float <= 0`, or `n_eff == 0`.

**`detail`:** `{ top1, top10, n_eff, hhi, float, excluded_counts: { pools, cex, burn, insider }, cex_list_missing }`

**Notes and failure modes.** The 30% top-10 and 35% single-wallet lines follow common
concentration-review practice. HHI is reported but not scored: it is largely redundant
with `top10`, and scoring both would double-count the same structure. The largest
practical error source is an incomplete `EXCLUDE` set, which biases this axis *downward*
(more apparent concentration than really exists).

---

## 3. Axis 2 - `lp_residual`

**Observation target:** how much real exit liquidity remains on the quote side, and
whether that liquidity is burned, locked, or still pullable.

| Field | Value |
| --- | --- |
| `label` | `Liquidity left` |
| `blurb` | `Real quote-side liquidity still in the pool(s), and whether that liquidity is burned, locked, or still pullable.` |

### Inputs

```text
pools = discover_pools(mint)                  # PumpSwap PDA, Raydium, and any other AMM found
for p in pools:
    p.quote_usd = balance(p.pool_quote_token_account) * quote_price_usd(p.quote_mint)
    p.lp_state  = classify_lp(p)              # "burned" | "locked" | "unlocked"
quote_usd = sum(p.quote_usd)                  # summed across all pools
graduated = has_migration_record(mint)
```

```text
classify_lp(p):
    burn_pct = ((max(supply, lpReserve-1) - supply) / max(supply, lpReserve-1)) * 100
    if burn_pct >= 99 or migrate_burn_confirmed(p): return "burned"
    if lp_held_by_known_locker(p) and unlock_time > now: return "locked"
    return "unlocked"
```

### Scoring

```text
depth = loglerp(quote_usd, 300, 30000, 0, 100)     # $300 -> 0 (no exit), $30k -> 100

if all pools in {burned, locked}:
    sec = 0                                        # already safe, no adjustment
else:
    pull_share = sum(quote_usd of unlocked pools) / max(quote_usd, 1)
    sec = -lerp(pull_share, 0.20, 1.0, 0, 40)      # up to -40 as pullable share grows

lp_residual = round(clamp(depth + sec, 0, 100))
```

### `unknown` versus a confirmed 0

This distinction is the reason the axis exists in this form. Not finding a pool and
confirming a pool is empty are different observations.

```text
if pools is empty and graduated == true:   lp_residual = 0        # migrated, yet no pool -> confirmed thin/dead
if pools is empty and graduated != true:   lp_residual = unknown  # not found or not indexed -> undecidable
if quote_price_usd cannot be observed:     lp_residual = unknown
```

**`detail`:** `{ quote_usd, pools: [{ amm, quote_usd, lp_state, burn_pct, unlock_time }], graduated }`

**Notes and failure modes.** Post-graduation death shows up as depth collapse rather than
as a price move, which is why depth is measured directly. Only the **quote side** counts:
token-side balance is not exit liquidity, since selling into it is exactly what fails.
The `$300` floor encodes the practical point at which exiting a position is no longer
possible. The three LP states are ordered by strength: burned is permanent, locked is
temporary and expires, unlocked is a live withdrawal vector. Known error sources are
undiscovered pools (biases the axis down, reads as thinner than reality), unknown locker
programs (a locked LP read as `unlocked`, also biasing down), and stale reserve reads.
The bias direction is deliberate: this axis prefers to understate liquidity rather than
overstate it.

---

