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
| `bazr-market` Anchor program | `anchor-program/` | 0.1.0, deployed on devnet | Yes |
| Generated IDL | `idl/bazr_market.json` | Matches the deployed program | Yes |
| BAZR Tag browser extension (MV3) | `tag-extension/` | 0.1.0 | Yes |
| Specifications | `docs/` | Current `main` | Yes |
| Any earlier commit, or a fork | - | - | No |

---

