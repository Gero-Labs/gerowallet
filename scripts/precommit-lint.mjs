// Pre-commit ESLint gate — STAGED INDEX CONTENT ONLY.
//
// Why not `eslint .` (the old gitHooks command): the flat config's
// @typescript-eslint/no-explicit-any is an error and src/ carries ~730 legacy
// `any` violations across 163 files. Linting the whole repo on every commit can
// never go green, so the hook was permanently bypassed with --no-verify (which
// also silently disabled the design ratchet + contrast gates). Scoping to the
// staged set makes the hook pass on a clean working set while still enforcing
// the repo rule "fix ESLint issues in every file you touch": the moment you edit
// a legacy file, its `any`s must be cleaned before the commit lands.
//
// Why lint the staged BLOB (git show :file) over stdin instead of the path on
// disk: for a partially-staged file (git add -p, then more unstaged edits) the
// working tree differs from what's actually being committed. Linting the path
// would let a commit whose staged hunk has an error pass because an unstaged
// edit "fixed" it on disk — and vice versa. Feeding the index content via
// --stdin lints exactly what git will commit. (lint-staged solves the same
// problem by stashing unstaged changes; doing that stash safely inside a hook
// is fiddly, so we read the index directly and add no dependency.)
//
// No --fix: nothing in the current ruleset is auto-fixable (no-explicit-any and
// no-unused-vars are both manual), and --fix over stdin can't write back to a
// partially-staged file without the same re-staging footgun anyway.
//
// Pure Node + git, no extra dependency (matches scripts/design/*.mjs), so it
// runs identically in the yorkie pre-commit hook and anywhere else.
import { execFileSync } from 'node:child_process';

const LINT_EXT = /\.(?:js|mjs|cjs|ts|tsx|vue)$/;

// On Windows npx is a batch file, and execFileSync without a shell cannot
// spawn one — it throws ENOENT, which the catch below would otherwise record
// as "this file has lint errors". Name the .cmd explicitly rather than passing
// shell: true, which would re-parse the file path through cmd.exe.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// ACMR: added / copied / modified / renamed — never deleted (D), so every path
// here still has a blob in the index for `git show :path` to read.
const staged = execFileSync(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
  { encoding: 'utf8' }
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => LINT_EXT.test(file));

if (staged.length === 0) {
  process.exit(0);
}

let failed = false;

for (const file of staged) {
  // The staged (index) version of the file, as raw bytes.
  let indexContent;
  try {
    indexContent = execFileSync('git', ['show', `:${file}`]);
  } catch {
    // Not resolvable in the index (shouldn't happen under the ACMR filter) — skip.
    continue;
  }

  try {
    // --stdin-filename makes ESLint resolve eslint.config.mjs (rules AND its
    // `ignores`) by this path, so vendored/generated staged files are skipped;
    // --no-warn-ignored keeps that skip silent. --cache is incompatible with
    // --stdin, so it is omitted — the staged set is small, so this is fine.
    execFileSync(
      NPX,
      ['eslint', '--stdin', '--stdin-filename', file, '--no-warn-ignored'],
      { input: indexContent, stdio: ['pipe', 'inherit', 'inherit'] }
    );
  } catch (err) {
    // Distinguish "eslint ran and found problems" (exit 1, errors already
    // printed) from "eslint never started". A silent ENOENT here reads as a
    // lint failure with no output, which is how this hook looked permanently
    // broken on Windows.
    if (err?.code === 'ENOENT' || err?.code === 'EACCES') {
      console.error(`precommit-lint: could not run \`${NPX}\` (${err.code}). Is the toolchain installed?`);
      process.exit(1);
    }
    // ESLint already printed this file's errors; record and keep going so the
    // developer sees every offending staged file in one run, not just the first.
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
