# Debugging playbook

## First: turn the logs on

512 log statements in this codebase go through `debugLog()` in `src/utils/debug.ts`, which is bound to a no-op unless `VITE_DEBUG_STORES === 'true'` **at build time**. The entire gero-sync WebSocket trace (connect, SUBSCRIBE, SYNC, CATCH_UP_COMPLETE, rollback, reconnect) and the whole store-sync port lifecycle are `debugLog`-only. With the flag off, a sync failure produces **zero console output**, which reads as "sync is fine".

It is read in exactly one source file and appears in no documentation - but `ci-cd.yml` also passes it through from a repo variable, so a release build can be produced with it on (see the logging rule in `security.md`). Do this before debugging anything:

```bash
printf 'VITE_DEBUG_STORES=true\n' >> .env.development
npm run dev          # or at minimum: npm run dev:background
# then reload the extension at chrome://extensions
```

It cannot be toggled at runtime - it is inlined at build.

## Where the consoles are

| Surface | How to open |
|---|---|
| Background service worker | `chrome://extensions` -> Gero -> "service worker" under Inspect views |
| Options / dashboard | Right-click the page -> Inspect |
| Side panel | Right-click inside the panel -> Inspect |
| Approval popup (sign-tx, dapp-connect, ...) | Right-click inside that window -> Inspect. **There is no popup target in the Inspect-views list**, because there is no popup bundle: those windows are `index.html#/sign-tx` etc. from the options bundle in a `chrome.windows.create({type:'popup'})` window |

**Reloading the extension tears down the side panel.** A reload at `chrome://extensions` kills the panel's page and its `store-sync` port, and its Inspect target disappears. Close and reopen the panel, and reopen its DevTools, before re-testing - otherwise you are reading a dead context and will conclude your fix did nothing.

**Do not filter the console on `⏱️ PERF:`, `🔐 Auth:`, `📡 API:`, `💾 DB:` or `🔄 Sync:`.** Those prefixes are documented in ARCHITECTURE.md and CLAUDE.md and appear **zero times** in `src/`. The real searchable tags are `[PRF]`, `[Keystone]`, `[DApp]`, `[TREZOR]`, `[LEDGER]`, `[ROUTER]`, `🌙` (Midnight), `🔵 [webpage.ts]`, `❌`, `✅`.

Background stack traces always point at `background/index.js:<line>`, never at a `.ts` file: the background bundle sets `sourcemap: false` unconditionally because 3000+ modules OOM the generator. Dev builds are unminified, so search the emitted file for the function name.

## Triage tree

### A message never comes back

Grep the **calling page's** console for the two unconditional warnings:

```
Chrome runtime error in sendToBackgroundFromOptions:
Chrome runtime error in sendToBackground:
```

These are raw `console.warn`, so they appear even with debug logging off. Then check:

1. **Wrong registry.** `sendToBackground` stamps `sender:'webpage'` and only reaches `app.add()` (CIP-30) handlers. `sendToBackgroundFromOptions` stamps `sender:'options'` and only reaches `app.addToOptions()` (`MessageTypes.*`) handlers. A `MessageTypes.*` call sent with `sendToBackground` matches nothing and silently never returns.
2. **The handler threw asynchronously.** The wrapper's try/catch only catches synchronous throws, so an async handler that rejects never calls `sendResponse` and the caller hangs until the port closes. Adding `return true` does nothing - `listen()` already returns `true` for every message it dispatches to a registered handler, and `false` only when nothing matched.
3. **The wallet was not there.** `walletManager.getWallet()` returns `null` during the async boot re-login after a worker restart.

### UI is stale but the data is fine

Check IndexedDB first. If `wallet-{id}.transactions` has the new rows and `wallet-{id}.sync` has a tip-level `height`, the sync leg works and the break is downstream, in the `store-sync` runtime port that pushes `walletStore` into the page. Look in the **page** console for `📡 Store messaging disconnected` / `❌ Reconnection failed`.

Note the reconnect counter is effectively broken: `connect()` resets `reconnectAttempts = 0` before the port has proven it survives, so the delay is always 1000ms and the `maxReconnectAttempts = 5` ceiling is unreachable. Endless 1-second reconnects are the symptom of a permanently broken port, not of a transient one.

### Is the socket even up?

No logging needed. `chrome.storage.local.loadingState`:

- `connected: true` - the gero-sync socket is open
- `connecting: true, connected: false` - retrying

The URL is `${VITE_SYNC_WS_URL}/ws/sync`, defaulting to `wss://sync.gerowallet.io` when unset.

## Reading the real state from a console

Run these in the **options page** console. `walletStore` and friends are not on `window`.

**IndexedDB.** Open with **no version argument** - passing a number either throws `VersionError` or triggers a destructive upgrade.

```js
const dbs = await indexedDB.databases();
const name = dbs.map(d => d.name).find(n => /^wallet-\d+$/.test(n || ''));
const db = await new Promise(r => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); });
const txs = await new Promise(r => { const t = db.transaction('transactions').objectStore('transactions').getAll(); t.onsuccess = () => r(t.result); });
```

Three databases:

| Name | Version | Stores |
|---|---|---|
| `GeroWalletDatabase` | 16 | `wallets`, `config`, `provider` - find the wallet `id` here |
| `wallet-{id}` | 11 | `config` (pk `key`), `sync`, `account`, `addresses`, `contacts`, `rewards`, `transactions` (pk = tx hash), `connected_dapps`, `multisig`, `portfolio_charts`, `utxos` |
| `{chain}_{network}` | 5 | `pools`, `dreps`, `sync`, `assets`, `epoch_params`, `genesis_info` |

**Store mirrors in `chrome.storage.local`**: `walletStore`, `loadingState`, `networkStore`, `geroStore`, `midnightStore`, `priceStore`, `featureFlags`, `walletConnectState`, `cip45State` and others. Written on a 300ms debounce after the (immediate) port broadcast, so reading storage right after an action can lag the page by up to 300ms.

**Asset metadata** lives under `networkStore.assets`, keyed by **concatenated** hex `policyId + assetNameHex`. Transaction amounts carry a **dotted** `policy.name` unit, so lookups miss without normalizing.

## Forcing state for a repro

**Force a feature flag on.** The SSE flag service cannot run in an MV3 worker, so the background reads flags only from the `featureFlags` mirror in `chrome.storage.local`. Write that key directly.

**Watch-only wallet** - reproduce a user's view from just a base address. Needs both `import.meta.env.DEV` (so a dev build) and the runtime Developer-networks toggle, which lives in the options page's `localStorage`:

```js
localStorage.setItem('gero:devNetworks', 'true');  // then reload
```

Hidden for Bitcoin and Midnight.

**Local governance data without a backend**: `node scripts/dev/governance-dev-proxy.mjs` serves `/api/governance/*` from anonymous Koios in Nexus DTO shape on `:8787`.

**Isolated component repro**: `npx vite --config test/wallet-library/vite.config.mts` serves the wallet-library/onboarding fixture on `127.0.0.1:3317` with the DB, geroStore, networks and assets modules stubbed. Note its config is missing the three `@noble/*` `.js` aliases that `vite.config.mts` and `vitest.config.mts` carry, so the dep pre-scan errors until you copy them across.

## Background-specific traps

- **`ReferenceError: Cannot access '<module>_service' before initialization`** at startup. The background is one IIFE with `manualChunks: undefined`, so Rollup inlines dynamic imports and leaves a namespace `const` wherever the module lands in emission order. If that is after its reader, you hit a temporal dead zone. `scripts/check-bundle-tdz.mjs` guards this on every build. Fix by making the dynamic import static.
- **`self.addEventListener('online'|'offline')` never fires.** A monkey-patch is prepended to the emitted bundle that makes those two event types a no-op. Use another reconnect trigger.
- **`typeof window !== 'undefined'` is statically false in the background bundle** - the config replaces it with the literal at compile time. Use `getContextType()`.
- **`instanceof Error` is avoided on purpose** (`src/shared/utils/errorHandler.ts`): patched third-party code in this bundle can produce functions with an `undefined` prototype, which throws inside the check. Use the duck-typed helpers.
- **The blockchain Dexie handle does not follow a network switch.** `WalletBg.getBlockchainDb()` guards on a module-level singleton, so the `${chain}_${network}` name is computed once. Restart the service worker after switching networks, or use the correctly keyed cache in `src/db/index.ts`.
- There are `chrome.alarms` at 1-minute (`auto-lock-check`) and 5-minute intervals, so the worker is woken at least once a minute. A genuinely "dead" worker is usually a crashed event handler, not an idle teardown.

## Dev-server symptoms

| Symptom | Cause |
|---|---|
| Page renders the literal text `Vite server did not start` | The dev HTML stub loads `http://localhost:3303/options/main.ts`; the server is down or on another port |
| `/vendor/*` 404s in dev only | The dev stub keeps absolute `/vendor/...` hrefs, which resolve against `chrome-extension://`, not the dev server. Fix by copying the asset in `copyDevAssets()` in `scripts/prepare.ts` (and `cp` it into `extension/vendor/` to fix the running server) |
| Every network call fails, no build error | No `.env.*` file. Common in a fresh git worktree, since env files are gitignored |
