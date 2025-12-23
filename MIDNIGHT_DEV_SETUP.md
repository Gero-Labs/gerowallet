# Midnight Blockchain - Development Setup

This guide explains how to work with the Midnight blockchain integration during development.

## Quick Start

### Mock Wallet for UI Development

A **mock Midnight wallet** is automatically created when you run the app in development mode. This allows you to:
- Test the Midnight wallet login flow
- Develop the Midnight dashboard UI
- Test network switching to Midnight
- Work on Midnight-specific features without full wallet implementation

### What Has Been Added

1. **Blockchain Configuration** ([src/models/types.ts](src/models/types.ts))
   - Added `MIDNIGHT: 'Midnight'` to `Blockchain` constant
   - Added Midnight coin type: `coin_type.midnight: 2400`
   - Added `CoinTypes.MIDNIGHT` constant

2. **Network Configuration** ([src/utils/networks.ts](src/utils/networks.ts))
   - Added Midnight Preview testnet configuration
   - Network ID: 0 (testnet)
   - Currency: tNIGHT (testnet NIGHT tokens)
   - Features: Transaction support enabled, no staking/governance yet

3. **Development Utilities** ([src/utils/midnight-dev-utils.ts](src/utils/midnight-dev-utils.ts))
   - Mock wallet creation functions
   - Automatic initialization in development mode
   - Console utilities for manual wallet management

4. **App Integration** ([src/options/main.ts](src/options/main.ts))
   - Mock wallet automatically created on app startup (development only)

## Using the Mock Wallet

### Automatic Creation

The mock wallet is created automatically when you run:

```bash
npm run dev
```

You'll see this console message:
```
✅ Mock Midnight wallet created with ID: [number]
⚠️ WARNING: This wallet uses fake keys and is for UI development only!
```

### Login Screen & Data Loading

The mock wallet will appear in the wallet selection screen ([WalletsListLogin.vue](src/options/modules/welcome/components/WalletsListLogin.vue)) with:
- **Name**: Mock Midnight Wallet
- **Chain**: Midnight - Preview
- **Icon**: Deep purple color

**When you login to the mock Midnight wallet:**
```
🌙 Detected Midnight mock wallet - loading mock data
✅ Midnight mock wallet loaded successfully
📊 Mock data summary:
  balances: {
    nightShielded: "1234567890000000"    (1,234.57 tNIGHT)
    nightUnshielded: "5678123456000000"  (5,678.12 tNIGHT)
    dust: "45678901000000"               (45.68 tDUST)
  }
  transactions: 7
  utxos: 5
```

### Manual Management (Console)

You can also manage the mock wallet from the browser console:

```javascript
// Create mock wallet manually
await window.midnightDevUtils.createMockWallet()

// Remove mock wallet
await window.midnightDevUtils.removeMockWallet()

// Access mock data utilities
window.midnightMockData.log()           // Log mock data summary
window.midnightMockData.getBalances()   // Get mock balances
window.midnightMockData.getAddresses()  // Get mock addresses
window.midnightMockData.getTransactions() // Get mock transactions
window.midnightMockData.getUTXOs()      // Get mock UTXOs
```

### Quick Access Button (Wallet Creation Screen)

When you're on the wallet creation screen ([CreateOrImportSeedPhrase.vue](src/options/modules/welcome/components/CreateOrImportSeedPhrase.vue)) and select **Midnight Preview** from the network dropdown, a special button appears:

- **Button Title**: "Go to Midnight Dashboard"
- **Icon**: Purple moon crescent (Midnight branding)
- **Location**: Below "Create Wallet", "Restore Wallet", and "Pair Hardware Wallet" buttons
- **Function**:
  - Finds the Mock Midnight Wallet in your wallet list
  - Automatically logs in to the mock wallet
  - Navigates to the dashboard with pre-loaded mock data
  - Shows an error if the mock wallet doesn't exist

**How to use:**
1. Navigate to the wallet creation/welcome screen
2. Select "Midnight Preview" from the network dropdown
3. Click "Go to Midnight Dashboard" button
4. You'll be logged in and taken to the dashboard with mock data

This provides a quick way to access the Midnight mock dashboard without manually creating or logging into a wallet.

## Implementation Status

### ✅ Completed (Phase 0 - Foundation)
- [x] Blockchain constant (`Blockchain.MIDNIGHT`)
- [x] Coin type constant (2400)
- [x] Network configuration (Midnight Preview)
- [x] Mock wallet for UI development
- [x] Login screen integration
- [x] **Mock data service** with realistic balances, transactions, UTXOs
- [x] **Midnight store** for state management (Five-balance system)
- [x] **Login flow integration** - Mock data automatically loaded
- [x] **Console utilities** for debugging (`window.midnightMockData`)
- [x] **Dashboard UI** - Five-balance cards, quick actions, transactions list

### 🚧 Next Steps (Phase 1 - Three-Key Foundation)
Based on [Midnight_Implementation_Guide.html](Midnight_Implementation_Guide.html):

1. **Three-Key Derivation** (`src/shared/utils/midnightCrypto.ts`)
   - Implement BIP32 key derivation for roles 0, 2, 3
   - Zswap key (role 3) - for zero-knowledge swaps
   - Dust key (role 2) - for DUST token management
   - NightExternal key (role 0) - for external NIGHT transactions

2. **Three-Address Generation** (`src/shared/utils/midnightAddresses.ts`)
   - Generate dust, shielded, unshielded addresses
   - Bech32m encoding for Midnight addresses

3. **EMIP3 Encryption Integration**
   - Reuse existing `encryptWithPassword`/`decryptWithPassword` from `crypto.ts`
   - Store encrypted keys for all three roles

### 📋 Upcoming Phases

See the full implementation guide for details:
- [Midnight_Integration_Plan.html](Midnight_Integration_Plan.html) - Executive summary
- [Midnight_Implementation_Guide.html](Midnight_Implementation_Guide.html) - Part 1 (Phases 1-5)
- [Midnight_Implementation_Guide_Part2.html](Midnight_Implementation_Guide_Part2.html) - Part 2 (Phases 6-10)

**Phase 2**: Three-Wallet Initialization & SDK Integration
**Phase 3**: State Management & Store Architecture
**Phase 4**: Database Schema & Persistence
**Phase 5**: Dashboard UI & Five-Balance Display
**Phase 6**: DUST Registration Flow
**Phase 7**: Transaction System & ZK Proofs
**Phase 8**: GraphQL Sync & Real-time Updates
**Phase 9**: Network Configuration & Manifest Updates
**Phase 10**: Testing Strategy & QA

## Important Notes

### ⚠️ Mock Wallet Limitations

The mock wallet created by this utility:
- **Uses fake encrypted keys** (not real cryptographic material)
- **Cannot sign transactions** (no real private keys)
- **Cannot connect to Midnight network** (mock data only)
- **Is for UI development only** - DO NOT use in production

### 🔒 Real Wallet Implementation

When implementing real Midnight wallet functionality (Phase 1+):
1. Remove or disable mock wallet creation
2. Implement proper three-key derivation (see Phase 1 guide)
3. Use real EMIP3 encryption for key storage
4. Integrate Midnight SDK packages (@midnight-ntwrk/*)

### 🎨 Midnight Branding

The current configuration uses a **placeholder icon** (Cardano blue logo). Update this in [src/utils/networks.ts](src/utils/networks.ts):

```typescript
// TODO: Replace with actual Midnight logo
import midnightLogo from '@/assets/svg/cardano-blue.svg';
```

Add the proper Midnight logo asset:
1. Place logo in `src/assets/svg/midnight.svg` (or similar)
2. Update import in `networks.ts`
3. Update `icon` and `currencyImage` fields in network configuration

## Testing the Integration

### 1. Run Development Build

```bash
npm run dev
```

### 2. Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` folder

### 3. Verify Mock Wallet

1. Open the extension
2. Navigate to wallet selection/login screen
3. Look for "Mock Midnight Wallet" with "Midnight - Preview" label
4. Attempt to "login" (will show error since no real wallet backend exists yet)

### 4. Next Steps

With the mock wallet visible, you can now:
- **Design the Midnight dashboard UI** (Phase 5)
- **Plan the three-balance display** (NIGHT + DUST balances)
- **Create transaction UI mockups** (send, receive, register DUST)
- **Test network switching** (Cardano ↔ Midnight)

## Removing Mock Wallet

To disable the mock wallet:

### Option 1: Remove from App Initialization
Comment out in [src/options/main.ts](src/options/main.ts):

```typescript
// await initMockMidnightWalletForDev();
```

### Option 2: Use Console Command
```javascript
await window.midnightDevUtils.removeMockWallet()
```

### Option 3: Manual Database Deletion
1. Open Chrome DevTools → Application → IndexedDB
2. Find `GeroWalletDatabase` → `wallets` table
3. Delete the wallet with `chain: 'Midnight'`

## File Reference

### Modified Files
- [src/models/types.ts](src/models/types.ts) - Blockchain and coin type constants
- [src/utils/networks.ts](src/utils/networks.ts) - Network configuration
- [src/options/main.ts](src/options/main.ts) - App initialization
- [src/services/walletManager.service.ts](src/services/walletManager.service.ts) - Midnight login/logout handling
- [src/options/modules/welcome/components/CreateOrImportSeedPhrase.vue](src/options/modules/welcome/components/CreateOrImportSeedPhrase.vue) - Quick access button to Midnight dashboard

### New Files
- [src/utils/midnight-dev-utils.ts](src/utils/midnight-dev-utils.ts) - Mock wallet creation utilities
- [src/utils/midnight-mock-data.ts](src/utils/midnight-mock-data.ts) - Mock Midnight blockchain data
- [src/stores/midnightStore.ts](src/stores/midnightStore.ts) - Midnight state management (Vue Observable)
- [MIDNIGHT_DEV_SETUP.md](MIDNIGHT_DEV_SETUP.md) - This file

### Implementation Guides
- [Midnight_Integration_Plan.html](Midnight_Integration_Plan.html)
- [Midnight_Implementation_Guide.html](Midnight_Implementation_Guide.html)
- [Midnight_Implementation_Guide_Part2.html](Midnight_Implementation_Guide_Part2.html)
- [Midnight_Implementation_ADDENDUM.html](Midnight_Implementation_ADDENDUM.html)
- [MIDNIGHT_DOCS_INDEX.md](MIDNIGHT_DOCS_INDEX.md)

---

---

## Mock Data Details

### Five-Balance System
The Midnight store follows the five-balance architecture from Phase 3 specifications:

```typescript
balances: {
  nightShielded: 1,234.567890 tNIGHT      // Private NIGHT in shielded pool
  nightUnshielded: 5,678.123456 tNIGHT    // Public NIGHT in unshielded pool
  nightRegistered: 3,000.000000 tNIGHT    // NIGHT registered for DUST generation
  dust: 45.678901 tDUST                   // DUST available for fees
  dustGenerating: 12.345678 tDUST         // Projected DUST from registered NIGHT
}
```

### Three-Address System
Mock addresses follow Midnight Preview testnet format (bech32m encoding):

```typescript
addresses: {
  dust: "midnightt1dust1qyx2ymk0sa79uyap0vdvz3ayxglz5nx..."
  shielded: "midnightt1shield1qyx2ymk0sa79uyap0vdvz3ayxglz5nx..."
  unshielded: "midnightt1qyx2ymk0sa79uyap0vdvz3ayxglz5nx..."
}
```

### Mock Transactions
7 transactions covering all operation types:
- **Receive** (2 txs): Incoming NIGHT transfers
- **Send** (2 txs): Outgoing NIGHT transfers
- **Register DUST** (1 tx): NIGHT registration for DUST generation
- **Shield** (1 tx): NIGHT transfer from unshielded → shielded (with ZK proof)
- **Unshield** (1 tx): NIGHT transfer from shielded → unshielded (pending)

All transactions include:
- Timestamp (ranging from 5 days ago to 3 hours ago)
- Fee amounts (in DUST)
- Block heights
- ZK proof generation time (for shielded transactions: ~10-12 seconds)

### Mock UTXOs
5 UTXOs for DUST registration UI testing:
- **2 registered** (generating DUST for 4 days)
- **3 unregistered** (ready to be registered)
- Total unshielded value matches balance

### Accessing Mock Data in Code

```typescript
// In background context (walletManager, background.ts)
import { midnightActions } from '@/stores/midnightStore';
import { getMockMidnightWalletData } from '@/utils/midnight-mock-data';

const mockData = getMockMidnightWalletData();
midnightActions.initializeMockData(mockData);

// In browser context (Vue components)
import { midnightStore } from '@/stores/midnightStore';
import { formatNight, formatDust } from '@/utils/midnight-mock-data';

// Access balances
const nightShielded = formatNight(midnightStore.balances.nightShielded);
const dust = formatDust(midnightStore.balances.dust);

// Access addresses
const unshieldedAddress = midnightStore.addresses.unshielded;

// Access transactions
const recentTxs = midnightStore.transactions.slice(0, 5);

// Access UTXOs
const registeredUTXOs = midnightStore.utxos.filter(u => u.registeredForDust);
```

---

**Last Updated**: 2025-12-11
**Status**: Phase 0 Complete - Mock Wallet Integration with Full Data + Quick Access Button
**Next Phase**: Phase 1 - Three-Key Foundation
