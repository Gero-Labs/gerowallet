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
- **Real-time**: Ably v2.11.0 (WebSocket blockchain updates)
- **Crypto**: WebAssembly (bip39, blake2b), `@noble/ciphers` (ChaCha20), `@noble/hashes` (PBKDF2)

## Project Structure
```
src/
  chrome/          # Extension: background.ts, walletBg.ts, messaging.ts, cardanoJsSdkCbor.ts
  modules/         # Feature modules (Vue components): dashboard, staking, governance, swap, pool-operator, etc.
  stores/          # Vue Observable stores: walletStore, geroStore, networkStore, poolOperatorStore, etc.
  services/        # Business logic: ably, sync, walletManager, storeMessaging
  db/              # Database: gero-db.ts (app-level), wallet-db.ts (per-wallet)
  api/             # External APIs: blockchain-api, dexhunter-api, tap-tools-api, spo-api
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

## Ably Real-time Service
- Singleton: `src/services/ably.service.ts`
- **Recreate client on wallet switch** (`setAuthParams` → `close()` → `recreateClient()`)
- **Non-blocking connection** — don't block wallet login waiting for Ably
- Use async-mutex for sync/tip processing

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
- LaunchDarkly integration: `src/stores/featureFlagsStore.ts`
- Flags: `isSwapEnabled`, `isGeroCardEnabled`, `isBlogEnabled`, `isGoMiningEnabled`, `isPoolOperatorEnabled`
- Route gating: `isRouteUnderMaintenance()` in router.ts
- Nav hiding: check flag in NavigationDrawer.vue menu items

## Background Polling
- **Sync (Ably `onTip`)**: Full speed when unlocked; throttled to every 2 min when locked (`walletManager.service.ts`)
- **Fiat rates**: Every 4 hours (`walletBg.ts startSync`)
- **Xerberus risk scores**: Every 12 hours
- **Price data**: Provided by market data API (`market-api.ts`), NOT by background alarms. No CoinGecko, ticker, DexHunter mcap, RealFi, or TapTools polling in background.

## Performance
- Login optimized to <200ms (non-blocking Ably, deferred BringCache, trusted login response)
- Use `Promise.all()` for parallel async, `setTimeout` for non-critical deferrals
- Use `performance.now()` timing logs with `⏱️ PERF:` prefix

## Common Issues
- **WASM loading**: Files must be in `public/`, check vite WASM plugins
- **Chrome messaging timeout**: Use `return true` for async handlers
- **"No Table" error**: Apply schema on every DB open
- **Store race conditions**: Always use in-memory state, not `chrome.storage.local.get()`
- **Login freezing**: Make messaging init non-blocking
- **Connection state stuck**: Use immediate `chrome.storage.local.set()` for critical states
- **Ably 401**: Recreate client in `setAuthParams()`
- **"window/window" error**: Don't use `define: { 'global': ... }` with `nodePolyfills` plugin
- **pbkdf2 build issues**: Virtual module plugin with `enforce: 'pre'` in background config

## External Integrations
Blockchain: Blockfrost, Koios, Backend API | Price: Market Data API (backend) | DeFi: DEX Hunter (swap only) | Security: Cardano Shield, Xerberus | Fiat: Moonpay, Guardarian | Other: Ably, ADA Handle, Charli3, Bring Cashback | Hardware: Ledger, Trezor, Keystone

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
**Last Updated**: 2026-03-25
