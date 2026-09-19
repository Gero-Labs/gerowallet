# Testing

One runner: Vitest 3.2.7, `vitest.config.mts`, happy-dom, `globals: true`, `testTimeout: 30000`, no setup files.

## Where tests live

- 227 `*.spec.ts` colocated with source under `src/`
- 11 `*.test.ts` under `src/`, mostly in `__tests__/` dirs
- 7 `*.test.ts` under `test/`

245 files, 2871 tests, ~95s for a full run.

Colocate new tests under `src/`, next to the code. Not for typechecking - nothing in this repo ever runs a meaningful `tsc` (see SKILL.md) - but because both CI workflows address tests by path, and the colocated convention is what everything else follows. (`tsconfig.json` includes `src/**` only, so anything under `test/` is outside it, which matters only if the typecheck debt is ever cleaned up.)

## Running

```bash
npm test                                   # full suite
npm test -- src/path/to/file.spec.ts       # one file (the -- is required)
npx vitest run src/services/crossDevice src/stores/midnightStore.spec.ts
npx vitest run <path> -t "test name substring"
npm run test:watch
```

`hookTimeout` is Vitest's **default 10s**, not the configured 30s - `testTimeout` does not cover `beforeAll`/`beforeEach`. A slow `beforeAll` needs its own explicit timeout argument.

## A red full-suite run is probably not you

On an unmodified tree the suite currently exits 1 with two known timing flakes:

- `src/services/crossDevice/proveService.spec.ts` (real timers)
- `src/chains/midnight/midnightKeyManager.ledger.spec.ts` (a `beforeAll` deriving Midnight HD keys for 3 networks, ~9.4s against a 10s hook timeout)

Both pass in isolation. **Re-run the failing file alone before calling it a regression.** A clean full run also happens, so a green run is not proof the flake is fixed.

```bash
npx vitest run src/services/crossDevice/proveService.spec.ts
```

`vitest.config.mts` excludes `**/.claude/**` and `**/.worktrees/**` precisely because agent worktrees are full checkouts that Vitest would otherwise glob, running every suite N+1 times against stale code and starving the real-timer suites. Keep worktrees under one of those two paths.

## What CI actually runs

About 62 of 245 files. `npm test` is never invoked in CI.

| Workflow | Runs |
|---|---|
| `dev-bundle-gate.yml` | 6 named spec files, then `design:check`, then `build:web` |
| `midnight-ledger-verify.yml` | Two whole **directories** - `src/chains/midnight` (31 files today) and `src/services/crossDevice` (19) - plus 6 named specs; then `scripts/build-isolated-extension.mjs` |

Because those are directory arguments, the covered set grows on its own whenever someone adds a spec under either path. Count it before quoting a number:

```bash
find src/chains/midnight src/services/crossDevice \( -name '*.spec.ts' -o -name '*.test.ts' \) | wc -l
```

Reproduce either locally by copying the path list from the workflow.

**Consequence: a regression outside those paths merges green forever.** Tests there are for your own confidence, not for the gate. Write them anyway, but do not mistake them for enforcement.

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

## Things that do not exist

- **No coverage tooling.** No `@vitest/coverage-*`, no config key, no threshold, no CI step.
- **No in-repo E2E.** `npm run test:e2e` runs `playwright test`, but Playwright is in neither `package.json` nor the lockfile nor `node_modules`. The real E2E suite is the separate repo `Gero-Labs/gerowallet-e2e-tests`; what this repo keeps of it is `scripts/build-isolated-extension.mjs`.
- **No typecheck gate.** See the verification ladder in SKILL.md.

## The manual browser harness

`test/wallet-library/` is a fixture server, not a Vitest suite: a Vite server on `127.0.0.1:3317` that mounts the **production** WalletLibrary/WalletSelector components with the DB, geroStore, networks and assets modules aliased to local fixtures, driven by two Node scripts. No npm script, no CI wiring.

```bash
npx vite --config test/wallet-library/vite.config.mts
PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright node test/wallet-library/browser.cjs        # 1100x1400
PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright node test/wallet-library/browser-mini.cjs   # 375x812
```

Its config lacks the three `@noble/*` `.js` aliases that `vite.config.mts` and `vitest.config.mts` carry; copy them across or the dep pre-scan errors.

This is the general technique for any component you cannot render in the full app (the full app cannot run headless - crypto init crashes): leaf-mount it with a scratch Vite config.

## Don't run this locally

`scripts/build-isolated-extension.mjs` refuses to run in a checkout that already has `.env*` or `extension/manifest.json`, because it synthesizes its own. It is for a clean disposable clone. Use `build:web` instead.
