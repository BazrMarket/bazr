# BAZR Tag

A Chrome extension (Manifest V3) that hangs a flea-market price tag on Solana mint addresses, on
the pages where you already run into them. The tag summarises the survival signals a token leaves
behind on chain -- who still holds it, what liquidity is left, whether the deployer wallet has
moved. It reports what can be observed at the moment you look; it is not a forecast of what a
token will do next, and it is not advice.

Part of the [BazrMarket/bazr](https://github.com/BazrMarket/bazr) repository.
Project site: <https://bazr.market>

**This extension is not published on the Chrome Web Store.** The only way to run it is to build
it yourself and load it unpacked, as described below.

## What it does

- Walks the text and a handful of attributes (`data-address`, `data-mint`, `title`, `aria-label`
  and similar) of a supported page for base58 strings that could be a mint address.
- Confirms each candidate against the BAZR API before drawing anything. The regular expression
  alone would litter a page with false positives, so a lookalike string is never tagged.
- Looks up only the candidates that scroll into view, caches the answers, and marks the nodes it
  has handled, so scrolling a timeline does not rescan the whole document.
- Opens the full tag on hover or click: the verdict (`dormant`, `dead` or `unclear`), the relic
  score out of 100, the five weighted axes behind it, and labels that state their own confidence.
- Reports an axis it could not observe as `unknown` rather than scoring it 0 -- collapsing "could
  not be seen" into "is bad" would render every token with a failed data lookup as dead.
- Runs the same lookup from the toolbar popup for an address you paste, and keeps the last five.

## Installing (load unpacked)

Node 20 or newer.

```bash
git clone https://github.com/BazrMarket/bazr.git
cd bazr/tag-extension
npm install
npm run build
```

The build writes `build/unpacked/` and `build/bazr-tag-<version>.zip`. Then, in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `build/unpacked` folder.

Chrome keeps warning about developer-mode extensions; updating means rebuilding and reloading.

## Settings

The options page opens in its own tab, from **Settings** in the popup or **Details -> Extension
options** on `chrome://extensions`.

- **API base** -- where every lookup goes. Two presets ship with it: the hosted service at
  `https://api.bazr.market` (the default) and `http://localhost:8030` for a local one. Any other
  host needs your permission, and Chrome asks for it when you save.
- **Automatic overlay** -- switch it off and nothing is drawn on any page and no address is sent
  anywhere. The popup still works on addresses you paste yourself.
- **Allowed sites** -- one switch per supported site. A site switched off here is not read at all.
- **Local cache** -- scored mints are kept for 10 minutes and confirmed non-mints for 24 hours,
  with counters and a clear button. All of it stays in this browser profile.

## Building and testing

| Command | What it does |
|---|---|
| `npm run build` | Production build: minified, no sourcemaps, plus the zip |
| `npm run build:dev` | The same output unminified, with sourcemaps |
| `npm test` | Unit tests over `test/**/*.test.js` with the Node test runner |
| `npm run smoke -- --base <url>` | Calls a live API and checks its responses against the contract |
| `npm run icons` | Redraws `public/icons/*.png` (needs Python 3 with Pillow) |
| `npm run gate` | Scans the tree for hype vocabulary, printing `scanned` / `exempted` / `violations` / `verdict` |

`npm run smoke` defaults to `http://localhost:8030`; `--base` points it elsewhere and `--mint` picks
another address. It exits 2, not 0, when the API is unreachable -- not having looked and having found
nothing wrong must not share an exit code.

The honesty gate reads `src/`, `scripts/`, `test/`, `manifest.json` and this file. The negative
tests under `test/` carry that vocabulary on purpose as fixtures, so they are counted under
`exempted` and listed on stderr rather than silently skipped. An exemption that swallowed the whole
tree would leave nothing scanned, and the gate treats that as a self-failure instead of a pass.

## Permissions and privacy

Taken from `manifest.json`, and nothing beyond it:

- `storage` -- settings, cache and recent lookups in `chrome.storage.local`. Nothing is synced.
- `alarms` -- a single 30-minute alarm that sweeps expired cache entries. An MV3 service worker is
  shut down between events, so `setInterval` cannot survive to do this.
- Host permissions are `https://api.bazr.market/*` and `http://localhost:8030/*` -- the only two
  hosts the extension may call without asking.
- `optional_host_permissions: https://*/*` is requested only if you point the API base somewhere
  else, and only at the moment you save that setting.
- Content scripts run at `document_idle` in the top frame only, on dexscreener.com, birdeye.so,
  solscan.io, x.com, twitter.com, pump.fun, jup.ag and gmgn.ai, plus their subdomains.
- Extension pages run under `script-src 'self'; object-src 'self'`, so no remote code is loaded.
  The minimum supported Chrome version is 110.

What leaves the browser is the mint-shaped strings found on those pages, sent to the API base you
configured. There is no account, no sign-in and no telemetry. The extension never connects to a
wallet, never talks to an RPC endpoint and signs nothing. It also ships no API key -- anyone can
unzip an extension, so a key inside one is a published key.

