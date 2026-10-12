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
`development` or `main` that change any application source (`src/**`), build or
test script (`scripts/**`), package manifest or lockfile, TypeScript/JavaScript
configuration, Vite configuration, this document, or the workflow itself. This
covers shared components, models, network utilities, support transport, CSP,
and the chunks imported by the scenarios without maintaining individual imports.

A nightly run at 03:17 UTC also checks the default branch, currently
`development`, without a path filter. GitHub activates that schedule only after
the workflow is merged into the default branch; it has not run from this PR.
You can also dispatch the workflow manually. The nightly run is a safety net
for path-filter limits and environment changes; it uses the same synthetic
fixtures and does not test live services.

This check is optional under the current branch protection settings. Keep it
separate from required checks because documentation-only pull requests can skip
this workflow. Application changes intentionally run the optional browser check,
even outside Help, because the extension shares runtime dependencies.
Scenario failures remain visible as failures and upload any available evidence.
The required **Ledger tests and extension bundles** check retains its broad
trigger, ledger tests, and production build, without installing Chromium or
running Help browser scenarios. Help unit tests remain in the production bundle
gate.

## Scenario coverage

The scenarios cover:

- **Public Help with no wallet:** the home dashboard (hero, search, chain pills
  with `aria-pressed`, six topic tiles), the Midnight pill demoting Gero Card to
  "Cardano only", the topic applicability page, hero search, the 390 px layout
  without horizontal scroll, and the Blog routes.
- **Reader:** breadcrumb, `.g-prose` body with numbered steps, the "On this page"
  / "Applies to" / "Checked for" rail, related guides, the local "Was this answer
  helpful?" acknowledgement, and the language fallback.
- **Support dialog:** the no-wallet email dialog (mailto primary, "Create or
  import" secondary), the locked email dialog with its "Unlock wallet" link
  (`redirect=`), and, for an eligible synthetic Cardano mainnet wallet with live
  chat enabled, the pre-chat dialog: editable question and context (guide id and
  chain, never the stake address), "Start live chat" handing that draft to the
  agent dock with its preferences left hidden, and no chat or support request
  before Send. Turning live chat off falls back to the email dialog.
- **Welcome Help panel:** one "Help" button (no "Help Center" or "Contact
  support" buttons) that opens a panel over the unchanged welcome screen, Escape
  returning focus to the button, "About this step" and numbered in-panel answers
  while setup is open, "Open the full Help Center" opening a new tab while the
  welcome URL and setup stay put, the in-panel failure message with its "Open
  Help in a new tab" link when `chrome.tabs.create` rejects, the saved-wallet
  (locked) variant, and the 390 px bottom sheet with its scrim.
- **Saved and unlocked wallets:** the public header disappearing for a ready
  wallet while the reader stays, and locking in place keeping the URL and search
  text, with the unlock action in the home support widget and the locked dialog
  rather than in the header.
- **Published content:** published guide rendering, popularity ranking,
  "Latest tutorial", search pagination, offline snapshots, and withdrawn guides.
- **Updates:** source pills with freshness dots, the always-visible stale-source
  notice (one stale source in the fixtures), 20/40-row pagination, original
  links, blog thumbnails and X post images on the Updates page and in the home
  "From the Gero blog" and "Latest on X" widgets (with the Gero/Nexus switch),
  the Midnight chain filter, offline snapshots, authoritative withdrawals, and
  the legacy Blog fallback.

These are browser acceptance tests using intercepted APIs and synthetic wallet
metadata. They do not verify live Contentful publication, real account state,
Chatwoot delivery, feed availability, or on-chain operations. No support message
or transaction is submitted. Fixture guides, social posts and images are
fabricated (images are solid-colour PNGs generated in memory); no unpublished CMS
drafts or private control-panel content is included.

Scripts live in `scripts/help-browser/`: `foundation-smoke.cjs` (offline, bundled
answers, welcome panel, support dialogs), `published-smoke.cjs` (published
guides), `updates-smoke.cjs` (Updates and home widgets), `fixtures.cjs`
(synthetic DTOs, update sources, generated images) and `helpers.cjs` (tall
full-page screenshots for views that scroll inside a container, image-load and
overflow checks).

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
