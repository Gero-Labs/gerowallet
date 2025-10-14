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
  - `@emurgo/cardano-serialization-lib-browser` v12.1.0 (legacy, being phased out)
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
      kraken-api.ts        # Kraken exchange API
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
**IMPORTANT**: The project is transitioning from Emurgo CSL to Cardano JS SDK:
- Legacy: `@emurgo/cardano-serialization-lib-browser` (CSL)
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
Use the established messaging pattern:
```typescript
// Frontend to background
const result = await Messaging.sendToBackground({
  method: MessageTypes.SIGN_TX,
  data: { tx, password, ... }
});

// Background handler (background.ts)
app.addToOptions(MessageTypes.SIGN_TX, async (request, sendResponse) => {
  try {
    const result = await walletBg.signTx(request.data);
    sendResponse({ success: true, data: result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
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
```typescript
import { encrypt, decrypt } from '@/shared/utils/crypto';

// Encrypt sensitive data
const encryptedMnemonic = encrypt(mnemonic, password);

// Decrypt when needed
const decryptedMnemonic = decrypt(encryptedMnemonic, password);
```

## External Integrations

### Blockchain APIs
- **Blockfrost**: Primary Cardano blockchain data provider (preferred for getTip)
- **Koios**: Alternative Cardano blockchain data provider
- **Backend API** (`localhost:8081` in dev): Proxy for blockchain data, caching, Ably tokens

### Price Data
- **Kraken WebSocket** (`src/services/krakenWebSocket.service.ts`): Real-time ADA/USD price
- **CoinGecko** (`src/api/coinGecko.api.ts`): Historical price data, market info

### DeFi & Trading
- **DEX Hunter** (`src/api/dexhunter-api.ts`): DEX aggregation, token swaps
- **TapTools** (`src/api/tap-tools-api.ts`): Token analytics, portfolio tracking
- **Strike Finance** (`src/api/strike-finance.api.ts`): Perpetuals trading

### Security & Analytics
- **Cardano Shield** (`src/api/cardano-shield-api.ts`): Transaction risk assessment, malicious address detection
- **Xerberus** (`src/api/xerberus.api.ts`): Token risk ratings

### Fiat On/Off Ramps
- **Moonpay** (`src/api/moonpay-api.ts`): Buy crypto with fiat
- **Guardarian**: Alternative fiat gateway

### Other Services
- **Bring Cashback** (`@bringweb3/chrome-extension-kit`): Cashback rewards
- **Ably** (`src/services/ably.service.ts`): Real-time blockchain updates
- **ADA Handle** (`src/api/ada-handle.api.ts`): Cardano name service
- **Charli3** (`src/api/charli3-api.ts`): Oracle price feeds

### Hardware Wallets
- **Ledger**: WebUSB/WebBLE communication (`@cardano-foundation/ledgerjs-hw-app-cardano`)
- **Trezor**: Connect API integration (`@trezor/connect-webextension`)
- **Keystone**: QR code communication (`@keystonehq/keystone-sdk`)

## Testing & Quality

### Current Setup
- ESLint with TypeScript support (minimal rules for rapid development)
- TypeScript compilation checking (`npm run typecheck`)
- Manual testing workflows (no automated tests yet)

### Building & Deployment
- Multi-environment builds (dev/beta/prod with `.env` files)
- Automated packaging for Chrome (.zip, .crx) and Firefox (.xpi)
- Version management in `package.json` and `manifest.json`

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

### 7. **Ably Connection Issues**
- **Channel Denied Access (401)**: Stale authentication tokens
  - Solution: Recreate client instance in `setAuthParams()`
- **ClientId Mismatch**: Cached clientId from previous wallet
  - Solution: Clear clientId in `connect()`, detect mismatches in authCallback
- **Slow Login**: Ably connection blocking wallet initialization
  - Solution: Connect in background async IIFE, don't await

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

## Troubleshooting

### Build Issues
- Clear node_modules and reinstall (`rm -rf node_modules && npm install`)
- Check for conflicting dependencies (`npm ls [package-name]`)
- Verify Node.js version compatibility (use Node 18+)
- Clear build artifacts (`npm run clear`)
- Check for TypeScript errors (`npm run typecheck`)

### Extension Loading
- Check manifest.json syntax (valid JSON, correct permissions)
- Verify all referenced files exist in `extension/` folder
- Check Chrome developer tools for errors (background page, options page)
- Reload extension after changes (click "Reload" in chrome://extensions/)
- Check for service worker errors in chrome://serviceworker-internals/

### Database Issues
- Check Dexie version compatibility (4.0.7)
- Verify schema migrations (check console for upgrade logs)
- Clear IndexedDB for testing (Application tab in DevTools)
- Test across contexts (background vs options page access)

### Cross-Context Communication
- Verify port connections (`chrome.runtime.connect`)
- Check message passing (`chrome.runtime.sendMessage`, `port.postMessage`)
- Test store sync across contexts (background ↔ options ↔ popup)
- Monitor Chrome storage updates (`chrome.storage.onChanged`)

---

## Quick Start for New Developers

1. **Clone and Install**:
   ```bash
   git clone [repo-url]
   cd gerowallet
   npm install
   ```

2. **Development**:
   ```bash
   npm run dev
   ```

3. **Load Extension**:
   - Open Chrome extensions page (`chrome://extensions/`)
   - Enable developer mode (toggle in top right)
   - Click "Load unpacked"
   - Select `extension/` folder from project root

4. **Key Files to Understand**:
   - `src/chrome/background.ts` - Main service worker (wallet lifecycle, message handling)
   - `src/chrome/walletBg.ts` - Wallet operations (transactions, UTXOs, addresses)
   - `src/services/walletManager.service.ts` - Wallet login/logout, initialization
   - `src/stores/walletStore.ts` - Active wallet state (UTXOs, keys, addresses)
   - `src/stores/geroStore.ts` - Global app state (wallets list, config)
   - `src/modules/navigation/router.ts` - Vue Router configuration
   - `src/modules/dashboard/` - Main dashboard (good example of module structure)

5. **Understanding the Flow**:
   - User logs in → `WalletsListLogin.vue` sends LOGIN message to background
   - Background → `walletManager.login()` creates WalletBg instance
   - WalletBg → Loads genesis, assets, epoch params, rewards, transactions
   - Ably → Connects in background for real-time updates
   - Store → Broadcasts wallet state to all browser contexts
   - Dashboard → Displays wallet data, portfolio, quick actions

**Remember**: This is a financial application handling real cryptocurrency. Always prioritize security and thoroughly test any changes.

## Important Implementation Notes

### Message Reconstruction Service
- **Purpose**: Reassembles large messages split across multiple Ably messages
- **Location**: `src/services/messageReconstruction.service.ts`
- **Usage**: Automatic for SYNC messages exceeding Ably's message size limit
- **Logging**: Minimal logging to reduce console spam (only errors and final reconstruction)

### Portfolio Cache
- **Purpose**: Cache portfolio data to reduce API calls and improve performance
- **Location**: `src/db/portfolio-cache.ts`
- **Tables**: `portfolio_cache` (in wallet-specific database)
- **Invalidation**: Automatic on wallet sync, manual on user refresh

### Debug Mode
- **Global Flag**: `window.DEBUG_MODE` (set in browser console)
- **Purpose**: Enable/disable `debugLog()` output
- **Default**: `false` in production, `true` in development
- **Usage**: `debugLog('message', data)` instead of `console.log()`

### Wallet Types
- **Normal**: Standard wallet with mnemonic phrase
- **Ledger**: Hardware wallet (Ledger device)
- **Trezor**: Hardware wallet (Trezor device)
- **Keystone**: Hardware wallet (QR-based air-gapped)
- **Google**: Cloud-based wallet (zkFold Smart Wallet integration)

### Network Support
- **Cardano Mainnet**: Full support (staking, governance, DeFi, etc.)
- **Cardano Preprod**: Testnet support (same features as mainnet)
- **Cardano Preview**: Testnet support (same features as mainnet)

---

## Appendix: Key Third-Party Libraries

### Cardano Libraries
- `@cardano-sdk/core` - Modern Cardano SDK (transaction building, serialization)
- `@cardano-sdk/tx-construction` - Transaction construction utilities
- `@emurgo/cardano-serialization-lib-browser` - Legacy CSL (WASM-based)
- `@emurgo/cardano-message-signing-browser` - CIP-8 message signing

### Cryptography
- `bip39` - Mnemonic phrase generation and validation
- `blake2b` - Blake2b hashing (Cardano addresses)
- `crypto-ts` - AES encryption (private keys, mnemonics)
- `bech32` - Bech32 encoding/decoding (Cardano addresses)

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

**Last Updated**: 2025-01-14 (after Conway-era transaction fee calculation fixes)