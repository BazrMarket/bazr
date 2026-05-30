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

## The relic score can be wrong, and here is how

A relic score is a summary of observations at a point in time. It is not a financial
judgment, not a prediction, not a probability, and not a rating. It reports what could
be seen about a token's survival signals when it was scored, and nothing beyond that.

**Do not use a relic score as a reason to buy or sell anything.** A high score does not
mean a token will recover, and a low score does not mean it cannot move. The score
describes what is left of a token, not what will happen to it.

### Per-axis failure paths

| Axis | How it can be wrong | Direction of the error |
|---|---|---|
| `holder_dispersion` | Exchange wallets counted as ordinary holders. Removing them depends on a maintained label list, and there is no confirmed free canonical source for those labels; when the list is missing the response flags it. An unrecognised pool vault reads as one enormous holder. In the other direction, one actor splitting a position across many fresh wallets reads as genuine spread. | Both. A missing exclusion reads too concentrated; wallet splitting reads too dispersed. |
| `lp_residual` | Liquidity held in a locker the classifier does not recognise reads as pullable. A pool that discovery misses is depth that is never counted. Only the actual quote-side vault balance is used, so advertised or virtual reserves cannot inflate it, but a stale balance read still can. | Mostly downward, except when a stale read overstates depth. |
| `dev_wallet_state` | The creator is identified heuristically from the creation signature, the first funder and launchpad records. A creator who moved holdings to fresh wallets defeats that, and the axis then reads clean. Misattribution in the other direction penalises an unrelated wallet. | Both. Redistribution reads too clean; misattribution reads too harsh. |
| `floor_shape` | Wash trading manufactures a trading floor. A day counts as active only when it carries both a minimum number of fills and at least three distinct signing wallets, which raises the cost of faking it. Three wallets are cheap on Solana, so this raises the price of the attack rather than closing it. | Upward when trading is simulated. |
| `social_afterglow` | Attention is the easiest signal to buy. The axis is approximated from on-chain traces, new first-time holders, distinct active wallets and holder-count trend, so bot wallets inflate it directly. Any external social source is mixed in as a capped secondary input and named in the response. It carries the lowest weight, 0.10, for exactly this reason. | Upward under bot activity. |

Two structural limits sit above that table. Every axis is a snapshot: the response
carries `scored_at`, and a cached answer reports `cache.hit` with its `age_s`, because a
score computed an hour ago describes an hour-old chain. And every axis measures the past.
No arrangement of past observations tells you what a token does next.

### Missing data is not bad data

An axis that could not be observed is reported with `status: "unknown"` and a null
score, and it is removed from the weighting so the remaining weights re-normalise over
what was actually seen. It is never counted as a zero.

This is not a stylistic choice. Folding an unobservable axis into a zero would render
every token whose data lookup failed as dead, which is a claim about the token rather
than about the lookup. Those two events must not collapse into the same number, because
the second one is a failure of BAZR and the first would be presented as a fact about
someone's holdings.

The same rule governs the top-level field. When not a single axis could be observed, the
score is `null`, not zero.

### Low coverage produces no verdict

Coverage is checked before any band is applied. If exit liquidity cannot be read at all,
or if the axes that were observable carry less than half the total weight, the verdict is
`unclear` with a stated reason, and no dead-or-dormant judgment is issued. The ambiguous
middle of the score range is also `unclear`, because forcing a choice there would
manufacture confidence that the observations do not support.

An aggregate that looks healthy cannot override a decisive axis either. A token scoring
well overall while its exit liquidity reads thin comes back `unclear` rather than
`dormant`, because a token nobody can exit is not meaningfully asleep.

The exact thresholds and formulas are in [relic-spec.md](./relic-spec.md), and every
response carries a `disclaimer` field that rendering surfaces are expected to show as
written.

## Credential handling

- **Clients get public RPC only.** Paid provider endpoints and their keys stay on the
  server, behind a proxy route that never forwards the key.
- **No key is ever inlined into a client bundle.** Any build-time variable that a
  framework exposes to the browser is written into the build output in plain text, so a
  secret placed in one is public the moment it ships. Provider keys, RPC URLs carrying a
  key, and bot tokens must never be set through such a variable. A build-output scan
  before shipping is worth more than the intention not to do it.
- **The SDK holds no credential at all.** `createBazrClient` takes a base URL, an
  optional fetch implementation, timeout and retry settings, and headers. There is no key
  parameter, because the public API needs none. A caller who adds an authorization header
  through `headers` owns the job of keeping that bundle off a browser.
- **Deploy keys live outside the tree.** The provider wallet in `Anchor.toml` points at a
  path outside the repository, and build outputs are excluded by `.gitignore`. A keypair
  file must never be committed, quoted in an issue, or pasted into a document.
- **A leaked key is rotated, not deleted.** Removing a commit does not remove it from
  clones or from anything that already fetched it. Rotate first, then clean up.

## Browser extension permissions

The overlay is built to the narrowest permission set that lets it do its one job. These
are the rules it follows:

- Static host permissions cover only the BAZR API origins that the shared constants pin.
  Any other origin, including a self-hosted API, requires a runtime permission the user
  grants explicitly.
- Content scripts run on a fixed list of supported sites rather than on all URLs.
- No wallet connection, no transaction signing, no private key ever touches the
  extension. Its entire message surface is reads, settings and cache control.
- Responses are cached for ten minutes, and addresses that turn out not to be mints are
  cached as negatives for a day, so repeated browsing does not translate into repeated
  requests.

The authoritative check is the `manifest.json` inside the packaged build. If a permission
appears there that is not on this list, treat it as a defect and report it through
[SECURITY.md](../SECURITY.md).

One privacy consequence is unavoidable and should be stated rather than buried. To hang a
tag on an address, the extension asks the BAZR API about that address. The API therefore
learns which mint addresses appear on pages the user visits. It does not receive the page
URL, the page content, or an account identity, and the cache reduces how often it is
asked at all. A user who does not want that exchange should not install the overlay; the
web interface answers the same question without a browser extension.

