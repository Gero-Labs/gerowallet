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
// Excluded by PATH, not by bare directory name: a `node_modules` or `vendor`
// directory anywhere else in the tree would otherwise be a free ratchet-evasion
// hatch (drop a file in src/modules/foo/vendor/ and it stops being counted).
const EXCLUDE_PATHS = new Set(['src/vendor', 'src/node_modules']);

const rel = (p) => p.split(sep).join(posix.sep);

/** Recursively collect files under `dir` whose extension is in `exts`. */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_PATHS.has(rel(full))) continue;
      walk(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

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

// tokens.css <-> _tokens.scss sync check.
//
// The pairs are DERIVED from _tokens.scss, not hand-listed: every `$g-foo` it
// declares must have a matching `--g-foo` in tokens.css with an equal value.
// A hand-written list silently stops covering tokens as the mirror grows, and
// a lookup that returns undefined on a miss makes `undefined === undefined`
// pass -- so a typo in BOTH names, or a token dropped from tokens.css, would
// have gone unnoticed. Missing on either side is now a hard failure.
// Values (not just hexes) are compared, case-insensitively.
const css = readFileSync('src/shared/styles/tokens.css', 'utf8');
const scss = readFileSync('src/shared/styles/_tokens.scss', 'utf8');

const norm = (v) => (v === undefined ? undefined : v.trim().replace(/;$/, '').toLowerCase());
const cssVal = (name) => norm((css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm')) || [])[1]);
const scssVars = [...scss.matchAll(/^\s*\$(g-[a-z0-9-]+):\s*([^;]+);/gim)].map((m) => [m[1], norm(m[2])]);

let syncFail = 0;
if (!scssVars.length) { console.error('TOKEN MIRROR: _tokens.scss declares no $g-* variables'); syncFail++; }
for (const [name, sVal] of scssVars) {
  const cVal = cssVal(`--${name}`);
  if (cVal === undefined) {
    console.error(`TOKEN DESYNC: $${name} exists in _tokens.scss but --${name} is missing from tokens.css`);
    syncFail++;
  } else if (cVal !== sVal) {
    console.error(`TOKEN DESYNC: --${name}=${cVal} vs $${name}=${sVal}`);
    syncFail++;
  }
}

const budgets = JSON.parse(readFileSync('scripts/design/budgets.json', 'utf8'));
let failed = syncFail;
for (const [k, v] of Object.entries(metrics)) {
  const b = budgets[k];
  const ok = b === undefined || v <= b;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'OVER'}  ${k}: ${v} (budget ${b ?? 'unset'})`);
}

// --rebaseline is the ONLY way a budget may go up, and it exists for exactly one
// situation: a merge has brought code into the tree that the budgets were never
// measured against (e.g. down-syncing a long-lived lineage). It demands a reason,
// prints every raise, and is meant to appear in the history a handful of times.
// Normal work uses --write, which can only ratchet down.
if (process.argv.includes('--rebaseline')) {
  const reasonArg = process.argv.find((a) => a.startsWith('--reason='));
  const reason = reasonArg && reasonArg.slice('--reason='.length).trim();
  if (!reason) {
    console.error('refusing --rebaseline: pass --reason="why this tree legitimately has more debt"');
    process.exit(1);
  }
  const raises = Object.entries(metrics).filter(([k, v]) => budgets[k] !== undefined && v > budgets[k]);
  if (!raises.length) {
    console.error('refusing --rebaseline: nothing is over budget. Use --write to ratchet down.');
    process.exit(1);
  }
  console.error(`\nREBASELINE (${reason})`);
  for (const [k, v] of raises) console.error(`  RAISED  ${k}: ${budgets[k]} -> ${v}`);
  for (const [k, v] of Object.entries(metrics)) budgets[k] = v;
  writeFileSync('scripts/design/budgets.json', JSON.stringify(budgets, null, 2) + '\n');
  console.error(`\n${raises.length} budget(s) raised, ${Object.keys(metrics).length - raises.length} re-pinned at or below. Justify this in the commit message.`);
  process.exit(0);
}

if (process.argv.includes('--write')) {
  for (const [k, v] of Object.entries(metrics)) {
    if (budgets[k] !== undefined && v > budgets[k]) {
      console.error(`refusing --write: ${k} would RAISE the budget (${budgets[k]} -> ${v}). If a merge legitimately added code, use --rebaseline --reason="..."`);
      process.exit(1);
    }
    budgets[k] = Math.min(budgets[k] ?? v, v);
  }
  writeFileSync('scripts/design/budgets.json', JSON.stringify(budgets, null, 2) + '\n');
  console.log('budgets.json updated (ratcheted down).');
  process.exit(0);
}
process.exit(failed ? 1 : 0);
