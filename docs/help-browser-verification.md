# Help Center browser verification

The **Help browser evidence** workflow runs three browser scenarios against the
complete production extension. Its artifact contains JSON results and
screenshots, available from the Actions run to reviewers with repository access.
The workflow requests two days of retention. Use the actual expiry reported in
the run summary or the artifact API's `expires_at` field; a workflow retention
request does not guarantee that download window. Download before that timestamp.
The executable scenarios and synthetic fixtures remain in Git after expiry.

The previous claim of 30 days was incorrect. For example, artifact `11584382577`
from the October 8, 2026 run expires on October 10, 2026, at 22:55:43 UTC, despite
that run requesting 30 days.

## CI scope

The separate **Help browser scenarios** check runs for pull requests to
`development` or `main` that change Help, Blog, support, welcome, navigation,
related shared UI/state, the browser harness, or its build dependencies. You can
also dispatch the workflow manually. Its `paths` list defines the exact scope;
update that list when moving a covered module or adding a shared dependency.

This check is optional under the current branch protection settings. Keep it
separate from required checks because unrelated pull requests skip this workflow.
Scenario failures remain visible as failures and upload any available evidence.
The required **Ledger tests and extension bundles** check retains its broad
trigger, ledger tests, and production build, without installing Chromium or
running Help browser scenarios. Help unit tests remain in the production bundle
gate.

## Scenario coverage

The scenarios cover public access with no wallet, setup preservation when Help
tab creation fails, native-link fallback, saved and unlocked wallets, locking
while reading, support eligibility/context, published guide rendering, search
pagination, language fallback, narrow layouts, update-source filters, offline
snapshots, authoritative withdrawals, and legacy Blog fallback.

These are browser acceptance tests using intercepted APIs and synthetic wallet
metadata. They do not verify live Contentful publication, real account state,
Chatwoot delivery, feed availability, or on-chain operations. No support message
or transaction is submitted. Fixture guides and social posts are fabricated;
no unpublished CMS drafts or private control-panel content is included.

## Reproduce locally

Use a clean disposable checkout with Node.js 22 and installed wallet dependencies.
The build helper refuses to overwrite existing environment files or a manifest.
It creates isolated build settings and a temporary extension identity.

```sh
npm ci
node scripts/build-isolated-extension.mjs .
npm install --prefix /tmp/gero-help-browser --ignore-scripts playwright@1.61.0
node /tmp/gero-help-browser/node_modules/playwright/cli.js install --with-deps chromium
export PLAYWRIGHT_MODULE=/tmp/gero-help-browser/node_modules/playwright
export HELP_SMOKE_OUTPUT="$PWD/output/help-browser"
node scripts/help-browser/foundation-smoke.cjs
node scripts/help-browser/published-smoke.cjs
node scripts/help-browser/updates-smoke.cjs
```

On Windows, set these two environment variables in PowerShell to the corresponding
absolute paths. Each scenario uses a fresh temporary Chromium profile. Remove
those disposable profiles after the run when no browser process uses them.
`WALLET_REPO` optionally selects another already-built wallet checkout.

## Live release acceptance

Before rollout, separately verify a real editor-saved Contentful date, published
and withdrawn guide/blog entries, Midnight curation, owned social export, and
the live Cardano and Bitcoin feeds through the staging backend. Compare accepted
item counts with raw feed counts and investigate skipped-item diagnostics.
Complete approved live-wallet/test-inbox checks before claiming support delivery.
