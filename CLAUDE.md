# Gero Wallet - Claude Development Guide

## Project Overview

**Gero Wallet** is a comprehensive Cardano blockchain wallet browser extension (v2.6.0) built as a Chrome Manifest V3 extension. It's a multi-chain light wallet that bridges Web2 and Web3 technologies, providing users with portfolio management, staking, governance, DeFi, and multi-signature wallet capabilities.

## Tech Stack & Architecture

### Core Technologies
- **Frontend**: Vue.js 2.7 + TypeScript + Vuetify 2.7 (Material Design)
- **Build System**: Vite 4.5.5 with 4 separate configurations
- **State Management**: Custom Vue Observable stores (not Vuex)
- **Database**: Dexie 4.0.7 (IndexedDB wrapper) with versioned schemas
- **Cardano Integration**:
  - `@cardano-sdk/core` v0.46.9 (primary, modern SDK - **preferred for new features**)
- **Hardware Wallets**: Ledger (@cardano-foundation/ledgerjs-hw-app-cardano v7.1.4), Trezor (@trezor/connect-webextension v9.6.2), Keystone (@keystonehq/keystone-sdk v0.8.0)
- **Real-time Communication**: Ably v2.11.0 (WebSocket-based blockchain updates)
- **Cryptography**: WebAssembly for performance-critical operations (bip39, blake2b)
- **Concurrency Control**: async-mutex v0.5.0 (prevents race conditions in sync operations)

### Build Configurations (Vite)
```
vite.config.mts              - Main web app and options page
vite.config.background.mts   - Service worker (background script)
vite.config.content.mts      - Content scripts (inject into web pages)
vite.config.inject.mts       - Page injection scripts (window.cardano API)
```

## Project Structure

```
src/
   chrome/                    # Extension-specific code
      background.ts          # Service worker (main background script)
      walletBg.ts           # Wallet operations in background context
      messaging.ts          # Chrome messaging system
      storeMessagingBg.ts   # Background store messaging broadcaster
      serialization.ts      # Cardano serialization utilities (legacy CSL)
      cardanoJsSdkCbor.ts   # SDK ↔ CSL CBOR conversion + fee calculation utilities
      auth.ts               # Google authentication
   modules/                  # Feature modules (Vue components)
      assets/              # Asset management and token details
      blog/                # In-app blog and news
      cashback/            # Bring cashback integration
      dashboard/           # Portfolio, assets, quick actions
      devTools/            # Developer tools and debugging
      governance/          # Cardano governance (CIP-1694) and DRep
      media-player/        # Audio/music player integration
      multisig/            # Multi-signature wallet functionality
      navigation/          # App navigation, layout, router
      staking/             # Cardano staking and delegation
      swap/                # DeFi and token swapping
      transactions/        # Transaction history and details
      wallet/              # Gero Card (debit card) integration
      welcome/             # Onboarding and wallet creation
   stores/                  # Vue Observable state management
      bringStore.ts        # Bring cashback state
      charli3Store.ts      # Charli3 oracle data
      coinGeckoStore.ts    # CoinGecko price data
      dexHunterStore.ts    # DEX Hunter swap aggregation
      geroStore.ts         # Global app state (wallets list, config)
      governanceStore.ts   # Governance and DRep state
      loading.ts           # Loading state management
      musicStore.ts        # Music player state
      networkStore.ts      # Network/provider management (tip, epoch params)
      priceStore.ts        # Real-time price data (Kraken WebSocket)
      realFiStore.ts       # RealFi integration state
      stakingStore.ts      # Staking pools and delegation state
      tapToolsStore.ts     # TapTools analytics
      walletStore.ts       # Active wallet state (UTXOs, keys, addresses)
      xerberusStore.ts     # Xerberus risk ratings
   services/                # Business logic services
      ably.service.ts                  # Real-time blockchain updates (WebSocket)
      kaiserEx.service.ts              # KaiserEx integration
      krakenWebSocket.service.ts       # Real-time price data
      messageReconstruction.service.ts # Reassemble large Ably messages
      storageObserver.service.ts       # Chrome storage change observer
      storeMessaging.service.ts        # Browser-side store sync
      sync.service.ts                  # Wallet sync orchestration
      walletManager.service.ts         # Wallet lifecycle management
   db/                      # Database layer (Dexie/IndexedDB)
      gero-db.ts           # Application-level database (wallets list)
      wallet-db.ts         # Wallet-specific databases
      schema.ts            # Database schema versions
      portfolio-cache.ts   # Portfolio data caching
   api/                     # External API integrations
      api.ts               # Base API class
      blockchain-api.ts    # Cardano blockchain data (Blockfrost, Koios)
      cardano-shield-api.ts # Transaction risk assessment
      cashback-api.ts      # Cashback integration
      charli3-api.ts       # Oracle price feeds
      clarity-api.ts       # Clarity Protocol integration
      crypto-api.ts        # Cryptocurrency market data
      dexhunter-api.ts     # DEX aggregation and swaps
      moonpay-api.ts       # Fiat on-ramp
      realfi-api.ts        # RealFi protocol
      tap-tools-api.ts     # Token analytics and portfolio tracking
   shared/                  # Reusable components and utilities
      utils/               # Utility functions
         builder.ts        # Transaction builder (Cardano JS SDK)
         resolver.ts       # Address/key resolvers and signature analysis
         crypto.ts         # Encryption/decryption utilities
         errorHandler.ts   # Error handling utilities
      composables/         # Vue composables
      components/          # Shared Vue components
   options/                 # Extension options page entry point
   popup/                   # Extension popup entry point
   sidepanel/              # Extension side panel entry point
```

## Key Development Patterns

### 1. **Chrome Extension Architecture**
- **Manifest V3** with service worker (background.ts runs in background context)
- Background script handles wallet operations, crypto, and sensitive data
- Content scripts inject wallet API into web pages (window.cardano)
- Options page provides full wallet interface (Vue.js SPA)
- Multiple entry points: popup, options, sidepanel

### 2. **State Management**
Uses custom Vue Observable stores instead of Vuex:
```typescript
// Example store pattern
const store = Vue.observable({
  state: { ... },
  mutations: { ... }
});
```

**Key stores:**
- `geroStore` - Global app state (wallets list, config, network selection)
- `walletStore` - Active wallet data (UTXOs, addresses, transactions, keys)
- `networkStore` - Network/provider management (tip, epoch params, genesis)
- `priceStore` - Real-time price data from Kraken WebSocket
- Feature stores: `stakingStore`, `governanceStore`, `dexHunterStore`, `tapToolsStore`, etc.

**Critical Store Patterns:**
- Stores use `broadcastFromBackground()` to sync state across contexts
- Browser contexts subscribe via `storeMessaging.subscribe(STORE_NAME, updateHandler)`
- **Always use current in-memory state** as base for Chrome storage updates (prevents race conditions)

### 3. **Database Layer**

#### Two-Tier Database Architecture
The application uses a two-tier database system:

1. **Application-Level Database** (`src/db/gero-db.ts`)
  - **Purpose**: Global application data (wallets list, providers, global config)
  - **Database Name**: `GeroWalletDatabase` (single instance)
  - **Tables**: `wallets`, `config`, `provider`
  - **Access**: Use `getDb()` and helper functions (`getAllWallets()`, `createNewWallet()`, etc.)

2. **Wallet-Specific Databases** (`src/db/wallet-db.ts`)
  - **Purpose**: Individual wallet data (transactions, addresses, contacts, etc.)
  - **Database Name**: `wallet-{walletId}` (one per wallet)
  - **Tables**: `config`, `sync`, `account`, `addresses`, `contacts`, `rewards`, `transactions`, `connected_dapps`, `multisig`
  - **Access**: Use `getDb(walletId)` and helper functions

**Database Versioning Pattern:**
```typescript
// Schema versions control migrations
db.version(1).stores({ wallets: '++id, name, type' });
db.version(2).stores({ wallets: '++id, name, type, publicKey' });
// ... apply schema on EVERY open, not just creation
```

**Critical Database Rules:**
- **Always apply schema when opening databases** to prevent "No [Table] Table" errors
- Use centralized `getDb()` functions - don't create custom database instances
- Database caching prevents reopening the same database multiple times
- Each wallet has its own isolated database to prevent data contamination

### 4. **Cardano Integration**
- Modern: `@cardano-sdk/core` (preferred for new features)
- Conversion utilities in `cardanoJsSdkCbor.ts` for interoperability

**Preferred Pattern for New Features:**
```typescript
import { Cardano, Serialization } from '@cardano-sdk/core';

// Use modern SDK
const tx: Cardano.Tx = { ... };
const serialized = Serialization.Transaction.fromCore(tx).toCbor();
```

### 5. **Hardware Wallet Pattern**
Hybrid approach for hardware wallets:
1. Background prepares transaction data
2. Frontend handles device communication (WebUSB, WebBLE, QR codes)
3. Background receives signed transaction and submits

**Supported Hardware Wallets:**
- **Ledger**: WebUSB (desktop) and WebBLE (mobile) communication
- **Trezor**: Connect API with webextension transport
- **Keystone**: QR code-based air-gapped communication

### 6. **Real-time Communication (Ably Service)**

The application uses Ably Realtime WebSocket service for blockchain updates:

**Service Location**: `src/services/ably.service.ts` (singleton)

**Integration Points:**
- `src/services/walletManager.service.ts` - Wallet lifecycle management
- `src/chrome/background.ts` - Background script integration

**Channel Types:**
- **Private Channels**: User-specific sync messages (address-based, e.g., `stake1u...`)
- **Group Channels**: Network-wide blockchain updates (e.g., `CARDANO.MAINNET`)

**Authentication Pattern:**
```typescript
// Critical: Always recreate client when switching wallets
public setAuthParams(chain: string, network: string, address: string): void {
  this.authParams = { chain, network, address };
  this.close();
  this.recreateClient(); // Fresh authentication state
}
```

**Key Patterns:**
- **Complete Client Recreation**: Recreate Ably client instance when switching wallets
- **AuthCallback Mechanism**: Fetch fresh tokens from API for each wallet context
- **Non-Blocking Connection**: Ably connects in background, doesn't block wallet login
- **Mutex Protection**: Use async-mutex for sync/tip processing (prevents race conditions)

**CRITICAL OPTIMIZATION**: Ably connection happens **fully in background** during wallet initialization:
```typescript
// DON'T block login waiting for Ably
(async () => {
  ablyService.connect();
  // Wait for connection (non-blocking)
  // Subscribe to channels after connected
})(); // Execute immediately but don't await
```

### 7. **Store Messaging System**

The application uses a dual messaging system for cross-context communication:

1. **Browser Context** (`src/services/storeMessaging.service.ts`)
  - Subscribes to store updates from background
  - Uses `chrome.runtime.connect` for WebSocket-like connection
  - Non-blocking initialization to prevent login freezing

2. **Background Context** (`src/chrome/storeMessagingBg.ts`)
  - Broadcasts store updates to all connected browser contexts
  - Port-based broadcasting to multiple windows/tabs
  - Serializes complex data types (BigInt, Map, Set)

**Critical Pattern - Race Condition Prevention:**
```typescript
// ALWAYS use current in-memory state, NOT chrome.storage.local.get()
function broadcastFromBackground(updates: Partial<WalletStore>) {
  const current = walletStore; // NOT from storage!
  const finalState = { ...current, ...serializedUpdates };
  chrome.storage.local.set({ [STORE_NAME]: finalState });
}
```

**Serialization Handling:**
```typescript
// Handle complex data types
const serializedUpdates = JSON.parse(JSON.stringify(updates, (key, value) => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return Array.from(value);
  return value;
}));
```

## Performance Optimizations

### Wallet Login Performance
Recent optimizations reduced wallet login time from **~11 seconds to <200ms**:

1. **API Provider Optimization** (`src/api/api.ts:165`)
  - Changed `getTip()` from KOIOS to BLOCKFROST provider (saved ~400ms)

2. **Non-Critical Data Deferral** (`src/services/walletManager.service.ts:404-412`)
  - DexHunter tokens/blacklists load in background (`setTimeout`, saved ~26ms)
  - BringCache loads in background (saved ~349ms)

3. **Ably Non-Blocking Connection** (`src/services/walletManager.service.ts:299-391`)
  - Ably connection happens fully in background (saved **~10,000ms**)
  - No longer blocks `Promise.all(promises)` in wallet initialization

4. **Chart Data Deferral** (`src/modules/navigation/components/Sparkline.vue:59-64`)
  - Kraken chart data loads after 500ms delay (saved ~181ms)

5. **Login Response Trust** (`src/options/modules/welcome/components/WalletsListLogin.vue:100-115`)
  - Replaced 5-second polling loop with response-based flow (saved up to 5000ms)
  - Trust background response + 100ms propagation delay

**Performance Monitoring:**
- Use `⏱️ PERF:` console logs to track timing
- `performance.now()` for high-precision timing
- Each critical operation logs its duration

## Development Commands

### Development
```bash
npm run dev              # Hot reload development (all contexts)
npm run dev-firefox      # Firefox development build
npm run dev:options      # Options page only
npm run dev:background   # Background script only
npm run dev:content      # Content scripts only
npm run dev:inject       # Inject scripts only
```

### Build & Package
```bash
npm run build           # Production build (all contexts)
npm run build:beta      # Beta build with beta environment
npm run pack            # Create .zip/.crx/.xpi packages
npm run pack:zip        # Create .zip only
npm run pack:zip:beta   # Create beta .zip
```

### Utilities
```bash
npm run clear           # Clean build artifacts
npm run typecheck       # TypeScript compilation check
npm run lint            # ESLint check
```

## Common Development Tasks

### 1. **Adding New Features**
- Create module in `src/modules/[feature]/`
- Add corresponding store if needed (`src/stores/[feature]Store.ts`)
- Update routing in `src/modules/navigation/router.ts`
- Add API integration in `src/api/[feature]-api.ts`
- Follow existing module structure (components, dialogs, views)

### 2. **Chrome Messaging**
Use the established messaging pattern with the **correct method** based on context:

**CRITICAL**: Use the correct messaging method based on where the code runs:
- **Options/Browser Context** (e.g., dialogs, components in `src/modules/`): Use `Messaging.sendToBackgroundFromOptions()`
- **Popup Context** (e.g., `src/popup/`): Use `Messaging.sendToBackground()`

```typescript
// OPTIONS/BROWSER CONTEXT (src/modules/dashboard/dialogs/*, etc.)
// Use sendToBackgroundFromOptions
const { Messaging } = await import('@/chrome/messaging');
const { MessageTypes } = await import('@/models/MessageTypes');

const response = await Messaging.sendToBackgroundFromOptions({
  method: MessageTypes.VERIFY_SPENDING_PASSWORD,
  data: { password }
});

// IMPORTANT: Response structure wraps data in a 'data' property
// Response format: { data: { success: boolean, error?: string }, target: string, sender: string }
if (!response.data.success) {
  throw new Error(response.data.error || 'Operation failed');
}

// POPUP CONTEXT (src/popup/*)
// Use sendToBackground
const response = await Messaging.sendToBackground({
  method: MessageTypes.SIGN_TX,
  data: { tx, password, ... }
});

// Same response structure: access via response.data.success, response.data.error, etc.
if (!response.data.success) {
  throw new Error(response.data.error || 'Operation failed');
}

// Background handler (background.ts)
// Use app.addToOptions for messages from options/browser context
app.addToOptions(MessageTypes.VERIFY_SPENDING_PASSWORD, async (request, sendResponse) => {
  try {
    const result = await walletBg.verifySpendingPassword(request.data.password);
    sendResponse({
      id: request.id,
      data: { success: true, result }, // Wrap in 'data' property
      target: TARGET,
      sender: SENDER.extension
    });
  } catch (error) {
    sendResponse({
      id: request.id,
      data: { success: false, error: error.message }, // Wrap in 'data' property
      target: TARGET,
      sender: SENDER.extension
    });
  }
  return true; // IMPORTANT: return true for async handlers
});
```

### 3. **Database Operations**
Follow the database patterns:
```typescript
// Application-level (wallets list)
import { getAllWallets, createNewWallet } from '@/db/gero-db';
const wallets = await getAllWallets();
const walletId = await createNewWallet(name, icon, theme, mnemonic, password, chain, network);

// Wallet-specific (transactions, addresses)
import { getDb } from '@/db/wallet-db';
const db = await getDb(walletId);
const transactions = await db['transactions'].toArray();
```

### 4. **Cardano Operations**
Use modern Cardano JS SDK for new features:
```typescript
import { Cardano, Serialization } from '@cardano-sdk/core';

// Build transaction with modern SDK
const tx: Cardano.Tx = { ... };
const serialized = Serialization.Transaction.fromCore(tx).toCbor();

// Convert between CSL and SDK
import { deserializeCardanoJsSdkTx, serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
const sdkTx = deserializeCardanoJsSdkTx(cslTx);
const cslTx = serializeCardanoJsSdkTx(sdkTx);
```

### 5. **Store Updates**
Follow the store broadcasting pattern:
```typescript
// In store file (runs in both contexts)
import { getContextType } from '@/utils/storageSync';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

const context = getContextType();

function broadcastFromBackground(updates: Partial<StoreType>) {
  if (context === 'background') {
    const serializedUpdates = JSON.parse(JSON.stringify(updates, serializer));
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Persist to storage as fallback
    const current = store; // Use in-memory state!
    chrome.storage.local.set({ [STORE_NAME]: { ...current, ...serializedUpdates } });
  }
}

// Browser context subscribes
if (context === 'browser') {
  storeMessaging.subscribe(STORE_NAME, (updates) => {
    Object.assign(store, updates);
  });
}
```

## Security Considerations

### 1. **Private Key Handling**
- All private keys encrypted with AES-256 (`crypto-ts` library)
- Background script isolation for sensitive operations
- Hardware wallet integration for enhanced security (Ledger, Trezor, Keystone)
- Spending password required for all transactions
- Mnemonic phrases encrypted separately (optional, can be derived from private key)

### 2. **DApp Integration**
- Connection approval system (user must approve each DApp)
- Transaction risk assessment via Cardano Shield API
- Domain whitelisting and blacklisting
- Limited permissions (only expose requested APIs)
- Secure message passing between page and extension

### 3. **Messaging Security**
- Validated message types (MessageTypes enum)
- Secure communication between contexts (Chrome runtime messaging)
- Error handling without sensitive data exposure
- No sensitive data in console logs (use debugLog for development)

### 4. **Data Encryption**

**High-Level Encryption** (for mnemonics and general data):
```typescript
import { encrypt, decrypt } from '@/shared/utils/crypto';

// Encrypt sensitive data (uses CryptoTS AES)
const encryptedMnemonic = encrypt(mnemonic, password);

// Decrypt when needed
const decryptedMnemonic = decrypt(encryptedMnemonic, password);
```

**Private Key Encryption** (ChaCha20-Poly1305 AEAD with PBKDF2):
```typescript
import { encryptWithPassword, decryptWithPassword } from '@/shared/utils/crypto';

// Encrypt private key bytes (returns hex string)
const encrypted = encryptWithPassword(password, rootKeyBytes);

// Decrypt to get Buffer
const decrypted = decryptWithPassword(password, encrypted);
```

**Implementation** (`src/shared/utils/crypto.ts`):
- ChaCha20-Poly1305 AEAD with PBKDF2-HMAC-SHA512 (19,162 iterations)
- Format: `salt (32B) + nonce (12B) + tag (16B) + ciphertext` (tag BEFORE ciphertext)
- 100% compatible with CSL's `encrypt_with_password`/`decrypt_with_password` (EMIP3)
- Libraries: `@noble/ciphers`, `@noble/hashes`

## External Integrations
- **Blockchain**: Blockfrost (primary), Koios, Backend API
- **Price Data**: Kraken WebSocket, CoinGecko
- **DeFi**: DEX Hunter, TapTools, Strike Finance
- **Security**: Cardano Shield, Xerberus
- **Fiat**: Moonpay, Guardarian
- **Other**: Ably, ADA Handle, Charli3, Bring Cashback
- **Hardware Wallets**: Ledger, Trezor, Keystone

## Common Issues & Solutions

### 1. **WASM Loading Issues**
- Ensure WASM files are in `public/` directory
- Check vite config for proper WASM handling (`vite-plugin-wasm`, `vite-plugin-top-level-await`)
- Verify service worker WASM loading (may need special handling in Manifest V3)

### 2. **Chrome Messaging Timeouts**
- Use `return true` in background handlers for async operations
- Implement proper error handling with try/catch
- Check for service worker lifecycle issues (inactive after 30 seconds)
- Use `chrome.runtime.sendMessage` with response callbacks

### 3. **TypeScript Errors**
- Project uses relaxed TypeScript rules (`noImplicitAny: false`)
- Some `@ts-ignore` comments for rapid development
- Focus on functionality over strict typing
- Run `npm run typecheck` to catch compilation errors

### 4. **Cardano SDK Migration**
- Use conversion utilities in `cardanoJsSdkCbor.ts` for CSL ↔ SDK transitions
- Test both legacy and modern code paths during migration
- Gradual migration approach (don't break existing functionality)

### 8. **Transaction Fee Calculation (Conway Era)**
**Critical Fix** (2025-01-14): Proper fee calculation for Conway-era certificate transactions

**Problem**: Delegation and unstaking transactions were failing with `FeeTooSmallUTxO` errors because:
1. Fee calculation didn't account for witness overhead during CBOR serialization
2. Change outputs weren't resolved before fee calculation (missing ~1-2KB in transaction size)
3. Conway-era certificates (`Unregistration`, `Registration`, `StakeRegistrationDelegation`) weren't recognized for signature detection

**Solution implemented in**:
- `src/chrome/cardanoJsSdkCbor.ts` - `BrowserTxConstruction.minFee()` now adds witness overhead
- `src/shared/utils/builder.ts` - `changeAddressResolver` always creates change output for certificate/withdrawal-only transactions
- `src/shared/utils/resolver.ts` - `analyzeTransactionForSignatures()` recognizes Conway-era certificate types

**Key Pattern for Certificate Transactions**:
```typescript
// ALWAYS create change output for transactions with certificates but no explicit outputs
const isCertificateOrWithdrawalOnly = (certificates.length > 0 || withdrawals.length > 0)
                                       && selectionSkeleton.outputs.size === 0;

if (isCertificateOrWithdrawalOnly) {
  // Always create change output with minimum 1 ADA
  // This ensures CBOR size calculation includes the change output
  return [changeOutput];
}
```

**Fee Calculation Flow**:
1. SDK's `minFee()` calculates base fee from CBOR size
2. Estimate required signatures (payment key + stake key for staking ops)
3. Add witness overhead: `witnessCount × 110 bytes × minFeeCoefficient`
4. Total fee = base fee + witness overhead

**Conway-Era Certificate Types**:
- `CertificateType.Unregistration` - Unstake (replaces legacy `StakeDeregistration`)
- `CertificateType.Registration` - Register stake key (replaces legacy `StakeRegistration`)
- `CertificateType.StakeRegistrationDelegation` - Register + delegate in one certificate
- `CertificateType.StakeDelegation` - Delegate to pool (no registration)
- All certificates must include `deposit` field for registration operations

### 5. **Database Issues**
- **"No Addresses Table" Error**: Forgot to apply schema when opening database
  - Solution: Always call `db.version(walletDBVersion).stores(walletDBSchema)` before `db.open()`
- **Missing Tables**: Schema not applied in opening path
  - Solution: Apply schema on EVERY open, not just creation
- **Race Conditions**: Using stale storage data instead of in-memory state
  - Solution: Always use current store state as base for updates

### 6. **Store Sync Issues**
- **Keys Not Persisting**: Race condition in `broadcastFromBackground`
  - Solution: Use `const current = walletStore;` NOT `chrome.storage.local.get()`
- **Login Freezing**: Messaging service blocking initialization
  - Solution: Make messaging initialization non-blocking
- **Cross-Context Updates**: Store not syncing between contexts
  - Solution: Check port connections, verify `broadcastUpdate()` is called
- **Connection State Stuck on "Connecting"**: Race condition where browser context initializes after Ably connects
  - Problem: Port connection happens AFTER critical state changes (connected/connecting), so browser hydrates stale data from debounced storage writes
  - Solution: Use immediate `chrome.storage.local.set()` for critical connection states instead of debounced writes (300ms delay)
  - Implementation (`src/stores/loading.ts`):
    ```typescript
    function broadcastFromBackground(updates: Partial<LoadingState>, immediate = false) {
      if (context === 'background') {
        Object.assign(loadingState, updates);
        backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

        // For critical state changes (connected/connecting), write immediately
        if (immediate || 'connected' in updates || 'connecting' in updates) {
          if (storageWriteTimeout) {
            clearTimeout(storageWriteTimeout);
            storageWriteTimeout = null;
          }
          chrome.storage.local.set({ [STORE_NAME]: loadingState });
          console.log('💾 LoadingState persisted immediately:', updates);
        } else {
          // Debounced storage write for other updates
          if (storageWriteTimeout) clearTimeout(storageWriteTimeout);
          storageWriteTimeout = setTimeout(() => {
            chrome.storage.local.set({ [STORE_NAME]: loadingState });
          }, 300);
        }
      }
    }
    ```

### 7. **Ably Connection Issues**
- **Channel Denied Access (401)**: Stale authentication tokens
  - Solution: Recreate client instance in `setAuthParams()`
- **ClientId Mismatch**: Cached clientId from previous wallet
  - Solution: Clear clientId in `connect()`, detect mismatches in authCallback
- **Slow Login**: Ably connection blocking wallet initialization
  - Solution: Connect in background async IIFE, don't await

### 8. **"window/window" Module Resolution Error**
**Problem**: Conflicting `global` variable handling between Vite's `define` and `nodePolyfills` plugin caused spurious `import ... from "window/window"` statements.

**Solution**: Don't use `define: { 'global': ... }` when using `vite-plugin-node-polyfills` with `globals: { global: true }`. Let the plugin handle it exclusively.

### 9. **pbkdf2 Build Issues (CommonJS/ESM Interop)**
**Problem**: Race condition where Rollup processed pbkdf2 before commonjs plugin transformed it.

**Solution**: Virtual module plugin in `vite.config.background.mts` that intercepts pbkdf2 imports with `enforce: 'pre'` and provides proper ESM exports.

### 10. **PRF (PassKey) Wallet Patterns**
**Implementation**: WebAuthn PRF extension for hardware-backed biometric wallet encryption (Phases 1-7 complete)

**Documentation**: See `PRF_IMPLEMENTATION_COMPLETE.md` and `PRF_PHASE_7_UX_ENHANCEMENTS.md` for comprehensive details

#### PRF Wallet Credential Storage Pattern

**Critical Rule**: PRF wallets store WebAuthn credential ID in wallet record; normal wallets use config table.

```typescript
// ALWAYS use this pattern for credential detection
const isPrfWallet = wallet?.encryptionMethod === 'prf';
const credentialId = isPrfWallet
  ? wallet.webAuthnCredentialId  // From wallet record
  : await configTable.where({ key: 'webAuthnCredentialId' }).first()?.value;  // From config table
```

**Applies To**:
- Lock settings dialog (registration status detection)
- Unlock wallet dialog (PassKey button visibility)
- Security tab (credential detection)
- Any component checking PassKey registration

**Why**: PRF wallets use credential ID for core encryption (stored in wallet record). Normal wallets use PassKey for autofill convenience only (stored in config).

#### WebAuthn in Chrome Extensions (Side Panel Pattern)

**Problem**: WebAuthn requires user activation (popup windows), doesn't work in side panels.

**Solution**: Hybrid approach with small popup for authentication only

```typescript
// 1. Detect side panel context
const isSidePanel = window.location.href.includes('tabId=');

if (isSidePanel) {
  // 2. Open PassKeyAuth popup - CRITICAL: Query params BEFORE hash
  const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
  const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

  // 3. Listen for result via postMessage
  const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== extensionOrigin) return;

    if (event.data.type === 'PASSKEY_AUTH_RESULT') {
      const { success, privateKeyBytes, error } = event.data.payload;
      // Handle result
    }
  });
} else {
  // Already in popup - direct WebAuthn call
  const privateKeyBytes = await decryptPrivateKeyWithPrf(...);
}
```

**Key Points**:
- Side panel: Persistent UI, better UX
- Small popup: Only for WebAuthn (auto-closes)
- Query params: Must come BEFORE hash (`?mode=privateKey#/route`)
- Communication: `postMessage` API bridges contexts
- Origin validation: Always check `event.origin`

**Files Implementing This Pattern**:
- `src/popup/modules/views/DappSignData.vue` - Side panel detection
- `src/modules/authentication/views/PassKeyAuth.vue` - Popup authentication handler
- `src/chrome/config.ts` - `passKeyAuth: 'passkey-auth'` popup type

#### Wallet Lock vs Transaction Security (PRF Wallets)

**Critical Distinction**: PRF wallets have TWO separate security layers

| Layer | Purpose | PRF Wallets | Normal Wallets |
|-------|---------|-------------|----------------|
| **Core Encryption** | Protect private keys | PassKey (hardware-backed) | Spending password (software) |
| **Auto-Lock** | Lock UI after idle | PIN/Pattern/Lock Password | PIN/Pattern/Spending Password |
| **Transaction Signing** | Authorize operations | PassKey (always required) | Spending password |
| **Password Autofill** | Convenience feature | N/A (hidden in UI) | Optional PassKey autofill |

**Implementation**:

```vue
<!-- Lock Settings: Different labels for PRF wallets -->
<template>
  <!-- Normal wallets: "Spending Password" -->
  <v-list-item-title v-if="isNormalWallet">
    {{ $t('security.spendingPassword') }}
  </v-list-item-title>

  <!-- PRF wallets: "Lock Password" (separate from PassKey) -->
  <v-list-item-title v-else>
    {{ $t('security.lockPassword') }}
  </v-list-item-title>
</template>
```

**Hidden Sections for PRF Wallets**:
- "Use PassKey for Password Autofill" - Hidden (no spending password exists)
- "Auto-Trigger PassKey Authentication" - Hidden (no spending password exists)

**Lock Password Setup**:
- Component: `src/modules/dashboard/dialogs/LockPasswordSetupDialog.vue`
- Purpose: Set password for UI auto-lock (separate from PassKey encryption)
- Storage: Hash with PBKDF2, store as `lockPasswordHash` in config table
- Pattern: Reuses PIN setup pattern (two-step verification)

#### PRF Wallet Safety Checks

**Prevent PassKey Deregistration**:
```vue
<!-- Normal wallets: Show Register/Deregister button -->
<v-btn v-if="!isPrfWallet" @click="handlePassKeyDeregister()">
  {{ isPassKeyRegistered ? $t('security.deregister') : $t('security.register') }}
</v-btn>

<!-- PRF wallets: Show lock icon with warning tooltip -->
<v-tooltip v-else-if="isPrfWallet && isPassKeyRegistered" bottom>
  <template v-slot:activator="{ on }">
    <v-icon color="primary" v-on="on">mdi-lock</v-icon>
  </template>
  <span>{{ $t('security.passKeyRequiredForPrfWallet') }}</span>
</v-tooltip>
```

**Why**: Deregistering PassKey from PRF wallet causes permanent lockout (private keys encrypted with hardware-bound secret).

**Always Backup Mnemonic**:
```typescript
// CreateWallet.vue - PRF wallets
const prfOptions = {
  usePrf: true,
  credentialId,
  passwordUnlockEnabled: false,
  backupMnemonic: true, // ALWAYS true for PRF wallets
};
```

**Why**: Mnemonic provides recovery path if device lost or PassKey unavailable.

#### PRF Wallet Types

**Pure PRF Mode** (Default if browser supports):
- No spending password
- PassKey required for all operations
- Mnemonic backup always enabled
- UI lock: PIN/Pattern/Lock Password

**PRF + Password Mode** (Optional):
- PassKey for transaction signing
- Password for spending operations
- Dual authentication
- Not recommended (use Pure PRF instead)

**Detection**:
```typescript
const isPrfWallet = wallet?.encryptionMethod === 'prf';
const hasSpendingPassword = !!wallet?.prfSpendingPasswordHash;
```

## Best Practices

### 1. **Code Organization**
- Keep feature modules self-contained (`modules/[feature]/`)
- Use shared utilities for common operations (`shared/utils/`)
- Maintain clear separation between UI (Vue components) and logic (services, stores)
- Follow existing naming conventions (camelCase for functions, PascalCase for components)

### 2. **Performance**
- Lazy load heavy components (use dynamic imports)
- Use Web Workers for heavy computations (though not currently implemented)
- Efficient UTXO management (cache, filter, index)
- Defer non-critical operations (setTimeout for background loading)
- Use `Promise.all()` for parallel async operations
- Monitor performance with `performance.now()` timing logs

### 3. **User Experience**
- Progressive loading states (`LoadingState.setText()`, `LoadingState.setLoading()`)
- Clear error messages (user-friendly, not technical)
- Responsive design for various screen sizes (mobile, tablet, desktop)
- Accessibility considerations (keyboard navigation, screen readers)

### 4. **Security**
- **Never log sensitive data** (private keys, mnemonics, passwords)
- Validate all user inputs (addresses, amounts, transaction data)
- Use established crypto patterns (don't roll your own)
- Handle errors gracefully without exposing sensitive info
- Use `debugLog()` for development logging (can be disabled in production)

### 5. **Logging Standards**
- `console.debug()` - Routine operations, development info (can be filtered out)
- `console.log()` - Important user-facing information (performance metrics, major events)
- `console.warn()` - Recoverable issues (non-critical failures, fallback usage)
- `console.error()` - Actual errors that need attention (unhandled exceptions, critical failures)
- Prefix logs with emoji/category for easy filtering (e.g., `⏱️ PERF:`, `🔐 Auth:`, `📡 API:`)

### 6. **Internationalization (i18n)**
- **Always use `$t()` for user-facing text** - All wording, labels, messages, and UI text must use the i18n translation function
- **Never hardcode strings in templates or components** - Use translation keys from language files
- **Pattern**: `$t('category.key')` in templates, `t('category.key')` in script setup (via `useTranslation()` composable)
- **Type Safety**: The `$t()` method is typed to return `string` via `src/shims-vue-i18n.d.ts`
- **Example**:
  ```vue
  <!-- Template -->
  <v-btn>{{ $t('swap.swap') }}</v-btn>

  <!-- Script setup -->
  import { useTranslation } from '@/shared/composables/useTranslation';
  const { t } = useTranslation();
  const message = computed(() => t('swap.insufficientBalance'));
  ```
- **Translation files**: Located in `src/locales/` (e.g., `en.json`, `es.json`)
- **Adding new translations**: Add keys to all language files to maintain consistency

### 7. **Vuetify Components Best Practices**
- **v-select: Always use `attach` prop** - Prevents menu from having absolute positioning issues when scrolling
  ```vue
  <v-select
    :items="items"
    v-model="selected"
    attach
  />
  ```
- **Why**: Without `attach`, the dropdown menu stays at a fixed position when the parent scrolls, causing misalignment
- **Apply to**: All `v-select`, `v-autocomplete`, `v-combobox` components throughout the application

### 8. **Feature Notification System**

The wallet implements a hierarchical feature notification system to inform users about new features added in version updates. Notifications appear as badges and dots that disappear after user interaction.

**Architecture:**
- **Components**:
  - `src/shared/components/NotificationDot.vue` - Reusable v-badge wrapper for showing indicators
  - `src/shared/composables/useFeatureNotifications.ts` - Core notification system logic
- **Storage**: LocalStorage (`gero_feature_notifications`) with version tracking
- **Hierarchy**: Settings Icon → Tab → List Item/Dialog → Specific Feature

**How it works:**
1. Features are defined in `FEATURE_DEFINITIONS` array with unique IDs, version numbers, and hierarchical paths
2. Features marked as "new" (not in seen list) show notification indicators
3. When user interacts with a feature, it's marked as seen and indicator disappears
4. Parent-level indicators only disappear when ALL child features are seen
5. Version changes reset all notifications

**Adding a new feature:**

1. **Define the feature** in `src/shared/composables/useFeatureNotifications.ts`:
   ```typescript
   const FEATURE_DEFINITIONS: FeatureDefinition[] = [
     // Existing features...
     {
       id: 'settings.security.passKey',  // Unique ID (hierarchical dot notation)
       version: '2.6.2',                     // Version when added
       path: ['settings', 'security', 'passKey']  // Hierarchy path
     },
     // Add your new feature:
     {
       id: 'navigation.governance',
       version: '2.6.3',
       path: ['navigation', 'governance']
     }
   ];
   ```

2. **Add notification indicator** to the UI component:
   ```vue
   <template>
     <!-- For list items, buttons, menu items -->
     <v-list-item @click="handleClick">
       <v-list-item-title>
         {{ $t('settings.myFeature') }}
         <!-- Add NotificationDot component -->
         <NotificationDot
           :show="isFeatureNew('settings.security.myFeature')"
           color="error"
         />
       </v-list-item-title>
     </v-list-item>
   </template>

   <script setup>
   import NotificationDot from '@/shared/components/NotificationDot.vue';
   import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

   function handleClick() {
     // Mark feature as seen when user interacts
     markFeatureAsSeen('settings.security.myFeature');
     // ... rest of click handler
   }
   </script>
   ```

3. **Add parent-level indicators** (if needed):
   ```vue
   <!-- For tabs in SettingsDialog -->
   <script setup>
   import { hasNewFeaturesInPath } from '@/shared/composables/useFeatureNotifications';

   const hasNewSecurityFeatures = computed(() =>
     hasNewFeaturesInPath(['settings', 'security'])
   );

   const tabs = computed(() => [
     {
       label: t('settings.security'),
       value: 'security',
       badge: shouldBackup.value || hasNewSecurityFeatures.value
     }
   ]);
   </script>
   ```

4. **Update APP_VERSION** in `useFeatureNotifications.ts` when releasing:
   ```typescript
   const APP_VERSION = '2.6.3'; // Increment for new release
   ```

**NotificationDot Component Props:**
- `show` (boolean): Whether to show the badge
- `color` (string): Badge color (default: 'error')
- `dot` (boolean): Show as dot vs content (default: true)
- `content` (string|number): Badge content if not dot
- `overlap` (boolean): Whether badge overlaps content
- `bordered` (boolean): Show white border
- `pulse` (boolean): Animate with pulse effect (default: false - static dots preferred)

**API Functions:**
- `isFeatureNew(featureId)` - Check if a specific feature is new
- `markFeatureAsSeen(featureId)` - Mark feature as seen when user interacts
- `hasNewFeaturesInPath(path)` - Check if any features in path are new (for parent indicators)
- `getNewFeatureCount(path)` - Get count of new features in path
- `getFeaturesInPath(path)` - Get all features in path
- `getNewFeaturesInPath(path)` - Get only new features in path
- `resetAllFeatureNotifications()` - Reset all (for debugging)

**Examples:**

```typescript
// Check if specific feature is new
if (isFeatureNew('settings.security.passKey')) {
  // Show dot/badge
}

// Check if any security features are new (parent-level check)
if (hasNewFeaturesInPath(['settings', 'security'])) {
  // Show badge on Security tab
}

// Mark as seen when user opens dialog
function openPassKeyDialog() {
  markFeatureAsSeen('settings.security.passKey');
  passKeyDialog.value = true;
}
```

**Implementation Examples:**
- Settings Icon Badge: `src/modules/navigation/layouts/ContentLayout.vue:150`
- Security Tab Badge: `src/modules/dashboard/dialogs/SettingsDialog.vue:99`
- Lock Settings Item Dot: `src/modules/dashboard/components/SecurityTab.vue`

## Quick Reference

**Key Files**: `background.ts`, `walletBg.ts`, `walletManager.service.ts`, `walletStore.ts`, `geroStore.ts`

**Wallet Types**: Normal, Ledger, Trezor, Keystone, Google (zkFold)

**Networks**: Mainnet, Preprod, Preview

---

## Appendix: Key Third-Party Libraries

### Cardano Libraries
- `@cardano-sdk/core` - Modern Cardano SDK (transaction building, serialization)
- `@cardano-sdk/tx-construction` - Transaction construction utilities
- `@emurgo/cardano-message-signing-browser` - CIP-8 message signing

### Cryptography
- `bip39` - Mnemonic phrase generation and validation
- `blake2b` - Blake2b hashing (Cardano addresses)
- `crypto-ts` - AES encryption (mnemonics, high-level encryption)
- `@noble/ciphers` - ChaCha20-Poly1305 AEAD encryption (private keys)
- `@noble/hashes` - PBKDF2 key derivation with SHA-512
- `bech32` - Bech32 encoding/decoding (Cardano addresses)
- `crypto-random-string` - Secure random string generation (salts, nonces)

### Database
- `dexie` - IndexedDB wrapper (versioned schemas, migrations)

### Real-time
- `ably` - WebSocket-based real-time messaging (blockchain updates)
- `async-mutex` - Mutex locks (prevents race conditions)

### UI Framework
- `vue` - Frontend framework (v2.7)
- `vuetify` - Material Design component library (v2.7)
- `vue-router` - Client-side routing (v3.6)
- `vue-i18n` - Internationalization (v8.28)

### Utilities
- `axios` - HTTP client (API requests)
- `lodash` - Utility functions
- `dayjs` (via `javascript-time-ago`) - Date/time formatting
- `qrcode`, `qr-code-styling` - QR code generation
- `highcharts`, `lightweight-charts` - Chart rendering

### Build Tools
- `vite` - Build tool and dev server
- `typescript` - Type checking
- `eslint` - Linting
- `@vitejs/plugin-vue2` - Vue 2 support in Vite

---

**Last Updated**: 2025-11-29
