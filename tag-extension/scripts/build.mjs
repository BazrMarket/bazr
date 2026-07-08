#!/usr/bin/env node
/**
 * build.mjs -- BAZR Tag (Chrome MV3) extension build
 *
 *   node scripts/build.mjs          # production  (minify on, sourcemap off)
 *   node scripts/build.mjs --dev    # development (minify off, sourcemap on)
 *
 * Steps
 *   1. Wipe build/ and create it again
 *   2. Four esbuild bundles (iife / browser / chrome110 / bundle)
 *   3. Copy the static files (popup and options html/css, public/icons/*.png)
 *   4. Check manifest.json against a minimal schema -> write it out with version taken from package.json
 *   5. Compress all of build/unpacked/ with zip.mjs
 *   6. Print the three-line summary
 *   7. Read the zip that was just written back and confirm manifest.json is inside it
 *
 * A missing input is never papered over with a stub: the build dies with exit 1 and a non-empty reason.
 * Every path is resolved as an absolute path from this script file's own location.
 */

import { build as esbuild, formatMessagesSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { writeZip, readZipEntries } from './zip.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(SCRIPT_DIR, '..');
const SRC_DIR = path.join(PKG_DIR, 'src');
const PUBLIC_ICONS = path.join(PKG_DIR, 'public', 'icons');
const BUILD_DIR = path.join(PKG_DIR, 'build');
const OUT_DIR = path.join(BUILD_DIR, 'unpacked');
const MANIFEST_SRC = path.join(PKG_DIR, 'manifest.json');
const PKG_JSON = path.join(PKG_DIR, 'package.json');

const DEV = process.argv.slice(2).includes('--dev');

// entry -> output path inside build/unpacked
const BUNDLES = [
  { entry: 'src/background/index.js', out: 'background.js' },
  { entry: 'src/content/index.js', out: 'content.js' },
  { entry: 'src/popup/popup.js', out: 'popup/popup.js' },
  { entry: 'src/options/options.js', out: 'options/options.js' },
];

// manifest.json is written separately in step 4. It still counts toward `copied`.
const STATIC_COPIES = [
  { from: 'src/popup/popup.html', to: 'popup/popup.html' },
  { from: 'src/popup/popup.css', to: 'popup/popup.css' },
  { from: 'src/options/options.html', to: 'options/options.html' },
  { from: 'src/options/options.css', to: 'options/options.css' },
];

/** The dedicated error fail() throws. The reason is already printed, so nothing above prints it again. */
class BuildError extends Error {}

/** A failure always prints the reason first and the verdict last. When output is truncated, the line that matters has to survive. */
function fail(reason, detail) {
  if (detail) process.stderr.write(`${detail.endsWith('\n') ? detail : `${detail}\n`}`);
  console.log(`reason=${reason}`);
  console.log('verdict=FAIL');
  // No process.exit() here -- when the output goes down a pipe, the async write can be cut off mid-flight.
  // The three summary lines exist to be grepped, so losing them loses the verdict itself.
  throw new BuildError(reason);
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${label}: ${file} (${err.code || err.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} is not valid JSON: ${file} -- ${err.message}`);
  }
  return null;
}

/** Chrome extension version: one to four dot-separated integers, each 0-65535, no leading zeros */
function validExtensionVersion(v) {
  if (typeof v !== 'string') return false;
  const parts = v.split('.');
  if (parts.length < 1 || parts.length > 4) return false;
  return parts.every((p) => /^(0|[1-9][0-9]*)$/.test(p) && Number(p) <= 65535);
}

function isGlob(p) {
  return p.includes('*') || p.includes('?');
}

function isExternalRef(p) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) || p.startsWith('//');
}

/** Gather every extension-internal relative path the manifest references (globs and external URLs excluded) */
function collectManifestRefs(m) {
  const refs = new Set();
  const add = (v) => {
    if (typeof v !== 'string' || v.length === 0) return;
    if (isGlob(v) || isExternalRef(v)) return;
    refs.add(v.replace(/^\/+/, ''));
  };
  const addIconMap = (v) => {
    if (typeof v === 'string') add(v);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) add(v[k]);
  };

  add(m.background?.service_worker);
  add(m.action?.default_popup);
  addIconMap(m.action?.default_icon);
  addIconMap(m.icons);
  add(m.options_page);
  add(m.options_ui?.page);
  add(m.devtools_page);
  add(m.side_panel?.default_path);

  for (const cs of Array.isArray(m.content_scripts) ? m.content_scripts : []) {
    for (const j of Array.isArray(cs.js) ? cs.js : []) add(j);
    for (const c of Array.isArray(cs.css) ? cs.css : []) add(c);
  }
  for (const war of Array.isArray(m.web_accessible_resources) ? m.web_accessible_resources : []) {
    for (const r of Array.isArray(war?.resources) ? war.resources : []) add(r);
  }
  for (const rr of Array.isArray(m.declarative_net_request?.rule_resources)
    ? m.declarative_net_request.rule_resources
    : []) {
    add(rr?.path);
  }
  for (const p of Array.isArray(m.sandbox?.pages) ? m.sandbox.pages : []) add(p);
  for (const k of Object.keys(m.chrome_url_overrides || {})) add(m.chrome_url_overrides[k]);

  return [...refs];
}

/** Minimal schema check plus an existence check on every referenced path. Returns each mismatch as a string. */
function validateManifest(m, outDir) {
  const errs = [];
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    return ['the top level of the manifest is not an object'];
  }
  if (m.manifest_version !== 3) {
    errs.push(`manifest_version is not 3 (actual: ${JSON.stringify(m.manifest_version)})`);
  }
  if (typeof m.background?.service_worker !== 'string' || m.background.service_worker.length === 0) {
    errs.push('background.service_worker is missing or is not a string');
  }
  if (!Array.isArray(m.host_permissions)) {
    errs.push(`host_permissions is not an array (actual: ${JSON.stringify(m.host_permissions)})`);
  }
  if (typeof m.action?.default_popup !== 'string' || m.action.default_popup.length === 0) {
    errs.push('action.default_popup is missing or is not a string');
  }
  for (const size of ['16', '48', '128']) {
    const v = m.icons?.[size];
    if (typeof v !== 'string' || v.length === 0) errs.push(`icons["${size}"] is missing or is not a string`);
  }
  if (!validExtensionVersion(m.version)) {
    errs.push(`version is not in Chrome extension form (actual: ${JSON.stringify(m.version)})`);
  }

  const refs = collectManifestRefs(m);
  for (const r of refs.sort()) {
    if (!fs.existsSync(path.join(outDir, r))) {
      errs.push(`a file the manifest references is not in build/unpacked: ${r}`);
    }
  }
  return errs;
}

/** Every file under dir as a posix relative path. Sorted by name -> the same input produces the same zip. */
async function walkFiles(dir, base = '') {
  const out = [];
  const items = await fsp.readdir(dir, { withFileTypes: true });
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const it of items) {
    const abs = path.join(dir, it.name);
    const rel = base ? `${base}/${it.name}` : it.name;
    if (it.isDirectory()) out.push(...(await walkFiles(abs, rel)));
    else if (it.isFile()) out.push(rel);
  }
  return out;
}

async function main() {
  // ---- 0. package.json alone owns the version ----
  const pkg = readJson(PKG_JSON, 'package.json');
  const version = pkg.version;
  if (!validExtensionVersion(version)) {
    fail(`the version in package.json is not in Chrome extension form (actual: ${JSON.stringify(version)})`);
  }

  // ---- 1. reset build/ ----
  await fsp.rm(BUILD_DIR, { recursive: true, force: true });
  await fsp.mkdir(OUT_DIR, { recursive: true });

  // ---- 2. four esbuild bundles ----
  for (const b of BUNDLES) {
    const absIn = path.join(PKG_DIR, b.entry);
    const absOut = path.join(OUT_DIR, b.out);
    await fsp.mkdir(path.dirname(absOut), { recursive: true });
    try {
      await esbuild({
        entryPoints: [absIn],
        outfile: absOut,
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: ['chrome110'],
        minify: !DEV,
        sourcemap: DEV ? 'linked' : false,
        legalComments: 'none',
        charset: 'utf8',
        logLevel: 'silent',
        absWorkingDir: PKG_DIR,
      });
    } catch (err) {
      // Whatever esbuild threw is surfaced as is rather than swallowed
      const msgs = Array.isArray(err?.errors) ? err.errors : [];
      if (msgs.length > 0) {
        const lines = formatMessagesSync(msgs, { kind: 'error', color: false, terminalWidth: 120 });
        process.stderr.write(lines.join(''));
      } else {
        process.stderr.write(`${err?.stack || String(err)}\n`);
      }
      fail(`esbuild bundle failed: ${b.entry} -> ${b.out}`);
    }
  }

  // ---- 3. copy the static files ----
  let copied = 0;
  for (const c of STATIC_COPIES) {
    const absFrom = path.join(PKG_DIR, c.from);
    const absTo = path.join(OUT_DIR, c.to);
    if (!fs.existsSync(absFrom)) fail(`a static file to copy is missing: ${c.from}`);
    await fsp.mkdir(path.dirname(absTo), { recursive: true });
    await fsp.copyFile(absFrom, absTo);
    copied += 1;
  }

  // icons
  if (!fs.existsSync(PUBLIC_ICONS)) fail(`the icon directory is missing: public/icons (run npm run icons first)`);
  const iconNames = (await fsp.readdir(PUBLIC_ICONS))
    .filter((n) => n.toLowerCase().endsWith('.png'))
    .sort();
  if (iconNames.length === 0) fail('public/icons holds zero .png files (run npm run icons first)');
  await fsp.mkdir(path.join(OUT_DIR, 'icons'), { recursive: true });
  for (const n of iconNames) {
    await fsp.copyFile(path.join(PUBLIC_ICONS, n), path.join(OUT_DIR, 'icons', n));
  }
  const icons = iconNames.length;

  // ---- 4. validate the manifest, then write it (package.json owns the version) ----
  if (!fs.existsSync(MANIFEST_SRC)) fail(`manifest.json is missing: ${MANIFEST_SRC}`);
  const manifest = readJson(MANIFEST_SRC, 'manifest.json');
  manifest.version = version;
  const errs = validateManifest(manifest, OUT_DIR);
  if (errs.length > 0) {
    for (const e of errs) console.log(`manifest_error: ${e}`);
    fail(`manifest.json failed validation -- ${errs.length} problem(s) (see the manifest_error lines above)`);
  }
  await fsp.writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  copied += 1;

  // ---- 5. zip ----
  const files = await walkFiles(OUT_DIR);
  if (files.length === 0) fail('build/unpacked is empty -- there is nothing to compress');

  const stray = files.filter((f) => f === 'node_modules' || f.startsWith('node_modules/') || f.includes('/node_modules/'));
  if (stray.length > 0) fail(`node_modules ended up inside build/unpacked: ${stray.slice(0, 5).join(', ')}`);
  if (!DEV) {
    const maps = files.filter((f) => f.endsWith('.map'));
    if (maps.length > 0) fail(`a sourcemap ended up in the production build: ${maps.join(', ')}`);
  }
  if (!files.includes('manifest.json')) fail('build/unpacked has no manifest.json');

  const zipRel = `build/bazr-tag-${version}.zip`;
  const zipAbs = path.join(PKG_DIR, zipRel);
  const entries = [];
  for (const f of files) entries.push({ name: f, data: await fsp.readFile(path.join(OUT_DIR, f)) });
  const info = await writeZip(entries, zipAbs);

  // ---- 7. self-check: read the zip back and parse its central directory ----
  let parsed;
  try {
    parsed = readZipEntries(await fsp.readFile(zipAbs));
  } catch (err) {
    fail(`the zip that was just written could not be read back: ${err.message}`);
  }
  const names = parsed.map((e) => e.name);
  if (!names.includes('manifest.json')) {
    fail(`the zip holds no manifest.json (${names.length} entries: ${names.slice(0, 10).join(', ')})`);
  }
  if (names.length !== files.length) {
    fail(`the zip entry count (${names.length}) differs from the build/unpacked file count (${files.length})`);
  }

  // ---- 6. summary ----
  console.log(`bundles=${BUNDLES.length} copied=${copied} icons=${icons}`);
  console.log(`zip=${zipRel} bytes=${info.bytes} entries=${names.length}`);
  console.log('verdict=PASS');
}

main().catch((err) => {
  if (!(err instanceof BuildError)) {
    // Died on a path other than fail() -- surface the cause as is and close with the same three-line contract
    process.stderr.write(`${err?.stack || String(err)}\n`);
    console.log(`reason=unexpected error: ${err?.message || String(err)}`);
    console.log('verdict=FAIL');
  }
  process.exitCode = 1;
});
