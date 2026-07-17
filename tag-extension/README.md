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

