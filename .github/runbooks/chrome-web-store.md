# Chrome Web Store release runbook

This runbook covers sending a tested release to the Chrome Web Store. One run of the workflow builds the package, tests it and uploads it, and the store only ever receives the exact package that run built and tested.

Workflow: [`chrome-web-store.yml`](../workflows/chrome-web-store.yml) (Actions → "Chrome Web Store release"). Script: [`scripts/chrome-web-store.mjs`](../../scripts/chrome-web-store.mjs). The script uses the Chrome Web Store API **v2**; Google stopped supporting v1.1 on October 15, 2026.

## 1. How a version reaches users

1. Commit the reviewed version to `package.json` and `package-lock.json`.
2. Run **Chrome Web Store release** with that version and `dry_run=true`. Its first job is **Chrome Extension CI/CD** (`ci-cd.yml`), which builds the commit, runs the unit suite and archives the package with its checksums. The run then re-checks that package and runs the e2e suites against it. Nothing is tagged, and nothing is sent to the store.
3. Run it again with `dry_run=false`. Everything in step 2 runs again, on a fresh build. The upload job then waits until an environment reviewer approves it. After approval it tags the commit `v<version>`, and the tag message names the run. It then uploads and submits the ZIP.
4. Google reviews the submission. With `submission=staged`, publish it from the Developer Dashboard once it is approved. With `publish`, it goes live as soon as it is approved.

The upload job uses the package built at the start of the same run, so approve it before that package expires (see [Artifact retention](#artifact-retention)). Running **Chrome Extension CI/CD** on its own still builds, tests and archives a package, but it no longer tags or releases anything.

### What is checked before anything is uploaded

| Check | Fails when |
|---|---|
| Build | **Chrome Extension CI/CD** fails: the version differs from `package.json` or `package-lock.json`, `MANIFEST_KEY` or `CHROME_EXTENSION_ID` is missing, a unit test fails, or the built package fails the release gate |
| Release tag | `v<version>` already marks another commit (a dry run only warns) |
| Build report | The report is not passing; or its identity, version, channel, commit or `package-lock.json` hash differs from this commit and the inputs |
| Files | The extension directory or the extracted ZIP fails the release gate (`check-release-artifact.mjs`), or differs by even one file hash from what was tested |
| ZIP | Its SHA-256 differs from `SHA256SUMS`, or from the hash the verify job recorded |
| E2E suites | Any test in the full isolated suites of [gerowallet-e2e-tests](https://github.com/Gero-Labs/gerowallet-e2e-tests) fails, times out or passes only on retry, or a suite runs no tests. They are post-v2.7 in three shards, plus legacy, run against the extracted ZIP (see below) |
| Store item | `CWS_ITEM_ID` is not the package's extension ID, or the item's public key belongs to another extension |
| Store state | The item is taken down; another version is in review or approved and waiting; or the published version is not lower than this one |
| Upload | The store reads a different version from the ZIP, or does not accept the upload |

## 2. One-time setup

### Google

1. The store listings must already exist. The API cannot create items, so the first package of a listing is uploaded by hand. Note each listing's **item ID** (production and beta), and your **publisher ID** from the Developer Dashboard.
2. In a Google Cloud project, enable the **Chrome Web Store API**.
3. Create credentials. A service account is preferred:
   - **Service account (preferred):** create one and a JSON key for it. Add its email address to the publisher's API access in the Developer Dashboard. It needs no personal Google account and does not expire.
   - **OAuth refresh token:** create an OAuth client and get a refresh token for the scope `https://www.googleapis.com/auth/chromewebstore`, from a Google account with access to the publisher. If the OAuth consent screen is still in *Testing*, Google expires the refresh token after 7 days, and the next release fails with `invalid_grant`.
4. The API publishes with the listing's current visibility. If you change visibility in the Dashboard, publish once by hand before using the API again.

### GitHub

Create two environments in Settings → Environments: `chrome-web-store-production` and `chrome-web-store-beta`. For each one:

- **Required reviewers:** the release owner(s). Turn on "Prevent self-review". This approval is the release authorization.
- **Deployment branches:** only `development` and `main`. The workflow runs from the branch it was started on. Without this restriction, a changed copy of the workflow on another branch could read the store secrets.
- **Variables:** `CWS_PUBLISHER_ID`, and `CWS_ITEM_ID` (that channel's listing).
- **Secrets:** `CWS_SERVICE_ACCOUNT_JSON`. Alternatively, all of `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`.

### Artifact retention

The workflows ask GitHub to keep their artifacts for 90 days, but GitHub never keeps one longer than the repository's retention setting (Settings → Actions → General → "Artifact and log retention"). On 2026-10-26 that setting was 2 days, so a run's package expired 2 days after the run started. The upload job must be approved within that time. Raise the setting if you need longer. Each artifact's expiry date is shown on its run's page.

### Release channel

The channel is fixed when the package is built. `ci-cd.yml` builds for the listing that its `MANIFEST_KEY`, `CHROME_EXTENSION_ID` and `VITE_IS_BETA` repository settings describe, and records that channel. A beta package therefore needs those settings pointed at the beta listing before the release run. The store job refuses a package built for another channel, or for an ID other than its environment's `CWS_ITEM_ID`.

## 3. Running it

| Input | Meaning |
|---|---|
| `version` | The tagged version, for example `2.8.0` |
| `channel` | `production` or `beta`. This picks the environment, and so the listing and credentials |
| `submission` | `staged` (default): submit for review, then publish by hand once approved. `publish`: goes live as soon as approved. `upload-only`: replace the draft, submit nothing |
| `deploy_percentage` | Optional, 1 to 100. Rolls out to that share of users. The store accepts it only for items above 10,000 weekly users. Empty means everyone |
| `dry_run` | `true` (default) builds, tests and e2e-tests the package, then stops. `false` also tags and uploads it after approval |

### The e2e gate

The `e2e` job runs the same harness commands and settings as the e2e repository's own `post-v27-e2e.yml`. Only the wallet under test differs: it is the release ZIP, extracted after its SHA-256 check, not a fresh test build. The suites therefore test the exact bytes the store will receive, with the production extension key and configuration.

The harness is always the e2e repository's `development` branch; `e2e-run.json` records the exact commit. There is deliberately no input to pick another ref. This workflow runs with the default branch's cache scope, so running unreviewed harness code there could poison caches that other workflows restore. For the same reason the job checks out no wallet source. The tested commit and the ZIP's SHA-256 are written into each suite's `qualification.json`, and the gate refuses a report for anything else.

The gate does not block on:

- **Skips:** each one carries a reason and a category (device needed, live chain needed, coverage gap and so on) in the job summary. Review them before you approve.
- **The live suites:** the funded-wallet, real-transaction ones (`@transaction`, `@live`). They need real testnet funds and are not part of the isolated suites.

Each shard keeps its `qualification.json` and an `e2e-run.json` naming the harness commit, as the artifact `e2e-<channel>-<version>-<suite>-<shard>-<run>`. Screenshots, videos and traces are never kept: this repository is public, and they can show the disposable recovery phrases the tests create. Inside `qualification.json`, `harnessSha` holds the wallet repository's commit; the harness commit is in `e2e-run.json`.

Each run writes a summary. The upload job keeps the store's answer as the artifact `chrome-web-store-<channel>-<version>-<run>`. That answer holds states and versions only, never a token or credential.

## 4. When something goes wrong

| Message or situation | What to do |
|---|---|
| The **Chrome Extension CI/CD** job fails | It is the same build as a standalone `ci-cd.yml` run. Fix the cause on the branch, then run the release again. |
| `v<version> already marks <commit>` | That version was already released from another commit. Bump the version and release again. |
| An e2e shard fails | Open that shard's job summary and log. A wallet bug means fixing it and releasing a new version. A harness problem means fixing it on the e2e repository's `development` branch, then rerunning. Don't release around a red gate. |
| `passed only on retry` | The legacy suite retries a failed test once on CI. A flaky release test still needs a look. Rerun the workflow; if the same test keeps flaking, fix the test or the wallet first. |
| The package can no longer be downloaded | It expired before the upload was approved (see [Artifact retention](#artifact-retention)). Nothing was tagged or uploaded, so run the release again; it builds a fresh package. |
| `Another version is already in review` / `waiting to be published` | Publish or cancel that submission in the Developer Dashboard, then run again. The workflow never cancels a submission itself. |
| `The store already serves X; Y must be higher` | Bump the version and release again. |
| The upload failed | The commit is already tagged. The tag stays on that commit, so once the cause is fixed in the store or its settings, run the release again on the same commit. |
| The upload succeeded but the submission failed | The listing's draft now holds the new package, and the commit is tagged. Submit that draft from the Developer Dashboard; don't run the workflow again. |
| `invalid_grant` | The refresh token was revoked or expired (see the *Testing* note above). Create a new one, or switch to a service account. |
| HTTP 403 | The service account's email is not on the publisher, or `CWS_PUBLISHER_ID` or `CWS_ITEM_ID` is wrong. |
| Google rejects the submission | Fix the cause, bump the version and release again. |
| A published version must be withdrawn | The store cannot go back to an older version. Ship a higher-version forward recovery package (see [RELEASE-READINESS.md](../../spikes/vue3-migration/RELEASE-READINESS.md#forward-recovery-package)). For a staged rollout, keeping its percentage low limits who receives it in the meantime. |
