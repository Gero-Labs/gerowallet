# Type Fixes Needed

**TypeScript compatibility fixes required after installing cardano-js-sdk packages**

## Current Status

The service files have been created but require the actual `@cardano-sdk` packages to be installed for full type compatibility. Here are the known type issues and their fixes:

---

## 1. Install Required Packages First

```bash
npm install @cardano-sdk/core@^0.46.9 \
            @cardano-sdk/wallet@^0.46.9 \
            @cardano-sdk/key-management@^0.46.9 \
            @cardano-sdk/cardano-services-client@^0.46.9 \
            @cardano-sdk/web-extension@^0.46.9 \
            @cardano-sdk/crypto@^0.1.30 \
            @cardano-sdk/util@^0.46.9 \
            rxjs@^7.8.1
```

---

## 2. AddressDiscovery Interface Mismatch

**Issue**: The `BlockfrostAddressDiscovery` implementation might not match the exact signature expected by `@cardano-sdk/wallet`.

**Current Implementation**:
```typescript
class BlockfrostAddressDiscovery implements AddressDiscovery {
  async discover(addresses: Cardano.PaymentAddress[]): Promise<Cardano.PaymentAddress[]> {
    // ...
  }
}
```

**Potential Fix** (check actual SDK interface):
```typescript
import { AddressDiscovery, Bip32Account, GroupedAddress } from '@cardano-sdk/wallet';

class BlockfrostAddressDiscovery implements AddressDiscovery {
  async discover(addressManager: Bip32Account): Promise<GroupedAddress[]> {
    const addresses = await addressManager.deriveAddresses();
    const usedAddresses: GroupedAddress[] = [];

    for (const address of addresses) {
      const txs = await this.client.addressTransactions(address.address, { count: 1, page: 1 });
      if (txs && txs.length > 0) {
        usedAddresses.push(address);
      }
    }

    return usedAddresses;
  }
}
```

---

## 3. HandleProvider Type Mismatch

**Issue**: The `HandleProvider` interface expects `HandleResolution[]` but we're returning `Map<any, any>`.

**Current Implementation**:
```typescript
const handleProvider: HandleProvider = {
  resolveHandles: async (handles) => {
    return new Map(); // Wrong return type
  },
  healthCheck: async () => ({ ok: true })
};
```

**Fix**:
```typescript
import { HandleProvider, HandleResolution } from '@cardano-sdk/core';

const handleProvider: HandleProvider = {
  resolveHandles: async (args) => {
    // Implement actual ADA Handle resolution
    const resolutions: HandleResolution[] = [];

    for (const handle of args.handles) {
      try {
        // Call ADA Handle API or your backend
        const resolution = await fetchHandleResolution(handle);
        if (resolution) {
          resolutions.push(resolution);
        }
      } catch (error) {
        console.error(`Failed to resolve handle ${handle}:`, error);
      }
    }

    return resolutions;
  },
  healthCheck: async () => ({ ok: true })
};
```

---

## 4. TxCBOR Type Issue

**Issue**: `Cardano.TxCBOR` might not be exported or might have a different name.

**Current Implementation**:
```typescript
submitTx: async (tx: Cardano.TxCBOR) => {
  // ...
}
```

**Potential Fix**:
```typescript
import { Cardano } from '@cardano-sdk/core';

submitTx: async (tx: Cardano.Tx) => {
  // Serialize to CBOR
  const txCbor = Cardano.util.bytesToHex(tx.toCbor());

  const response = await fetch(customSubmitTxUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor' },
    body: Buffer.from(txCbor, 'hex')
  });

  // ...
}
```

---

## 5. RemoteApiProperties Missing Export

**Issue**: `RemoteApiProperties` and `RemoteApiPropertyType` might not be exported from `@cardano-sdk/web-extension`.

**Current Import**:
```typescript
import { createPersistentCacheStorage, RemoteApiProperties, RemoteApiPropertyType } from '@cardano-sdk/web-extension';
```

**Potential Fix**:

If not exported, you can define them locally or remove the `walletProvidersProperties` export (it's only needed for cross-context messaging which might not be necessary initially):

```typescript
// Option 1: Remove walletProvidersProperties export if not needed
// export const walletProvidersProperties = ...  // Comment out

// Option 2: Define locally if needed
export enum RemoteApiPropertyType {
  MethodReturningPromise = 'MethodReturningPromise',
  Observable = 'Observable',
  HotObservable = 'HotObservable'
}

export type RemoteApiProperties<T> = {
  [K in keyof T]?: Record<string, RemoteApiPropertyType>;
};
```

---

## 6. BlockfrostClient Method Signatures

**Issue**: `BlockfrostClient` methods might have different signatures than expected.

**Check these methods**:
- `addressTransactions(address, options)`
- `txsUtxos(txId)`

**Refer to Blockfrost SDK documentation**: https://github.com/blockfrost/blockfrost-js

Example fix:
```typescript
// addressTransactions might require different options
const txs = await this.client.addressTransactions(
  address,
  {
    count: 1,
    page: 1,
    order: 'desc'  // May need additional options
  }
);
```

---

## 7. Simplest Approach: Start Without Custom Implementations

For initial implementation, you can use the SDK's built-in providers without custom implementations:

```typescript
import {
  createCardanoServicesProviders
} from '@cardano-sdk/cardano-services-client';

export async function createCardanoProviders(
  config: ProvidersConfig
): Promise<WalletProvidersDependencies> {
  // Use SDK's built-in provider factory
  const providers = await createCardanoServicesProviders({
    baseUrl: getBlockfrostUrl(config.chain, config.network),
    projectId: config.blockfrostApiKey,
    logger: config.logger
  });

  return providers;
}
```

This avoids type issues with custom implementations until you need specific customizations.

---

## Testing After Fixes

After applying fixes:

1. **Type check**:
   ```bash
   npm run typecheck
   ```

2. **Build**:
   ```bash
   npm run build
   ```

3. **Run tests**:
   ```bash
   npm run test tests/observableWallet.test.ts
   ```

---

## Priority Order

1. ✅ **Install packages** (most important)
2. **Test with built-in providers first** (simplest approach)
3. **Fix type errors one by one** (as they appear)
4. **Implement custom providers** (only if needed)

---

## Quick Start (Recommended Approach)

Instead of custom implementations, start with SDK's built-in providers:

```typescript
// src/services/cardanoProviders.service.ts (simplified)
import { BlockfrostProvider } from '@cardano-sdk/cardano-services-client';

export async function createCardanoProviders(config: ProvidersConfig) {
  const blockfrost = new BlockfrostProvider({
    projectId: config.blockfrostApiKey,
    baseUrl: getBlockfrostUrl(config.chain, config.network)
  });

  return {
    assetProvider: blockfrost,
    networkInfoProvider: blockfrost,
    txSubmitProvider: blockfrost,
    utxoProvider: blockfrost,
    chainHistoryProvider: blockfrost,
    rewardAccountInfoProvider: blockfrost,
    rewardsProvider: blockfrost,
    stakePoolProvider: blockfrost,
    drepProvider: blockfrost,
    handleProvider: blockfrost,  // If supported
    // Add caching later
  };
}
```

This gets you started quickly and you can add custom implementations (caching, address discovery) later once the basic integration works.

---

**Status**: Ready for package installation and type verification
**Next Step**: `npm install` and resolve any remaining type errors