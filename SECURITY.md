# Security Policy

BAZR is an aftermarket for Solana meme tokens that already graduated from a
launchpad. It reads public on-chain data, summarises it as a relic score, and
shows the reasoning behind that summary.

This file is the reporting path for this repository. It also states the limits of
the score itself, because a number that is trusted for more than it can carry is
a safety problem and not only an accuracy problem.

The technical threat model lives in [docs/security.md](docs/security.md).

---

## Supported versions

Everything here is pre-1.0 and is developed on `main`. Security fixes land on
`main`. There are no maintenance branches and no back-ported patches.

| Component | Path | Version | Receives security fixes |
|---|---|---|---|
| `bazr-market` Anchor program | `anchor-program/` | 0.1.0, not deployed on any cluster | Yes |
| Generated IDL | `idl/bazr_market.json` | Matches the source in this tree | Yes |
| BAZR Tag browser extension (MV3) | `tag-extension/` | 0.1.0 | Yes |
| Specifications | `docs/` | Current `main` | Yes |
| Any earlier commit, or a fork | - | - | No |

---

## Deployment status, stated plainly

- **The program is not deployed on any cluster.** The address is
  `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb`. It ran on devnet from
  2026-08-18, and it was deployed to mainnet-beta on 2026-08-20 and closed
  again six minutes later; devnet was closed the same day. The closing
  signatures are listed in the [README](README.md#the-on-chain-program). What
  is left on each chain is a 36-byte stub whose `ProgramData` account is gone,
  so it cannot execute and there is no value at risk from it anywhere today. A
  report against the program is therefore a report against source.
- **The program has not been audited.** No third party has reviewed it. Nothing
  in this repository should be read as implying otherwise.
- **The devnet bond mint is a throwaway test token** with no value. Nothing about
  it is a launch.
- **An upgradeable program can be replaced by whoever holds its upgrade
  authority.** Reading this source tells you what the source does. It does not
  bind what is deployed at that address now or later. That is a property of
  upgradeable programs generally, and it is the single most important thing to
  understand before treating a source review as an assurance.
- **The extension is not on the Chrome Web Store.** It is built from source and
  loaded unpacked, so there is no automatic update channel: a fix reaches you
  when you rebuild.

---

## Reporting a vulnerability

**Use GitHub Security Advisories. Do not open a public issue.**

Report privately here:

https://github.com/BazrMarket/bazr/security/advisories/new

That form is the only reporting channel this project maintains. It stays private
between you and the maintainers until an advisory is published, and it keeps the
report attached to the repository rather than in somebody's inbox. No email
address, chat handle or bounty platform is listed here on purpose: a contact that
nobody watches is worse than no contact at all.

If the advisory form is unavailable to you, open a public issue that says only "I
have a security report and cannot use the advisory form", with no technical
detail, and wait to be contacted.

### What to include

A report is actionable when someone else can reproduce it. Please include:

- The affected component and the commit hash.
- What an attacker gains, in one sentence.
- Exact reproduction steps. For the program: an instruction sequence, the account
  layout, and the cluster. For the extension: the page, the DOM shape, and the
  browser version.
- Any proof-of-concept, as a patch or a script.
- Your assessment of severity, and whether you have disclosed it elsewhere.

Please do not test against other people's wallets or funds. Use devnet, a local
validator, or a wallet you own.

### What to expect

These are targets that the maintainers work to, not promises:

| Stage | Target |
|---|---|
| Acknowledgement that the report arrived | 3 business days |
| Initial assessment and severity triage | 7 calendar days |
| Fix or documented mitigation for high severity | 30 calendar days |
| Public advisory after a fix ships | Coordinated with the reporter |

### Disclosure

This project follows coordinated disclosure. The default embargo is 90 days from
acknowledgement, shortened when a fix ships earlier and extended when a fix needs
downstream coordination. Reporters are credited in the advisory under whatever
name they choose, and may ask to stay anonymous.

If something is already being exploited, say so in the first message. That
changes the schedule.

---

## Scope

### In scope

- **`anchor-program/`** -- missing signer or owner checks, PDA seed collisions,
  account substitution, mint or decimals confusion in a bond transfer, arithmetic
  overflow or truncation in bond, reputation and slash accounting, authority
  escalation, and anything that lets a stall owner withdraw or avoid a bond they
  should not, or reset a losing record.
- **`idl/bazr_market.json`** -- an IDL that does not describe the program it
  claims to describe, in a way that would make a client build the wrong
  instruction or decode an account incorrectly.
- **`tag-extension/`** -- permission scope wider than the extension needs, content
  script paths that can be driven by page-controlled input, any path that sends
  browsing data somewhere other than the configured API base, and address
  detection that can be arranged by an attacker to attach a tag to the wrong
  address.
- **Scoring correctness that changes a verdict** -- coverage accounting,
  re-normalisation of unobserved axes, and verdict thresholds, as specified in
  `docs/relic-spec.md`. See the section below.
- **Supply chain** -- a dependency declared in this repository with a known
  advisory, or a build script that fetches code at install time.
- **Committed secrets** -- see the last section.

### Out of scope

- **The TypeScript SDK and the command-line tool.** They are not in this
  repository. Report those against
  [BazrMarket/bazr-sdk](https://github.com/BazrMarket/bazr-sdk).
- **The hosted web frontend and the backend service.** They are not in this
  repository either. What you can verify from here is that the published formula
  and contract match this code, and that live responses match both. A live
  response that contradicts `docs/api-contract.md` or `docs/relic-spec.md` is
  worth reporting, and it will be triaged as a service issue.
- Third-party services BAZR reads from, including Solana RPC providers, Helius
  and Jupiter. Report those to their own security programs.
- Denial of service against public RPC endpoints, and load testing of any kind
  against infrastructure you do not own.
- Market outcomes. A token going to zero is not a vulnerability.
- The market authority being able to resolve listings and slash stalls. That is
  documented, not hidden -- see the next section.
- Automated scanner output with no reproduction and no analysis.
- Social engineering, phishing of maintainers, and physical access.
- Attacks requiring the victim to have already lost their private key, or to sign
  an arbitrary transaction constructed outside BAZR.
- Missing rate limits on a local development server.

---

## The market authority is the largest trust assumption

`Market.authority` is a single key that can resolve a listing as `Survived` or
`Faded`, slash a stall and burn part of its bond, and pause the market. Every one
of those actions emits an event, so they are auditable after the fact. Auditable
is not prevented. A dishonest or compromised authority can mis-resolve listings
and destroy bonds, and no rule in this program stops it.

The honest description of a stall bond is therefore a deposit held under the
authority's judgment, not a trustless escrow. Anyone weighing whether to open a
stall should read it that way. This is a design limitation that is disclosed
rather than a vulnerability to report, and it is in the out-of-scope list above
for that reason. A way for someone *other* than the authority to reach those
powers is very much in scope.

---

## Limits of the relic score

**A relic score is an observational summary, not a financial judgement.** It
compresses what could be observed about a token after graduation into one number
and five axes. It is not a prediction, not a rating, not a recommendation, and
not a statement that a token is safe.

**Do not use a relic score as a reason to buy or sell anything.** It is a
starting point for reading the on-chain data yourself, and the axis breakdown
exists so you can go and check the underlying facts.

### Every axis can be wrong

Each axis is an inference over public data, and each has a known way to fail.
None of these is hypothetical:

| Axis | How it can be wrong |
|---|---|
| `holder_dispersion` | An exchange hot wallet, a bridge or a custody contract is one address holding many people's balances. Counted as a whale, it reads as concentration that is not there. The reverse also happens: one person split across many wallets reads as healthy dispersion. |
| `lp_residual` | A locker contract, a vesting program or a protocol-owned position may not be recognised as locked liquidity, so real depth reads as absent. An unfamiliar pool type can be missed entirely, and the token then looks thinner than it is. |
| `floor_shape` | Wash trading inflates trade continuity and makes a floor look supported. Thin books make one trade look like a trend. A quiet token and a dead token can produce similar shapes. |
| `social_afterglow` | Bot amplification, purchased engagement and coordinated posting are cheap. A token can look socially alive with no humans in it. A genuinely active community on a platform that is not indexed reads as silence. |
| `dev_wallet_state` | Deployer wallets get rotated, funds get moved through intermediaries, and redistribution is easy to hide. A tracked deployer wallet going quiet does not mean the deployer left. |

Tags carry the same caveat. A tag is an observation with a confidence level, not
a verdict, and a missing tag means nothing was observed rather than that nothing
happened.

### Missing data and bad data are different events

An axis that could not be observed is marked `status: "unknown"`, is **removed
from the weighting**, and the remaining weights are re-normalised over the axes
that were observed. It is never folded in as a zero. The rule is specified in
`docs/relic-spec.md` section 8, and the extension asserts it in its own tests.

Folding an unobserved axis to zero would make a token whose data lookup failed
render identically to a token that was measured and found dead. Those are
different claims, and the number must not collapse them into one.

The consequence is that a score always arrives with a coverage figure. A score
computed over two of five axes is not the same object as one computed over five
of five, even when the two numbers match, and the interface says which one you
are looking at.

### Low coverage produces `unclear`, not a low score

When coverage is too low to support a claim, the verdict is `unclear`. It is not
downgraded to `dead` and it is not padded up to look complete. `unclear` is a
real answer meaning the data was not there, and it sits alongside `dormant` and
`dead` in the verdict set for exactly that reason.

### False positives are a security report

If you find a case where a score, a verdict or a tag is wrong in a way that would
mislead someone, report it through the same advisory link above. It is in scope,
and it is treated as a real defect rather than as feedback.

A false positive report is actionable when it includes:

- The mint address, in full. Do not abbreviate it.
- The score, verdict and axis breakdown that was returned, including the `status`
  of each axis and the coverage figure.
- The observation you believe is correct, and how you established it. A block
  explorer link, a transaction signature or a contract address is enough.
- Roughly when you observed it, since the underlying data moves.

A scoring bug that an attacker can arrange, rather than one that occurs by
chance, is treated as higher severity than the same bug occurring naturally.

---

## What the extension sends, and where

Taken from `tag-extension/manifest.json` and matching
[`tag-extension/README.md`](tag-extension/README.md). Report anything that
contradicts this list:

- Permissions are `storage` and `alarms`. Storage holds settings, the local cache
  and recent lookups in `chrome.storage.local`, and nothing is synced. The single
  alarm sweeps expired cache entries, which an MV3 service worker cannot do with
  `setInterval` because it is shut down between events.
- Host permissions are `http://localhost:8030/*` and `https://api.bazr.market/*`.
  Those are the only two hosts the extension may call without asking, and
  `src/shared/constants.js` pins the same pair, with `test/manifest.test.js`
  comparing the two lists in both directions.
  `optional_host_permissions: https://*/*` is requested only when you point the
  API base somewhere else, and only at the moment you save it.
- Content scripts run at `document_idle` in the top frame only, on the sites
  listed in the manifest and their subdomains.
- What leaves the browser is the mint-shaped strings found on those pages, sent
  to the API base you configured. There is no account, no sign-in and no
  telemetry.
- The extension never connects to a wallet, never talks to an RPC endpoint, and
  signs nothing.
- It ships no API key. Anyone can unzip an extension, so a key inside one is a
  published key, and there is no slot for one in the settings schema.
- Extension pages run under `script-src 'self'; object-src 'self'`, so no remote
  code is loaded.
- Turning off the automatic overlay stops any address being sent from any page;
  the popup still works on an address you paste yourself.

---

## Handling of keys and secrets

This repository contains no private keys, no API keys and no RPC credentials, and
it must stay that way.

- If you find a committed secret here, report it through the advisory link rather
  than opening an issue, so it can be rotated before it is advertised.
- The deploy keypair lives outside the repository and is passed to each command
  explicitly. `.gitignore` blocks `.keys/`, `.deploy/`, `id.json`,
  `*-keypair.json`, `*-deploy*.json`, `*-deployer*.json` and `*-wallet*.json` so
  that a stray copy cannot be staged by accident.
- Provider API keys belong on a server behind a proxy route. They must never
  reach a browser bundle or an extension build.
