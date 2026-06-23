// Reads and writes settings. chrome.storage.local is the only source of truth.
// The service worker dies after roughly 30 seconds idle, so settings must never sit in a global.

import {
  DEFAULT_SETTINGS, STORAGE_KEYS, SUPPORTED_SITES, BUILTIN_API_ORIGINS,
} from './constants.js';
import { normalizeBaseUrl } from './api.js';

/** Merges what is stored with the defaults, so adding a site does not break existing users. */
export function mergeSettings(stored) {
  const source = stored && typeof stored === 'object' ? stored : {};
  const siteEnabled = {};
  for (const site of SUPPORTED_SITES) {
    siteEnabled[site.id] = source.siteEnabled?.[site.id] !== false;
  }
  return {
    apiBase: typeof source.apiBase === 'string' && source.apiBase.trim()
      ? source.apiBase.trim()
      : DEFAULT_SETTINGS.apiBase,
    autoOverlay: source.autoOverlay !== false,
    siteEnabled,
  };
}

export async function readSettings(storage = chrome.storage.local) {
  const result = await storage.get(STORAGE_KEYS.settings);
  return mergeSettings(result?.[STORAGE_KEYS.settings]);
}

export async function writeSettings(patch, storage = chrome.storage.local) {
  const current = await readSettings(storage);
  const next = mergeSettings({ ...current, ...patch });
  normalizeBaseUrl(next.apiBase); // throws here on a bad value rather than after it is persisted
  await storage.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

/** Whether the origin is already static in the manifest. If not, a runtime permission is needed. */
export function needsOptionalPermission(apiBase) {
  try {
    const origin = new URL(normalizeBaseUrl(apiBase)).origin;
    return !BUILTIN_API_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

/** The origin pattern to hand to chrome.permissions.request. */
export function originPattern(apiBase) {
  const origin = new URL(normalizeBaseUrl(apiBase)).origin;
  return `${origin}/*`;
}
