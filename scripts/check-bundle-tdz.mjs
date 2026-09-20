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
 * How an offender is identified, and why the declaration is located by Rollup's
 * `/*#__PURE__*\/` annotation rather than by a bare `const <name> =`, is
 * documented in bundle-tdz-analysis.mjs, which also carries the unit tests'
 * entry points (scripts/check-bundle-tdz.spec.mjs).
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
 * only ever run against dev bundles. The regexes are whitespace-tolerant
 * regardless.
 *
 * ## A stale node_modules invalidates the result
 *
 * The keys are computed from the bundled dependency code, so an install that
 * has drifted from package-lock.json produces different modules, a different
 * emitted order, and different `$N` suffixes. That reports as offenders fixed
 * and introduced that no commit caused. Reproduce a failure with `npm ci`
 * before believing it, and compare against what CI built.
 *
 *   node scripts/check-bundle-tdz.mjs           # check
 *   node scripts/check-bundle-tdz.mjs --write   # re-pin after a real reduction
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyse, lineOf } from './bundle-tdz-analysis.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BUNDLE = join(ROOT, 'extension', 'background', 'index.js');
const PREMINIFY_CAPTURE = join(ROOT, 'node_modules', '.cache', 'gero', 'background.pre-minify.js');
const BASELINE = join(HERE, 'bundle-tdz-baseline.json');

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

const baseOf = key => key.replace(/\{.*$/, '');
const countBases = keys => {
  const counts = new Map();
  for (const key of keys) counts.set(baseOf(key), (counts.get(baseOf(key)) ?? 0) + 1);
  return counts;
};
const knownBases = countBases(known);
const foundBases = countBases(foundKeys);

/** Same module, different exports: unique base name on both sides. */
const drifted = entry =>
  !known.has(entry.key)
  && knownBases.get(baseOf(entry.key)) === 1
  && foundBases.get(baseOf(entry.key)) === 1;

const introduced = found.filter(entry => !known.has(entry.key) && !drifted(entry));
const driftedKeys = found.filter(drifted).map(entry => entry.key);
const fixed = [...known]
  .filter(key => !foundKeys.includes(key))
  .filter(key => !driftedKeys.some(next => baseOf(next) === baseOf(key)))
  .sort();

if (driftedKeys.length > 0) {
  console.log(
    `check-bundle-tdz: ${driftedKeys.length} known offender(s) changed exports (${driftedKeys.join(', ')}).`
    + ' Same module, still pinned — re-pin with --write to update the key.',
  );
}

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
  + 'subtree, moving its declaration later in the emitted bundle.\n'
  + '\nIf your working tree is not what CI installs, this is not that: re-run `npm ci` and\n'
  + 'rebuild before treating the report as a code change.\n',
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
