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
 *   node scripts/check-bundle-tdz.mjs           # check
 *   node scripts/check-bundle-tdz.mjs --write   # re-pin after a real reduction
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BUNDLE = join(ROOT, 'extension', 'background', 'index.js');
const BASELINE = join(HERE, 'bundle-tdz-baseline.json');

/** `Promise.resolve().then(() => someNamespace)` — Rollup's inlined-import shape. */
const REFERENCE = /Promise\.resolve\(\)\.then\(\(\)\s*=>\s*([A-Za-z0-9_$]+)\)/g;

/** Offsets are compared, not line numbers: cheaper and immune to reformatting. */
function analyse(source) {
  const firstReadAt = new Map();
  for (const match of source.matchAll(REFERENCE)) {
    const name = match[1];
    if (!firstReadAt.has(name)) firstReadAt.set(name, match.index);
  }

  const violations = [];
  for (const [name, readAt] of firstReadAt) {
    const declaredAt = source.indexOf(`const ${name} = `);
    // No declaration found at all means the name is not an inlined namespace
    // (an alias, or already a real import) — nothing to order.
    if (declaredAt === -1) continue;
    if (declaredAt > readAt) violations.push(name);
  }
  return violations.sort();
}

function lineOf(source, name) {
  const at = source.indexOf(`const ${name} = `);
  return at === -1 ? '?' : source.slice(0, at).split('\n').length;
}

if (!existsSync(BUNDLE)) {
  console.log('check-bundle-tdz: no background bundle built yet — skipping.');
  process.exit(0);
}

const source = readFileSync(BUNDLE, 'utf8');
const found = analyse(source);

if (process.argv.includes('--write')) {
  // Keep any hand-written note: it is the only place the reason for an entry
  // lives, and re-pinning must not silently erase it.
  const note = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8')).note
    : undefined;
  const pinned = note === undefined ? { known: found } : { note, known: found };
  writeFileSync(BASELINE, `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`check-bundle-tdz: pinned ${found.length} known offender(s).`);
  process.exit(0);
}

const known = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).known)
  : new Set();

const introduced = found.filter(name => !known.has(name));
const fixed = [...known].filter(name => !found.includes(name)).sort();

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
for (const name of introduced) {
  console.error(`  ${name}  (declared around line ${lineOf(source, name)}, read earlier)`);
}
console.error(
  '\nFix by making the import static where the module is in the same iife anyway'
  + ' (a dynamic import buys no code splitting there), or by not adding the import edge.\n',
);
process.exit(1);
