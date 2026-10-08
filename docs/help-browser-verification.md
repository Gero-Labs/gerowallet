# Help Center browser verification

The **Ledger tests and extension bundles** workflow runs three browser scenarios
against the complete production extension. Its **Help browser evidence** artifact
contains JSON results and screenshots, available from the Actions run to reviewers
with repository access. Download it within 30 days. The executable scenarios and
synthetic fixtures remain in Git after the artifact expires.

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
