// manifest.json (MV3) validity, least privilege, and no secrets in the source.
//
// Why this check lives here: the build validates the manifest, but only as far as "does the
// referenced file exist". **Whether the permissions are wider than they need to be** is
// something nobody looks at. One <all_urls> lets the extension read every page, and that is
// a trust cost that is hard to walk back, in review and with users alike.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { BUILTIN_API_ORIGINS, DEFAULT_API_BASE, DEV_API_BASE, SUPPORTED_SITES } from '../src/shared/constants.js';

const PKG_DIR = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));

// --- MV3 required skeleton --------------------------------------------------

test('MV3: manifest_version is 3 and it runs off a service_worker', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(typeof manifest.background.service_worker, 'string');
  assert.ok(manifest.background.service_worker.length > 0);
  assert.equal(manifest.background.page, undefined, 'an MV2 background page is still here');
  assert.equal(manifest.background.persistent, undefined, 'MV3 has no persistent flag');
});

test('MV3: no MV2-only keys are left behind', () => {
  for (const dead of ['browser_action', 'page_action', 'web_accessible_resources_v2']) {
    assert.equal(manifest[dead], undefined, `${dead} is not valid under MV3`);
  }
  assert.ok(manifest.action, 'MV3 uses action');
});

test('MV3: all four icon sizes are there (an SVG cannot be referenced directly)', () => {
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(typeof manifest.icons[size], 'string', `icons.${size} is missing`);
    assert.match(manifest.icons[size], /\.png$/, `icons.${size} is not a PNG`);
    assert.equal(typeof manifest.action.default_icon[size], 'string', `action.default_icon.${size} is missing`);
  }
});

test('MV3: the popup and the options page are declared', () => {
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.equal(manifest.options_ui.page, 'options/options.html');
});

test('MV3: the CSP blocks remote code execution', () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /https?:/, 'a remote script origin got into the CSP');
});

test('version follows the Chrome extension format, and package.json is the source of truth', () => {
  const valid = (v) => typeof v === 'string'
    && v.split('.').length <= 4
    && v.split('.').every((p) => /^(0|[1-9][0-9]*)$/.test(p) && Number(p) <= 65535);
  assert.ok(valid(manifest.version), `manifest.version does not fit the format: ${manifest.version}`);
  assert.ok(valid(pkg.version), `package.json version does not fit the format: ${pkg.version}`);
  assert.equal(manifest.version, pkg.version, 'the build overwrites this with the package.json value, so keep the source in step');
});

// --- Least privilege (this is the real check) -------------------------------

test('host_permissions carries no <all_urls>-style wildcard', () => {
  assert.ok(Array.isArray(manifest.host_permissions));
  const broad = ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*', '*://*'];
  for (const pattern of manifest.host_permissions) {
    assert.equal(broad.includes(pattern), false, `a broad pattern is in host_permissions: ${pattern}`);
  }
});

test('host_permissions is just the two API origins (the target sites are content_scripts business)', () => {
  assert.deepEqual(
    [...manifest.host_permissions].sort(),
    BUILTIN_API_ORIGINS.map((origin) => `${origin}/*`).sort(),
  );
});

test('broad permissions live on the optional side only -- the user has to grant them', () => {
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(manifest.host_permissions.includes('https://*/*'), false);
});

test('permissions is storage and alarms, nothing else', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'storage']);
});

test('no sensitive permission is requested', () => {
  const sensitive = [
    'tabs', 'webRequest', 'webRequestBlocking', 'cookies', 'history', 'bookmarks',
    'downloads', 'management', 'proxy', 'debugger', 'clipboardRead', 'nativeMessaging',
    'declarativeNetRequest', 'scripting', 'geolocation',
  ];
  for (const permission of sensitive) {
    assert.equal(manifest.permissions.includes(permission), false, `a sensitive permission is requested: ${permission}`);
  }
});

// --- content_scripts and SUPPORTED_SITES stay in agreement ------------------

test('there is one content_scripts entry and it attaches only to the target sites', () => {
  assert.equal(manifest.content_scripts.length, 1);
  const entry = manifest.content_scripts[0];
  assert.deepEqual(entry.js, ['content.js']);
  assert.equal(entry.run_at, 'document_idle');
  assert.equal(entry.all_frames, false, 'injecting into every frame means scanning iframe ads as well');

  const broad = ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*'];
  for (const pattern of entry.matches) {
    assert.equal(broad.includes(pattern), false, `a broad pattern is in matches: ${pattern}`);
    assert.match(pattern, /^https:\/\//, `a plaintext http target is present: ${pattern}`);
  }
});

test('SUPPORTED_SITES and the manifest matches do not drift apart', () => {
  const matches = manifest.content_scripts[0].matches;

  // A site in the constants has to be in the manifest too (otherwise the setting turns on and no script attaches)
  for (const site of SUPPORTED_SITES) {
    assert.ok(
      matches.includes(`https://${site.host}/*`),
      `${site.host} is not in matches -- turning it on in settings does nothing`,
    );
    assert.ok(
      matches.includes(`https://*.${site.host}/*`),
      `the subdomain pattern for ${site.host} is not in matches`,
    );
  }

  // The other way round, a host that is only in the manifest is a site the settings cannot turn off
  const known = new Set(SUPPORTED_SITES.map((s) => s.host));
  for (const pattern of matches) {
    const host = pattern.replace(/^https:\/\//, '').replace(/^\*\./, '').replace(/\/\*$/, '');
    assert.ok(known.has(host), `this host is only in matches -- settings cannot turn it off: ${host}`);
  }
});

// --- Honesty and wording ----------------------------------------------------

test('the name and description carry no hype (a Web Store listing is advertising)', () => {
  const text = `${manifest.name} ${manifest.description}`;
  const forbidden = /\b(guaranteed|100x|1000x|moonshot|next pump|buy signal|revival|prediction|profit)\b/i;
  assert.doesNotMatch(text, forbidden, `the listing reads as a forecast or a profit promise: ${text}`);
});

test('the listing text is English (the web UI is 100% English)', () => {
  for (const value of [manifest.name, manifest.description]) {
    assert.doesNotMatch(value, /[^\x00-\x7F]/, `a non-ASCII character is present: ${value}`);
  }
});

// --- No secrets in the source -----------------------------------------------

/** Every text file under src/. The list counted and the list read are the same one (built once, read once). */
function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) sourceFiles(abs, out);
    else out.push(abs);
  }
  return out;
}

test('the extension source carries no API key, token or paid RPC URL', () => {
  const files = [
    ...sourceFiles(path.join(PKG_DIR, 'src')),
    path.join(PKG_DIR, 'manifest.json'),
  ];
  assert.ok(files.length > 0, 'scanned=0 -- no files read means nothing was looked at, not that it is clean');

  const patterns = [
    /api[-_]?key\s*[=:]\s*['"][^'"]+['"]/i,
    /helius/i,
    /quicknode/i,
    /alchemy\.com/i,
    /sk-ant-/,
    /Bearer\s+[A-Za-z0-9._-]{20,}/,
    /(?:^|[^A-Za-z])[A-Za-z0-9_-]{0,8}(?:secret|token)\s*[=:]\s*['"][A-Za-z0-9._-]{16,}['"]/i,
  ];

  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.test(line)) hits.push(`${path.relative(PKG_DIR, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(hits, [], `scanned=${files.length} and secret candidates came out`);
});

// --- Is the default API base a host that actually exists --------------------

test('the default API base is a production API that is actually up', () => {
  assert.equal(DEFAULT_API_BASE, 'https://api.bazr.market');
  assert.equal(DEV_API_BASE, 'http://localhost:8030');
  assert.equal(BUILTIN_API_ORIGINS.includes(DEFAULT_API_BASE), true);
  assert.equal(BUILTIN_API_ORIGINS.includes(DEV_API_BASE), true);
});

/**
 * Returns the code with the comments taken out.
 *
 * [false-positive regression] A rule of the form "FAIL if this host shows up anywhere in the file"
 * flags **the very comment that warns people off the host** as a violation, so the check argues
 * against documenting itself. Comments ship no behaviour, so the rule is narrowed to code -- in
 * exchange all of the code is read, template literals included.
 */
function stripComments(file, text) {
  if (file.endsWith('.json')) return text;                     // JSON has no comments
  if (file.endsWith('.html')) return text.replace(/<!--[\s\S]*?-->/g, '');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const PLACEHOLDER_HOST = /example\.invalid/;

test('[regression] no placeholder host is left in shipping code', () => {
  // `.invalid` is reserved by RFC 2606 and can never be registered, so a host under it is always a
  // stand-in that someone meant to replace. Let one reach a default or host_permissions and every
  // lookup fails silently right after install, with nothing on screen to say why.
  const shipping = [
    ...sourceFiles(path.join(PKG_DIR, 'src')),
    path.join(PKG_DIR, 'manifest.json'),
  ];
  assert.ok(shipping.length > 0, 'scanned=0 -- what was never looked at is not clean');

  const hits = [];
  for (const file of shipping) {
    const code = stripComments(file, readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, index) => {
      if (PLACEHOLDER_HOST.test(line)) hits.push(`${path.relative(PKG_DIR, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `scanned=${shipping.length} and a placeholder host is still in the code`);

  for (const pattern of manifest.host_permissions) {
    assert.doesNotMatch(pattern, PLACEHOLDER_HOST, `it asks for permission on a host that cannot exist: ${pattern}`);
  }
});

test('[control] the placeholder check fires on code and stays quiet on comments', () => {
  const fires = {
    'const.js': "export const DEFAULT_API_BASE = 'https://api.example.invalid';",
    'template.js': 'const url = `https://api.example.invalid/relic/${mint}`;',
    'manifest.json': '  "https://api.example.invalid/*"',
    'options.html': '<input placeholder="https://api.example.invalid">',
  };
  for (const [file, line] of Object.entries(fires)) {
    assert.ok(
      PLACEHOLDER_HOST.test(stripComments(file, line)),
      `a planted violation was missed: ${file} -- ${line}`,
    );
  }

  const misses = {
    'line-comment.js': '// api.example.invalid is a stand-in, never ship it as the default',
    'block-comment.js': '/* a host under example.invalid resolves nowhere by design */',
    'html-comment.html': '<!-- api.example.invalid is not a real endpoint -->',
  };
  for (const [file, line] of Object.entries(misses)) {
    assert.equal(
      PLACEHOLDER_HOST.test(stripComments(file, line)), false,
      `a comment was flagged as a violation (this false positive is why the rule was narrowed): ${file} -- ${line}`,
    );
  }

  // The live default is flagged on neither side
  assert.equal(PLACEHOLDER_HOST.test(DEFAULT_API_BASE), false, 'a perfectly good default is flagged as a violation');
});

test('[control] the secret check above really does fire', () => {
  // Watch only the quiet side and never the firing side, and a checker that passes everything
  // scores full marks. This goes the other way: it confirms a planted violation gets caught.
  const planted = [
    'const key = "sk-ant-abcdefghijklmnop";',
    'const rpc = "https://mainnet.helius-rpc.com/?api-key=deadbeef";',
    'headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz" }',
  ];
  const patterns = [
    /api[-_]?key\s*[=:]\s*['"][^'"]+['"]/i,
    /helius/i,
    /sk-ant-/,
    /Bearer\s+[A-Za-z0-9._-]{20,}/,
  ];
  for (const line of planted) {
    assert.ok(patterns.some((p) => p.test(line)), `a planted violation was missed: ${line}`);
  }
});
