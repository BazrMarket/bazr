// Finds mint candidates in the DOM. The walk is written by hand rather than using
// document.createTreeWalker -- that is what lets the unit tests pass in plain fake DOM objects
// with no jsdom dependency.

import { extractMintCandidates, extractMintCandidatesFromUrl } from '../shared/base58.js';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Places that must not get a price tag even when an address is sitting inside them. */
export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'HEAD', 'TITLE', 'META', 'LINK',
]);

/** For sites that show a truncated address but keep the full one in an attribute (dexscreener). */
export const ADDRESS_ATTRIBUTES = [
  'data-address', 'data-mint', 'data-token-address', 'data-token', 'title', 'aria-label',
];

export const TAGGED_ATTR = 'data-bazr-tagged';
const OWN_MARKERS = ['data-bazr-marker', 'data-bazr-panel', 'data-bazr-notice'];

/** Nodes we created are never walked again -- otherwise the MutationObserver loops forever. */
export function isOwnNode(element) {
  if (!element || typeof element.hasAttribute !== 'function') return false;
  return OWN_MARKERS.some((attr) => element.hasAttribute(attr));
}

export function shouldSkipElement(element) {
  if (!element) return true;
  if (isOwnNode(element)) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return SKIP_TAGS.has(tag);
}

export function isAlreadyTagged(element, address) {
  if (!element || typeof element.getAttribute !== 'function') return false;
  const value = element.getAttribute(TAGGED_ATTR);
  if (!value) return false;
  return value.split(',').includes(address);
}

export function markTagged(element, address) {
  if (!element || typeof element.setAttribute !== 'function') return;
  const value = element.getAttribute?.(TAGGED_ATTR);
  const list = value ? value.split(',') : [];
  if (!list.includes(address)) list.push(address);
  element.setAttribute(TAGGED_ATTR, list.join(','));
}

/**
 * Collects the mint candidates under root.
 * @param {object} root a Document or an Element (anything DOM-shaped with childNodes will do)
 * @param {{ maxNodes?: number }} [options] walk ceiling -- one Twitter timeline can hold
 *   tens of thousands of nodes
 * @returns {Array<{ address: string, kind: 'text'|'attr', node: object, host: object }>}
 *   kind='text': node is the text node, host is the parent element the marker goes into
 *   kind='attr': node and host are the same element
 */
export function collectTargets(root, options = {}) {
  const { maxNodes = 6000 } = options;
  const found = [];
  const seen = new Set();
  let visited = 0;

  const stack = [];
  const start = root?.body && root.nodeType !== ELEMENT_NODE ? root.body : root;
  if (start) stack.push(start);

  while (stack.length > 0) {
    if (visited >= maxNodes) break;
    const node = stack.pop();
    if (!node) continue;
    visited += 1;

    if (node.nodeType === TEXT_NODE) {
      const parent = node.parentElement || node.parentNode;
      if (!parent || shouldSkipElement(parent)) continue;
      for (const address of extractMintCandidates(node.textContent || '')) {
        const dedupeKey = `${address}|text|${found.length}`;
        if (isAlreadyTagged(parent, address)) continue;
        if (seen.has(`${address}|${nodeIdentity(parent)}`)) continue;
        seen.add(`${address}|${nodeIdentity(parent)}`);
        found.push({ address, kind: 'text', node, host: parent, dedupeKey });
      }
      continue;
    }

    if (node.nodeType !== ELEMENT_NODE && node.nodeType !== undefined && !node.childNodes) continue;

    if (node.nodeType === ELEMENT_NODE) {
      if (shouldSkipElement(node)) continue;
      for (const attribute of ADDRESS_ATTRIBUTES) {
        const value = node.getAttribute?.(attribute);
        if (!value) continue;
        for (const address of extractMintCandidates(value)) {
          if (isAlreadyTagged(node, address)) continue;
          if (seen.has(`${address}|${nodeIdentity(node)}`)) continue;
          seen.add(`${address}|${nodeIdentity(node)}`);
          found.push({ address, kind: 'attr', node, host: node });
        }
      }
    }

    const children = node.childNodes;
    if (children && children.length) {
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  }

  return found;
}

let identityCounter = 0;
const identityMap = new WeakMap();

/** Keys an element so one scan cannot collect it twice, without writing onto the DOM object. */
function nodeIdentity(node) {
  if (!node || typeof node !== 'object') return String(node);
  let id = identityMap.get(node);
  if (id === undefined) {
    identityCounter += 1;
    id = identityCounter;
    identityMap.set(node, id);
  }
  return id;
}

/** Pulls the address out of a detail page URL (solscan.io/token/<mint> and the like). */
export function detectPageMint(href) {
  const candidates = extractMintCandidatesFromUrl(href);
  return candidates.length > 0 ? candidates[0] : null;
}
