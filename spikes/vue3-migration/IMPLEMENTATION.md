# Vue 3 migration implementation and verification

The local branch `migration/vue3-vuetify4` migrates GeroWallet 2.7.3 from Vue 2
and Vuetify 2 to native Vue 3.5.44 and Vuetify 4.2.4. Its base is development
commit `50e0bcfe6ca8a6bace23f2a0010bad6d278b2d1a`. The package version remains
2.7.3 for local review; this is not a store release or a version bump.

This work implements [epic #1282](https://github.com/Gero-Labs/gerowallet/issues/1282).
The user requested a local PR, continued implementation without intermediate
approval, and an AI review at the end. No branch, PR, tag, or package has been
published. Acceptance below distinguishes implemented work from device and
release evidence that still needs to be collected.

The [integration evidence](evidence/integration.json) pins implementation commit
`79bdb4572350f26666179c986358b54dec21a8a4`, the lockfile, test reports, both
complete artifact manifests and verified ZIP hashes. Later evidence/document
updates leave that tested production code unchanged.

## Ticket coverage

| Ticket | Local implementation and evidence | Remaining acceptance |
| --- | --- | --- |
| [V01 #1283](https://github.com/Gero-Labs/gerowallet/issues/1283) | Frozen dependency/inventory baseline; independent Vuetify 3 and 4 pilots, each with 14 passing browser checks. | Review target and final forecast. |
| [V02 #1284](https://github.com/Gero-Labs/gerowallet/issues/1284) | Vue Test Utils 2 harness, reconciled legacy explorer expectations, deterministic timeout test, migrated browser fixtures, new real-control regression tests. | Complete supported-platform and encrypted-profile matrix. |
| [V03 #1285](https://github.com/Gero-Labs/gerowallet/issues/1285) | Node 24.19, Vite 7.3.7, Vue plugin, normal peer resolution, clean lockfile install, all four extension build configurations. | Hosted CI run on the reviewed commit. |
| [V04 #1286](https://github.com/Gero-Labs/gerowallet/issues/1286) | Both createApp roots, Router 4, late hydration guards, query handling, RouterView/KeepAlive conversion, real away/back lifecycle tests. | Supported-browser smoke at the reviewed candidate. |
| [V05 #1287](https://github.com/Gero-Labs/gerowallet/issues/1287) | Reactive stores; proxy-safe Chrome and Dexie boundaries; real store/port integration without published-state overrides; persistence and rollback tests. | In-place browser-profile upgrade and recovery rehearsal. |
| [V06 #1288](https://github.com/Gero-Labs/gerowallet/issues/1288) | I18n 11.4.14 runtime-only build; exhaustive production-compiler pass over 16,839 messages; literal-at-sign escaping; locale/plural tests. | Visual locale sweep at narrow and desktop widths. |
| [V07 #1289](https://github.com/Gero-Labs/gerowallet/issues/1289) | Shared model/emits, activators, inputs, overlays, toast replacement, numeric steppers, responsive/theme compatibility. | Final visual review. |
| [V08 #1290](https://github.com/Gero-Labs/gerowallet/issues/1290) | Awaited form validation, approval freshness through async boundaries, single-flight signing, stale key wiping, correlated QR responses and Bitcoin unsigned-transaction matching. | Physical PassKey and hardware signing on supported test networks. |
| [V09 #1291](https://github.com/Gero-Labs/gerowallet/issues/1291) | Dashboard, assets, contacts, send/history, market tables, sidepanel and draggable library migrated; browser drag/persistence regressions. | Full three-chain visual and transaction matrix. |
| [V10 #1292](https://github.com/Gero-Labs/gerowallet/issues/1292) | Swap custom-element boundary preserved; perps/earn/vault controls and native tables migrated. | Live provider integration and test-network transaction acceptance. |
| [V11 #1293](https://github.com/Gero-Labs/gerowallet/issues/1293) | Staking, governance, pool registration, card and Help controls migrated; real pool/relay and Help navigation regressions. | Provider/device checks and final visual review. |
| [V12 #1294](https://github.com/Gero-Labs/gerowallet/issues/1294) | Vuetify 4 final runtime; Vue 2 host plugins/compiler/decorators removed; no compat runtime. | Final AI review of coordinated migration. |
| [V13 #1295](https://github.com/Gero-Labs/gerowallet/issues/1295) | Automated suite, source/type baseline comparison, production browser checks and artifact qualification. | External matrix and exact-reviewed-candidate acceptance. |
| [V14 #1296](https://github.com/Gero-Labs/gerowallet/issues/1296) | Artifact/version/CSP/WASM/hash checker and negative tests; compatible secret-reader suites; tested-artifact release workflow and forward-recovery runbook. | Stable store identity, real profile upgrade/recovery, release-owner access. |
| [V15 #1297](https://github.com/Gero-Labs/gerowallet/issues/1297) | Contributor/runtime/API guidance, implementation ledger and release/recovery instructions. | Final reviewer handoff and platform evidence. |
| [V16 #1298](https://github.com/Gero-Labs/gerowallet/issues/1298) | Local release preparation only; manual workflow defaults to dry run and cannot rebuild or mutate the tested source before tagging. | Beta distribution, observation, store submission and rollout. |

No issue is automatically closed by this local implementation. In particular,
an integration-branch change is not equivalent to a store rollout.

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

## Reproduce local qualification

Use Node 24.19.0 and npm 11.1.0. The integration uses Vitest/UI 4.1.11 because the
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
baseline is not a passing check. The final evidence records both full results
and the absence of introduced diagnostics. The new Vue-aware check also checks
production component templates and their contracts.

The final automated run passes all 5,040 tests across 437 files with zero skips.
Full ESLint retains 116 errors versus 268 in the baseline; the Vue-aware check
retains 56 TypeScript errors versus 242 baseline diagnostics. Both comparisons
find zero introduced diagnostics, and production SFCs have none. Changed-file
lint, the unchanged design budgets, and all 56 contrast checks pass.

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
or promise that the reserve is funded. The AI review and first physical test
matrix are the next forecast checkpoints.

Prioritize review of signing freshness and QR correlation, serialized wallet
data, background bundling, router/KeepAlive behavior, native forms/tables, and
the exact-artifact release workflow. Keep physical device evidence, existing
encrypted-profile upgrade/recovery, full platform coverage, store identity and
submission authority as explicit release gates. The local branch must not be
presented as production-qualified until those gates pass.
