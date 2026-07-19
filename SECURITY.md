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

## Deployment status, stated plainly

- **The program is deployed to devnet only.** The address is
  `FSLSR2xYiR5NPWg6g8DZ1KyVRVa7xW37gDStbaDfSXLb`. There is no mainnet
  deployment, so there is no mainnet value at risk today. A report against the
  program is a report against source and against a devnet deployment.
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

