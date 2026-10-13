# Vue 3 migration review fixes

Commit `4f57b4fb` addresses the source findings in the review of `d80397b5`.
Commit `020c7805` also repairs a navigation drawer crash found by populated-wallet
browser testing. The branch `migration/vue3-vuetify4` is pushed with the user's
authorization. Hosted CI passes all 5,076 tests across 445 files; the preceding
local full run passes 5,075 tests before the added packaging regression. The
[evidence record](evidence/review-fixes.json) pins the tested source, package
hashes, browser results, and hosted workflow outcome.

## Findings and verification

Each row corresponds to the numbered finding in the supplied review document.

| Item | Resolution | Evidence |
| --- | --- | --- |
| 1. Reactive asset cloning | Deep-unwrap both network assets and token-registry metadata before `structuredClone`. Preserve independent returned objects and native value types. | Four regressions reproduce `DataCloneError` before the fix, including nested proxies, fungible tokens, NFT metadata, and CIP-68 registry decimals. The final full suite passes. |
| 2. Midnight column headings | Use native Vuetify `title`/`key` headers and existing translated labels for all nine columns. | Real Vuetify mounts reproduce blank headings before the fix, then verify English/German/Spanish headers, token rows, balance updates, and network changes. Source audit found no other legacy table header objects. |
| 3. Decline during device signing | Restore the SignTx button's `txSignLoading` disabled binding. Keep freshness checks when the wallet, network, lock, or component lifecycle changes. | Fifteen component tests cover pending Ledger, Trezor bridge, and Trezor WebUSB calls, decline after device failure, and discarded late results. The guard does not claim to abort a device transport. |
| 4. Hosted build capacity | Remove the production build's forced 6 GB heap. Honor the caller's `NODE_OPTIONS`; CI sets 4 GB old space and 128 MB semi-space. Record effective Node heap and Linux resource measurements in workflow artifacts. | Clean local production and beta builds pass in 98.60 and 100.37 seconds. Hosted build passes in 125.05 seconds with reported maximum RSS of 4,496,548 KiB (about 4.29 GiB). |
| 5. Blockchain database boundary | Delegate WalletBg to the shared chain/network-specific opener and remove its module singleton. | Real IndexedDB tests cover nested reactive writes, network isolation, reopen behavior, and unavailable-database errors. No schema changes. |
| 6. Repeated locale compilation | Cache in-flight and completed per-locale compilation, share push-catalog reads, reset on build/watch changes, and keep exhaustive build-start validation. | Seven new regressions include real Rollup watch edits, broken unimported catalogs, recovery, and concurrent loads. All 16,839 messages still compile. |
| 7. Redundant store serialization | Remove the outer JSON serialization from both GeroStore persistence paths. | Immediate and debounced tests preserve bigint/Map/Set serialization and detached nested values. |
| 8. Prefix runtime aliases | Match bare Vue/i18n specifiers exactly and retain the background-specific alias exclusions. | Real Vite resolution checks cover four configurations, bare imports, and valid Vue/i18n subpaths. Both packaged app entrypoints pass CSP checks. |

The changed files pass ESLint and the normal commit hooks. Design budgets and
all 56 contrast checks pass. Vue-aware type checking retains the same 56
diagnostics as `d80397b5`, with no new diagnostics. Independent read-only passes
over the fixes found no additional actionable regressions.

The populated-wallet console observer also caught a setup-time access to
`$vuetify.display` before Vuetify's options mixin installed it. The drawer now
uses native `useDisplay()` and `useTheme()` injections. Two real Vuetify/Router
regressions fail on the original code, then pass alongside the existing drawer
tests: 22 tests cover mounting, theme changes, navigation, and mobile behavior.
The repository audit found no other setup-time `$vuetify` access.

Clean hosted packaging exposed another existing mismatch: production copied
notification images under `public/notifications/`, while the manifest and
background worker requested them under `public/`. The copy target now matches
those runtime URLs. A regression executes the real copy hook in an empty output
directory and compares the emitted images with their tracked source bytes.
The workflow retains diagnostic reports even when a validation gate fails.

## Runtime and hosted acceptance

Production and beta packages each contain 1,163 files and eight local WASM
files. Both package checks, configured channel identity checks, and remote-code
guards pass. Their TDZ checks retain 27 known observations and introduce none.
Both actual extension entrypoint
checks report zero CSP violations or uncaught page errors. Every ZIP entry was
independently decompressed and matched to its qualified artifact checksum.

The user supplied a public mainnet address for read-only populated-wallet
qualification. The browser harness uses a fresh profile with one public Watch
record, followed by real production login, sync, database loading, and store
broadcasts. It never pins asset fields or supplies a spending credential.
All five local checks pass: public login and sync, dashboard and drawer,
transaction history, expanded token details, and approval presentation from an
already-confirmed transaction. The run observes 883 history entries, three
holdings rows, and two metadata assets, with zero page or runtime console errors.
The approval check never signs or submits. A bounded worker-schema readiness
guard fixes the harness's initial seeding race; the failed setup attempts remain
in local evidence. Restricted third-party hosts limit fiat-price and image
coverage. The final runtime record identifies the exact artifact tested.
The downloaded Linux CI artifact independently passes the same five checks and
both extension entrypoints, with zero runtime errors or CSP violations. Its full
artifact hash remains unchanged throughout both browser runs. Screenshots are
visually inspected. Public wallet identifiers, balances, transaction details,
and screenshots stay outside the committed evidence.
The live address currently has no NFT collections; synthetic reactive NFT
regressions do not substitute for populated live NFT acceptance.

The production public key in the existing `.env.production` derives
`bgpipimickeadkjlklgciifhnalhdjhe`, matching the canonical store link. The required
GitHub identity settings now use those verified existing values. Public runtime
settings and the existing MoonPay publishable key preserve production behavior;
no private signing key is used. The workflow also now forwards the existing
Google OAuth client ID and CIP-45 default, which its env-writing step omitted.

The authorized invocation is:

```sh
gh workflow run ci-cd.yml --repo Gero-Labs/gerowallet \
  --ref migration/vue3-vuetify4 -f dry_run=true -f expected_version=2.7.3
```

The [first hosted run](https://github.com/Gero-Labs/gerowallet/actions/runs/38422687595)
passed all 5,075 tests and the production build, then correctly rejected the
missing notification image. Its failure record is preserved. The
[replacement dry run](https://github.com/Gero-Labs/gerowallet/actions/runs/38424347669)
uses packaging commit `e872dd0928e9a4302cbe3fe6bc123080b98b0363`. Both local
channels are rebuilt from empty output directories for this revision. See the
evidence record for the replacement run's successful result and memory metrics.
The hosted clean install, all 5,076 tests, secret reader guard, build, artifact
identity/integrity checks, and uploads pass. The publish job is skipped.
Both runs use `dry_run=true`; tagging and store submission remain separate.
Later commit `0cd2fa9c` only hardens browser-test setup. Subsequent documentation
and evidence commits do not change the tested production code or build inputs.

The review's 7 GB runner assumption does not apply to this public repository:
GitHub documents 16 GB for standard public-repository Linux runners. The actual
runner reports 16,765,374,464 bytes of RAM. Node reports a 4,697,620,480-byte
effective heap limit with the configured old-space/semi-space flags. See
[GitHub's runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The intermediate web build took 49.57 seconds, versus 47.60 seconds in the earlier
candidate log. These runs used different heap settings and concurrent workloads;
they are not a controlled performance comparison. Cache tests establish that
each locale is compiled once per build instead of repeatedly for virtual loads.

## Remaining gates

The review's code fixes and hosted dry run pass. Keep final acceptance open for
the live populated-NFT check and the remaining release matrix. Authentication and
hardware, existing-profile upgrade/recovery, provider/platform coverage, stable
channel ownership, and publication remain the release gates described in
[release readiness](RELEASE-READINESS.md).

An unrelated existing CIP-68 behavior was observed during regression work:
the resolver checks an index on `onchain_metadata_extra` before parsing the JSON
string, so short metadata payloads can be skipped. This review fix preserves
that behavior; it needs a separately scoped correction and acceptance check.
