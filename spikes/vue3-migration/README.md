# Vue 3 migration pilot

This is the frozen V01 experiment and Vue 2 baseline record. The production
migration now lives on `migration/vue3-vuetify4`; see
[implementation and verification](IMPLEMENTATION.md) for its scope and results.
Statements below about unchanged production dependencies describe the V01
checkpoint, not the current integration branch.

This isolated extension supports [V01](https://github.com/Gero-Labs/gerowallet/issues/1283)
of [the migration epic](https://github.com/Gero-Labs/gerowallet/issues/1282).
It proves selected framework contracts before the production wallet changes.
It does not contain a wallet, real signing, production accounts, or chain SDKs.

The local integration branch is **migration/vue3-vuetify4**. The first review
branch, **migration/v01-foundation-pilot**, starts from development commit
50e0bcfe6ca8a6bace23f2a0010bad6d278b2d1a (GeroWallet 2.7.3).
That includes the explorer-selection change merged after the original audit
at ec6b105693858ccc2ef1562aecb43d407a76210b.

## Review scope

The production Vue 2 dependency files and shipped entrypoints stay separate
from the pilot's independently locked packages. Review these deliverables:

- [Dependency decisions](dependency-matrix.json): current locked versions,
  exact target versions, peer requirements, consumers, and migration owners.
- [Source inventory](inventory.json): every tracked production Vue component,
  its primary work package, routes, feature guards, and audit drift.
- [Capacity and ownership](capacity.json): the user-confirmed execution model
  and the remaining scheduling decisions.
- [Vue 2 baseline results](evidence/baseline.json): exact commands, outcomes,
  failure classification, and report/artifact hashes.
- [Vuetify 3 pilot evidence](evidence/pilot-vuetify3.json) and
  [Vuetify 4 pilot evidence](evidence/pilot-vuetify4.json): the 14 passing
  browser checks per target, runtime versions, and input/artifact hashes.
- The source, build runner, and browser checks in this directory.
- Baseline and pilot evidence described below.

V01 remains open until its technical evidence, ownership, and forecast are
reviewed. A passing small pilot cannot establish complete wallet parity.
V02 supplies the full application baselines and upgrade fixtures; V03–V12
convert and integrate production code; V13 qualifies the release candidate.

## Run the pilot

Use Node 24.19.0 for this recorded experiment. The machine's original Node
20.11.0 and the repository's current CI Node 22.11.0 are below the selected
Vite 7 toolchain's minimum patch versions. V03 must update the migration
toolchain runtime and CI together.

The browser runner resolves the pinned Playwright package from each target.
Install its Chromium browser on a fresh machine after installing the target:

~~~sh
npm run ci:vue3
npm exec --prefix targets/vuetify3 -- playwright install chromium
~~~

An existing Playwright installation can be supplied through the optional
PILOT_PLAYWRIGHT_PATH variable. The report records the actual library and
browser versions; use those versions when reproducing evidence.

Run from this directory:

~~~sh
npm run ci:vue3
npm run typecheck:vue3
npm run build:vue3
npm run test:vue3

npm run ci:vuetify4
npm run typecheck:vuetify4
npm run build:vuetify4
npm run test:vuetify4
~~~

The two targets have independent lockfiles. Keep their versions pinned when
comparing the Vuetify 3 checkpoint with Vuetify 4. Do not use forced peer
resolution or replace the production wallet lockfile with either pilot lock.

Both targets passed clean installation, isolated typechecking, production
builds, and all 14 browser checks on October 13, 2026. Both recorded npm
audits reported zero vulnerabilities. Runtime evidence uses Node 24.19.0,
Playwright 1.62.1, and Chromium 151.0.7922.34 on Windows. The source and
lockfile hashes in each report identify the tested inputs.

The browser checks load a fresh, disposable unpacked extension profile.
They exercise both options and sidepanel entry documents under an MV3
production script policy. Treat opening the sidepanel document at its narrow
viewport as entrypoint evidence, not as proof of the browser's side-panel
chrome or the production sidepanel integration.

## What this pilot can prove

The experiment covers framework integration and the following contracts:

- Independent application roots and Router 4 guards.
- A real Vuetify form with asynchronous validation and invalid/pending states.
- Dialog rendering, locale changes, and cached-route lifecycle.
- Background-owned synthetic state reaching both application roots through
  real extension messages and broadcasts.
- Compiler recognition and DOM properties/events for a native gero-swap
  element. The pilot element is a labeled contract stub.

Production signing, authentication, storage schemas, chain SDK/WASM loading,
the vendored swap runtime, full translation catalogs, and migrated production
components remain separate acceptance requirements in their owning tickets.
The pilot must not be presented as proof that those paths have migrated.

## Evidence and baseline

Evidence must identify the source revision, dependency versions, runtime,
commands, results, and artifact hashes. Keep generated browser profiles,
builds, screenshots, and raw test logs out of Git. Use only synthetic state.

The baseline uses a clean disposable copy of development with its original
Vue 2 lockfile. It records clean installation, tests, production extension
builds, design checks, lint, and typechecking separately. Existing failures
are reported as failures, with owning follow-ups; they are not relabeled as
passing because they predate the migration.

The October 13 Windows run used Node 24.19.0 and npm 10.2.4:

| Check | Recorded result |
|---|---|
| Clean install | Passed; 1,766 packages |
| Design audit and contrast | Passed |
| Full unit/component suite | 413 files; 4,826 of 4,829 tests passed |
| Production extension builds | Background, content, inject, web, and prepare passed |
| Full-repository lint | 268 existing errors |
| Root typecheck after build | 242 existing errors |

Two legacy explorer assertions fail consistently and contradict the newer
explorer tests. The cross-device timeout test failed under the full run but
passed twice in isolation. V02 owns reconciliation and timing hardening;
the initial full-suite result remains failed.

The initial archive-only install exposed an upstream Windows postinstall that
expects a Git directory. Initializing the disposable baseline as a Git
repository allowed clean npm ci to succeed. The normal checkout already has
that Git context. No dependency bypass was used.

The repository has no preflight or format npm script. Its actual contributor
gates are changed-file ESLint, design checks, relevant tests, and production
builds. Full-repository lint/typecheck results are useful baseline evidence
but have existing debt, as documented in CONTRIBUTING.md.

## Source ownership and changes from development

Regenerate the inventory from a committed source revision with the root
repository dependencies installed:

~~~sh
node spikes/vue3-migration/inventory.mjs --ref <source-commit>
node spikes/vue3-migration/inventory.mjs --check
~~~

Every component has one primary work package. Shared security controls still
require the signing reviewer and consumer coordination described by V08.
Logical work-package ownership does not imply an assigned engineer:
Codex implements the queue and the user reviews it.

Sync development weekly and before accepting each ticket. Record the new SHA,
regenerate the inventory, allocate new routes/files, and review conflicts
explicitly. Do not silently carry a previous inventory over newly merged UI
changes.

## Integration and acceptance

The local branch names above are not remote branches and do not have a CI
run merely because they exist. The existing workflows target development
and main. Before using a remote integration branch, V03 must add an explicit
intermediate CI profile and verify its branch rules.

Intermediate acceptance requires clean install, changed-code lint and type
checks, relevant unit/component tests, production/beta pilot builds,
background/content/inject contracts, and applicable CSP/TDZ checks.
List unavailable full-UI checks, their owner, and their restoration checkpoint.
An unavailable or failing full-app check is not a successful pilot check.

Development currently requires four checks, an approving review, an up-to-date
branch, and resolved review conversations:

- Production bundle (SFC parse).
- npm ci (lock in sync).
- ESLint flat config loads.
- Ledger tests and extension bundles.

Keep those protections. Accept scoped work on the integration branch with a
reviewed SHA, linked PR or local review, and exact-commit evidence. Then close
the native ticket and mark it Done to unblock dependents. Full application
gates return in V12/V13 before development integration; V16 owns production
verification. Local preparation alone does not close a ticket.

## Delivery model

The user confirmed that the team is the user and Codex. The previous
three-engineer-plus-QA scenario is superseded. The 74–116 person-day estimate
is a human-team workload reference, not a prediction of assistant throughput.

Keep December 23, 2026 as the rollout target and December 31 as the completion
objective. Calibrate the forecast after this pilot and the first production
conversion, including user review, hardware checks, CI, and store lead times.
Allocate the 20% effort reserve explicitly; do not count the December 24–31
calendar buffer as the same reserve.

No weekly user hours or workweek have been assumed. Unmeasured capacity and
unconfirmed hardware/release access remain open decisions in V01.

## Browser and performance coverage

The automated pilot records its Chromium version on Windows. It is one
tested environment, not a supported-browser declaration. The existing
manifest has no explicit minimum Chrome version; V01/V02 must confirm the
supported Chrome/Chromium and OS matrix from actual release requirements.
Hardware and native passkey checks need the corresponding real devices.

V02 must collect full-wallet options/sidepanel cold start, worker startup,
bundle sizes, balance/list updates, and memory after repeated navigation
on fixed hardware and an exact SHA. Pilot measurements must remain separate.
Agree release budgets against those baselines before claiming improvements.
