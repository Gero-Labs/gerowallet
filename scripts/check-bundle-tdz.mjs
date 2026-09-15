#!/usr/bin/env node
/**
 * Guard against reading an inlined dynamic-import namespace before it exists.
 *
 * The background is bundled as a single iife (vite.config.background.mts sets
 * `format: 'iife'` with `manualChunks: undefined`), so `await import('x')`
 * cannot yield a separate chunk. Rollup inlines the module and rewrites the
 * call to `Promise.resolve().then(() => x_namespace)`, where `x_namespace` is a
 * `const` declared wherever that module happens to land in the emitted order.
 *
 * When that declaration lands AFTER the code that reads it, any evaluation
 * reaching the reader first dies on a temporal-dead-zone ReferenceError. That
 * is how `Cannot access 'midnightSync_service' before initialization` broke
 * wallet login: declared ~90k lines below the `initializeWallet` that read it.
 *
 * `madge --circular` does NOT catch this. There is no cycle — the hazard is
 * emitted ORDER, and it moves whenever anyone adds an import anywhere in the
 * subtree. So the invariant is checked against the built artifact itself.
 *
 * Baselined, not absolute: the bundle carries a long tail of pre-existing
 * offenders that are latent today because nothing reads them during evaluation.
 * The baseline pins that set so it can only shrink. A NEW one fails the build.
 *
 * ## How an offender is identified
 *
 * Not by its emitted variable name. Rollup deduplicates colliding module names
 * with a `$N` suffix that is assigned in emission order, so `config$1` becomes
 * `config` and `de$4` becomes `de$6` the moment any module moves — and a
 * name-keyed baseline then reports the same two i18n loaders as both "fixed"
 * and "new". An offender is keyed instead by its base name plus the export
 * list of its namespace object (`Object.freeze({ __proto__: null, a, b })`):
 * stable across reorders, and still distinct for the eight unrelated packages
 * that all bundle as `index$N`.
 *
 * ## Which file is analysed
 *
 * Production runs terser, which mangles every namespace const to a short name
 * that changes from build to build — useless as a key. The build plugin
 * (vite.config.background.mts) therefore captures the entry chunk BEFORE
 * minification into node_modules/.cache/gero/background.pre-minify.js, and
 * that capture is what this script prefers. It falls back to the emitted
 * bundle only when no capture exists (a dev bundle is unminified anyway).
 *
 * An earlier revision read only the emitted file and searched for
 * `const name = ` with spaces; terser emits `const name=`, so it found nothing
 * and passed every production build with "0 known offenders" — the guard had
 * only ever run against dev bundles. Both regexes below are whitespace-tolerant
 * regardless.
 *
 *   node scripts/check-bundle-tdz.mjs           # check
 *   node scripts/check-bundle-tdz.mjs --write   # re-pin after a real reduction
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BUNDLE = join(ROOT, 'extension', 'background', 'index.js');
const PREMINIFY_CAPTURE = join(ROOT, 'node_modules', '.cache', 'gero', 'background.pre-minify.js');
const BASELINE = join(HERE, 'bundle-tdz-baseline.json');

/** `Promise.resolve().then(() => someNamespace)` — Rollup's inlined-import shape. */
const REFERENCE = /Promise\.resolve\(\)\.then\(\(\)\s*=>\s*([A-Za-z0-9_$]+)\)/g;

/** How far past a declaration to look for its export list. */
const NAMESPACE_WINDOW = 20_000;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Offset of `const <name> =` in any spacing, or -1. */
function declarationOffset(source, name) {
  const match = new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=`).exec(source);
  return match ? match.index : -1;
}

/**
 * The stable identity of a namespace: `base{export,export,…}`.
 *
 * Reads the `{ __proto__: null, … }` literal Rollup emits for an ES namespace
 * and keeps only its keys — the values are local bindings and get mangled or
 * re-suffixed. A namespace built any other way (a CJS interop wrapper) has no
 * such literal and falls back to the base name alone.
 */
function fingerprint(source, name, declaredAt) {
  const base = name.replace(/\$\d+$/, '');
  const window = source.slice(declaredAt, declaredAt + NAMESPACE_WINDOW);
  const open = window.indexOf('{');
  const literalStart = window.indexOf('__proto__');
  // The export literal is the first `{` and must be the `__proto__` one; a
  // different shape after `=` means this is not an ES namespace object.
  if (open === -1 || literalStart === -1 || literalStart - open > 20) return base;
  const close = window.indexOf('}', literalStart);
  if (close === -1) return base;
  const keys = window
    .slice(literalStart, close)
    .split(',')
    .map(entry => entry.trim().split(/\s*:/)[0].trim())
    .filter(key => key && key !== '__proto__')
    .sort();
  return `${base}{${keys.join(',')}}`;
}

/** Offsets are compared, not line numbers: cheaper and immune to reformatting. */
function analyse(source) {
  const firstReadAt = new Map();
  for (const match of source.matchAll(REFERENCE)) {
    const name = match[1];
    if (!firstReadAt.has(name)) firstReadAt.set(name, match.index);
  }

  const violations = [];
  for (const [name, readAt] of firstReadAt) {
    const declaredAt = declarationOffset(source, name);
    // No declaration found at all means the name is not an inlined namespace
    // (an alias, or already a real import) — nothing to order.
    if (declaredAt === -1) continue;
    if (declaredAt > readAt) {
      violations.push({ name, key: fingerprint(source, name, declaredAt), declaredAt });
    }
  }
  return violations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

const SOURCE_PATH = existsSync(PREMINIFY_CAPTURE) ? PREMINIFY_CAPTURE : BUNDLE;

if (!existsSync(SOURCE_PATH)) {
  console.log('check-bundle-tdz: no background bundle built yet — skipping.');
  process.exit(0);
}

const source = readFileSync(SOURCE_PATH, 'utf8');
const found = analyse(source);
const foundKeys = found.map(entry => entry.key);

if (process.argv.includes('--write')) {
  // Keep any hand-written note: it is the only place the reason for an entry
  // lives, and re-pinning must not silently erase it.
  const note = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8')).note
    : undefined;
  const pinned = note === undefined ? { known: foundKeys } : { note, known: foundKeys };
  writeFileSync(BASELINE, `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`check-bundle-tdz: pinned ${found.length} known offender(s).`);
  process.exit(0);
}

const known = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).known)
  : new Set();

const introduced = found.filter(entry => !known.has(entry.key));
const fixed = [...known].filter(key => !foundKeys.includes(key)).sort();

if (fixed.length > 0) {
  console.log(
    `check-bundle-tdz: ${fixed.length} offender(s) no longer present (${fixed.join(', ')}).`
    + ' Re-pin with --write so they cannot come back.',
  );
}

if (introduced.length === 0) {
  console.log(`check-bundle-tdz: OK — ${found.length} known offender(s), 0 new.`);
  process.exit(0);
}

console.error(
  '\ncheck-bundle-tdz: FAIL — a dynamic-import namespace is now read before it is declared.\n'
  + 'This is the shape that threw "Cannot access \'midnightSync_service\' before initialization"\n'
  + 'and broke wallet login. It usually means an import was added somewhere in that module\'s\n'
  + 'subtree, moving its declaration later in the emitted bundle.\n',
);
for (const entry of introduced) {
  console.error(`  ${entry.name}  (declared around line ${lineOf(source, entry.declaredAt)}, read earlier)`);
  console.error(`    key: ${entry.key}`);
}
console.error(
  '\nFix by making the import static where the module is in the same iife anyway'
  + ' (a dynamic import buys no code splitting there), or by not adding the import edge.\n',
);
process.exit(1);
