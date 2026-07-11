# gerowallet Native Embed + DexHunter Rip-out — Design Spec (#3b + #3c)

**Date:** 2026-07-03
**Status:** Draft
**Repo:** gerowallet
**Branch:** `feat/embed-swap-widget` (worktree, off `development`)

---

## 1. Goal

Make gerowallet swap through Gero's own aggregator by embedding the `<gero-swap>` web component
(built in #1/#3a) in **native mode**, replacing the three DexHunter swap UIs, and retire the
DexHunter swap-transaction paths. Preserve every non-swap consumer of the current
`dexHunterStore` (verified/blacklist/decimals/price for ~9 screens) by keeping its hydration under
a neutral name.

Two coupled deliverables:
- **#3b Embed:** vendor the widget, add a Vue2 wrapper that mounts `<gero-swap mode="native">`
  with a native signer + token resolver, and swap it in at the three mount sites.
- **#3c Rip-out:** delete the DexHunter swap-tx methods + swap branding/tagging; rename
  `dexHunterStore` → `tokenMetadataStore`, keeping its token/blacklist hydration for non-swap
  consumers.

### Non-goals
- No public partner gateway (that's #2b). Native mode uses the existing gero-backend proxy path.
- No limit orders, no built-in charts (widget is market-swap only).
- No change to the aggregator engine or nexus.
- Do NOT delete the token-metadata hydration or the ~9 non-swap consumers — only the swap-tx code.

---

## 2. Decisions (locked)

| Topic | Decision |
|---|---|
| Distribution | **Vendored bundle**: commit the widget's built `gero-swap.js` (IIFE, self-contained — bundles Vue3+Vuetify4, self-registers `<gero-swap>`) + `style.css` into gerowallet; load via `<script>`/`<link>` from `'self'`. (The ESM build externalizes `vue`, so it cannot run in the Vue2 host — the IIFE is the correct artifact.) |
| Metadata store | **Rename `dexHunterStore` → `tokenMetadataStore`, keep hydration** (`loadTokens`/`loadBlacklistPolicies`). Delete only swap-tx methods + branding. |
| Signer | Native `Signer` bridges to the existing `SIGN_TX` (partialSign → witnesses) + `walletStore` addresses/utxos — the exact contract `SwapCard.vue` already uses. |
| Token metadata | `resolveToken` backed by `useMarketData`/`resolveAsset` (market API primary, metadata store fallback). |

---

## 3. Architecture

### 3.1 Vendoring the widget

- Commit built artifacts to `src/vendor/gero-swap/gero-swap.js` and `.../gero-swap.css` (copied
  from `gero-dex-widget/packages/widget/dist/gero-swap.js` + `style.css`). Add a short
  `src/vendor/gero-swap/README.md` recording the source commit + rebuild command
  (`pnpm --filter @gero/dex-widget build`) so re-vendoring is reproducible.
- Extend the existing `rollup-plugin-copy` step (`vite.config.mts:273`) to copy
  `src/vendor/gero-swap/*` into the extension output (e.g. `extension/vendor/gero-swap/`).
- In `src/sidepanel/index.html` and `src/options/index.html`, add before the app entry:
  `<link rel="stylesheet" href="/vendor/gero-swap/gero-swap.css">` and
  `<script src="/vendor/gero-swap/gero-swap.js"></script>` (both served from `'self'` — CSP
  `script-src 'self'` allows it; `style-src *` allows the stylesheet). The IIFE self-registers
  `<gero-swap>` on load.
- Register the element with the Vue 2 compiler so it isn't treated as a Vue component: in
  `src/sidepanel/main.ts` and `src/options/main.ts`, set
  `Vue.config.ignoredElements = [...(Vue.config.ignoredElements||[]), 'gero-swap']` before mount.

CSP note: the vendored bundle must remain runtime-only (no template compiler) — guaranteed by
#3a's `verify:csp` guard. No gerowallet CSP change is needed (`connect-src` already allows
`*.gerowallet.io`; the widget's native `base-url` points at the gero-backend proxy).

### 3.2 `GeroSwapEmbed.vue` (new Vue2 wrapper)

A single thin wrapper (`src/modules/swap/components/GeroSwapEmbed.vue`) owns the bridge:

- Renders `<gero-swap mode="native" ...>` with attributes: `network`, `base-url`
  (`import.meta.env.VITE_NEXUS_URL`), `token-in`, `token-out`, `slippage`, `theme` (map the
  wallet's current theme → the widget's CSS-var theme JSON).
- Sets JS **properties** on the element (via a `ref` + `mounted`/watchers, since functions/objects
  can't be attributes):
  - `el.signer = nativeSigner` (see 3.3),
  - `el.resolveToken = resolveTokenFn` (see 3.4),
  - `el.tokens = catalog` (optional: the wallet's known token list as `TokenMeta[]`).
- Listens for the widget's events and re-emits Vue events / drives wallet UX:
  `token-change` (update any host chart/context), `swap-submitted` (`{txHash}` → toast +
  refresh tx list / pending tx), `swap-error` (`{code,message}` → toast), `quote`, `connect`
  (unused in native).
- Accepts props to preconfigure the pair (e.g. `buyTokenUnit`) so the existing entry points
  (dialog/quick-swap) can seed `token-out`.

This wrapper is the ONLY new integration surface; the three call sites just mount it.

### 3.3 Native signer (`useNativeSwapSigner.ts`)

A composable returning a `Signer` (the `@gero/dex-core` interface) backed by the extension:

```ts
const signer: Signer = {
  async getAddresses() {
    const keys = walletStore.keys;                 // { payment[], change[], stake[] }
    const used = [...keys.payment, ...keys.change].map(k => k.address);
    return { used, change: walletStore.loggedWallet.baseAddress };
  },
  async getUtxos() {
    return walletStore.utxos.map(utxoToCip30Hex);   // reuse useStrikeDeposit.ts:utxoToCip30Hex
  },
  async signTx(unsignedTxCbor) {
    return signSwapWitness(unsignedTxCbor);         // per-type dispatch, witness-set hex only
  },
  meta: { name: 'Gero' },
};
```

**CRITICAL (verified in the codebase): `SIGN_TX` alone covers only 2 of the 5 wallet types.**
`SIGN_TX` (`background.ts:1678` → `walletBg.signTx` `walletBg.ts:1547`) signs only **password**
(decrypt root key) and **PRF** (`privateKeyBytes`). **Ledger / Trezor / Keystone are signed
client-side** in the sidepanel/options context (the background has no HW private key). The agent
`SwapCard.vue` is **password-only** and explicitly notes PRF/HW are unwired — **a known gap this
design must NOT replicate**, or HW/PRF users can't swap.

`signSwapWitness(unsignedTxCbor)` therefore dispatches per active wallet type, mirroring the 5
current `SwapSheet.vue` branches, each producing a **witness-set CBOR hex** from the opaque
`unsignedTxCbor` — WITHOUT re-serializing the tx body:

- **Password** (`walletStore.loggedWallet.type === Normal`, not PRF): `VERIFY_SPENDING_PASSWORD`
  then `SIGN_TX {txCbor, partialSign:true, password, accountIndex:0, utxos, addresses,
  mergeWitnesses:false}` → `{witnesses}` (SwapSheet.vue:1043-1102).
- **PRF/PassKey** (`encryptionMethod==='prf'` / `prfEncryptedPrivateKey`+`webAuthnCredentialId`):
  PassKey popup → `SIGN_TX` with `privateKeyBytes` instead of password (SwapSheet.vue:1117-1160).
- **Ledger** (`type === Ledger`): `ledgerUtils.txToLedger(...)` → `Cardano.Signatures` →
  `Serialization.TransactionWitnessSet.fromCore({signatures}).toCbor()` (SwapSheet.vue:1176-1219).
- **Trezor** (`type === Trezor`): `MessageTypes.TREZOR {method:'signTx', txCbor}` → `.signatures` →
  `TransactionWitnessSet.fromCore({signatures}).toCbor()` (SwapSheet.vue:1230-1270).
- **Keystone** (`type === Keystone`): `createKeystoneSignRequest(...)` → QR dialog →
  `onKeystoneScan(ur)` → `parseSignature(ur).witnessSet` (SwapSheet.vue:1284-1335).

All five yield a witness-set hex; the widget's `submit` (aggregator `/submit`) finalizes. The
opaque cbor is never parsed to a Tx object in gerowallet (the HW paths that DO need a Tx object
must derive it from the SAME cbor the widget will submit, never a re-encoded one — the plan pins
the exact reused serialization).

**Reuse vs replicate:** `useTransactionSigning.handleSign()`
(`src/shared/composables/useTransactionSigning.ts:427`) already dispatches all 5 types, but is
NOT drop-in: it hardcodes `partialSign:false` (swaps need `true`), it auto-submits via `SUBMIT_TX`
(swaps need the aggregator co-sign between witness and submit), and it takes a `Cardano.Tx`
**object** not the opaque cbor. The plan's first task decides between (A) extracting/parametrizing
its per-type witness producers into a swap-friendly `signSwapWitness(cbor)` (preferred — one code
path, all wallet types, no duplication) vs (B) a new composable replicating the 5 SwapSheet
branches. Either way, HW/PRF MUST work — this is a correctness gate, not a nice-to-have.

### 3.4 Token resolver (`resolveToken`)

```ts
async function resolveToken(unit: string): Promise<TokenMeta | null> {
  if (unit === 'lovelace') return null;             // widget seeds ADA itself
  const asset = await resolveAsset({ unit });       // resolver.ts:367 (or useMarketData)
  if (asset?.metadata?.decimals == null && ...) return null; // unknown → widget blocks (UNKNOWN_TOKEN_DECIMALS)
  return { unit, decimals, ticker, name, img: asset.img, verified: asset.verified, price };
}
```

- Decimals come from `useMarketData` (market API `apiToken.decimals ?? dhToken?.decimals`) /
  `resolveAsset`. This is the fix that makes non-ADA amounts correct in the embed (the #3a widget
  now consumes it).
- `verified`/`img` from the same source; `price` optional (display only).

### 3.5 Mount-site replacement

Replace the three DexHunter swap UIs with `GeroSwapEmbed`:

- `SwapWidget.vue` usages → `GeroSwapEmbed`:
  - `src/modules/swap/Swap.vue:12` (route `/swap`)
  - `src/modules/dashboard/dialogs/SwapDialog.vue:14` (pass `buyTokenUnit`)
  - `src/modules/dashboard/views/Dashboard.vue:220` (inline column, keep `isSwapEnabled` gate)
- `SwapSheet.vue` (sidepanel flow) → a sidepanel-styled mount of `GeroSwapEmbed` (keep the sheet
  chrome/height + `isSwapEnabled` maintenance overlay; the swap body becomes the widget).
- `QuickSwap.vue` (`TokenDetailPanel.vue:145`) → `GeroSwapEmbed` seeded with the detail token as
  `token-out`.

Keep the `isSwapEnabled` feature-flag gate at all sites (`featureFlagsStore:121`,
`Dashboard.vue:204-219`, `QuickActionsBox.vue:230`). Old `SwapWidget.vue`/`SwapSheet.vue`/
`QuickSwap.vue`/`SwapOverviewOverlay.vue` are removed once no longer referenced.

### 3.6 Rebrand

- Remove "Powered by DexHunter" (`SwapWidget.vue:253-259`) — gone with the component; the widget
  carries Gero branding.
- Remove DexHunter DEX logos (`SwapOverviewOverlay.vue:92-103`) — gone with the component (route
  breakdown is now inside the widget's `RoutePanel`).
- `TransactionsCard.vue:1280-1300` `isDexHunter` tagging: keep the historical tagging for old
  DexHunter txs (already-settled orders still show), but ALSO recognize aggregator/Nexus swap txs
  (new heuristic or metadata) so new swaps are tagged correctly. Label: neutral "Swap" or "Gero
  Swap" (`transactions.dexHunter` i18n key → repurpose/rename; add German). Confirm the exact
  new-tx heuristic during planning.
- i18n: `market.verifiedTooltip` "Token identity verified by DexHunter" → neutral wording (us.ts +
  de.ts).

### 3.7 #3c — DexHunter removal + store rename

- `src/api/dexhunter-api.ts`: delete the swap-tx methods `swap`, `swapLimitBuild`, `swapSign`
  (and `reverseEstimate`/`estimate`/`getAveragePrice`/`walletBalance` if only the removed UIs used
  them — verify no other caller during planning). KEEP `getSwapTokens`, `mCap`,
  `getAllBlacklistPolicies` (metadata) unless/until migrated — they still back the store.
- Rename `dexHunterStore` → `tokenMetadataStore` (`src/stores/dexHunterStore.ts` →
  `tokenMetadataStore.ts`): keep state (`tokens` map, `blacklistPolicies`), actions
  (`loadTokens`, `loadBlacklistPolicies`, `updatePrices`, `searchTokens`, `registerAddress` — drop
  `registerAddress` if only swap used it), and the bg↔browser sync. Update the STORE_NAME
  constant + all ~9 consumers' imports (resolver.ts, useMarketData.ts, Portfolio, Send, Assets,
  TokenSelector, SelectTokenDialog, AssetsToSendStep, walletManager.service.ts hydration).
- Keep `walletManager.service.ts:415,423` hydration (now calling the renamed store).
- Remove `dexHunterLogo` asset export (`assets.ts:144,378`) + `src/assets/svg/dexhunter.svg` once
  unreferenced.

Naming: keep it mechanical — a rename + import updates, not a rewrite of the ~9 consumers.

---

## 4. Data flow (native swap)

```
GeroSwapEmbed mounts <gero-swap mode=native>, sets signer + resolveToken
  user picks tokens/amount inside the widget
  widget resolveToken(unit) -> gerowallet useMarketData/resolveAsset -> decimals/verified
  widget: quote (gero-backend /api/nexus/api/aggregator/quote, native base-url)
  user clicks Swap -> widget buildTx -> signer.signTx(cbor) -> SIGN_TX (bg, partialSign) -> witnesses
  widget submit({unsignedTxCbor, userWitnessHex}) -> aggregator co-signs + submits -> txHash
  widget emits swap-submitted -> GeroSwapEmbed toast + refresh pending tx
```

---

## 5. Security (OX)

- Opaque cbor end-to-end: `signTx` passes `unsignedTxCbor` untouched to `SIGN_TX` (partialSign),
  returns witness only; submit sends the same cbor. No re-serialization in gerowallet.
- Native mode sends NO partner key (trusted first-party proxy path); `base-url` is the configured
  gero-backend host, never user-derived.
- `resolveToken`/token display data is untrusted → the widget already renders as text; gerowallet
  passes plain values.
- Removing DexHunter swap must not remove the blacklist/verified checks the wallet relies on for
  scam-token warnings (they live in `resolver.ts` via the store) — the store rename preserves them.
- No secrets logged; reuse `debugLog`.

---

## 6. Testing

- `useNativeSwapSigner`: getAddresses maps `walletStore.keys`; getUtxos maps via `utxoToCip30Hex`;
  signTx posts `SIGN_TX` with `partialSign:true` and returns `witnesses`; error path throws on
  missing witnesses. (Mock `Messaging`/`walletStore`.)
- `resolveToken`: returns null for `lovelace`; maps `resolveAsset`/`useMarketData` output to
  `TokenMeta` with correct decimals; returns null when decimals unknown.
- `GeroSwapEmbed`: sets `signer`/`resolveToken`/`tokens` properties + attributes on the element;
  re-emits `swap-submitted`/`swap-error`; seeds `token-out` from prop.
- Store rename: `tokenMetadataStore` hydration + the non-swap consumers still resolve
  verified/decimals/blacklist (a smoke test over `resolver.ts` reading the renamed store).
- Manual/e2e (plan notes): a preprod swap through the embedded widget end-to-end once #2a's backend
  route is live (build → SIGN_TX → submit → txHash).

---

## 7. Risks / open questions

- **HW-wallet / PRF signing (RESOLVED — see §3.3):** confirmed `SIGN_TX` covers only
  password+PRF; Ledger/Trezor/Keystone sign client-side. `signSwapWitness(cbor)` dispatches all 5
  types (extract from `useTransactionSigning` per §3.3 fork A, or replicate SwapSheet's 5
  branches). Correctness gate: HW/PRF swaps MUST work. Because the widget owns the swap UI, the
  signer runs when the widget calls `el.signer.signTx(cbor)` — the Keystone QR dialog + PassKey
  popup are host-rendered by `GeroSwapEmbed` (the widget's `signTx` promise stays pending until the
  host resolves the scan/popup). The plan pins how `GeroSwapEmbed` surfaces those host dialogs.
- **Sidepanel vs options context:** `SIGN_TX` is registered via `addToOptions` (options + sidepanel).
  Confirm `sendToBackgroundFromOptions` works from both the sidepanel sheet and the options dialog
  mount of `GeroSwapEmbed`.
- **Vuetify 4 (widget) vs Vuetify 2 (host) CSS bleed:** widget uses light DOM (per #1). The
  vendored `style.css` is global — confirm it's scoped enough (`.gero-swap-root`/Vuetify-4 classes)
  not to restyle the Vue2 host, or scope it. (Prefix/scope during planning if bleed is observed.)
- **New-tx tagging heuristic:** how to recognize aggregator swap txs in `TransactionsCard` (order
  address / metadata) — define during planning.
- **`SwapSheet.vue` HW breadth:** it's the largest current file; replacing it with the widget must
  preserve the sidepanel UX (sheet height, back nav). Plan scopes this carefully.
