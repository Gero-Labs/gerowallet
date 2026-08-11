// Pre-commit ESLint gate — STAGED FILES ONLY.
//
// Why not `eslint .` (the old gitHooks command): the flat config's
// @typescript-eslint/no-explicit-any is an error and src/ carries ~730 legacy
// `any` violations across 163 files. Linting the whole repo on every commit can
// never go green, so the hook was permanently bypassed with --no-verify (which
// also silently disabled the design ratchet + contrast gates). Scoping to
// staged files makes the hook pass on a clean working set while still enforcing
// the repo rule "fix ESLint issues in every file you touch": the moment you edit
// a legacy file, its `any`s must be cleaned before the commit lands.
//
// No --fix: nothing in the current ruleset is auto-fixable (no-explicit-any and
// no-unused-vars are both manual), so --fix would be a no-op — and running it
// over partially-staged files (git add -p) risks committing unstaged hunks
// because the fixed file has to be re-`git add`ed. If an auto-fixable rule is
// ever added, switch this to lint-staged, which stashes unstaged changes first.
//
// Pure Node + git, no extra dependency (matches scripts/design/*.mjs), so it
// runs identically in the yorkie pre-commit hook and anywhere else.
import { execFileSync } from 'node:child_process';

const LINT_EXT = /\.(?:js|mjs|cjs|ts|tsx|vue)$/;

// ACMR: added / copied / modified / renamed — never deleted (D), so we don't
// hand ESLint a path that no longer exists on disk.
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

try {
  // ESLint applies eslint.config.mjs's own `ignores`, so vendored/generated
  // staged files are skipped here too. --cache keeps repeat commits fast.
  execFileSync('npx', ['eslint', '--cache', '--no-error-on-unmatched-pattern', ...staged], {
    stdio: 'inherit'
  });
} catch {
  // ESLint already printed the offending files; exit non-zero so the commit aborts.
  process.exit(1);
}
