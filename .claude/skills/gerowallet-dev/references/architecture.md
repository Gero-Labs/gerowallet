# Architecture: contexts and messaging

## Five execution contexts

| Context | Code | What it is |
|---|---|---|
| Page world | `src/chrome/inject.ts` (+ `injectMidnight.ts`, `webpage.ts`) | Defines `window.cardano` (CIP-30) and `window.midnight[uuid]` on every page. Delivered as a web-accessible resource that the content script appends as a `<script>` tag - it is not a manifest content script |
| Content script | `src/chrome/content.ts` | The one manifest content script, isolated world, relays page <-> background |
| Background | `src/chrome/background.ts` (6645 lines) + `src/chrome/walletBg.ts` | MV3 service worker. Owns the wallet instance, the DB and signing |
| Options SPA | `src/options/` -> `extension/index.html` | The main UI. **Also renders every dApp approval "popup" window**, loaded at a hash route inside `chrome.windows.create({type:'popup'})` |
| Side panel | `src/sidepanel/` -> `extension/sidepanel/index.html` | Mini-Gero. Its own router, its own pages, its own components |

`src/popup/{index.html,main.ts,Popup.vue}` is **dead code** - not a Vite input, and the manifest declares no `action.default_popup`. The live popup surfaces are the Vue components under `src/popup/modules/views/`, routed by the *options* router.

Which context you are in: `getContextType()` in `src/utils/storageSync.ts:84-91`. No `window` -> `'background'`; `chrome-extension:` protocol -> `'browser'` (options, approval popup and side panel all collapse to this); otherwise `'content'`. Use it rather than ad-hoc `typeof window` checks: the background Vite config replaces `typeof window` and `typeof document` with the literal `"undefined"` at compile time, so a `typeof`-guarded branch is silently dead-code-eliminated in that bundle only.

## Messaging

`src/chrome/messaging.ts` is the whole transport. It routes on a `sender` string in the message body into one of **two handler registries**:

| Call from UI | Stamps | Dispatches against | Handlers registered with |
|---|---|---|---|
| `Messaging.sendToBackgroundFromOptions()` | `SENDER.options` | `optionsMethodList` | `app.addToOptions(MessageTypes.X, ...)` |
| `Messaging.sendToBackground()` | `SENDER.webpage` | `methodList` | `app.add(METHOD.x, ...)` |

**The split is by registry, not by window.** CLAUDE.md's "Popup context: `sendToBackground()`" reads as popup-vs-options and is misleading. Every wallet UI surface - options page, approval popup window, side panel - uses `sendToBackgroundFromOptions` for `MessageTypes.*` handlers. `sendToBackground` is for invoking a dApp-facing CIP-30 method, which only two components in the whole UI legitimately do.

Method-name constants live in two places: dApp-facing CIP-30 / Bitcoin / Midnight methods in `src/chrome/config.ts`, internal UI <-> background methods in `src/models/MessageTypes.ts`.

Index the surface:

```bash
grep -n 'app.addToOptions(MessageTypes\.' src/chrome/background.ts    # ~110 internal handlers
grep -nE 'app.add\((METHOD|BITCOIN_METHOD|MIDNIGHT_METHOD)\.' src/chrome/background.ts   # dApp-reachable handlers
```

### The response envelope, and the trap in it

Handlers reply with `{ id, data, target: 'gerowallet', sender: 'extension' }`. Callers unwrap `res.data`.

**Neither send function ever rejects.** On `chrome.runtime.lastError` they *resolve* with `{ error: <message> }` and no `data` key, so `res.data.success` throws `Cannot read properties of undefined`. Always:

```ts
const res = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.X, data });
if (res?.error) { /* transport failure */ }
if (res?.data?.error) { /* handler-level failure */ }
```

The exported `BackgroundResponse<T>` type is narrower than what is actually sent (no `id`, no `error`) - do not treat it as the contract.

**`return true` in a handler does nothing.** `BackgroundHandler` is typed to return void and the value is discarded; the wrapper inside `listen()` already returns `true` unconditionally. What matters is calling `sendResponse` exactly once on every path, including every error path. CLAUDE.md's template is cargo cult here.

### Ports

Four named `chrome.runtime` port channels:

- `store-sync` - store broadcast (see `state-and-data.md`)
- `internal-background-popup-communication` - the approval popup window
- `internal-background-sidepanel-communication` - side panel approval
- `mini-gero-dapp-channel:<tabId>` - side-panel dApp channel

If the approval window or side panel is closed rather than declined, the background still resolves, with a connector-shaped refusal (CIP-30 `APIError.Refused`, or Midnight's `Rejected` shape).

## MV3 service worker lifetime

There is no keepalive. The worker is torn down whenever Chrome feels like it, and every cold start re-runs the boot block at `background.ts:121-163`: `loadWallets()` -> `hydrateWalletStore()` -> `checkAutoLock()` -> `walletManager.login(...)`, which reconstructs `WalletBg` from the DB.

Consequences you must design for:

- `walletManager.getWallet()` returns `null` while no wallet is logged in **and** during the async boot re-login. Every handler must handle `null`; UI must surface or retry rather than assume. The symptom of getting this wrong is an intermittent, unreproducible "Wallet instance not available" after the extension has been idle.
- Anything that must survive worker death has to be derived from `chrome.storage` or IndexedDB, never from background memory.
- Durable timers are `chrome.alarms`, not `setInterval` - four are registered at module scope and dispatched from one `onAlarm` listener.
- **Verifying only against a warm worker is not verifying.** The real-world wallet switch or dApp request happens minutes after the last activity, with the worker already dead.

## Trust boundaries

- The `sender` string in the message body is **forgeable by a content script**. A small set of sensitive options-context methods is additionally gated on the real `chrome.runtime.MessageSender` being an own extension page (`src/chrome/senderTrust.ts`, `EXTENSION_PAGE_ONLY_METHODS`).
- The content relay normally pre-checks the dApp whitelist, but `enable`, `isEnabled`, `connect` and every sign method are deliberately fast-pathed past it so the user gesture survives for `chrome.sidePanel.open()`. **Any new `app.add()` handler on that fast path must re-check `WalletStore.isWhitelisted(request.origin)` itself**, using the relay-stamped `request.origin` and never `request.data.origin`, which the page controls.
- The relay rejects messages whose `e.source !== window`, so a cross-origin iframe cannot get its request relayed under the top frame's whitelisted origin.

## Reading a flow end to end

The clearest worked example is an options-page signature: `src/shared/composables/useTransactionSigning.ts` builds the payload, dispatches by wallet type, and sends `MessageTypes.SIGN_TX`; `background.ts` handles it; `walletBg.ts:2062` does the signing. For the dApp side, `src/popup/modules/views/SignTx.vue` is the port-controller half of the approval loop.

Before modelling a new handler on an existing one, grep the `MessageTypes` constant to confirm it has a live caller - `MessageTypes.RESTORE` is registered and called by nothing.
