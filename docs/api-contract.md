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

