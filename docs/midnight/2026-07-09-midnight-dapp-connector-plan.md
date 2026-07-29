# Midnight DApp Connector — Build Plan

**Date:** 2026-07-09
**Spec:** `@midnightntwrk/dapp-connector-api` — https://github.com/midnightntwrk/midnight-dapp-connector-api/blob/main/SPECIFICATION.md
**Status:** Phase 1 implemented (2026-07-09) — discovery, `connect` approval, all read getters, `signData`, `submitTransaction`. `makeTransfer`/`makeIntent`/`balanceUnsealedTransaction`/`balanceSealedTransaction`/`getProvingProvider` present on the returned `ConnectedAPI` but reject with `InternalError` until Phase 2/3 land (see §4). Full build green across all 4 Vite contexts (main/background/content/inject); dedicated `@midnight-ntwrk/dapp-connector-api@^4.0.1` dep installed for types.
**Approval UI (2026-07-10 revision):** `connect`/`signData` approvals route EXCLUSIVELY through the mini-gero side panel (`DAppOverlay.vue` + `useDAppOverlay.ts`'s `mini-gero-dapp-channel:${tabId}` port) — the standalone-popup approach originally shipped (`MidnightDappConnect.vue`/`MidnightDappSignData.vue` under `src/popup/modules/views/`) was retired per product decision. No popup fallback: if the side panel can't be opened/connected within 5s, the request fails outright. See §2.2 for the mechanism this actually uses (it is NOT the popup-view `useSidePanel`/`InternalSidePanelController` pattern described in earlier revisions of this doc — that pattern is dead code, confirmed unreachable, in the current codebase).
**Goal:** expose Gero as a discoverable Midnight wallet provider so dapps (LunarSwap, Midnames, the official Bboard/Counter examples, etc.) can connect, read, sign, and submit.

---

## 1. Why this is mostly wiring

Gero's Midnight integration already owns every hard capability the connector needs to expose:

- addresses — `midnightKeyManager` derives unshielded / shielded (+ coin/encryption pubkeys) / dust
- balances — `midnightStore.balances` (`nightUnshielded`, `nightShielded`, dust via `dustState`)
- unshielded send + dust-balance + BIP-340 sign — `midnight-tx.service` + `midnightTxBuilder` + `walletBg`
- submit — Nexus relay (`submitMidnightTx`)
- tx history — `midnightStore.transactions`
- config/endpoints — `midnightConfig`

The connector is a **thin provider + bridge + approval shell** over those. It does NOT reimplement wallet logic.

## 2. Architecture (mirror the existing CIP-30 path exactly)

The Cardano connector already implements the exact page↔background bridge we need. Reuse it verbatim in shape:

```
page (dapp)                     page (MAIN world)        content script         background
─────────────────────────────  ───────────────────────  ────────────────────   ───────────────────
window.midnight[uuid].connect() → injectMidnight.ts   →  content.ts relay    →  MIDNIGHT_METHOD.*
  .getUnshieldedBalances()        (provider object)       (per-origin gate)      handlers → existing
  .signData() ...                 calls midnightWebpage    Messaging.sendTo*      Gero Midnight fns
                                  bridge fns
```

Reference implementations to copy the shape from:
- Provider object in page context: `src/chrome/inject.ts` (defines `window.cardano.gerowallet`)
- Page→content bridge fns: `src/chrome/webpage.ts` (`Messaging.sendToContent({ method: METHOD.x, data })`)
- Content relay + per-origin dApp whitelist gate: `src/chrome/content.ts`
- Method name registry: `METHOD` in `src/chrome/config.ts`
- Background handlers: `app.addToOptions(MessageTypes.X, ...)` in `src/chrome/background.ts` / `walletBg.ts`
- Connect-approval popup: the CIP-30 `enable()` flow (background pops the connect dialog, records the origin)

**Key reuse decision:** the page-context provider lives in the SAME inject bundle that already runs in the page MAIN world (`inject.ts`). We do NOT need a new Vite config — add a `injectMidnight.ts` module imported by `inject.ts` (or a sibling block), so `window.midnight` is installed alongside `window.cardano`.

### Injection mechanics — exact requirements (verified against `SPECIFICATION.md` §Initial API, points 1-4)

```typescript
// First wallet on the page locks the container:
if (!window.midnight) {
  Object.defineProperty(window, 'midnight', {
    value: Object.create(null), writable: false, configurable: false,
  });
}
// Then install under a fresh UUIDv4 key — enumerable MUST be true, since the
// documented discovery pattern is `Object.values(window.midnight ?? {})`
// (see README.md "Connect" example) — a non-enumerable entry is invisible to it.
Object.defineProperty(window.midnight, crypto.randomUUID(), {
  configurable: false, writable: false, enumerable: true, value: initialAPI,
});
```

Both `InitialAPI` and the later `ConnectedAPI` must be `Object.freeze()`d (not just installed via `defineProperty` — freeze the object literal itself before assigning it as `value`).

### 2.1 The real page↔content↔background gate — verified in `messaging.ts`, reuse as-is

Traced the ACTUAL mechanism `Messaging.createProxyController()` implements (not a re-derivation from principles):

1. Page context posts `window.postMessage({method, data, target:'gerowallet', sender:'webpage', id})` (via `sendToContent`).
2. Content script's `createProxyController` listener (installed by `content.ts`) catches it, stamps `request.origin = window.origin`.
3. **Two methods bypass the pre-check and go straight to background**: `METHOD.enable` / `METHOD.isEnabled` (and the Bitcoin equivalents) — because background's own `enable` handler IS the approval gate.
4. **Every other method** first round-trips `Messaging.sendToBackground({method: METHOD.isWhitelisted, origin})`; only forwarded to background for real if that returns truthy.
5. Background's `isWhitelisted` handler calls `WalletStore.isWhitelisted(origin)`, which checks `walletStore.connectedDapps` — **loaded from the currently-active wallet's own per-wallet IndexedDB** (`wallet-{id}`, via `addConnectedDapp(walletId, domain)` in `db/wallet-db.ts`).

**Critical finding: this whitelist is already correctly scoped per Midnight vs. Cardano with ZERO new code.** Because a Midnight wallet is a distinct wallet record (`wallet.id`, `wallet-{id}` DB) from any Cardano wallet, `walletStore.connectedDapps` is a *different, independently-empty* list when a Midnight wallet is the active one. A dapp approved while a Cardano wallet was logged in does NOT appear connected when the user switches to a Midnight wallet — no extra chain-scoping logic needed; the existing per-wallet DB isolation already provides it.

**Plan: reuse `METHOD.isWhitelisted` / `WalletStore.isWhitelisted` / `WalletStore.addConnectedDapp` verbatim** for the Midnight connector gate — do not introduce a parallel whitelist table. `MIDNIGHT_METHOD.connect` is architecturally `enable`'s twin: bypasses the pre-check, does its own fast-accept-if-already-whitelisted / else-pop-approval-dialog / on-approve-call-`addConnectedDapp` flow (mirror `app.add(METHOD.enable, ...)` in `background.ts:488`). Every other `MIDNIGHT_METHOD.*` goes through the standard `isWhitelisted` pre-check in `content.ts`'s relay, unchanged.

**One Midnight-specific guard the CIP-30 pattern doesn't need**: `MIDNIGHT_METHOD.connect`'s handler must ALSO check `currentWallet.chain === Blockchain.MIDNIGHT` and reject (not silently misroute) if a non-Midnight wallet is active — mirroring the existing chain guard in `METHOD.getAddress` (`background.ts:592`, which already restricts to Cardano/Apex chains and returns `APIError.Refused` otherwise).

### 2.2 Approval surface: mini-gero side panel, no popup (revised 2026-07-10)

Phase 1 originally shipped `connect`/`signData` as standalone popup windows (`focusOrCreatePopup` + `Messaging.sendToPopupInternal`, mirroring `DappConnect.vue`/`DappSignData.vue`). Per product decision, this was retired — Midnight approvals now route EXCLUSIVELY through the mini-gero side panel, with no popup fallback.

**This is a different mechanism from the popup-view `useSidePanel` computed / `Messaging.createInternalSidePanelController` pattern** those retired components used — that pattern connects to a port named `internal-background-sidepanel-communication`, whose background-side handler (`Messaging.sendToSidePanelInternal`) is never actually called anywhere in `background.ts`. It's dead/vestigial code from an earlier side-panel design. **Do not use it for new work.**

The REAL mechanism (already used by CIP-30's `enable`/`signData`/`signTx` and Bitcoin's `enable`, `background.ts:186-285`):

- `miniGeroPorts: Map<number, chrome.runtime.Port>` — keyed by tabId, populated when the side panel's `DAppOverlay.vue` mounts and `useDAppOverlay.ts`'s `connect()` opens a port named `mini-gero-dapp-channel:${tabId}` (tabId read from a `?tabId=` query param `openSidebar` appends to the side panel's URL).
- `sendToMiniGero(method, payload, tabId)` — posts `{type:'dapp-request', method, requestId, payload}` down that port; resolves/rejects when a matching `{type:'dapp-response', requestId, data, error}` arrives (or the port disconnects, treated as a decline).
- `openSidebar(tabId, 'sidepanel/index.html')` — opens the native `chrome.sidePanel` UI; `waitForMiniGeroPort(5000, tabId)` polls until the port registers or times out.
- Primary path: if `miniGeroPorts.has(tabId)` already (panel already open for this tab, e.g. a prior `connect` call), skip straight to `sendToMiniGero`. Otherwise: `openSidebar` → `waitForMiniGeroPort` → `sendToMiniGero`. **On failure at any step (timeout, `sendToMiniGero` rejecting), reply with an error — no popup fallback.**

**Error shape over the mini-gero port is a plain string, not an object** (`reject(new Error(String(response.error)))` in `sendToMiniGero`'s resolver) — this loses the Midnight `{type, code, reason}` shape unless explicitly preserved. Fix: `DAppOverlay.vue`'s Midnight branches JSON-encode a `DAppConnectorAPIError` into that string (`midnightError(code, reason)` helper in the component); `background.ts`'s `parseMidnightMiniGeroError` JSON-decodes it back out, falling back to a synthesized `InternalError` for anything that isn't valid JSON (a genuine timeout, a non-Midnight decline string, etc). The "panel closed without responding" disconnect handler (`background.ts`'s `port.onDisconnect` listener) is similarly method-aware — `pendingDAppRequests` now stores the originating `method` alongside `tabId`/`resolve` so it can synthesize the correctly-shaped error for Midnight vs. CIP-30/Bitcoin requests sharing the same port infrastructure.

**PRF/PassKey signing in the side panel needs its own popup** — this is a platform constraint, not a UX choice, and is NOT what "retire the popup" refers to (that was about the approval PROMPT surface). WebAuthn doesn't reliably work from inside the side panel's own window (see `?mode=privateKey#/passkey-auth` used by the existing `signDataPrf`), so `signMidnightDataPrf` in `DAppOverlay.vue` opens the SAME kind of small top-level popup, now with a new `mode=rawPrf` on `PassKeyAuth.vue` that returns the raw PRF output (`evaluatePrfForWallet`) rather than a Cardano-decrypted private key — Midnight decrypts its mnemonic from the raw PRF output directly (`walletBg.signMidnightConnectorData`), unlike CIP-30's Cardano-specific `decryptPrivateKeyWithPrf` path.

## 3. Method → Gero mapping

Verified against the ACTUAL published `@midnight-ntwrk/dapp-connector-api@4.0.1` package (`npm pack` + read `dist/api.d.ts` directly) — not just the `SPECIFICATION.md` prose, which is measurably stale in two places (see §3.1). Where they conflict, the shipped `.d.ts` wins: that's what real dapps compile against.

| Spec method | Exact return type (4.0.1 `.d.ts`) | Gero source | Effort |
|---|---|---|---|
| `getUnshieldedAddress()` | `{unshieldedAddress: string}` | `midnightStore.addresses.unshielded` | ready — expose |
| `getDustAddress()` | `{dustAddress: string}` | `midnightStore.addresses.dust` | ready — expose |
| `getShieldedAddresses()` | `{shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey}` | `ShieldedAddress.codec.decode(networkId, midnightStore.addresses.shielded)` — the bech32m shielded address is a PUBLIC, reversible encoding of the two pubkeys (`wallet-sdk-address-format`'s `ShieldedAddress` class exposes `.coinPublicKeyString()`/`.encryptionPublicKeyString()`), so this needs zero mnemonic decrypt / no auth prompt | ready — pure decode of already-known public data |
| `getUnshieldedBalances()` | `Record<TokenType,bigint>` | UTxO set → sum per `tokenType` | ready — shape as record |
| `getDustBalance()` | `{cap: bigint, balance: bigint}` — **NOT a bare bigint** (`SPECIFICATION.md`'s prose snippet still shows `Promise<bigint>`; the shipped 4.0.1 type has the `cap` field, confirmed stale doc) | `midnightStore.dustState.{cap, current}` | ready — adapter |
| `getShieldedBalances()` | `Record<TokenType,bigint>` | `midnightStore.balances.nightShielded` (scalar) | small gap — need per-token record from a ShieldedWallet state; today only native scalar |
| `getTxHistory(page,size)` | `HistoryEntry[]` (`{txHash, txStatus}`) | `midnightStore.transactions` | ready — map to `{txHash, txStatus}`, paginate |
| `getConfiguration()` | `{indexerUri, indexerWsUri, proverServerUri?, substrateNodeUri, networkId}` (`proverServerUri` is `@deprecated` in favor of `getProvingProvider`) | `midnightConfig` endpoints | ready — expose indexer/ws/prover/node URIs + networkId |
| `getConnectionStatus()` | `{status:'connected', networkId} \| {status:'disconnected'}` | per-origin session state | ready |
| `submitTransaction(tx)` | `Promise<void>` | Nexus relay `submitMidnightTx` | ready — adapter |
| `signData(data, {encoding, keyType:'unshielded'})` | `{data, signature, verifyingKey}` — **NO `scheme` field in 4.0.1's actual type** (see §3.1) | `walletBg` BIP-340 sign | ready + add `midnight_signed_message:<data_size>:` prefix (mandatory, version-independent), approval dialog |
| `hintUsage(methods)` | `Promise<void>` | permission pre-hint | trivial — no-op / prewarm approval; must resolve only after any user interaction completes |
| `makeTransfer(outputs, {payFees=true})` | `{tx: string}` | our unshielded build (Nexus) + dust-balance + sign | medium — return a balanced tx instead of build-sign-submit inline; shielded outputs need the shielded builder; when `payFees:false` must NOT issue a DustSpend |
| `balanceUnsealedTransaction(tx)` / `balanceSealedTransaction(tx)` | `{tx: string}` | dust-balance logic exists but tailored to our own tx | medium/new — balance a dapp-supplied serialized tx |
| `makeIntent(inputs, outputs, {intentId, payFees})` | `{tx: string}` | none | new |
| `getProvingProvider(keyMaterialProvider)` | `ProvingProvider` (`check`/`prove`) | our proving is consent-gated cloud (Nexus/sidecar) | hard/defer — dapp supplies 10-80MB circuit key material; no artifact registry exists |

### 3.1 Verified discrepancies between `SPECIFICATION.md` (main) and the shipped `4.0.1` package

Found by downloading the real tarball (`npm pack @midnight-ntwrk/dapp-connector-api@4.0.1`) and reading `dist/api.d.ts`/`errors.d.ts`/`globals.d.ts` directly, then diffing against the `SPECIFICATION.md` prose:

1. **`getDustBalance()`** — spec prose: `Promise<bigint>`. Shipped type: `Promise<{cap: bigint; balance: bigint}>`. The doc snippet predates a real type change.
2. **`Signature.scheme`** — `SPECIFICATION.md` §Signing describes an optional `scheme?: 'ecdsa_secp256k1_sha256' | 'schnorr_bip340'` field (dual-scheme support), but the shipped 4.0.1 `Signature` type is just `{data, signature, verifyingKey}` — no `scheme` field at all. This lines up with the July 5 ecosystem audit's finding that ECDSA `signData` support is a **4.1.0-beta.1** addition (published 2026-07-02, still beta) — `SPECIFICATION.md` on `main` already documents the upcoming contract, ahead of what's stable. **Decision: implement against the 4.0.1 type exactly** (omit `scheme`) since (a) that's what dapps compiling against the stable package actually get, and (b) we only sign with BIP-340 Schnorr today, which is the spec's own documented default when the field is absent ("when it is absent, the wallet and DApp must treat the signature as `schnorr_bip340`"). Revisit when we bump to 4.1.0+.
3. **README.md `makeTransfer` example field name** — one code sample uses `tokenType: nativeToken().raw`, a second uses `type: nativeToken().raw`. The `.d.ts`'s `DesiredOutput.type` field name is correct; the first README example has a typo. Use `type`.

**Takeaway for implementation: treat the installed package's compiled `.d.ts` as ground truth for wire shapes; use `SPECIFICATION.md` only for behavioral/procedural rules (freezing, permissions, the signData prefix) where it doesn't conflict with a shipped type.**

### What each tier of methods unlocks
- **Read getters + `signData` + `submitTransaction`** → discovery, portfolio viewers, identity/attestation dapps (signData), status.
- **`makeTransfer`** → simple transfers; with our prove-on-submit sidecar this needs no `getProvingProvider`.
- **`balanceUnsealed/SealedTransaction` + `makeIntent` + `getProvingProvider`** → Compact **contract-interaction** dapps (the DeFi/gaming half). This is the real work and is gated on the proving-delegation + circuit-artifact question.

## 4. Phased plan

### Phase 1 — Discovery + read + sign + submit (bulk of the value, low risk)
Injector + `window.midnight[uuid]` + `InitialAPI` + `connect()` approval + all read getters + `signData` + `submitTransaction`. Almost entirely wiring over existing Gero functions.

New files:
- `src/chrome/injectMidnight.ts` — page-context provider (mirror `inject.ts`)
- `src/chrome/midnightWebpage.ts` — page→content bridge fns (mirror `webpage.ts`)
- `src/chrome/midnightSignDataCodec.ts` — shared strict hex/base64/text decoder for the signData preview + actual sign step (single source of truth, see §5)

Modified files:
- `src/chrome/inject.ts` — import/install the Midnight provider block
- `src/chrome/messaging.ts` — `MIDNIGHT_METHOD.connect` bypasses the whitelist pre-check (like `enable`); `popupDisconnectedError` shapes the disconnect-without-response fallback correctly per originating connector
- `src/chrome/config.ts` — `MIDNIGHT_METHOD` name registry, `MidnightErrorCode`
- `src/models/MessageTypes.ts` — `SIGN_MIDNIGHT_CONNECTOR_DATA` (options-context, called by the side panel)
- `src/chrome/background.ts` — `MIDNIGHT_METHOD.*` handlers; `connect`/`signData` route through `sendToMiniGero`/`miniGeroPorts`/`openSidebar`/`waitForMiniGeroPort` (see §2.2) — no popup fallback
- `src/chrome/walletBg.ts` — `signMidnightConnectorData` (BIP-340 sign + mandatory `midnight_signed_message:` prefix)
- `src/sidepanel/composables/useDAppOverlay.ts` — `midnight_connect`/`midnight_signData` added to `VALID_METHODS` + the `DAppRequest['method']` union
- `src/sidepanel/components/DAppOverlay.vue` — the actual approval UI: `midnight_connect` (mirrors the `enable` branch) and `midnight_signData` (mirrors the `signData` branch, using `midnightSignDataCodec.ts` for the decoded-bytes preview + malformed-input guard)
- `src/modules/authentication/views/PassKeyAuth.vue` — new `mode=rawPrf` (WebAuthn doesn't work reliably inside the side panel's own window, so PRF signing opens this as a small top-level popup, same workaround the existing CIP-30 `signDataPrf` already uses — but returns raw PRF output via `evaluatePrfForWallet`, not a Cardano-decrypted private key)
- per-origin permission store (reuses the CIP-30 dApp-whitelist mechanism, `WalletStore.connectedDapps`)

Acceptance: the official Bboard/Counter example detects Gero in its wallet list, connects (with an approval prompt), reads addresses/balances, `signData` round-trips (verifiable), and can submit a pre-built tx.

### Phase 2 — makeTransfer
Return a dust-balanced transfer tx (reuses our build + `balanceTransactions`); `submitTransaction` routes through the existing prove+submit sidecar relay. Covers simple sends for connected dapps without `getProvingProvider`.

### Phase 3 — Contract dapps
`balanceUnsealedTransaction` / `balanceSealedTransaction` / `makeIntent` + `getProvingProvider`. Depends on the proving strategy decision (cloud vs WASM) and a circuit-artifact story. Largest effort; scope after Phase 1/2 land and after the WASM-proving spike.

## 5. Security (this is a dapp-facing attack surface)

- **Per-origin permission gating.** Every `ConnectedAPI` call must verify the calling origin is connected (reuse the CIP-30 whitelist gate in `content.ts`). Two distinct semantics, verified against `SPECIFICATION.md` §Permissions — do not conflate them:
  - `Rejected` — one-time (e.g. user declines this specific transaction). Does not affect future calls.
  - `PermissionRejected` — sticky preference. Once returned for a method, the wallet must keep returning it "for the session (that is, until the browser window/tab with the DApp page is closed)". Implement as an in-memory (not `chrome.storage`-persisted) per-origin+method denial set, cleared on tab close — NOT a permanent block.
- **Approval on state-changing calls.** `connect`, `signData`, `makeTransfer`, `submitTransaction` require an explicit user prompt showing the origin. Never auto-approve.
- **XSS hygiene.** DApp-supplied `name`/`icon` are for OUR side to advertise (safe), but any dapp-provided strings we render in approval dialogs must be escaped (see `escapeHtml` in `content.ts`) and `icon` rendered only in an `<img>`, never as HTML — same rule the spec itself imposes on dapps rendering OUR name/icon (§Initial API point 6), so hold ourselves to it symmetrically for rendering the connecting dapp's own metadata (title, favicon) in the approval dialog.
- **signData prefix is mandatory, version-independent.** Prefix with `midnight_signed_message:<data_size>:` before signing, where `<data_size>` is the byte length of the UN-prefixed data (prevents a dapp from tricking the wallet into signing a raw transaction as "data"). Return `{data, signature, verifyingKey}` — no `scheme` field for our 4.0.1 pin (see §3.1; adding an extra `scheme:'schnorr_bip340'` field is harmless at runtime but not required and not present in the type we compile against).
- **No key exposure.** Signing/proving stay in the background/BG worker; the page never sees secret material. `getProvingProvider` (Phase 3) must not hand circuit-derived secrets to the page.
- **Network match.** `connect(networkId)` must reject if it doesn't match the logged-in wallet's network; `getConnectionStatus` reflects the real network.
- **No capability leakage when locked / non-Midnight.** If the active wallet isn't Midnight (or is locked), the provider is still installed for discovery but methods return `Disconnected` — mirror how `BITCOIN_DAPP_ENABLED` gates the Bitcoin surface in `inject.ts`.
- **`payFees:false` must be honored exactly.** Per spec, when `payFees` is `false` the wallet "must not issue `DustSpend` to pay fees in the transaction" — a silent fee-add when the dapp explicitly opted out is a spec violation with real financial-consent implications (the dapp/dedicated service is expected to pay instead).

## 6. Open decisions

1. ~~**apiVersion pin.**~~ **RESOLVED**: pin `apiVersion: '4.0.1'`, matching the reference implementation / 1AM (verified live via `npm view @midnight-ntwrk/dapp-connector-api dist-tags` → `latest: "4.0.1"`). Add `@midnight-ntwrk/dapp-connector-api@^4.0.1` as a dep — **dashed scope**, NOT `@midnightntwrk` (unlike the `wallet-sdk-*` packages: the canonical `@midnightntwrk/dapp-connector-api` scope currently has no stable release at all, only `4.1.0-beta.0+`/canaries — pinning canonical here would put us on a beta by accident).
2. **Which endpoints `getConfiguration` returns** — our Nexus-proxied indexer, or the public Foundation indexer the dapp's own SDK would hit. Likely the public Foundation endpoints for the dapp's read path; confirm privacy/rate-limit implications.
3. **Feature-flag gate** — put the connector behind a flag for staged rollout (mirror the `isMidnight*` feature-flag pattern).
4. **Proving delegation (Phase 3)** — cloud (consent-gated, current) vs WASM in-extension. Blocks contract dapps. Decide after the WASM MV3 spike.
5. **Multi-wallet discovery** — if the user has several Midnight wallets, do we advertise one provider (active wallet) or one per wallet? Spec supports multiple UUID keys; recommend one provider bound to the active wallet for v1.

## 7. Test matrix (from midnight-awesome-dapps)

- Official examples: **Bboard**, **Counter**, **Hello World** — canonical connect/read/sign smoke tests.
- **LunarSwap** / dMarket — transfer + (Phase 3) contract interaction.
- **Midnames** — identity, signData-heavy.
- `midnight-wallet-cli`'s `mn serve` (DApp connector server) — reference wallet to diff our behavior against.

---

## Bottom line

Phase 1 is a well-scoped, mostly-wiring task over capabilities Gero already has, and it makes Gero a discoverable Midnight wallet for the simpler half of the dapp ecosystem. Phases 2–3 add transfers and then the contract-dapp surface, with `getProvingProvider` as the one genuinely hard, decision-gated piece.
