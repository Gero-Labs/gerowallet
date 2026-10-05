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
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINT_EXT = /\.(?:js|mjs|cjs|ts|tsx|vue)$/;

// Why `node <ESLint's own JS entry>` rather than `npx eslint`: on Windows npx
// is a batch file, and since the April 2024 hardening (CVE-2024-27980) Node
// 18.20+, 20.12+ and 22 refuse to spawn a .cmd/.bat without `shell: true` —
// execFileSync throws EINVAL before anything runs. The old catch only knew
// ENOENT/EACCES, so on Node 22 (which CI pins) that EINVAL was recorded as
// "this file has lint errors" and the hook failed with no output at all; it
// kept working locally only because the machine's default Node predated the
// change. `shell: true` is not the answer either: it re-parses the file path
// through cmd.exe. ESLint exports nothing but its package.json, so the entry
// is taken from that file's `bin` rather than require.resolve()d directly.
export function eslintEntry(require = createRequire(import.meta.url)) {
  const pkgPath = require.resolve('eslint/package.json');
  const { bin } = require(pkgPath);
  return join(dirname(pkgPath), typeof bin === 'string' ? bin : bin.eslint);
}

/** argv for `execFileSync(process.execPath, …)`: a JS entry, never a .cmd. */
export function eslintStdinArgs(entry, file) {
  // --stdin-filename makes ESLint resolve eslint.config.mjs (rules AND its
  // `ignores`) by this path, so vendored/generated staged files are skipped;
  // --no-warn-ignored keeps that skip silent. --cache is incompatible with
  // --stdin, so it is omitted — the staged set is small, so this is fine.
  return [entry, '--stdin', '--stdin-filename', file, '--no-warn-ignored'];
}

/** execFileSync error codes that mean ESLint never started, as opposed to ran and failed. */
const SPAWN_FAILURES = new Set(['ENOENT', 'EACCES', 'EINVAL']);

/**
 * Lint every staged file's index blob. `indexContent(file)` returns the blob
 * and throws when the index has none; `runEslint(file, input)` throws the way
 * execFileSync does — `code` set when the process could not start, `status`
 * set when ESLint ran and reported problems (which it has already printed).
 *
 * Returns 'clean', 'errors' (every offending file was still visited, so the
 * developer sees all of them in one run) or 'cannot-run' (stopped at the first
 * spawn failure, which is reported — a silent one is how this hook looked
 * permanently broken on Windows, twice).
 */
export function lintStaged(staged, { indexContent, runEslint, report = console.error }) {
  let failed = false;
  for (const file of staged) {
    let input;
    try {
      input = indexContent(file);
    } catch {
      continue; // not resolvable in the index (shouldn't happen under the ACMR filter)
    }
    try {
      runEslint(file, input);
    } catch (err) {
      if (SPAWN_FAILURES.has(err?.code)) {
        report(`precommit-lint: could not start ESLint (${err.code}). Is the toolchain installed?`);
        return 'cannot-run';
      }
      failed = true;
    }
  }
  return failed ? 'errors' : 'clean';
}

// Run the gate only when invoked as a script, so the spec can import the
// pieces above. Compared case-insensitively on Windows: the hook's cwd and
// argv come through sh, and the drive letter's case is not guaranteed.
const here = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = process.platform === 'win32' ? here.toLowerCase() === invoked.toLowerCase() : here === invoked;

if (isMain) {
  // ACMR: added / copied / modified / renamed — never deleted (D), so every path
  // here still has a blob in the index for `git show :path` to read.
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => LINT_EXT.test(file));

  if (staged.length === 0) {
    process.exit(0);
  }

  let entry;
  try {
    entry = eslintEntry();
  } catch (err) {
    console.error(`precommit-lint: ESLint is not installed (${err.message}). Run npm install.`);
    process.exit(1);
  }

  const result = lintStaged(staged, {
    // The staged (index) version of the file, as raw bytes.
    indexContent: (file) => execFileSync('git', ['show', `:${file}`]),
    runEslint: (file, input) =>
      execFileSync(process.execPath, eslintStdinArgs(entry, file), { input, stdio: ['pipe', 'inherit', 'inherit'] }),
  });
  process.exit(result === 'clean' ? 0 : 1);
}
