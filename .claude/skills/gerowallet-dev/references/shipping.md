# Shipping: commit, PR, review, merge

## Branch

Branch from `development`, target `development`. Release and recovery branches must start from a verified source selected through the release runbook. Check current branch protection and release state rather than assuming an old branch or tag is qualified.

```bash
git checkout development && git pull && git checkout -b fix/<slug>
```

Branch names in use: `fix/`, `feat/`, `ci/`, `chore/`, `claude/`.

## Commit

Conventional Commits with a scope, lowercase, imperative, no trailing period:

```
fix(midnight): keep the self-transfer amount through replays
feat(sidepanel): site-activity card in mini-Gero
ci(review): don't fail the completion gate when the PR edits this workflow
```

The pre-commit hook runs three gates in one chain:

```
node scripts/precommit-lint.mjs && node scripts/design/audit.mjs && node scripts/design/contrast.mjs
```

`precommit-lint.mjs` lints the **staged index blob** (`git show :file` piped to `eslint --stdin`), not the file on disk, so a partially staged file is linted exactly as it will be committed. It covers `.js/.mjs/.cjs/.ts/.tsx/.vue`. Two rules are errors: `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-unused-vars` (`^_` escapes).

**If the hook blocks you:**

| Failure | Do this |
|---|---|
| ESLint errors in a file you barely touched | Fix them. The repo rule is that any file you edit leaves lint clean. That is the price of touching a legacy file. |
| `OVER <metric>` from the ratchet | `node scripts/design/audit.mjs 2>&1 \| grep OVER` to see which. Tokenize the value. If it is a `#1122`-style reference in a comment, rewrite it as `PR 1122`. See `design-system.md`. |
| Contrast failure | You changed a token or a chain accent. Fix the colour, do not raise a budget. |
| `Cannot find module .../yorkie/src/runner.js` | Repair the checkout's dependency installation and generated hook, then rerun the normal commit. Do not bypass its gates. |

**Never use `--no-verify`.** The single hook entry chains all three gates, so skipping lint also skips the ratchet and the WCAG check. That exact habit is why `precommit-lint.mjs` was written.

## Before you push

```bash
npx eslint <files you changed>
npm run design:check
npx vitest run <specs near your change>
npm run build:web -- --mode production
```

And, for anything user-visible, actually run it: `npm run dev`, load `extension/`, click the thing.

## Pull request

```bash
gh pr create --base development --fill
gh pr checks --watch
```

Required checks on `development` (these are job `name:` strings, not workflow names):

| Context | Workflow | What it runs |
|---|---|---|
| `Production bundle (SFC parse)` | `dev-bundle-gate.yml` | Explicit regression suites, including secret readers/migration, stores, navigation and i18n; `npm run design:check`; then `build:web` against a synthesized placeholder `.env.production`. Read the workflow for the current path list. |
| `npm ci (lock in sync)` | `lockfile-check.yml` | `npm ci --ignore-scripts` |
| `ESLint flat config loads` | `eslint-check.yml` | `eslint --print-config` on two files. It lints **no source** - it only proves the flat config resolves |
| `Ledger tests and extension bundles` | `midnight-ledger-verify.yml` | The Midnight + crossDevice vitest slice, then `scripts/build-isolated-extension.mjs` which builds all four production bundles plus manifest preparation. Deliberately **not** path-filtered, so it runs on every PR |

### Getting it approved, concretely

Four checks green is not enough. Also enforced:

- **1 approving review, and you cannot approve your own PR.** GitHub refuses it on authorship (`Can not approve your own pull request`). A solo-authored PR therefore needs an independent reviewer. (`require_last_push_approval` is **false** here, so pushing a commit to *someone else's* PR does not disqualify you from approving it.)
- **`dismiss_stale_reviews: true`** - every push drops the approval you already had. On a long-lived branch that means merge-from-`development`, then re-approve, every round.
- **`strict: true`** - the branch must be up to date with `development` before it can merge.
- **`required_conversation_resolution`** - a fully green, approved PR still reports `BLOCKED` while any review thread is unresolved. REST does not expose threads; list them over GraphQL.

Confirm the merge actually landed - a blocked `gh pr merge` prints a hint and exits without merging:

```bash
gh pr view <n> --json state,mergedAt,mergeCommit
```

`claude-code-review.yml` runs on eligible same-repo PRs and installs dependencies
so the reviewer can execute targeted Vitest and ESLint checks. Read the completed
review for the checks actually run; a successful action alone is not evidence
for every test. It skips fork and Dependabot PRs, and the action refuses to review
a PR that edits its own workflow file.

## Release packaging

`ci-cd.yml` is separate from the PR checks. It runs on `main` pushes, manual
dispatch, or as the first job of `chrome-web-store.yml`, with Node 24.19.0, npm
11.1.0, and `npm ci`. Before archiving it runs the full deterministic suite, the
secret-reader guard, sequential production builds, artifact
version/identity/CSP/hash checks, and the background TDZ guard. Manual runs
require the reviewed package version and channel identity settings. It never
tags or publishes.

Releases are one run of `chrome-web-store.yml`: that build, a re-check of its
package, the full gerowallet-e2e-tests isolated suites against its ZIP, then,
with `dry_run=false` and the environment's approval, the `v<version>` tag and the
store upload of that same ZIP. Follow
[release and recovery readiness](../../../../spikes/vue3-migration/RELEASE-READINESS.md);
green packaging does not close physical-device, profile-upgrade, recovery,
provider, beta, or production-verification gates.

## If you are contributing from a fork

- All four required checks sit at `action_required` with 0s duration until a maintainer clicks "Approve and run workflows", once per push.
- The AI reviewer never runs. You get the four gates and human review.
- If a maintainer pushes to your PR, they must push to the fork's URL, not `origin`.

## Reviewing, or responding to review

`references/security.md` lists what reviewers block on. Resolve only threads you actually addressed; for one you are accepting rather than fixing, reply saying so before resolving, or a live gap reads as a closed defect.

## Dependencies

`.github/dependabot.yml` suppresses all majors and documents hard pins. Two that bite:

- `bitcoinjs-lib` is frozen at exactly `6.1.7` by `@babylonlabs-io/btc-staking-ts`'s single-version peer. Bumping it breaks `npm ci` and re-locking does not fix it.
- `@midnightntwrk/ledger-v9` must move together with all four sibling `wallet-sdk-*` packages, or npm quietly nests a second `wasm-bindgen` copy.

To resync a drifted lockfile: `npm install --package-lock-only`, then validate with a **real** `npm ci` - a lockfile-only operation does not prove a clean installation. Do not force or bypass peer resolution.

## Security issues

Never in a public issue, PR or discussion. Use the private advisory at
`https://github.com/Gero-Labs/gerowallet/security/advisories/new`, or `support@gerowallet.io`.
Acknowledgement within 3 business days, assessment within 10, 90-day coordinated disclosure target.
