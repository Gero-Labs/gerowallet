# Gero Wallet Architecture

## Table of Contents
- [Overview](#overview)
- [High-Level Architecture](#high-level-architecture)
- [Chrome Extension Architecture](#chrome-extension-architecture)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [State Management](#state-management)
- [Database Architecture](#database-architecture)
- [Security Architecture](#security-architecture)
- [Real-Time Communication](#real-time-communication)
- [Transaction Processing](#transaction-processing)
- [External Integrations](#external-integrations)
- [Build System](#build-system)

---

## Overview

Gero Wallet is a comprehensive Cardano blockchain wallet implemented as a Chrome browser extension (Manifest V3). It bridges Web2 and Web3 technologies, providing users with secure wallet management, portfolio tracking, staking, governance participation, and DeFi integrations.

### Key Architectural Principles

1. **Security First**: Private keys never leave the background context, all sensitive operations are isolated
2. **Multi-Context Design**: Separate execution contexts (background, content, inject, web) with secure messaging
3. **Real-Time Sync**: WebSocket-based blockchain updates with Ably for instant portfolio updates
4. **Performance Optimized**: Non-blocking initialization, deferred loading, and efficient state management
5. **Extensible**: Modular architecture with clear separation of concerns

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser Extension                            │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Popup      │  │   Options    │  │  Side Panel  │          │
│  │   (Web UI)   │  │   (Web UI)   │  │   (Web UI)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┼──────────────────┘                  │
│                            │                                     │
│                ┌───────────▼───────────┐                         │
│                │  Chrome Messaging     │                         │
│                │  (Runtime.sendMessage)│                         │
│                └───────────┬───────────┘                         │
│                            │                                     │
│         ┌──────────────────▼──────────────────┐                 │
│         │   Background Service Worker         │                 │
│         │  - Wallet Operations                │                 │
│         │  - Crypto Operations                │                 │
│         │  - Transaction Signing              │                 │
│         │  - State Broadcasting               │                 │
│         └──────────┬──────────────────┬──────┘                  │
│                    │                  │                          │
│         ┌──────────▼─────┐  ┌────────▼─────────┐               │
│         │  IndexedDB     │  │  Chrome Storage  │               │
│         │  (Dexie)       │  │  (Sync State)    │               │
│         └────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │  External Services      │
                │  - Blockfrost API       │
                │  - Ably WebSocket       │
                │  - Price Feeds          │
                │  - DeFi Aggregators     │
                └─────────────────────────┘
```

---

## Chrome Extension Architecture

### Manifest V3 Structure

Gero Wallet is built using Chrome's **Manifest V3** specification, which enforces stricter security and performance requirements:

#### 1. **Background Service Worker** (`src/chrome/background.ts`)
- **Purpose**: Core wallet operations, transaction signing, crypto operations
- **Lifecycle**: Event-driven, can be suspended after 30 seconds of inactivity
- **Key Responsibilities**:
  - Wallet key management (encrypted storage)
  - Transaction construction and signing
  - Message routing between contexts
  - State broadcasting to UI contexts
  - API communication with blockchain providers

#### 2. **Content Scripts** (`src/chrome/content/`)
- **Purpose**: Inject wallet API into web pages
- **Execution Context**: Runs in isolated context within web pages
- **Responsibilities**:
  - Bridge communication between page and extension
  - Inject `window.cardano` API for DApp connections
  - Message relay and validation

#### 3. **Inject Scripts** (`src/chrome/inject/`)
- **Purpose**: Provide `window.cardano` API to web pages
- **Execution Context**: Runs in page's main context
- **Responsibilities**:
  - Expose Cardano DApp connector API (CIP-30)
  - Handle DApp connection requests
  - Transaction approval UI

#### 4. **Web UI Contexts** (Options, Popup, Sidepanel)
- **Options Page** (`src/options/`): Full wallet interface (main UI)
- **Popup** (`src/popup/`): Quick access wallet actions
- **Sidepanel** (`src/sidepanel/`): Chrome's side panel UI

### Cross-Context Communication

```
┌─────────────┐                    ┌──────────────────┐
│   Web Page  │                    │   Options Page   │
│             │                    │   (Vue.js SPA)   │
│  window.    │                    │                  │
│  cardano    │                    │                  │
└──────┬──────┘                    └────────┬─────────┘
       │                                    │
       │ postMessage                        │ chrome.runtime
       ▼                                    ▼
┌──────────────┐                    ┌──────────────────┐
│   Content    │                    │   Background     │
│   Script     │◄───────────────────┤   Service Worker │
│              │  chrome.runtime    │                  │
└──────────────┘                    └──────────────────┘
```

**Message Flow:**
1. Web page calls `window.cardano.signTx()`
2. Inject script posts message to content script
3. Content script sends to background via `chrome.runtime.sendMessage()`
4. Background processes, responds
5. Response flows back through the chain

---

## Component Architecture

### Module System

Gero Wallet uses a **feature-based module architecture**. Each feature is self-contained in `src/modules/[feature]/`:

```
src/modules/
├── assets/              # Token and NFT management
├── blog/                # In-app news and updates
├── dashboard/           # Portfolio overview, quick actions
├── governance/          # Cardano governance (CIP-1694)
├── multisig/            # Multi-signature wallets
├── navigation/          # App routing and layout
├── staking/             # Cardano staking and delegation
├── swap/                # DeFi token swapping
├── transactions/        # Transaction history and details
├── wallet/              # Wallet settings and management
└── welcome/             # Onboarding and wallet creation
```

**Module Structure:**
```
modules/[feature]/
├── components/          # Vue components specific to feature
├── dialogs/             # Modal dialogs
├── views/               # Main views/pages
├── composables/         # Vue composables
└── types.ts             # TypeScript types
```

### Service Layer

Business logic is centralized in **services** (`src/services/`):

| Service | Purpose |
|---------|---------|
| `walletManager.service.ts` | Wallet lifecycle (create, import, login, switch) |
| `sync.service.ts` | Blockchain synchronization (UTXOs, transactions) |
| `ably.service.ts` | Real-time WebSocket communication |
| `krakenWebSocket.service.ts` | Real-time price feeds |
| `storeMessaging.service.ts` | Cross-context state synchronization |
| `storageObserver.service.ts` | Chrome storage change observer |

### API Layer

External integrations are abstracted in `src/api/`:

```typescript
// Base API class with common patterns
class Api {
  protected async request(endpoint: string, options?: RequestOptions) {
    // Common retry logic, error handling, auth
  }
}

// Feature-specific APIs extend base
class BlockchainApi extends Api {
  async getUtxos(address: string): Promise<Utxo[]> { ... }
  async submitTx(txHash: string): Promise<void> { ... }
}
```

**Key API Integrations:**
- **Blockchain**: Blockfrost (primary), Koios (backup), Backend API
- **Prices**: Kraken WebSocket, CoinGecko, Charli3 Oracle
- **DeFi**: DEX Hunter (swap aggregation), TapTools (analytics)
- **Security**: Cardano Shield (risk assessment), Xerberus (ratings)
- **Fiat**: Moonpay, Guardarian (on/off ramps)

---

## Data Flow

### Wallet Initialization Flow

```
User Login
    │
    ▼
┌────────────────────────────────┐
│ walletManager.service.ts       │
│ - Decrypt private keys         │
│ - Initialize wallet stores     │
│ - Setup Ably connection        │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ sync.service.ts                │
│ - Fetch UTXOs from blockchain  │
│ - Fetch transaction history    │
│ - Calculate balances           │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ walletStore (Vue Observable)   │
│ - Update state                 │
│ - Broadcast to UI contexts     │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ UI Updates (Options/Popup)     │
│ - Render portfolio             │
│ - Show balances                │
└────────────────────────────────┘
```

### Transaction Flow

```
User Initiates Transaction
         │
         ▼
┌────────────────────────────────┐
│ UI Component (e.g., SendDialog)│
│ - Validate inputs              │
│ - Request password             │
└────────┬───────────────────────┘
         │
         │ chrome.runtime.sendMessage
         ▼
┌────────────────────────────────┐
│ background.ts                  │
│ - Route message to handler     │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ walletBg.ts                    │
│ - Build transaction (SDK)      │
│ - Calculate fees               │
│ - Sign with private key        │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ BlockchainApi                  │
│ - Submit to Blockfrost         │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Ably Real-time Update          │
│ - Receive confirmation         │
│ - Update wallet state          │
└────────────────────────────────┘
```

### Hardware Wallet Flow

Hardware wallets (Ledger, Trezor, Keystone) use a **hybrid approach**:

1. **Background** prepares unsigned transaction
2. **Frontend** handles device communication (WebUSB, WebBLE, QR)
3. User confirms on device
4. Frontend sends signed transaction back to background
5. **Background** submits to blockchain

**Why?** Service workers can't access WebUSB/WebBLE APIs directly.

---

## State Management

### Vue Observable Stores

Gero Wallet uses **custom Vue Observable stores** instead of Vuex for lightweight, performant state management:

```typescript
// Example store pattern
const walletStore = Vue.observable({
  // State
  walletId: null,
  address: null,
  balance: '0',
  utxos: [],
  transactions: [],

  // Mutations (methods that modify state)
  setWallet(walletId: string, address: string) {
    this.walletId = walletId;
    this.address = address;
  },

  setBalance(balance: string) {
    this.balance = balance;
  }
});
```

### Key Stores

| Store | Purpose | Location |
|-------|---------|----------|
| `geroStore` | Global app state (wallets list, network, config) | `src/stores/geroStore.ts` |
| `walletStore` | Active wallet data (UTXOs, keys, addresses) | `src/stores/walletStore.ts` |
| `networkStore` | Network params (tip, epoch, genesis) | `src/stores/networkStore.ts` |
| `priceStore` | Real-time price data | `src/stores/priceStore.ts` |
| `stakingStore` | Staking pools and delegation | `src/stores/stakingStore.ts` |
| `governanceStore` | Governance and DRep state | `src/stores/governanceStore.ts` |
| `loadingStore` | Loading states and progress | `src/stores/loading.ts` |

### Cross-Context State Synchronization

**Challenge**: Chrome extension has multiple isolated JavaScript contexts (background, options, popup). State must stay synchronized.

**Solution**: Dual messaging system

#### Background Context (`src/chrome/storeMessagingBg.ts`)
```typescript
// Broadcast store updates to all connected UI contexts
function broadcastUpdate(storeName: string, updates: any) {
  // Serialize complex types (BigInt, Map, Set)
  const serialized = JSON.parse(JSON.stringify(updates, serializer));

  // Broadcast via port connections
  ports.forEach(port => {
    port.postMessage({ storeName, updates: serialized });
  });

  // Persist to Chrome storage as fallback
  chrome.storage.local.set({ [storeName]: serialized });
}
```

#### Browser Context (`src/services/storeMessaging.service.ts`)
```typescript
// Subscribe to store updates from background
storeMessaging.subscribe('walletStore', (updates) => {
  Object.assign(walletStore, updates);
});
```

**Critical Pattern**: Always use **current in-memory state** as base for updates:
```typescript
// ✅ CORRECT
const current = walletStore;
const finalState = { ...current, ...updates };
chrome.storage.local.set({ walletStore: finalState });

// ❌ WRONG (race condition)
const current = await chrome.storage.local.get('walletStore');
const finalState = { ...current.walletStore, ...updates };
chrome.storage.local.set({ walletStore: finalState });
```

---

## Database Architecture

### Two-Tier Database System

Gero Wallet uses **Dexie.js** (IndexedDB wrapper) with a two-tier architecture:

#### 1. Application-Level Database (`src/db/gero-db.ts`)
- **Database Name**: `GeroWalletDatabase` (singleton)
- **Purpose**: Global application data
- **Tables**:
  - `wallets` - List of all wallets (id, name, type, encrypted keys)
  - `config` - Global settings
  - `provider` - Blockchain provider configuration

```typescript
// Access pattern
import { getAllWallets, createNewWallet } from '@/db/gero-db';

const wallets = await getAllWallets();
const walletId = await createNewWallet(name, icon, theme, mnemonic, password);
```

#### 2. Wallet-Specific Databases (`src/db/wallet-db.ts`)
- **Database Name**: `wallet-{walletId}` (one per wallet)
- **Purpose**: Individual wallet data (isolated)
- **Tables**:
  - `config` - Wallet-specific settings
  - `sync` - Sync state (last sync time, tip)
  - `account` - Account details
  - `addresses` - Address derivation cache
  - `contacts` - Address book
  - `rewards` - Staking rewards history
  - `transactions` - Transaction history
  - `connected_dapps` - DApp connection permissions
  - `multisig` - Multi-sig wallet data

```typescript
// Access pattern
import { getDb } from '@/db/wallet-db';

const db = await getDb(walletId);
const transactions = await db['transactions'].toArray();
await db['transactions'].add(newTransaction);
```

### Database Versioning

**Critical Pattern**: Always apply schema on every database open:

```typescript
db.version(1).stores({
  wallets: '++id, name, type'
});

db.version(2).stores({
  wallets: '++id, name, type, publicKey'
}).upgrade(tx => {
  // Migration logic
});

await db.open();
```

**Why?** Prevents "No [Table] Table" errors. Schema application is idempotent.

### Data Persistence Strategy

1. **Hot Path**: In-memory stores (Vue Observable) for UI reactivity
2. **Persistence**: IndexedDB for permanent storage
3. **Sync**: Chrome Storage for cross-context state hydration
4. **Cache**: Portfolio cache for expensive calculations

---

## Security Architecture

### Threat Model

1. **Malicious DApps**: Attempting to steal private keys or trick users
2. **XSS Attacks**: Injecting scripts to access wallet data
3. **Phishing**: Social engineering to extract mnemonics
4. **Physical Access**: Unauthorized device access
5. **Network Attacks**: Man-in-the-middle, DNS poisoning

### Security Layers

#### 1. **Private Key Protection**

**Storage**: All private keys encrypted with **AES-256** (CryptoTS) and **ChaCha20-Poly1305** (EMIP3):

```typescript
// High-level encryption (mnemonics, general data)
import { encrypt, decrypt } from '@/shared/utils/crypto';
const encryptedMnemonic = encrypt(mnemonic, password);

// Private key encryption (ChaCha20-Poly1305 AEAD)
import { encryptWithPassword, decryptWithPassword } from '@/shared/utils/crypto';
const encrypted = encryptWithPassword(password, rootKeyBytes);
```

**Format**: `salt (32B) + nonce (12B) + tag (16B) + ciphertext`
- PBKDF2-HMAC-SHA512 (19,162 iterations)
- 100% compatible with Cardano Serialization Library's EMIP3

#### 2. **Context Isolation**

- **Private keys**: Only accessible in background service worker
- **Transaction signing**: Never exposes keys to UI contexts
- **Message validation**: All cross-context messages validated

#### 3. **DApp Connection Security**

```typescript
// Connection approval required
const approval = await showConnectionDialog(dappInfo);
if (!approval) throw new Error('User rejected');

// Transaction risk assessment
const risk = await cardanoShieldApi.assessRisk(tx);
if (risk.level === 'high') showWarning();
```

**Protections**:
- Domain whitelisting/blacklisting
- Transaction preview and approval
- Risk assessment (Cardano Shield API)
- Limited API exposure (CIP-30 standard only)

#### 4. **Hardware Wallet Integration**

- **Ledger**: WebUSB/WebBLE with app attestation
- **Trezor**: Connect API with bridge/webextension
- **Keystone**: Air-gapped QR code signing

**Benefit**: Private keys never touch the computer, even encrypted.

#### 5. **Spending Password**

- Required for all sensitive operations
- Never stored (must be re-entered)
- Separate from encryption key (optional enhanced security)

### Security Best Practices

1. **Never log sensitive data** (keys, mnemonics, passwords)
2. **Validate all inputs** (addresses, amounts, transaction data)
3. **Use established crypto patterns** (don't roll your own)
4. **Handle errors gracefully** without exposing sensitive info
5. **Regular security audits** (see `docs/SECURITY_AUDIT.md`)

---

## Real-Time Communication

### Ably WebSocket Service

Gero Wallet uses **Ably Realtime** for instant blockchain updates:

**Architecture**:
```
Blockchain Events
      │
      ▼
┌───────────────────────┐
│  Gero Backend         │
│  (monitors chain)     │
└──────────┬────────────┘
           │ publish
           ▼
┌───────────────────────┐
│  Ably Realtime        │
│  (message broker)     │
└──────────┬────────────┘
           │ subscribe
           ▼
┌───────────────────────┐
│  Background Worker    │
│  (ably.service.ts)    │
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐
│  Sync & Update Stores │
└───────────────────────┘
```

**Channel Types**:
1. **Private Channels**: User-specific updates (e.g., `stake1u...`)
   - New transactions
   - UTXO changes
   - Reward payouts

2. **Group Channels**: Network-wide events (e.g., `CARDANO.MAINNET`)
   - New blocks
   - Epoch transitions
   - Protocol parameter updates

**Authentication**:
```typescript
// Per-wallet authentication
ablyService.setAuthParams(chain, network, stakeAddress);
ablyService.connect();

// Auth callback fetches token from backend
authCallback: async (tokenParams, callback) => {
  const token = await backendApi.getAblyToken(address);
  callback(null, token);
}
```

**Optimization**: Non-blocking connection during wallet login:
```typescript
// Don't block login waiting for Ably
(async () => {
  await ablyService.connect();
  await ablyService.subscribe(channels);
})(); // Execute but don't await
```

**Concurrency Control**: Mutex locks prevent race conditions:
```typescript
import { Mutex } from 'async-mutex';
const syncMutex = new Mutex();

ablyService.on('message', async (message) => {
  await syncMutex.runExclusive(async () => {
    // Process sync updates atomically
  });
});
```

---

## Transaction Processing

### Modern Cardano SDK Integration

Gero Wallet uses **@cardano-sdk/core** (v0.46.9) for all transaction operations:

```typescript
import { Cardano, Serialization } from '@cardano-sdk/core';

// Build transaction
const tx: Cardano.Tx = {
  body: {
    inputs: [...],
    outputs: [...],
    fee: calculatedFee,
    ...
  },
  witness: {
    signatures: new Map(),
    ...
  }
};

// Serialize to CBOR
const txCbor = Serialization.Transaction.fromCore(tx).toCbor();

// Submit to blockchain
await blockchainApi.submitTx(txCbor);
```

### Fee Calculation (Conway Era)

**Critical**: Proper fee calculation for Conway-era transactions:

```typescript
// 1. Build initial transaction skeleton
const skeleton = buildTxSkeleton(inputs, outputs, certificates);

// 2. Resolve change outputs (MUST happen before fee calc)
const change = changeAddressResolver(skeleton);

// 3. Calculate base fee from CBOR size
const baseFee = await sdk.minFee(skeletonWithChange);

// 4. Add witness overhead
const witnessCount = analyzeTransactionForSignatures(tx);
const witnessOverhead = witnessCount * 110; // bytes per signature
const totalFee = baseFee + (witnessOverhead * minFeeCoefficient);

// 5. Update transaction with final fee
tx.body.fee = totalFee;
```

**Conway-Era Certificate Types**:
- `CertificateType.Unregistration` - Unstake (replaces legacy StakeDeregistration)
- `CertificateType.Registration` - Register stake key
- `CertificateType.StakeRegistrationDelegation` - Register + delegate
- `CertificateType.StakeDelegation` - Delegate to pool

### Transaction Builder (`src/shared/utils/builder.ts`)

```typescript
export async function buildTx(params: TxBuilderParams): Promise<Cardano.Tx> {
  // 1. Coin selection
  const { inputs, change } = selectCoins(params);

  // 2. Build outputs
  const outputs = buildOutputs(params.recipients);

  // 3. Add certificates/withdrawals
  const certificates = buildCertificates(params.certificates);

  // 4. Calculate fees
  const fee = await calculateFee({ inputs, outputs, certificates });

  // 5. Finalize transaction
  return {
    body: { inputs, outputs, fee, certificates, ... },
    witness: { signatures: new Map() }
  };
}
```

---

## External Integrations

### Blockchain Providers

**Primary**: Blockfrost
- **Pros**: Fast, reliable, well-documented
- **Cons**: Rate limits on free tier
- **Fallback**: Koios (community-run)

**Backend API**: Custom backend for specialized operations:
- Ably token generation
- Portfolio analytics
- Custom queries not available in standard APIs

### Price Feeds

1. **Kraken WebSocket**: Real-time ADA/USD price
   ```typescript
   krakenWebSocketService.connect();
   krakenWebSocketService.on('price', (price) => {
     priceStore.setPrice('ADA', price);
   });
   ```

2. **CoinGecko**: Historical data, altcoin prices
3. **Charli3**: On-chain oracle prices

### DeFi Integrations

- **DEX Hunter**: Swap aggregation across Cardano DEXs
  - Finds best rates across Minswap, SundaeSwap, WingRiders, etc.
  - Smart order routing

- **TapTools**: Portfolio analytics and token metrics
  - Token prices and charts
  - Portfolio valuation

- **Strike Finance**: Perpetuals trading (futures/options)

### Fiat On/Off Ramps

- **Moonpay**: Credit card purchases, ACH transfers
- **Guardarian**: Alternative fiat gateway

---

## Build System

### Vite Multi-Config Architecture

Gero Wallet uses **4 separate Vite configurations** for different contexts:

```
vite.config.mts               - Main web app (options, popup, sidepanel)
vite.config.background.mts    - Background service worker
vite.config.content.mts       - Content scripts
vite.config.inject.mts        - Page injection scripts
```

**Why?** Each context has different requirements:
- **Background**: Node polyfills, WASM support, no DOM
- **Content**: Minimal bundle size, isolated from page
- **Inject**: Must run in page context, expose window.cardano
- **Web**: Full Vue.js SPA with router, Vuetify

### Build Process

```bash
npm run build
```

**Steps**:
1. Clear previous builds (`extension/` folder)
2. Build background worker (Rollup bundle)
3. Build content scripts (injected into pages)
4. Build inject scripts (window.cardano API)
5. Build web apps (options, popup, sidepanel)
6. Copy manifest.json and static assets
7. Copy WASM files to `extension/`

**Output**: `extension/` folder ready to load in Chrome

### Plugin Architecture

**Critical Plugins**:
- `vite-plugin-wasm` - WebAssembly support (cryptography)
- `vite-plugin-top-level-await` - Async WASM loading
- `vite-plugin-node-polyfills` - Node.js compatibility (Buffer, process, etc.)
- `@vitejs/plugin-vue2` - Vue.js 2.7 support
- `unplugin-auto-import` - Auto-import Vue, Vuetify
- `unplugin-vue-components` - Auto-import components

### Environment Variables

```bash
.env.development    # Development (localhost backend)
.env.production     # Production (mainnet backend)
.env.beta          # Beta testing environment
```

**Key Variables**:
- `VITE_BACKEND_URL` - Gero backend API endpoint
- `VITE_BLOCKFROST_API_KEY` - Blockchain data API
- `VITE_ABLY_API_KEY` - Real-time messaging
- `VITE_MOONPAY_API_KEY` - Fiat on-ramp

---

## Performance Optimizations

### Wallet Login Performance

Recent optimizations reduced login time from **~11 seconds to <200ms**:

1. **API Provider Optimization**: Switched `getTip()` from KOIOS to BLOCKFROST (saved ~400ms)
2. **Non-Critical Deferrals**:
   - DexHunter tokens/blacklists load in background (saved ~26ms)
   - Bring cashback cache loads async (saved ~349ms)
3. **Ably Non-Blocking**: Connection happens in background (saved **~10,000ms**)
4. **Chart Data Deferral**: Load Kraken charts after 500ms (saved ~181ms)
5. **Login Response Trust**: Removed 5-second polling loop (saved up to 5000ms)

**Monitoring**:
```typescript
const start = performance.now();
await operation();
console.log(`⏱️ PERF: Operation took ${performance.now() - start}ms`);
```

### Bundle Size Optimization

- **Code Splitting**: Dynamic imports for heavy components
- **Tree Shaking**: Vite removes unused code
- **Minification**: Terser for production builds
- **Lazy Loading**: Routes and dialogs loaded on demand

---

## Development Workflow

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start dev server (hot reload)
npm run dev

# 3. Load in Chrome
# - Navigate to chrome://extensions/
# - Enable "Developer mode"
# - Load unpacked -> select extension/ folder
```

### Testing

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Fix linting issues
npm run lint -- --fix
```

### Debugging

**Background Script**:
1. Go to `chrome://extensions/`
2. Find Gero Wallet
3. Click "service worker" link
4. Opens DevTools for background context

**Options/Popup**:
1. Right-click on extension UI
2. Select "Inspect"
3. Opens DevTools for UI context

**Console Prefixes**:
- `⏱️ PERF:` - Performance metrics
- `🔐 Auth:` - Authentication/security
- `📡 API:` - Network requests
- `💾 DB:` - Database operations
- `🔄 Sync:` - Blockchain sync

---

## Key Design Patterns

### 1. **Message Passing Pattern**

```typescript
// Options/Browser Context
const response = await Messaging.sendToBackgroundFromOptions({
  method: MessageTypes.SIGN_TX,
  data: { tx, password }
});

// Background Handler
app.addToOptions(MessageTypes.SIGN_TX, async (request, sendResponse) => {
  const signedTx = await walletBg.signTx(request.data.tx, request.data.password);
  sendResponse({ data: { success: true, tx: signedTx } });
  return true; // Keep channel open for async
});
```

### 2. **Store Broadcasting Pattern**

```typescript
// Update store and broadcast to all contexts
function updateWalletState(updates: Partial<WalletStore>) {
  Object.assign(walletStore, updates);

  if (context === 'background') {
    backgroundStoreMessaging.broadcastUpdate('walletStore', updates);
    chrome.storage.local.set({ walletStore: { ...walletStore } });
  }
}
```

### 3. **Database Access Pattern**

```typescript
// Centralized database access
const db = await getDb(walletId);

// Use transactions for atomic operations
await db.transaction('rw', db.transactions, db.addresses, async () => {
  await db.transactions.add(newTx);
  await db.addresses.update(address, { lastUsed: Date.now() });
});
```

### 4. **Hardware Wallet Pattern**

```typescript
// 1. Background prepares unsigned transaction
const unsignedTx = await buildTx(params);

// 2. UI handles device communication
const signedWitness = await ledgerService.signTx(unsignedTx);

// 3. Background assembles and submits
const finalTx = assembleTx(unsignedTx, signedWitness);
await blockchainApi.submitTx(finalTx);
```

---

## Extending the Architecture

### Adding a New Feature Module

1. Create module directory: `src/modules/myFeature/`
2. Add components, dialogs, views
3. Create store if needed: `src/stores/myFeatureStore.ts`
4. Add API integration: `src/api/myFeature-api.ts`
5. Register routes in `src/modules/navigation/router.ts`
6. Add navigation items in `src/modules/navigation/`

### Adding a New Blockchain Provider

1. Create API class: `src/api/myProvider-api.ts`
2. Implement required methods: `getUtxos()`, `submitTx()`, `getTip()`, etc.
3. Add to provider configuration in `src/stores/networkStore.ts`
4. Update provider selection logic

### Adding a New DeFi Integration

1. Create API class: `src/api/myDeFi-api.ts`
2. Create store: `src/stores/myDeFiStore.ts`
3. Add UI components in `src/modules/swap/` or new module
4. Integrate with transaction builder

---

## Conclusion

Gero Wallet's architecture prioritizes **security**, **performance**, and **extensibility**. The multi-context design isolates sensitive operations, the modular structure enables feature additions without coupling, and the real-time communication provides instant updates.

For detailed implementation guides, see:
- **Getting Started**: `docs/GETTING_STARTED.md`
- **Development Guide**: `CLAUDE.md`
- **Contributing**: `CONTRIBUTING.md`
- **Security**: `docs/SECURITY_AUDIT.md`

---

**Last Updated**: 2025-12-23