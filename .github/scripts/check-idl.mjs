#!/usr/bin/env node
/*
 * check-idl.mjs -- the committed IDL has to describe the committed program.
 *
 * idl/bazr_market.json is checked in so that a client can be built without running
 * `anchor build` first. That convenience is also a hazard: an IDL is a build artifact,
 * and a stale one keeps answering questions about a program that no longer looks like
 * that. This script re-derives the answers from the Rust source and compares.
 *
 * Usage
 *   node .github/scripts/check-idl.mjs           # check the repository this file is in
 *   node .github/scripts/check-idl.mjs <root>    # check a different checkout
 *
 * What it compares
 *   1. Program address. idl.address, declare_id!() in lib.rs, and both
 *      [programs.localnet] and [programs.devnet] in Anchor.toml must be one string.
 *      A program ID that drifts between those four places is how a client ends up
 *      signing for the wrong program.
 *   2. Instruction names, against the `pub fn`s inside the #[program] module.
 *   3. Account names, against the #[account] structs under src/state/.
 *   4. Event names, against the #[event] structs in src/events.rs.
 *   5. Error names, against the variants of the #[error_code] enum in src/errors.rs.
 *   6. idl.metadata.name against the [lib] name in the program's Cargo.toml.
 *
 * Names are compared as sets, not as counts. Two counts can agree while the names
 * behind them do not, and the interesting failure -- a renamed instruction -- is
 * exactly the one a count misses.
 *
 * No dependencies. Node's standard library only, so it runs on a bare checkout.
 *
 * Measurement discipline, the same rules the extension's gate script follows:
 *   - Having read nothing and having found nothing wrong print the same thing. Every
 *     input file is required, and a missing one is SELF-FAIL and exit 2, never a pass.
 *   - An empty set extracted from a file that does exist is SELF-FAIL too: it means the
 *     parser stopped matching the source, which would otherwise read as "no mismatches".
 *   - Mismatch detail is printed before the verdict. In output that gets truncated, the
 *     lines that matter have to come first.
 *
 * stdout is the fixed summary block; explanations for a human go to stderr.
 * Exit code: 0=PASS  1=FAIL  2=SELF-FAIL
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] ?? path.join(HERE, '..', '..'));

const PROGRAM_DIR = path.join(ROOT, 'anchor-program', 'programs', 'bazr-market');
const FILES = {
  idl: path.join(ROOT, 'idl', 'bazr_market.json'),
  lib: path.join(PROGRAM_DIR, 'src', 'lib.rs'),
  events: path.join(PROGRAM_DIR, 'src', 'events.rs'),
  errors: path.join(PROGRAM_DIR, 'src', 'errors.rs'),
  stateDir: path.join(PROGRAM_DIR, 'src', 'state'),
  anchorToml: path.join(ROOT, 'anchor-program', 'Anchor.toml'),
  cargoToml: path.join(PROGRAM_DIR, 'Cargo.toml'),
};

const problems = [];
const selfFailures = [];

function read(label, file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    selfFailures.push(`cannot read ${label} at ${path.relative(ROOT, file)}: ${err.code ?? err.message}`);
    return null;
  }
}

/** Body of the brace-delimited block that starts at or after `from`. */
function blockAfter(source, from) {
  const open = source.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function allMatches(source, re) {
  return [...source.matchAll(re)].map((m) => m[1]);
}

/** Report set difference both ways. Direction is the whole diagnosis. */
function compareSets(what, fromIdl, fromSource) {
  const idl = new Set(fromIdl);
  const src = new Set(fromSource);
  for (const name of [...idl].sort()) {
    if (!src.has(name)) {
      problems.push(`${what}: "${name}" is in the IDL and not in the Rust source -- the IDL is stale, or the item was renamed or removed without regenerating it`);
    }
  }
  for (const name of [...src].sort()) {
    if (!idl.has(name)) {
      problems.push(`${what}: "${name}" is in the Rust source and not in the IDL -- regenerate idl/bazr_market.json with anchor build`);
    }
  }
}

function requireNonEmpty(what, list, file) {
  if (list.length === 0) {
    selfFailures.push(`extracted zero ${what} from ${path.relative(ROOT, file)} -- the parser stopped matching this source, so a clean result here would mean nothing`);
  }
  return list;
}

// ---------------------------------------------------------------- read inputs

const idlRaw = read('the IDL', FILES.idl);
const libRs = read('lib.rs', FILES.lib);
const eventsRs = read('events.rs', FILES.events);
const errorsRs = read('errors.rs', FILES.errors);
const anchorToml = read('Anchor.toml', FILES.anchorToml);
const cargoToml = read("the program's Cargo.toml", FILES.cargoToml);

let stateFiles = [];
try {
  stateFiles = fs
    .readdirSync(FILES.stateDir)
    .filter((f) => f.endsWith('.rs') && f !== 'mod.rs')
    .sort()
    .map((f) => path.join(FILES.stateDir, f));
  if (stateFiles.length === 0) selfFailures.push(`no .rs files under ${path.relative(ROOT, FILES.stateDir)} besides mod.rs`);
} catch (err) {
  selfFailures.push(`cannot list ${path.relative(ROOT, FILES.stateDir)}: ${err.code ?? err.message}`);
}

let idl = null;
if (idlRaw !== null) {
  try {
    idl = JSON.parse(idlRaw);
  } catch (err) {
    selfFailures.push(`idl/bazr_market.json is not valid JSON: ${err.message}`);
  }
}

function bail() {
  for (const line of selfFailures) process.stderr.write(`self-fail: ${line}\n`);
  process.stdout.write('program_id=?\ninstructions=?\naccounts=?\nevents=?\nerrors=?\n');
  process.stdout.write(`mismatches=?\nverdict=SELF-FAIL\n`);
  process.stderr.write('This is not "nothing is wrong". It is "the check could not run". Fix the paths above and run it again.\n');
  process.exit(2);
}

if (selfFailures.length > 0 || idl === null) bail();

// ------------------------------------------------------- extract from source

const declaredId = (libRs.match(/declare_id!\s*\(\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*\)/) ?? [])[1] ?? null;
if (!declaredId) selfFailures.push('no declare_id!("...") found in lib.rs');

function tomlProgramId(section) {
  const at = anchorToml.indexOf(`[programs.${section}]`);
  if (at === -1) return null;
  const rest = anchorToml.slice(at);
  const end = rest.indexOf('\n[', 1);
  const body = end === -1 ? rest : rest.slice(0, end);
  return (body.match(/bazr_market\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"/) ?? [])[1] ?? null;
}

const localnetId = tomlProgramId('localnet');
const devnetId = tomlProgramId('devnet');
if (!localnetId) selfFailures.push('no bazr_market entry under [programs.localnet] in Anchor.toml');
if (!devnetId) selfFailures.push('no bazr_market entry under [programs.devnet] in Anchor.toml');

const programBlock = (() => {
  const at = libRs.indexOf('#[program]');
  if (at === -1) return null;
  return blockAfter(libRs, at);
})();
if (programBlock === null) selfFailures.push('no #[program] module block found in lib.rs');

const libName = (cargoToml.match(/\[lib\][\s\S]*?\bname\s*=\s*"([A-Za-z0-9_]+)"/) ?? [])[1] ?? null;
if (!libName) selfFailures.push('no [lib] name in the program Cargo.toml');

if (selfFailures.length > 0) bail();

const srcInstructions = requireNonEmpty(
  'instructions',
  allMatches(programBlock, /\bpub\s+fn\s+([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/g),
  FILES.lib,
);
const srcEvents = requireNonEmpty(
  'events',
  allMatches(eventsRs, /#\[event\][\s\S]{0,80}?\bpub\s+struct\s+([A-Za-z0-9_]+)/g),
  FILES.events,
);
const errorEnum = blockAfter(errorsRs, Math.max(errorsRs.indexOf('#[error_code]'), 0));
const srcErrors = requireNonEmpty(
  'error variants',
  errorEnum === null ? [] : allMatches(errorEnum, /#\[msg\("(?:[^"\\]|\\.)*"\)\]\s*([A-Za-z0-9_]+)\s*,/g),
  FILES.errors,
);
const srcAccounts = requireNonEmpty(
  'accounts',
  stateFiles.flatMap((f) => allMatches(read('a state module', f) ?? '', /#\[account\][\s\S]{0,80}?\bpub\s+struct\s+([A-Za-z0-9_]+)/g)),
  FILES.stateDir,
);

if (selfFailures.length > 0) bail();

// ------------------------------------------------------------------ compare

const idlAddress = typeof idl.address === 'string' ? idl.address : null;
if (!idlAddress) {
  selfFailures.push('the IDL has no top-level "address" string');
  bail();
}

for (const [where, value] of [
  ['declare_id!() in anchor-program/programs/bazr-market/src/lib.rs', declaredId],
  ['[programs.localnet] in anchor-program/Anchor.toml', localnetId],
  ['[programs.devnet] in anchor-program/Anchor.toml', devnetId],
]) {
  if (value !== idlAddress) {
    problems.push(`program address: idl/bazr_market.json says ${idlAddress}, ${where} says ${value}`);
  }
}

const idlName = idl.metadata?.name ?? null;
if (idlName !== libName) {
  problems.push(`program name: the IDL metadata says "${idlName}", the [lib] name in Cargo.toml says "${libName}"`);
}

compareSets('instruction', (idl.instructions ?? []).map((i) => i.name), srcInstructions);
compareSets('account', (idl.accounts ?? []).map((a) => a.name), srcAccounts);
compareSets('event', (idl.events ?? []).map((e) => e.name), srcEvents);
compareSets('error', (idl.errors ?? []).map((e) => e.name), srcErrors);

// ------------------------------------------------------------------- report

for (const line of problems) process.stdout.write(`mismatch: ${line}\n`);

process.stdout.write(`program_id=${idlAddress}\n`);
process.stdout.write(`instructions=${(idl.instructions ?? []).length}\n`);
process.stdout.write(`accounts=${(idl.accounts ?? []).length}\n`);
process.stdout.write(`events=${(idl.events ?? []).length}\n`);
process.stdout.write(`errors=${(idl.errors ?? []).length}\n`);
process.stdout.write(`mismatches=${problems.length}\n`);
process.stdout.write(`verdict=${problems.length === 0 ? 'PASS' : 'FAIL'}\n`);

if (problems.length > 0) {
  process.stderr.write('The committed IDL and the Rust source disagree. Rebuild with `anchor build` in anchor-program/\n');
  process.stderr.write('and copy target/idl/bazr_market.json to idl/bazr_market.json, or fix the source, whichever is wrong.\n');
  process.exit(1);
}
process.exit(0);
