# Maintenance and verification

This is the contributor handoff for [V15 #1297](https://github.com/Gero-Labs/gerowallet/issues/1297).
The October 18, 2026 baseline is development commit
`1a4d50ac5e1d51fc9a3601a63808c79f839ff6b2`, after merged PRs #1302, #1305,
and #1306. It does not certify a production release.

## Measured baseline

The [machine-readable ledger](spikes/vue3-migration/evidence/maintenance-2026-10-18.json)
contains the lockfile hash, commands, report hashes, individual type/lint
diagnostics, dependency advisory URLs, and evidence limits. Checks used a fresh
normal install with scripts enabled, Node 24.19.0, npm 11.1.0, and Windows x64.
No forced or legacy peer resolution was used.

| Check | Result | Interpretation |
| --- | --- | --- |
| `npm ci` | Pass | Lockfile installs normally with scripts |
| `npm run dev` | Pass | Manifest, three watched bundles, HTTP 200 UI; no live backend |
| Full Vitest suite, two workers | 5,239 passed; 466 files; zero failures/skips | Unit/integration coverage selected by Vitest |
| Four production bundles and preparation | Pass | Synthetic public manifest key; public/empty service settings |
| Packaged browser smoke | Pass, Chromium 151.0.7922.34 | Options, sidepanel document, dashboard handoff; no page errors/CSP violations |
| Artifact guard | 1,162 files and eight local WASM files pass | Store identity not verified |
| Design and contrast | 15 metrics and 56 checks pass | Existing budgets unchanged |
| Secret readers and remote-code guard | Pass | Static compatibility and emitted-code checks |
| TDZ guard | 27 known, zero new | Five existing export fingerprints changed; baseline not rewritten |
| Vue-aware type check, after declaration generation | **54 errors** | Failing historical diagnostic baseline |
| Repository ESLint | **112 errors in 31 files**, zero warnings | All `@typescript-eslint/no-explicit-any` |
| `npm audit` | **73 affected dependency nodes** | 19 low, 31 moderate, 23 high, zero critical |

Audit totals are not unique-advisory or exploit counts. Registry results change
over time. A green build does not waive advisories or diagnostics. Compare
path/code/message identities, not only totals: fixing one old error must not
hide a new one elsewhere.

The browser smoke blocks external requests and uses a disposable profile. It
does not exercise native side-panel chrome, physical devices, funded wallets,
live providers, or an existing production profile.

## Ownership and follow-up

The existing [capacity model](spikes/vue3-migration/capacity.json) assigns
implementation and automated verification to Codex during authorized sessions,
and review, product/release decisions, and external access to Adam
([@adamcazes](https://github.com/adamcazes)). It does not imply continuous
background work, additional staffing, or a committed delivery date.

| Work | Accountable owner | Disposition and acceptance |
| --- | --- | --- |
| [#1313: type/lint debt](https://github.com/Gero-Labs/gerowallet/issues/1313) | Adam; Codex implementation | Repair by subsystem, clean every touched code file, preserve behavior, refresh diagnostics; no suppression or weakened config |
| [#1314: dependency advisories](https://github.com/Gero-Labs/gerowallet/issues/1314) | Adam; Codex implementation | Triage reachability and remediation per advisory, coordinate SDK peers, retain explicit no-fix/deferral rationale |
| [#1284: coverage/baselines](https://github.com/Gero-Labs/gerowallet/issues/1284) | Adam; Codex automation | Resolve scenario exclusions, live prerequisites, and missing coverage |
| [#1292: vault capability](https://github.com/Gero-Labs/gerowallet/issues/1292) | Adam; Codex implementation | Restore transfers only with supported provider capability and acceptance evidence |
| [#1295: final qualification](https://github.com/Gero-Labs/gerowallet/issues/1295) | Adam | Exact-candidate device, platform, provider, accessibility, and performance acceptance |
| [#1296: release/recovery](https://github.com/Gero-Labs/gerowallet/issues/1296) | Adam | Store identity, supported-profile upgrade and forward recovery on retained package |
| [#1298: rollout](https://github.com/Gero-Labs/gerowallet/issues/1298) | Adam | Authorized beta, store submission, production observation |

Update the relevant issue and ledger when a batch is accepted. Link the
reviewed PR and evidence from [epic #1282](https://github.com/Gero-Labs/gerowallet/issues/1282).
V15 documentation completion does not close these follow-ups.

## Dependency policy and cadence

[Dependabot](.github/dependabot.yml) already checks npm and GitHub Actions
weekly on Monday at 03:00 UTC. Its existing reviewer route is unchanged.
Review that queue weekly when maintenance work is scheduled, and refresh the
audit on dependency changes and before release. This guide creates no new
scheduled automation or notification commitment.

Use the lockfile as the reproducible dependency graph. Keep Node on the
supported 24.x range and npm aligned with CI. Review majors manually. Grouped
minor/patch proposals still need normal installation, tests, and build checks.
Retain these coupled-update constraints until their upstream contracts change:

- ZXing browser/library must have mutually compatible peer ranges.
- Babylon currently pins `bitcoinjs-lib` to 6.1.7.
- The Midnight v9 ledger and its four aliased wallet consumers must share the
  same WASM instance/version; a successful install alone does not prove this.
- Vitest/UI, Vite, plugins, and the Node runtime must be reviewed together.

For #1314, start with runtime input/rendering and wallet/device SDK paths,
including DOMPurify and showdown. Review build/install paths separately:
TypeScript ESLint/globby, Rollup copy/unplugin, and yorkie also need disposition.
Do not treat a development dependency as automatically harmless. npm's
`fixAvailable` can propose a major change or downgrade; inspect it before
editing. Do not use `npm audit fix --force` or bypass peer resolution.

For each advisory, record the affected path, exposure assessment, compatible
upgrade or mitigation, tests, and any deferral reason. Newly discovered
exploitable weaknesses follow [SECURITY.md](SECURITY.md), not a public exploit
write-up. Published registry advisories remain linked in the ledger.

## Reproduce from a fresh checkout

Select Node 24.19.0 and npm 11.1.0 before running commands. Use a disposable
checkout with its own `node_modules`; the isolated builder refuses existing
production configuration or a prepared manifest. Do not use an active
development extension as its output directory.

```sh
git clone https://github.com/Gero-Labs/gerowallet.git gerowallet-check
cd gerowallet-check
git checkout 1a4d50ac5e1d51fc9a3601a63808c79f839ff6b2
npm ci
npm test -- --maxWorkers=2
npm run design:check
node scripts/build-isolated-extension.mjs <absolute-checkout-path>
node scripts/check-secret-envelope-readers.mjs
node scripts/remote-code-guard.mjs extension
node scripts/check-bundle-tdz.mjs
node scripts/check-release-artifact.mjs extension --expected-version 2.7.3 --report ../artifact.json
npm run typecheck
npx eslint . --format json --output-file ../lint.json
npm audit --json
```

Replace `<absolute-checkout-path>` with the actual path, quoted if it contains
spaces. The last three commands are expected to fail at this baseline; retain
their diagnostics. For a new PR, repeat against its base and head. A build
generates auto-import and component declarations needed for a fair typecheck
comparison. Inspect generated `src/components.d.ts` changes before committing;
do not hand-edit declarations or include unrelated generated noise.

The isolated build supplies synthetic configuration and a public manifest key.
The artifact command above intentionally does not claim expected store ID
verification. Keep its report outside `extension/`. Install a compatible
browser with the pinned `npx playwright install chromium`, then run:

```sh
node scripts/migration/entrypoints-browser.cjs
```

For interactive development, create `.env.development` using the
[README settings](README.md#2-configure-environment) and run `npm run dev`.
The default Vite port is 3303 and is strict; set `PORT` in your shell for an
unused port. Wait for preparation and all bundles before loading `extension/`
at `chrome://extensions`. UI edits hot-reload; worker/content/inject changes
require an extension reload. Live data requires a reachable configured backend.

## Pull-request and release gates

As checked on October 18, `development` requires these checks plus one
approving review, an up-to-date branch, and resolved review conversations:

| Required check | Workflow |
| --- | --- |
| Production bundle (SFC parse) | [dev-bundle-gate.yml](.github/workflows/dev-bundle-gate.yml) |
| npm ci (lock in sync) | [lockfile-check.yml](.github/workflows/lockfile-check.yml) |
| ESLint flat config loads | [eslint-check.yml](.github/workflows/eslint-check.yml) |
| Ledger tests and extension bundles | [midnight-ledger-verify.yml](.github/workflows/midnight-ledger-verify.yml) |

Read each workflow for its current selected test paths. The normal pre-commit
hook lints staged code and runs design/contrast checks. Never bypass it. No
repository `format` or `preflight` script exists; avoid broad formatting.

The [release workflow](.github/workflows/ci-cd.yml) runs the full suite and
qualifies a retained artifact. Use the
[release/recovery procedure](spikes/vue3-migration/RELEASE-READINESS.md) for
channel identity, committed version, checksums, dry run, and publication.
Legacy `pack:*` commands alone are not qualification.

External E2E uses [gerowallet-e2e-tests](https://github.com/Gero-Labs/gerowallet-e2e-tests).
Record both exact 40-character wallet and harness SHAs, artifact digest,
browser/platform, failures, skips, and prerequisite exclusions. Its historical
wallet pin does not qualify a newer candidate. Historical run links without
accessible results must not be represented as freshly verified evidence.
