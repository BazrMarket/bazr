// BAZR Tag -- shared constants.
// This file touches no chrome.* API, so the Node unit tests import it directly.

/** Flea-market palette. The one source of truth for every color the extension draws. */
export const PALETTE = {
  asphalt: '#3A3A38',
  tarpBlue: '#1F6FB2',
  tagRed: '#E8452F',
  cardboard: '#C8A87C',
  grass: '#7FA650',
  labelCream: '#F2EFE3',
  shadeGray: '#6E7076',
  dustYellow: '#D9B85C',
};

/** UI font stacks. Falls back to system faces wherever the brand fonts are missing. */
export const FONT_STACK = {
  display: "'Anton', 'Haettenschweiler', 'Arial Narrow', system-ui, sans-serif",
  body: "'Karla', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'Azeret Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
};

/** docs/api-contract.md `Verdict` -- do not add a fourth value here. */
export const VERDICTS = ['dormant', 'dead', 'unclear'];

/** docs/api-contract.md `AxisKey` -- the contract's keys. Display order is AXIS_DISPLAY_ORDER. */
export const AXIS_ORDER = [
  'holder_dispersion',
  'lp_residual',
  'dev_wallet_state',
  'floor_shape',
  'social_afterglow',
];

/**
 * Pre-normalization weights. docs/relic-spec.md section 7 is the source of truth; they sum to 1.00.
 * The API carries the same numbers in `axis.weight`, and this table is the fallback for when that
 * field is empty -- without it, one unreadable weight draws all five axes at the same size, and
 * the fact that lp_residual is the one that decides disappears from the screen.
 */
export const AXIS_WEIGHTS = {
  lp_residual: 0.30,
  floor_shape: 0.25,
  holder_dispersion: 0.20,
  dev_wallet_state: 0.15,
  social_afterglow: 0.10,
};

/** Display order = descending weight. The heavier an axis, the higher and thicker it is drawn. */
export const AXIS_DISPLAY_ORDER = [...AXIS_ORDER].sort(
  (a, b) => (AXIS_WEIGHTS[b] || 0) - (AXIS_WEIGHTS[a] || 0),
);

/** Weight -> mini bar height in px. Linear: 0.10 -> 8px, 0.30 -> 16px. */
export const AXIS_BAR_HEIGHT = { min: 6, max: 18, base: 4, perWeight: 40 };

/** Only used when the API omits a label. docs/relic-spec.md is the source of truth. */
export const AXIS_FALLBACK_LABEL = {
  holder_dispersion: 'Holder dispersion',
  lp_residual: 'LP residual',
  dev_wallet_state: 'Dev wallet state',
  floor_shape: 'Floor shape',
  social_afterglow: 'Social afterglow',
};

/**
 * The `reason` codes emitted by docs/relic-spec.md sections 8-9.
 * Folding distinct events into the single word "unclear" leaves the reader unable to tell them
 * apart. high_aggregate_no_exit is the sharp case: it is unclear with a high score, so hiding the
 * reason makes it read as "nice number". Each code therefore carries its own text and severity.
 */
export const VERDICT_REASONS = {
  'no liquidity read': {
    severity: 'note',
    text: 'No pool could be read, so the axis that decides this was left out rather than scored zero.',
  },
  'insufficient coverage': {
    severity: 'note',
    text: 'Too few axes could be observed to stand behind either call.',
  },
  'high aggregate but cannot exit': {
    severity: 'alert',
    text: 'The other axes score well, but there is not enough liquidity to sell into. A high total does not make this exitable.',
  },
  'no exit liquidity, no trading floor': {
    severity: 'alert',
    text: 'Neither exit liquidity nor a trading floor is left.',
  },
  'no observable axis': {
    severity: 'note',
    text: 'Not one of the five axes could be observed, so there is no score to report.',
  },
};

export const SEVERITIES = ['info', 'caution', 'alert'];
export const CONFIDENCES = ['high', 'medium', 'low'];

/** Sites the overlay runs on. It reimplements nothing they do -- it only clips a price tag on. */
export const SUPPORTED_SITES = [
  { id: 'dexscreener', host: 'dexscreener.com', label: 'DEX Screener' },
  { id: 'birdeye', host: 'birdeye.so', label: 'Birdeye' },
  { id: 'solscan', host: 'solscan.io', label: 'Solscan' },
  { id: 'x', host: 'x.com', label: 'X' },
  { id: 'twitter', host: 'twitter.com', label: 'Twitter' },
  { id: 'pumpfun', host: 'pump.fun', label: 'Pump.fun' },
  { id: 'jupiter', host: 'jup.ag', label: 'Jupiter' },
  { id: 'gmgn', host: 'gmgn.ai', label: 'GMGN' },
];

/**
 * The production API every lookup goes to unless the user points it somewhere else.
 *
 * [careful] This value and the manifest `host_permissions` move **together.** Change one without
 * the other and the extension cannot reach its own API: a base with no matching host permission is
 * blocked by Chrome, and a host permission with no base grants access to nothing. A default that
 * does not resolve fails silently from the moment the extension is installed, leaving the user
 * with nothing to conclude except that it is broken -- so the condition for changing this is not
 * "the host is configured" but `curl -fsS <base>/health` coming back with an answer.
 * (The options page still lets anyone point the extension at another API base.)
 */
export const DEFAULT_API_BASE = 'https://api.bazr.market';
export const DEV_API_BASE = 'http://localhost:8030';

/**
 * Origins that sit statically in manifest.json host_permissions. Anything else needs a runtime
 * permission request. test/manifest.test.js compares this array against the manifest in both
 * directions -- edit one side only and the settings save fine while no request ever leaves.
 */
export const BUILTIN_API_ORIGINS = [
  'https://api.bazr.market',
  'http://localhost:8030',
];

export const MSG = {
  RELIC: 'BAZR_RELIC',              // look up a single mint (cache first)
  RESOLVE: 'BAZR_RESOLVE',          // a batch of candidates -> only the ones that really are mints
  SETTINGS_GET: 'BAZR_SETTINGS_GET',
  SETTINGS_SET: 'BAZR_SETTINGS_SET',
  CACHE_CLEAR: 'BAZR_CACHE_CLEAR',
  CACHE_STATS: 'BAZR_CACHE_STATS',
  RECENT_GET: 'BAZR_RECENT_GET',
  HEALTH: 'BAZR_HEALTH',
};

export const CACHE_TTL_MS = 10 * 60 * 1000;        // relic responses are kept 10 minutes
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000; // "not a mint" answers are kept 24 hours
export const CACHE_MAX_ENTRIES = 300;
export const MAX_CONCURRENCY = 4;                   // ceiling on API requests in flight

/**
 * Request timeout.
 *
 * A request that hangs holds a slot in the queue for as long as it hangs, so this
 * is never unbounded.
 */
export const REQUEST_TIMEOUT_MS = 12000;
export const RECENT_LIMIT = 5;

export const STORAGE_KEYS = {
  settings: 'settings',
  relicCache: 'relicCache',
  negativeCache: 'negativeCache',
  recent: 'recent',
};

export const DEFAULT_SETTINGS = Object.freeze({
  apiBase: DEFAULT_API_BASE,
  autoOverlay: true,
  siteEnabled: Object.freeze(
    SUPPORTED_SITES.reduce((acc, s) => { acc[s.id] = true; return acc; }, {}),
  ),
});
