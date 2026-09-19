# Shipping: commit, PR, review, merge

## Branch

Branch from `development`, target `development`. `main` is the release branch, is unprotected, and is months behind. There are no `release/*` branches - releases are tagged at release time, and a hotfix branches from the tag.

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
| `Cannot find module .../yorkie/src/runner.js` | You are in a harness-managed worktree with no yorkie installed. Run the three gates by hand, then `--no-verify` for that commit only. |

**Never use `--no-verify` routinely.** The single hook entry chains all three gates, so skipping lint also skips the ratchet and the WCAG check. That exact habit is why `precommit-lint.mjs` was written.

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
| `Production bundle (SFC parse)` | `dev-bundle-gate.yml` | 6 named vitest files, `npm run design:check`, then `build:web` against a synthesized placeholder `.env.production` |
| `npm ci (lock in sync)` | `lockfile-check.yml` | `npm ci --ignore-scripts` |
| `ESLint flat config loads` | `eslint-check.yml` | `eslint --print-config` on two files. It lints **no source** - it only proves the flat config resolves |
| `Ledger tests and extension bundles` | `midnight-ledger-verify.yml` | The Midnight + crossDevice vitest slice, then `scripts/build-isolated-extension.mjs` which builds all five production entry points. Deliberately **not** path-filtered, so it runs on every PR |

### Getting it approved, concretely

Four checks green is not enough. Also enforced:

- **1 approving review, and you cannot approve your own PR.** GitHub refuses it on authorship (`Can not approve your own pull request`). A solo-authored PR therefore needs a second reviewer, or `gh pr merge --squash --admin` if you have that right. (`require_last_push_approval` is **false** here, so pushing a commit to *someone else's* PR does not disqualify you from approving it.)
- **`dismiss_stale_reviews: true`** - every push drops the approval you already had. On a long-lived branch that means merge-from-`development`, then re-approve, every round.
- **`strict: true`** - the branch must be up to date with `development` before it can merge.
- **`required_conversation_resolution`** - a fully green, approved PR still reports `BLOCKED` while any review thread is unresolved. REST does not expose threads; list them over GraphQL.

Confirm the merge actually landed - a blocked `gh pr merge` prints a hint and exits without merging:

```bash
gh pr view <n> --json state,mergedAt,mergeCommit
```

`claude-code-review.yml` runs on same-repo PRs, actually executes vitest and eslint, and is **not** a required check. It never runs on fork PRs, and it refuses to run on a PR that edits its own workflow file.

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

To resync a drifted lockfile: `npm install --package-lock-only`, then validate with a **real** `npm ci` - `--package-lock-only` skips peer resolution, so it will not reproduce the ERESOLVE the gate hits.

## Security issues

Never in a public issue, PR or discussion. Use the private advisory at
`https://github.com/Gero-Labs/gerowallet/security/advisories/new`, or `support@gerowallet.io`.
Acknowledgement within 3 business days, assessment within 10, 90-day coordinated disclosure target.
