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

