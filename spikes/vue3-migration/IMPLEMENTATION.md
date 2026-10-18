# Vue 3 migration implementation and verification

The Vue 3/Vuetify 4 migration merged in
[PR #1302](https://github.com/Gero-Labs/gerowallet/pull/1302), followed by
[PR #1305](https://github.com/Gero-Labs/gerowallet/pull/1305). Development at
`1a4d50ac5e1d51fc9a3601a63808c79f839ff6b2` includes those changes and PR #1306.
The package remains `2.7.3`; implementation acceptance is separate from
production release authorization under [epic #1282](https://github.com/Gero-Labs/gerowallet/issues/1282).

## Current handoff — October 18, 2026

[MAINTENANCE.md](../../MAINTENANCE.md) provides current commands, ownership,
dependency cadence, and follow-up debt. The
[dated evidence](evidence/maintenance-2026-10-18.json) records a fresh normal
install, 5,239 passing tests across 466 files without skips, four production
bundles, and a packaged Chromium entrypoint smoke. Type checking still reports
54 diagnostics and ESLint 112 errors; neither is represented as passing.

The artifact uses a synthetic public manifest key. Offline browser smoke does
not qualify store identity, physical devices, providers, profile upgrades, or
rollout. Those remain in the open tickets below. Historical JSON records are
preserved; their candidate hashes and run results do not transfer to newer code.

The [review response](REVIEW-RESPONSE.md) and
[review-fix evidence](evidence/review-fixes.json) describe the earlier October
13–14 review sequence. Use them for historical provenance, not as the latest
candidate record. Remote run links in old records were not requalified by this
documentation update.

## Historical integration evidence

The [integration evidence](evidence/integration.json) pins implementation commit
`79bdb4572350f26666179c986358b54dec21a8a4`, the lockfile, test reports, both
complete artifact manifests, and verified ZIP hashes. It preserves the original
local-only qualification scope. The subsequent review fixes change production
code, so this record does not certify the current candidate.

## Ticket coverage

The October 18 ticket audit closed verified implementation scope. Outstanding
device, profile, provider, and release criteria remain with their owning
tickets; closing implementation tickets does not mark those criteria complete.

| Ticket | Status and remaining scope |
| --- | --- |
| [V01: dependency/pilot decision #1283](https://github.com/Gero-Labs/gerowallet/issues/1283) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V03: build toolchain #1285](https://github.com/Gero-Labs/gerowallet/issues/1285) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V04: bootstrap/router #1286](https://github.com/Gero-Labs/gerowallet/issues/1286) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V05: reactive stores #1287](https://github.com/Gero-Labs/gerowallet/issues/1287) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V06: i18n #1288](https://github.com/Gero-Labs/gerowallet/issues/1288) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V07: shared controls #1289](https://github.com/Gero-Labs/gerowallet/issues/1289) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V08: authentication/approvals #1290](https://github.com/Gero-Labs/gerowallet/issues/1290) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V09: wallet screens #1291](https://github.com/Gero-Labs/gerowallet/issues/1291) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V11: ancillary features #1293](https://github.com/Gero-Labs/gerowallet/issues/1293) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V12: integration cleanup #1294](https://github.com/Gero-Labs/gerowallet/issues/1294) | Closed: verified implementation; release acceptance retained in open gates below. |
| [V02 #1284](https://github.com/Gero-Labs/gerowallet/issues/1284) | Open: full coverage and prerequisites. |
| [V10 #1292](https://github.com/Gero-Labs/gerowallet/issues/1292) | Open: vault transfers intentionally disabled pending provider capability. |
| [V13 #1295](https://github.com/Gero-Labs/gerowallet/issues/1295) | Open: final exact-candidate qualification. |
| [V14 #1296](https://github.com/Gero-Labs/gerowallet/issues/1296) | Open: channel identity, supported-profile upgrade and recovery. |
| [V15 #1297](https://github.com/Gero-Labs/gerowallet/issues/1297) | Documentation handoff prepared; closes after review/merge. |
| [V16 #1298](https://github.com/Gero-Labs/gerowallet/issues/1298) | Open: beta, submission, and production rollout. |
| [Maintenance #1313](https://github.com/Gero-Labs/gerowallet/issues/1313) | Open: type/lint diagnostic remediation. |
| [Maintenance #1314](https://github.com/Gero-Labs/gerowallet/issues/1314) | Open: advisory triage and coordinated dependency updates. |

## Implementation decisions

The Vuetify 3 checkpoint remains a reproducible pilot. The production conversion
goes directly to the tested Vuetify 4 target. Existing Options API components
remain supported; there is no application-wide Composition API rewrite. The
vendored swap custom element remains an independently bundled local dependency.

Router 4 guards use the hydrated store, and cached views keep their activation
and deactivation behavior. Native Vuetify controls use `modelValue` and
`update:modelValue`; forms await the validation result's `valid` field. Table
sorting, expansion, raw row events, selection keys, and server pagination are
adapted explicitly. Immutable native-library objects and WASM builders avoid
Vue deep proxies. Compatibility styles preserve existing grid breakpoints,
spacing, typography and color aliases while controls use Vuetify 4.

Vue I18n compiles each production message into local message functions during the build. Runtime
pages and the background use local precompiled resources. Literal `@` characters
are escaped in source messages, preserving their rendered copy. Key/placeholder
parity tests remain separate from the exhaustive parser check.

Approval scopes invalidate synchronously when the original transaction, request,
wallet, network, authentication context, lock state or relevant dialog lifecycle
changes. Each asynchronous boundary checks freshness before dispatch and after
completion. A new approval is required for a replacement. Returned stale key
bytes are wiped. Keystone responses must match their generated request IDs;
Bitcoin PSBT responses must retain the approved unsigned transaction. An atomic
signing call already dispatched to a worker or device cannot be recalled by a
UI guard; later submission and result delivery remain guarded.

Storage schemas and encrypted formats are preserved. Serialization removes
proxies without converting dates, typed arrays, maps, sets or big integers to
JSON-shaped substitutes. The frozen legacy, gpw1, gpw2 and PassKey compatibility
tests remain mandatory. See [release and recovery readiness](RELEASE-READINESS.md).

## Historical integration qualification

For current reproduction, use [MAINTENANCE.md](../../MAINTENANCE.md), including
build-generated declarations before type checking. The commands and counts
below describe the original integration checkpoint.

That checkpoint used Node 24.19.0 and npm 11.1.0. The integration uses Vitest/UI 4.1.11 because the
initial 3.2.7 graph retained disclosed test-tool vulnerabilities. The final
lockfile also resolves the compatible shell-quote fix. npm 10 and 11 hit an
Arborist error while resolving that development-tool update; npm 12.2.0 generated
the lock, followed by a successful normal `npm ci` with npm 11.1.0, including
installation scripts. No forced peer resolution or legacy-peer mode is used.

```sh
npm ci
npm test -- --maxWorkers=2
npm run typecheck
npm run typecheck:ts
npm run design:check
npm run build
node scripts/check-secret-envelope-readers.mjs
node scripts/check-bundle-tdz.mjs
node scripts/check-release-artifact.mjs extension --expected-version 2.7.3 --report artifact.json
```

Use the changed-file ESLint gate enforced by the normal pre-commit hook. Full
repository lint and TypeScript have measured pre-existing debt; a failing
baseline is not a passing check. Evidence must record both full results and
introduced diagnostics. The new Vue-aware check also checks
production component templates and their contracts.

The historical integration run passed all 5,040 tests across 437 files with zero
skips. Full ESLint retained 116 errors versus 268 in the baseline; the Vue-aware
check retained 56 TypeScript errors versus 242 baseline diagnostics. Both
comparisons found zero introduced diagnostics, and production SFCs had none.
Changed-file lint, the unchanged design budgets, and all 56 contrast checks
passed. The [review-fix record](evidence/review-fixes.json) preserves the subsequent
review checkpoint; the October 18 ledger above is the current local baseline.

`typecheck` now uses `vue-tsc`; `typecheck:vue` is an explicit alias. The older
TypeScript-only command remains available as `typecheck:ts` for baseline
comparison. Plain `tsc` cannot resolve the component templates and is not the
authoritative Vue 3 component check.

Builds run sequentially to control the memory peak of the chain SDK bundles.
The background stays a classic IIFE worker. Vite's module-preload helper is
disabled there, and CommonJS conversion uses Vite's integrated plugin. One
existing TDZ baseline fingerprint changed when tree shaking reduced the exports
of the unchanged Midnight unshielded-wallet namespace to
`UnshieldedSectionSchema,createKeystore`. Its pre-initialization access remains
an existing deferred factory access; it is not a new waiver or a claim that all
historical TDZ observations were removed. The guard must still reject new
fingerprints.

The shipped Vue alias selects the runtime-only module. Draggable resolves its
published ESM source instead of its UMD bundle: the UMD global detection attempted
`Function()` at startup under MV3 CSP. Browser entrypoint checks listen for CSP
violations as well as uncaught errors and hash the exact artifact being tested.
The test harness retains Vue's template compiler for test stubs; it is not shipped.

The October 13 dependency audit fell from 89 findings, including three critical,
to 73 findings with zero critical (19 low, 31 moderate, 23 high). The remaining
findings are inherited dependency debt, not a clean security bill. Raw reports
are retained with the local evidence. No broad forced SDK update was performed.

## Delivery and review

The confirmed team is the user and Codex. Codex owns implementation and automated
verification; the user owns product/release decisions and access to physical
devices and store accounts. Parallel agents improve local coverage but are not
three committed engineering lanes. The original 74–116 person-day estimate is
historical risk context, not measured assistant throughput.

The target remains December 23, 2026, with December 24–31 reserved for store
delays and recovery. Retain a separate 20% effort reserve for review fixes and
regressions. Its calendar allocation depends on measured review and external
test turnaround; this implementation does not invent the user's availability
or promise that the reserve is funded. Review-fix acceptance and the first
physical test matrix are the next forecast checkpoints.

Prioritize review of signing freshness and QR correlation, serialized wallet
data, background bundling, router/KeepAlive behavior, native forms/tables, and
the exact-artifact release workflow. Keep physical device evidence, existing
encrypted-profile upgrade/recovery, full platform coverage, exact-package
channel identity, and submission authority as explicit release gates. The
branch must not be presented as production-qualified until those gates pass.
