// Design-debt ratchet. Counts style-debt metrics across src/ and compares
// against scripts/design/budgets.json. Any metric ABOVE budget fails.
// When a sweep lands, re-run with --write to lower budgets to the new
// reality. Budgets may only decrease; the script rejects a --write that
// would raise any number.
// Also verifies tokens.css and _tokens.scss agree on shared values.
//
// Implemented as a pure-Node scanner rather than by shelling out to ripgrep:
// `rg` is not guaranteed to exist on a developer machine (it is not on PATH
// here) nor on the self-hosted CI runner, and this script has to run in both
// the pre-commit hook and CI. 682 files / ~7 MB scans in well under a second.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const BASE_EXT = ['.vue', '.scss', '.css'];
const EXCLUDE_DIRS = new Set(['node_modules', 'vendor']);

/** Recursively collect files under `dir` whose extension is in `exts`. */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // src/vendor is a third-party bundle, not our code.
      if (EXCLUDE_DIRS.has(name)) continue;
      walk(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const rel = (p) => p.split(sep).join(posix.sep);

const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8'));
  return cache.get(f);
};

const BASE_FILES = walk('src', BASE_EXT);
const TS_FILES = walk('src', ['.ts', '.vue']);

/** All matches of `re` across `files`. Mirrors `rg -o --no-filename`. */
function matches(re, files = BASE_FILES) {
  const out = [];
  for (const f of files) {
    const m = read(f).match(re);
    if (m) out.push(...m);
  }
  return out;
}

const distinct = (arr) => new Set(arr.map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim())).size;

const HEX = /#[0-9a-f]{3,8}\b/gi;
const hexes = matches(HEX);

const formatForkFiles = TS_FILES.filter((f) => rel(f) !== 'src/shared/utils/format.ts');

const metrics = {
  hexOccurrences: hexes.length,
  hexDistinct: distinct(hexes),
  fontSizeDistinct: distinct(matches(/font-size:\s*[^;}"]+/gi)),
  radiusDistinct: distinct(matches(/border-radius:\s*[^;}"]+/gi)),
  zIndexDistinct: distinct(matches(/z-index:\s*[^;}"]+/gi)),
  backdropFilters: matches(/backdrop-filter/gi).length,
  uppercase: matches(/text-transform:\s*uppercase/gi).length,
  infiniteAnimations: matches(/animation:[^;}]*infinite/gi).length,
  importantCount: matches(/!important/gi).length,
  lowAlphaText: matches(/(^|[^-a-z])color:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.[0-5]/gim).length,
  transitionAll: matches(/transition:\s*all/gi).length,
  // trust-surface tripwires
  corruptedMdiNames: matches(/mdi-[a-z-]*[^\x00-\x7F][^"' ]*/gi).length, // e.g. mdi-information-outlƒine
  formatFnForks: matches(/(function|const)\s+(formatPrice|formatBalance|formatUsd)\b/g, formatForkFiles).length,
};

// tokens.css <-> _tokens.scss sync check (shared hex values must match)
const css = readFileSync('src/shared/styles/tokens.css', 'utf8');
const scss = readFileSync('src/shared/styles/_tokens.scss', 'utf8');
const pairs = [
  ['--g-surface', '$g-surface'], ['--g-raised', '$g-raised'], ['--g-overlay', '$g-overlay'],
  ['--g-text-1', '$g-text-1'], ['--g-text-2', '$g-text-2'], ['--g-text-3', '$g-text-3'],
  ['--g-error', '$g-error'], ['--g-success', '$g-success'], ['--g-warning', '$g-warning'], ['--g-info', '$g-info'],
];
const val = (src, name) => (src.match(new RegExp(`${name.replace('$', '\\$')}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
let syncFail = 0;
for (const [c, s] of pairs) {
  if (val(css, c) !== val(scss, s)) { console.error(`TOKEN DESYNC: ${c}=${val(css, c)} vs ${s}=${val(scss, s)}`); syncFail++; }
}

const budgets = JSON.parse(readFileSync('scripts/design/budgets.json', 'utf8'));
let failed = syncFail;
for (const [k, v] of Object.entries(metrics)) {
  const b = budgets[k];
  const ok = b === undefined || v <= b;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'OVER'}  ${k}: ${v} (budget ${b ?? 'unset'})`);
}

if (process.argv.includes('--write')) {
  for (const [k, v] of Object.entries(metrics)) {
    if (budgets[k] !== undefined && v > budgets[k]) {
      console.error(`refusing --write: ${k} would RAISE the budget (${budgets[k]} -> ${v})`); process.exit(1);
    }
    budgets[k] = Math.min(budgets[k] ?? v, v);
  }
  writeFileSync('scripts/design/budgets.json', JSON.stringify(budgets, null, 2) + '\n');
  console.log('budgets.json updated (ratcheted down).');
  process.exit(0);
}
process.exit(failed ? 1 : 0);
