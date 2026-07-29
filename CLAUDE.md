# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gero Wallet - Development Guide

## Overview
Cardano blockchain wallet Chrome extension (Manifest V3). Multi-chain light wallet with portfolio, staking, governance, DeFi, multi-sig, and SPO dashboard.

## Tech Stack
- **Frontend**: Vue.js 2.7 + TypeScript + Vuetify 2.7
- **Build**: Vite 4.5.5 (4 configs: main, background, content, inject)
- **State**: Custom Vue Observable stores (not Vuex)
- **DB**: Dexie 4.0.7 (IndexedDB) with versioned schemas
- **Cardano**: `@cardano-sdk/core` v0.46.9 (preferred for new features)
- **Hardware Wallets**: Ledger, Trezor, Keystone
- **Real-time**: Gero Sync — push-based WebSocket sync (`VITE_SYNC_WS_URL`)
- **Crypto**: WebAssembly (bip39, blake2b), `@noble/ciphers` (ChaCha20), `@noble/hashes` (PBKDF2)

## Project Structure
```
src/
  chrome/          # Extension: background.ts, walletBg.ts, messaging.ts, cardanoJsSdkCbor.ts
  modules/         # Feature modules (Vue components): dashboard, staking, governance, swap, pool-operator, etc.
  stores/          # Vue Observable stores: walletStore, geroStore, networkStore, poolOperatorStore, etc.
  services/        # Business logic: sync, websocket (Gero Sync), walletManager, storeMessaging
  db/              # Database: gero-db.ts (app-level), wallet-db.ts (per-wallet)
  api/             # Data clients, routed through gero-backend/Nexus: blockchain-api, nexus-tx-api, market-api, spo-api
  shared/          # Reusable: utils/, composables/, components/
  options/         # Extension options page entry
  popup/           # Extension popup entry
  sidepanel/       # Extension side panel entry
```

## Critical Patterns

### Chrome Messaging
- **Options/Browser context**: `Messaging.sendToBackgroundFromOptions()`
- **Popup context**: `Messaging.sendToBackground()`
- **Response format**: `{ data: { success, error?, result? }, target, sender }`
- **Background handler**: `app.addToOptions(MessageTypes.X, async (req, sendResponse) => { ... return true; })`

### State Management
- Stores use `broadcastFromBackground()` to sync across contexts
- **ALWAYS use in-memory state** as base for Chrome storage updates (prevents race conditions)
- Browser contexts subscribe via `storeMessaging.subscribe(STORE_NAME, handler)`

### Database
- **App-level** (`gero-db.ts`): `GeroWalletDatabase` — wallets list, config, provider
- **Per-wallet** (`wallet-db.ts`): `wallet-{id}` — transactions, addresses, config, etc.
- **Always apply schema on EVERY open**, not just creation (prevents "No Table" errors)

### Cardano SDK
```typescript
import { Cardano, Serialization } from '@cardano-sdk/core';
// Use modern SDK for new features. Conversion: cardanoJsSdkCbor.ts
```

### Transaction Fee Calculation (Conway Era)
- `cardanoJsSdkCbor.ts`: `minFee()` adds witness overhead (witnessCount × 110 bytes × minFeeCoefficient)
- `builder.ts`: Always create change output for certificate/withdrawal-only transactions
- `resolver.ts`: Recognizes Conway certificate types (Unregistration, Registration, StakeRegistrationDelegation)

## Commands
```bash
npm run dev              # Dev (all contexts)
npm run build            # Production build
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm run pack             # Package .zip/.crx/.xpi
```

## Key Rules

### ESLint
- **Fix ESLint issues in every file you touch** — resolve any existing or newly introduced ESLint errors/warnings before moving on

### i18n
- **Always use `$t()` for user-facing text** — never hardcode strings
- Translation files: `src/plugins/i18n/us.ts` (English), `de.ts` (German)
- **When adding keys to `us.ts`, always add corresponding German in `de.ts`**
- **Before creating a new i18n key, search for an existing key with the same text** (e.g., `errors.insufficientBalance` already exists — reuse it instead of creating `perpetuals.insufficientBalance`)

### Vuetify
- `v-select`, `v-autocomplete`, `v-combobox`: **Always use `attach` prop** (prevents dropdown positioning issues on scroll)

### Vue Event Handlers
- **CRITICAL**: `@click="handler"` passes Event as first arg, overriding defaults. Use `@click="handler()"` when function has default params.

### Security
- All private keys encrypted (ChaCha20-Poly1305 AEAD with PBKDF2)
- Background script isolation for sensitive operations
- Never log sensitive data
- Use `debugLog()` for dev logging

### Extension Context Detection
- Use `typeof chrome !== 'undefined' && !!chrome.runtime?.id`
- Do NOT use `import.meta.env.DEV` for URL selection (baked in at build time)

## Store Broadcasting Pattern
```typescript
function broadcastFromBackground(updates: Partial<StoreType>) {
  if (context === 'background') {
    const serialized = JSON.parse(JSON.stringify(updates, (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return Array.from(value);
      return value;
    }));
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serialized);
    const current = store; // Use in-memory state, NOT chrome.storage.local.get()
    chrome.storage.local.set({ [STORE_NAME]: { ...current, ...serialized } });
  }
}
```

## Gero Sync Real-time Service
- Push-based WebSocket sync (replaced Ably): `src/services/websocket.service.ts` + `src/services/sync.service.ts`
- Connect via `VITE_SYNC_WS_URL`; the server pushes tip/updates (no client polling)
- **Reconnect + re-subscribe on wallet switch** (subscribe to the new wallet's addresses / stake key)
- **Non-blocking connection** — don't block wallet login waiting for sync
- Use async-mutex for sync/tip processing
- Message contract invariants: `SYNC_CHECK_OK` / `CATCH_UP_COMPLETE`

## PRF (PassKey) Wallets
- Core encryption via WebAuthn PRF extension (hardware-backed)
- Credential stored in wallet record (`wallet.webAuthnCredentialId`), NOT config table
- Pure PRF: no spending password, PassKey for all operations
- Side panel: use popup window for WebAuthn (`?mode=privateKey#/passkey-auth`)
- **Never deregister PassKey from PRF wallet** (permanent lockout)
- Always backup mnemonic for PRF wallets

## Feature Notifications
- `src/shared/composables/useFeatureNotifications.ts` — hierarchical badge system
- Define features with `{ id, version, path }` in `FEATURE_DEFINITIONS`
- `isFeatureNew(id)`, `markFeatureAsSeen(id)`, `hasNewFeaturesInPath(path)`

## Feature Flags
- Self-hosted flag service (gero-sync): `src/services/featureFlag.service.ts` + `src/stores/featureFlagsStore.ts`
- Backend URL: `VITE_FLAGS_BASE_URL` (see `.env.*`)
- Flags: `isSwapEnabled`, `isGeroCardEnabled`, `isBlogEnabled`, `isGoMiningEnabled`, `isPoolOperatorEnabled`, `isPhysicalCardOrderingEnabled`, `isBitcoinEnabled` (master visibility gate for the Bitcoin chain: onboarding tile + BTC route guards + BTC nav items)
- Route gating: `isRouteUnderMaintenance()` in router.ts
- Nav hiding: check flag in NavigationDrawer.vue menu items

## Background Polling
- **Sync (Gero Sync tip push)**: Full speed when unlocked; throttled to every 2 min when locked (`walletManager.service.ts`)
- **Risk scores**: Every 12 hours (via Nexus)
- **Fiat rates (USD→EUR)**: Fetched on demand by `useCurrencyConverter.ts` via `/api/price/fiatRates`. No background polling.
- **Price data**: Provided by the market data API (`market-api.ts`, via backend), NOT by background alarms. No third-party price/mcap polling in the background.

## Performance
- Login optimized to <200ms (non-blocking sync, deferred BringCache, trusted login response)
- Use `Promise.all()` for parallel async, `setTimeout` for non-critical deferrals
- Use `performance.now()` timing logs with `⏱️ PERF:` prefix

## Common Issues
- **WASM loading**: Files must be in `public/`, check vite WASM plugins
- **Chrome messaging timeout**: Use `return true` for async handlers
- **"No Table" error**: Apply schema on every DB open
- **Store race conditions**: Always use in-memory state, not `chrome.storage.local.get()`
- **Login freezing**: Make messaging init non-blocking
- **Connection state stuck**: Use immediate `chrome.storage.local.set()` for critical states
- **Sync WS drop**: reconnect in `websocket.service.ts`; re-subscribe to addresses/stake key on wallet switch
- **"window/window" error**: Don't use `define: { 'global': ... }` with `nodePolyfills` plugin
- **pbkdf2 build issues**: Virtual module plugin with `enforce: 'pre'` in background config

## Design System (Gero Design Language)
One token layer, four surfaces, scarce chain accent, motion as feedback, enforced by a ratchet.

### Tokens
- **Canonical source**: `src/shared/styles/tokens.css` (CSS custom properties) mirrored by `src/shared/styles/_tokens.scss` (SCSS vars, auto-injected into every SFC `<style lang="scss">` via `vite.config.mts` `additionalData`). The audit fails if the two drift.
- **Surfaces** (elevation via surface + hairline, never glow): `--g-canvas` #000, `--g-surface` #0C0E12, `--g-raised` #12151B, `--g-overlay` #1A1E26. Hairlines `--g-hairline-1/2/3`. Text tones `--g-text-1/2/3` (never use white text below 0.6 alpha — use `--g-text-3`).
- **Chain accent is the ONLY per-chain color.** `useChainAccent()` (bootstrapped once in `options/App.vue`) is the sole writer of `--g-accent` / `--g-grad-1/2` (+ legacy `--chain-*` aliases). Never hardcode chain hexes; gradients only on sanctioned slots (primary CTA, active nav indicator, chain dot, header hairline).
- **Scale tokens**: radii `--g-r-chip/control/card/sheet/pill`, spacing `--g-s-1..6`, durations `--g-dur-fast/base/slow`, z-ladder `--g-z-sticky/dock/sheet/toast`, `--g-font-ui` / `--g-font-mono`.
- **Baseline** (`src/shared/styles/baseline.css`, loaded after Vuetify): type ramp (`.t-display/.t-title/.t-heading/.t-body*/.t-caption/.t-label`), `.g-num` (tabular), `.g-mono`, `.delta-up`/`.delta-down`, sentence-case buttons, the focus ring, reduced-motion collapse. Vuetify CSS is emitted twice, so overrides that must win a tie are `html`-prefixed — see `project_vuetify_css_cascade` memory.

### Primitives
- `GButton` (four tiers) and the `.geroButton` gradient CTA. `BaseDialog` is THE modal primitive (`size` prop, tokenized surface, esc-to-close, house transition). Formatting: import from `src/shared/utils/format.ts` — do NOT fork `formatPrice`/`formatSignedChange`/etc. (the audit counts forks). Deltas use `formatSignedChange()` (glyph carries direction) + `delta-up`/`delta-down`, never a colored chip.

### Gates (run before every commit; wired into the pre-commit hook)
```bash
node scripts/design/audit.mjs            # ratchet: 15 metrics vs scripts/design/budgets.json
node scripts/design/audit.mjs --write    # ratchet the budgets DOWN to current (after a net reduction)
node scripts/design/contrast.mjs         # 56 WCAG checks against the real token files
```
- The ratchet only moves down. To RAISE a budget (a token's legitimate first use, a merge): `node scripts/design/audit.mjs --rebaseline --reason="..."` and justify it in the commit message. Metrics include hex/radius/font-size/z-index distinctness, backdropFilters, uppercase, infiniteAnimations, importantCount, lowAlphaText, transitionAll, clickableDivs + outlineNone (a11y floor), and trust-surface tripwires (corruptedMdiNames, formatFnForks).
- **Working rule**: any file you touch leaves the ratchet at or below where you found it. Tokenize the values you pass; if a change is a real token first-use, rebaseline with a reason.

### Motion
Motion is feedback, not decoration. Keep spinners, ~1.4s skeleton shimmers, typing/dot indicators, and status/sync/connection pulses. Delete decorative loops (glow/breathe/float/aurora/color-shift). Durations resolve to `--g-dur-*`; prefer explicit `transition` property lists over `transition: all` (and never comma-list properties with a single trailing duration — that only animates the last one).

## External Integrations
Data layer: **Nexus** (via gero-backend) — blockchain data, prices, DeFi/swap routing, and risk scores are all brokered server-side; the client carries no third-party data keys. Real-time: **Gero Sync** (WebSocket push). Fiat on-ramp: MoonPay, Guardarian. Other: ADA Handle, Bring Cashback. Hardware: Ledger, Trezor, Keystone.

## Relevant Skills
Use these slash commands when working on this project:
- `/cardano` — Cardano transactions, staking, native tokens, UTxO model
- `/bitcoin` — Bitcoin transactions, wallets, Lightning (multi-chain support)
- `/blockchain-expert` — DeFi, smart contracts, Web3 patterns
- `/browser-extension-builder` — Chrome extension architecture, Manifest V3, content scripts, messaging
- `/i18n` — Sync and translate `us.ts`/`de.ts` language files
- `/content-design` — UI copy: button labels, error messages, tooltips, empty states
- `/frontend-design` — Production-grade Vue/Vuetify UI components
- `/senior-security` — Crypto implementation, security architecture, wallet security audits
- `/simplify` — Review changed code for quality and efficiency

---
**Last Updated**: 2026-07-29
