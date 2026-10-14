# Testing

The pinned runner is Vitest 4.1.11. `vitest.config.mts` uses happy-dom,
`globals: true`, `testTimeout: 30000`, and the shared `test/setup.ts` setup file.

## Where tests live

Source tests live next to their implementation under `src/`; additional suites
live under `scripts/` and `test/`. Browser harnesses are separate Node scripts.
Record file/test counts from the run you performed rather than copying a count
from this guide.

Colocate new source tests because the PR workflows address suites by path and
the convention makes coverage easy to find. `npm run typecheck` and
`typecheck:vue` run Vue-aware template/TypeScript checking; `typecheck:ts` keeps
the TypeScript-only comparison. Historical diagnostics remain, so compare the
same baseline and fix introduced errors. Type checking is useful even though a
repo-wide clean result is not currently a required PR gate.

## Running

```bash
npm test                                   # full suite
npm test -- src/path/to/file.spec.ts       # one file (the -- is required)
npx vitest run src/services/crossDevice src/stores/midnightStore.spec.ts
npx vitest run <path> -t "test name substring"
npm run test:watch
```

`hookTimeout` is Vitest's **default 10s**, not the configured 30s - `testTimeout` does not cover `beforeAll`/`beforeEach`. A slow `beforeAll` needs its own explicit timeout argument.

## Investigate a red full-suite run

Record the command, source SHA, failures, and skips before interpreting the run.
Some suites have shown load-sensitive timing failures:

- `src/services/crossDevice/*.spec.ts` (real timers)
- `src/chains/midnight/midnightKeyManager.ledger.spec.ts` (a `beforeAll` deriving Midnight HD keys for 3 networks, ~9.4s against a **10s** hook timeout)
- `src/shared/utils/renderMarkdown.spec.ts`

Re-run a failing file alone to distinguish load sensitivity from a reproducible
regression. Keep the initial failure and isolated result in the evidence; do not
rewrite a failed full run as passing because one isolated retry passed.

```bash
npx vitest run src/services/crossDevice/proveService.spec.ts
```

`vitest.config.mts` excludes `**/.claude/**` and `**/.worktrees/**` precisely because agent worktrees are full checkouts that Vitest would otherwise glob, running every suite N+1 times against stale code and starving the real-timer suites. Keep worktrees under one of those two paths.

## What CI actually runs

Required PR checks run selected suites. The candidate packaging workflow runs
the full deterministic suite, but is not triggered by every PR.

| Workflow | Runs |
|---|---|
| `dev-bundle-gate.yml` | Explicit regression paths for secrets, stores, navigation, Help, i18n and other supported behaviors; then `design:check` and `build:web`. Read its current path list. |
| `midnight-ledger-verify.yml` | `src/chains/midnight` and `src/services/crossDevice`, plus named transaction/store suites; then `scripts/build-isolated-extension.mjs`. |
| `help-browser-evidence.yml` | Three real extension Help browser harnesses with synthetic API responses on matching changes or manual dispatch. |
| `ci-cd.yml` | `npm test -- --maxWorkers=2`, reader guard, sequential builds and artifact/TDZ checks on `main` pushes or manual dispatch. |

Because those are directory arguments, the covered set grows on its own whenever someone adds a spec under either path. Count it before quoting a number:

```bash
rg --files src/chains/midnight src/services/crossDevice -g '*.spec.ts' -g '*.test.ts'
```

Reproduce either locally by copying the path list from the workflow.

A green PR does not prove suites outside its workflow path lists passed. Run
the relevant tests locally and retain full-suite results for the exact release
candidate. AI review may run additional targeted suites; its report must state
which ones actually ran.

**The inverse is just as important**: anything under `src/chains/midnight` or `src/services/crossDevice` **is** gated on every PR, so a red `Ledger tests and extension bundles` check is a real failure, not noise. That check is also not path-filtered, so it runs its vitest slice and builds all five production entry points even for a one-file UI PR - budget for the wait.

## Make your test fail first

Under happy-dom, `getContextType()` returns `'content'` (a `window` exists, protocol is `http:`). So `broadcastFromBackground()` no-ops and `storeMessaging.subscribe` is never wired. **A test written against a store's broadcast path passes on both the broken and the fixed code.** Confirm the test fails against the unfixed tree before you trust it.

## Patterns to copy

| Need | Template |
|---|---|
| Store unit test | `src/stores/controlledAmount.spec.ts` - mock `@/chrome/storeMessagingBg` and `@/services/storeMessaging.service` before importing the store |
| IndexedDB test | `src/db/wallet-db.spec.ts` - `import 'fake-indexeddb/auto'` as line 1 |
| Mocking Chrome-dependent stores | `test/sidepanel/useChainContext.test.ts` - `vi.hoisted` + `vi.mock('@/stores/walletStore')` |
| A component with many deps | `src/modules/dashboard/components/TransactionsCard.pending.spec.ts` - note its mount helper hand-lists every `vi.mock` and Vuetify stub, so **importing a new component into a covered component can break a spec your PR never touched** |

**Blast radius worth knowing**: `src/stores/governanceAlertsStore.spec.ts` builds a wallet `config` fixture, so any change to the config shape or to `setConfig` fails a spec with no visible relationship to your diff.

## Limits of the tooling

- **No coverage tooling.** No `@vitest/coverage-*`, no config key, no threshold, no CI step.
- **No configured `playwright test` suite here.** The root package pins Playwright 1.62.1, and a normal `npm ci` installs its Node module. `npm run test:e2e` exposes `playwright test`, but there is no root Playwright test config. The separate `Gero-Labs/gerowallet-e2e-tests` repository and this repo's Node browser harnesses have their own setup. Record both the wallet/artifact SHA and external E2E SHA; an older pinned wallet run does not qualify a new candidate.
- **No typecheck gate.** See the verification ladder in SKILL.md.

## The manual browser harness

`test/wallet-library/` is a fixture server, not a Vitest suite: a Vite server on `127.0.0.1:3317` that mounts the **production** WalletLibrary/WalletSelector components with the DB, geroStore, networks and assets modules aliased to local fixtures, driven by two Node scripts. No npm script, no CI wiring.

```bash
npx vite --config test/wallet-library/vite.config.mts
PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright node test/wallet-library/browser.cjs        # 1100x1400
PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright node test/wallet-library/browser-mini.cjs   # 375x820
```

The fixture aliases stores and data clients. It establishes component behavior,
not production background synchronization or profile-upgrade acceptance.
`test/visual-parity/` similarly checks native controls, layout, focus, and the
vendored widget's theme boundary with synthetic state.

The real extension can also be exercised in a disposable browser profile:

- `scripts/migration/entrypoints-browser.cjs` checks the retained artifact's
  options/sidepanel pages, CSP, and dashboard handoff.
- `scripts/migration-browser/store-sync-smoke.cjs` creates synthetic wallets
  through production UI and verifies real background broadcasts/persistence
  without harness writes to the asserted state. Its offline limits are recorded
  explicitly; it does not prove every live-provider or upgrade path.

Read each runner's environment options and keep its artifact immutable during
the run. The Node module installed by `npm ci` does not establish that a
compatible browser binary is provisioned. Install the required browser with
the pinned Playwright CLI, for example `npx playwright install chromium`, or
use the runner's documented browser override. CI may provision its own browser
and system dependencies. Physical devices, existing-profile upgrades, and
production release acceptance still need their separate evidence.

## Don't run this locally

`scripts/build-isolated-extension.mjs` refuses to run in a checkout that already has `.env`, `.env.local`, `.env.production`, `.env.production.local` or `extension/manifest.json`, because it synthesizes its own. It is for a clean disposable clone. Note `.env.development` is **not** on that guard list, so a normal dev checkout will happily start the whole five-target production build - that is a long wait, not a safe check. Use `build:web` instead.
