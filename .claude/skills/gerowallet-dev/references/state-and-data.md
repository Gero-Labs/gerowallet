# State and persistence

Two independent layers with different owners: `Vue.observable` stores synced across contexts, and Dexie/IndexedDB owned by the background.

## Stores

A store is a plain `Vue.observable<T>({...})` object plus a module-level `STORE_NAME` (which doubles as its `chrome.storage.local` key) and `const context = getContextType()`. No Vuex, no Pinia, no base class - every store re-implements the same ~40 lines by hand.

Smallest complete example to copy: `src/stores/cip45Store.ts` (64 lines). Canonical full example: `src/stores/walletStore.ts`.

**The background is the only writer.** `broadcastFromBackground()` opens with `if (context === 'background')` and returns silently otherwise. Calling a store setter from a component mutates that page's in-memory copy and nothing else - no persistence, no other context, no error.

The flow:

```
background mutates store
  -> serialize (bigint -> string, Map -> object, Set -> array)
  -> broadcastUpdate over the 'store-sync' chrome.runtime port
  -> chrome.storage.local.set (300ms debounce, WHOLE store snapshot)

UI page
  -> one-shot hydrate from chrome.storage.local on cold start
  -> storeMessaging.subscribe(STORE_NAME, handler) for live updates
  -> handler applies key-by-key:  if (key in store) store[key] = updates[key]
```

Two rules fall straight out of that:

**Declare every field in the `Vue.observable({...})` literal with a default.** The subscribe handler drops unknown keys via `if (key in store)`, and Vue 2 only installs reactive getters on properties present at creation. A field added only to the type and the setter works in the background and never appears in the UI, with no error.

**Use the in-memory store as the base for the `chrome.storage` write**, never `chrome.storage.local.get()`. The read-modify-write version races the Dexie liveQuery; the fix is commented in `geroStore.ts:108`. Copy `broadcastFromBackground` from `walletStore.ts`, `geroStore.ts`, `networkStore.ts`, `cip45Store.ts` or `loading.ts`. Do **not** copy it from `tapToolsStore`, `tokenMetadataStore`, `coinGeckoStore`, `charli3Store` or `musicStore` - those still carry the racy pattern. (`stores/modules/card.ts` has no `broadcastFromBackground` at all and never persists, so it is not a store template either.)

**BigInt survives the trip out but not back.** The serializer stringifies `bigint`, and nothing revives it: both `storeMessaging.subscribe` and the cold-start hydrate assign the raw JSON. So in every browser context `walletStore.bitcoinBalance.{available,total,locked}` are **strings**, while in the background they are real BigInts. Arithmetic or a comparison written against the background's view throws `Cannot mix BigInt and other types` - or worse, silently compares strings - in UI contexts only, where no vitest run will see it. Coerce at the read site.

**`clearForWalletSwitch()` deliberately does not broadcast.** It clears the wallet-scoped slice in memory and carries the comment *"We don't broadcast here because the background script will update with new wallet data shortly"* - whereas `logout()` does broadcast. That asymmetry is the root of the whole "stale data after a wallet switch" bug class: if the new wallet's data is slow, or the worker died mid-switch, other contexts keep showing the old wallet. Before changing it, know that the silence was avoiding an empty-state flash.

Consume a store in `<script setup>` with `toRefs()`:

```ts
import walletStore from '@/stores/walletStore';        // actions
import { walletStore as store } from '@/stores/walletStore';  // the observable
const { config, loggedWallet } = toRefs(store);
```

`src/options/main.ts` awaits hydration of `geroStore` and `walletStore` **before** mounting Vue, because the router's `beforeEach` would otherwise see `loggedWallet === null` and bounce to `/welcome`.

Lightweight UI-owned preferences use a simpler pattern - `Vue.observable` + direct `chrome.storage.local` + an `onChanged` listener + an explicit `hydrated` flag so the UI does not flash the default. See `src/stores/agentDockPrefsStore.ts`.

`featureFlagsStore` is UI-only (an `EventSource` cannot run in an MV3 worker) and mirrors its flags into a separate `featureFlags` storage key that the background reads.

## Per-wallet or global? Decide before you write the recipe

The `config` table is **per wallet**, so anything stored there resets when the user switches wallets. For a preference the user reads as an app-level setting - privacy, display, language - that is a bug, not a scope. The codebase has an explicit precedent against it: `setLocale` in `walletStore.ts` carries the comment

> CRITICAL: Only save to geroStore (global preference, persists across login/logout) - DO NOT save to wallet-specific config to avoid duplicate liveQuery triggers

So: **per-wallet `config`** for anything genuinely about that wallet (currency, auto-submit, staking view). **`geroStore`** for anything the user expects to hold across wallets. Surface the choice in the PR rather than inheriting whatever the nearest existing field did - "I matched the existing field" is not an answer for a control being promoted into Settings.

## Per-wallet settings: the recipe

For a per-wallet preference, do **not** try to write it from the component into the store. Write to Dexie and let the liveQuery come back around:

```ts
import { setWalletConfiguration } from '@/db/wallet-db';
await setWalletConfiguration(walletId, 'myKey', value);
// ConfigLoader liveQuery (background) -> WalletStore.setConfig() -> broadcast -> every UI context
```

That round trip is the point: it is what makes the value durable and consistent across contexts. `setWalletConfiguration` is callable from any context (Dexie's cross-context storage-mutated channel carries the change to the background).

**Only 7-8 keys are seeded into a new wallet's `config` table** (`createNewWalletDb`: currency, txAutoSubmit, tokenAllocationSort, hideScamTokens, hideUnverifiedTokens, stakingProView, locale, plus `backup` when a mnemonic exists). For any other key, `walletStore.config.yourKey = value` is a plain assignment onto an object Vue 2 has already observed, so **it is not reactive and nothing re-renders** until the liveQuery round trip replaces the whole object. Always go through `setWalletConfiguration`, and never latch a local ref.

**Read config with an explicit fallback.** `ConfigLoader` **replaces** `walletStore.config` wholesale from the DB rows, so the defaults declared in the observable literal are destroyed the first time it fires, and only 7-8 keys are seeded into a new wallet's `config` table:

```ts
const hide = computed(() => walletStore.config?.hideBalances ?? false);
```

And do not latch the first read: `config` is `{}` until the liveQuery delivers. Treat `Object.keys(config).length > 0` as the "config has arrived" signal. `governanceAlertsStore.hydrate()` is the reference implementation.

**The round trip needs a live service worker.** The liveQuery loaders run in the background, so while the worker is torn down a Dexie write from a UI page persists but **does not propagate**: other open contexts keep their last `chrome.storage` snapshot until something wakes the worker. For a control where stale means wrong - anything privacy- or security-shaped - that is a fail-open, and it is invisible in local dev where the worker is usually warm. QA step: make the change, confirm at `chrome://extensions` that the service worker shows inactive, then open the side panel and check it reflects the new value.

**A durable preference written only through `broadcastFromBackground` silently resets on every worker restart**, because the broadcast persists the whole in-memory snapshot and a freshly booted worker is at defaults. If the background owns a durable field, give it a background-side hydrate guarded by an "already touched" flag. This shipped once as the Midnight proof-server mode flipping back to Gero Cloud.

## Dexie

Three schemas, all declared in `src/db/schema.ts`:

| DB | Opener | Versioning |
|---|---|---|
| `GeroWalletDatabase` (app-level: wallets, config, provider) | `getDb()` in `src/db/gero-db.ts` | Full version chain 10 -> 14 -> 15 -> 16, three with `.upgrade()` |
| `wallet-{id}` (per wallet) | `getDb(id)` in `src/db/wallet-db.ts` | **One** version, the complete current schema, no upgrade hooks |
| `{chain}_{network}` (blockchain cache) | `src/db/index.ts` | Own version + Map cache |

**Every opener of a per-wallet DB must declare the complete `walletDBSchema`.** Declaring a subset makes Dexie do an implicit same-version schema diff and **drop the omitted tables, destroying user data**. This actually happened; the unused `multisig` table is retained in the schema for exactly this reason.

**Do not bump `geroDBVersion` to add a migration.** The last block in `gero-db.ts` is `db.version(geroDBVersion)`, so bumping the constant silently re-labels the existing migration. Freeze that block to its literal (`db.version(16)...`), append a new `db.version(geroDBVersion)` block with your migration, then bump the constant to 17.

**Adding a non-indexed field needs no version bump at all.** A Dexie schema string lists the primary key and indexes only, not the record shape. `src/db/wallet-library.ts` added `isFavorite` and `categoryId` that way.

DB rows reach stores **only** through `liveQuery` loaders registered in the background: `src/db/loaders/` (per wallet, via `LoaderFactory` in `walletBg`'s constructor) and `src/plugins/geroLoader.ts` (app level).

## Dead code that looks like API

- `src/utils/storageSync.ts` exports `smartPersist()`, `hydrateStore()` and `debouncedWriter` - **zero consumers**. Only `getContextType()` is live.
- `src/chrome/database.ts`, including its polling `liveQuery` shim and `getProvider()` - imported nowhere.

## Testing stores

Mock the two messaging modules before importing the store; that is the whole setup. Template: `src/stores/controlledAmount.spec.ts`.

Be aware that under happy-dom `getContextType()` returns `'content'` (a `window` exists and the protocol is `http:`), so `broadcastFromBackground` no-ops and `storeMessaging.subscribe` is never wired. **A test written against the broadcast path passes on broken code.** Make your test fail first.
