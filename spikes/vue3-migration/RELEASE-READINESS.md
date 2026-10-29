# Vue 3 release and recovery readiness

This is the release procedure for
[V14 #1296](https://github.com/Gero-Labs/gerowallet/issues/1296). The migration
and follow-up fixes are merged; development is `2.7.3`. Release version and
source must be committed and reviewed before publication. Production tagging,
store submission, and rollout require release-owner authorization.

## Current qualification boundary — October 18, 2026

The current local baseline is development
`1a4d50ac5e1d51fc9a3601a63808c79f839ff6b2`. See the
[maintenance handoff](../../MAINTENANCE.md) and
[dated evidence](evidence/maintenance-2026-10-18.json): normal clean install,
5,239 tests passed without skips, complete production build, static guards,
and offline Chromium entrypoint smoke. The build uses a synthetic public
manifest key and does not establish store identity or production readiness.

Keep these release gates open:

- [#1284](https://github.com/Gero-Labs/gerowallet/issues/1284): missing coverage
  and live prerequisites, with exact wallet/harness SHAs.
- [#1295](https://github.com/Gero-Labs/gerowallet/issues/1295): supported-device,
  platform, live-provider, accessibility, and performance acceptance.
- [#1296](https://github.com/Gero-Labs/gerowallet/issues/1296): expected channel
  identity on the retained candidate, supported production-profile upgrade
  (including 2.7.2), forward recovery, and release-owner access.
- [#1298](https://github.com/Gero-Labs/gerowallet/issues/1298): authorized beta,
  store submission, and production observation.

The [review-fix record](evidence/review-fixes.json) retains earlier packaging
and identity checks, including the reported hosted dry run on `e872dd09`.
Those historical results do not qualify this newer source. Historical hosted
run links have not been revalidated by this documentation update. Every new
candidate needs its own checksums, expected ID, and scenario evidence.

## Historical integration qualification

The following table preserves results from October 13, 2026, under
`D:/GeroRepos/gitRepos/output/gerowallet-v01-2026-10-13/`. Production and beta
packages at that checkpoint were rebuilt after browser testing exposed a
runtime `new Function` path in the draggable dependency. Both replacement
packages passed the passive browser CSP checks. Their reports identify the
complete artifact digest and verify that files did not change during the run.

The committed [integration record](evidence/integration.json) associates these
results with implementation commit `79bdb4572350f26666179c986358b54dec21a8a4`.
Both local ZIP archives were decompressed and every file hash matched its
qualified artifact manifest. They remain historical version 2.7.3 review
packages, not the current review-fix candidate. Statuses in this table describe
that checkpoint; use the current record above for subsequent qualification.

| Gate | Historical result | Evidence and remaining work at that checkpoint |
| --- | --- | --- |
| Reproducible dependency install | Pass locally | Normal `npm ci` completes with Node 24.19.0 and npm 11.1.0; no forced or legacy peer resolution. `final-ci.log` records the clean install. Hosted CI remains pending. |
| Automated tests | Pass locally | `vue3-final-alias-full-suite.json`: 437 files, 5,040 tests passed, zero failed or skipped, including the final ESM draggable resolution. Tests use Vitest 4.1.11. This supersedes the earlier two-failure full-suite report. |
| Changed-file lint and design | Pass locally | `final-changed-lint.json` reports zero errors across 548 files. Full lint retains 116 errors versus 268 in the baseline, with zero introduced diagnostics. `final-design.log` passes the unchanged design budgets and all 56 contrast checks. The normal commit hooks also gate the final staged contents. |
| TypeScript migration regression | Pass relative to baseline | `final-types.log` reports 56 existing diagnostics and zero production SFC diagnostics. `final-type-diagnostic-comparison.json` finds zero introduced normalized diagnostics against the 242-diagnostic baseline. The full typecheck still exits with errors; it is not an absolute clean result. |
| Production translation compilation | Pass locally | All 16,839 messages across English, German, Spanish, and push catalogs compile with pinned compiler 11.4.14. Compiler, parity, and runtime tests pass. Visual locale acceptance remains open. |
| Secret and persistence compatibility | Pass in automated scope | Eight compatibility suites pass 101 tests; real store/port and IndexedDB regressions also pass. These use frozen or synthetic fixtures and do not prove an existing browser profile upgrades in place. |
| Production and beta package integrity | Pass locally, identity open | `candidate-production-artifact.json` and `candidate-beta-artifact.json` each pass with 1,168 files and eight local WASM files. Both full builds and remote-code checks pass; the TDZ guard reports 27 known and zero new observations. Public store identity remains unverified. |
| Real MV3 entrypoints and CSP | Pass in automated scope | Both `candidate-*-entrypoints/report.json` reports pass with zero CSP violations and uncaught page errors. They exercise options, the sidepanel document, translated controls, and the dashboard tab handoff. All three Help browser suites and the ESM draggable desktop/mini fixtures pass. Native browser side-panel chrome and the full provider/device matrix remain open. |
| Real background synchronization and restart | Pass in offline scope | `store-browser-final/report.json` passes 12 checks with zero page errors on the final production artifact. Production UI creates both synthetic wallets; real broadcasts, password unlock, switching, persistence, and process restart work without harness state writes. Wallet A reaches the dashboard after the existing 300-second offline safety timeout. Wallet B's first-restore dashboard and live synchronization are not certified. A saved lock is verified before restart; existing startup policy intentionally clears it when no session unlock method is configured. |
| Dependency advisories | Reviewed numbers; release decision open | `final-audit.json` records 73 findings: 19 low, 31 moderate, 23 high, zero critical. Remaining advisories need recorded owners, exposure assessment, and release disposition. This is not a clean dependency audit. |
| Stable store identity and exact candidate | Open | Local artifact reports explicitly set `identityVerified: false`. Match the intended production/beta public manifest key to the release owner's expected extension ID, then qualify the committed candidate and its retained archives. |
| In-place upgrade and forward recovery | Open | Exercise supported production profiles (including 2.7.2) and a higher-version recovery package without uninstalling. Cover supported secret formats, flag-on migration, flag-off readers, database state, browser restart, and worker termination. Follow the recovery procedure below. |
| Physical authentication and signing | Open | Test PassKey and supported Ledger, Trezor, and Keystone paths on the supported platforms and test networks. Include Cardano, Bitcoin, and Midnight where supported, cancellation/replacement while authorization is pending, and fresh approval after replacement. Mocked signing tests do not establish physical device acceptance. |
| Full UI and provider acceptance | Open | Complete desktop/narrow, locale, cached navigation, real native sidepanel, and provider integration checks across the supported chain matrix. Record any unavailable provider or platform explicitly. |
| Final review, beta observation, and publication | Open | Complete the final AI review and address findings on the candidate. Obtain the release owner's decision, run the approved beta observation period, confirm store access and lead times, then authorize V16 publication separately. No store action has occurred. |

The release owner must keep a separate record for each channel. Include the
reviewed source commit, lockfile hash, artifact report, ZIP checksum, browser
version, operating system, device/firmware versions where relevant, scenario
outcomes, and unresolved limitations. Source changes that affect the tested
behavior require refreshed evidence. Formatting this document does not make an
older package the reviewed candidate.

## Historical compatibility evidence

The compatibility run on October 13, 2026 uses Node `24.19.0` and the installed
Vue `3.5.44` / Vuetify `4.2.4` dependency graph. The eight suites below pass all
101 tests. The JSON report is saved outside the checkout at
`D:/GeroRepos/gitRepos/output/gerowallet-v01-2026-10-13/v14-compatibility-tests.json`.
The integration evidence associates these results with its committed candidate
and lockfile. The current candidate needs its own recorded compatibility checks;
this historical local run is not an immutable release artifact.

```sh
node scripts/check-secret-envelope-readers.mjs
npx vitest run --maxWorkers=1 \
  src/shared/utils/legacyCryptoJs.spec.ts \
  src/shared/utils/secretReaders.spec.ts \
  src/shared/utils/secretEnvelope.spec.ts \
  src/shared/utils/secretWriters.spec.ts \
  src/shared/utils/webauthn-prf.spec.ts \
  src/chrome/secretMigration.spec.ts \
  scripts/check-secret-envelope-readers.spec.mjs \
  scripts/remote-code-guard.spec.mjs
```

The source reader guard passes. The frozen fixtures verify legacy CryptoJS,
raw PBKDF2 root and key blobs, `gpw1` text, and purpose-bound `gpw2` secrets.
Writer and migration tests cover flag behavior, key equivalence, failed writes,
concurrent unlocks, and password rotation across related secrets. PassKey
encryption remains a separate supported path.

The Vue migration does not change database versions or encryption formats:

| Storage | Current version | Recovery requirement |
| --- | --- | --- |
| `GeroWalletDatabase` | 16 | Keep all current wallet fields and secret readers. |
| `wallet-{id}` | 11 | Preserve config, contacts, transactions, caches, and multisig records. |
| Chain cache databases | 5 | Keep chain and network scope separate. |
| Portfolio database | 1 | Preserve its existing schema. |
| Chrome local storage | Existing keys | Preserve flags, selected wallet, lock state, and scoped caches. |

The new IndexedDB boundary removes Vue proxies without JSON conversion. Its
tests preserve dates, typed arrays, maps, sets, big integers, cycles, encrypted
strings, and transaction rollback. The production store integration test uses
real stores and messages with simulated Chrome ports and IndexedDB; it does not
replace a browser-profile upgrade rehearsal.

## Package gate

The new [artifact checker](../../scripts/check-release-artifact.mjs) validates
the emitted directory before archiving. Its negative regression suite passes
18 tests. Run it after all four bundles and `build:prepare` finish:

```sh
node scripts/check-release-artifact.mjs extension \
  --expected-version "$CANDIDATE_VERSION" \
  --expected-id "$CHROME_EXTENSION_ID" \
  --report release-evidence/artifact.json
node scripts/check-bundle-tdz.mjs
```

The gate checks these properties:

- Package, lockfile, and generated manifest versions match the explicit version.
- The manifest uses MV3 and preserves the classic background IIFE format.
- Both UI pages, the worker, icons, content scripts, HTML asset references,
  web-accessible resources, and local WASM files are present.
- Production script CSP allows only local code and optional WASM compilation.
  Remote scripts, JavaScript `unsafe-eval`, duplicate CSP directives, and
  executable remote asset references fail.
- The existing remote-code guard scans emitted JavaScript and HTML, including
  copied vendor files. Dynamically constructed remote URLs still require review.
- Nested ZIP or CRX archives fail, preventing an old release from entering the
  new package. Archive outside `extension/`.
- The supplied public manifest key derives the expected extension ID. A local
  run without `--expected-id` explicitly reports identity as unverified.
- The report records permissions, host permissions, CSP, local WASM paths,
  per-file SHA-256 hashes, lockfile hash, Node version, and check time.

The historical initial check correctly rejected a shared development output
directory containing an old ZIP and incomplete assets. Prepared production and
beta directories passed the structural checker, but browser execution exposed
the CSP issue recorded above. Every subsequent candidate must pass both the
artifact checker and real extension execution. Checker regression tests alone
do not certify a package, and structural success alone does not certify its
runtime behavior.

## Release workflow behavior

The repaired [CI workflow](../../.github/workflows/ci-cd.yml) builds the selected
commit once on a hosted runner with Node `24.19.0`, npm `11.1.0`, and `npm ci`.
It runs the test suite, reader guard, sequential production build, artifact
gate, and background TDZ guard before uploading the extension and evidence.
The ZIP is outside the extension directory. A checksum file accompanies it.

For a manual run, you must supply `expected_version` matching the reviewed
package and lockfile. The repository must provide `MANIFEST_KEY` as a variable
or secret and `CHROME_EXTENSION_ID` as a variable. These must identify the
intended store channel. The build report records the source SHA, workflow run,
and beta/production channel from configuration. The CI workflow itself never
tags or releases anything.

Releases run through
[Chrome Web Store release](../../.github/workflows/chrome-web-store.yml), whose
first job calls the CI workflow on the commit being released. Later jobs in the
same run download that package and re-check provenance, channel, identity and
every file hash, including the ZIP's extracted contents. The run then executes
the full isolated gerowallet-e2e-tests suites (post-v2.7 and legacy) against
that extracted ZIP. Any failure, or a pass on retry, blocks the release. Only
after a reviewer approves the `chrome-web-store-<channel>` environment does it
create `v<version>` on that exact SHA, then upload that ZIP through the store
API v2 and submit it (staged by default). It refuses a `v<version>` tag on any
other commit. It neither bumps versions after testing nor commits to `main`,
and it never rebuilds the package after the first job. Setup and recovery are
in the [store runbook](../../.github/runbooks/chrome-web-store.md).

The authorized `dry_run=true`, `expected_version=2.7.3` hosted invocation passes.
Its run URL, tested commit, outcome, and measured runner resources are in the
[historical review-fix record](evidence/review-fixes.json). Store permissions, protected release
environments, and store acceptance remain separate release-owner checks.
The authorized dry run does not authorize `dry_run=false` or production tagging.

## Forward recovery package

Recovery is a new, higher-version package built from a compatible source
baseline. Historical `main`, an old tag, or the old ZIP in a developer output
folder is not an acceptable recovery candidate merely because its UI worked.
Follow the existing
[secret-envelope runbook](../../.github/runbooks/secret-envelope.md).

Before a rollout, prepare a recovery candidate that meets every condition:

1. Keep readers for every format already written, including `gpw2`, plus current
   database versions, fields, and storage namespaces. Never downgrade migrated
   encrypted secrets to a weaker format.
2. Run the reader guard against the recovery source ref and its working tree,
   then run the frozen readers, writers, migration, PassKey, and persistence
   suites using the recovery candidate's own lockfile.
3. Use the same store channel and extension ID as the release being recovered.
   Give the package a reviewed version higher than the failed release. Preserve
   required permissions and CSP; record any intentional difference explicitly.
4. Build all bundles and local WASM from that source, run both package guards,
   and retain the source SHA, lockfile hash, ZIP hash, and artifact report.
5. Install the release and then the forward recovery package in place in a
   disposable profile. Keep the extension key and installation directory stable.
   Do not uninstall: uninstalling destroys the state this rehearsal must verify.
6. Reopen encrypted accounts, verify addresses and scoped settings, lock and
   unlock, change the spending password, reopen again, and perform supported
   test-network signing on Cardano, Bitcoin, and Midnight. Exercise password,
   PassKey, and relevant hardware paths. Use synthetic wallets only.
7. Recheck those wallets after worker termination and browser restart. Test
   flag-on migration and flag-off recovery; already migrated wallets must remain
   readable when `isKeyEnvelopeV2Enabled` is turned off.

Turning off that flag stops new migrations; it does not undo prior writes.
Do not ask users for passwords, phrases, private keys, or encrypted blobs when
collecting recovery evidence. The existing runbook's format labels and outcome
counters are the appropriate diagnostic output.

## Remaining release acceptance

Keep V14 open until evidence exists for both the release and recovery packages.
The local work above does not establish the following external acceptance:

- A clean final package passes all gates at the final reviewed commit.
- Disposable-profile in-place upgrade and forward recovery pass with stable
  identity, real background login, persistence, and all supported secret formats.
- The named release owner and escalation contact have the artifact location,
  channel ID, submission access, and post-install verification checklist.
- The store's review lead time and rollout capabilities are confirmed for the
  December 23, 2026 target and December 31, 2026 deadline. Use the approved beta
  channel if controlled percentage rollout is unavailable.
- Exact-candidate integration, hardware, supported-platform, and real browser
  evidence from V13/V15 is attached before V16 publication authority is used.
