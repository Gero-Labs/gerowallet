# Gero Wallet - Tomo Connect Integration PR

## Overview

PR to add Gero Wallet as a built-in Bitcoin wallet in `@tomo-inc/tomo-wallet-provider`.

Gero Wallet is a multi-chain browser extension wallet supporting Cardano and Bitcoin. It exposes a `window.gero_btc` provider object implementing the `TomoBitcoinInjected` interface.

- Chrome Web Store: https://chromewebstore.google.com/detail/gero-dashboard/iifeegfcfhlhhnilnggaopkpegobafdn
- Website: https://gerowallet.io

## Files to Add

### 1. `src/providers/btc/GeroBTCWallet.ts`

Copy `GeroBTCWallet.ts` from this directory into the tomo-wallet-provider repo.

### 2. Update `src/providers/btc/list.ts`

Add to the imports:

```typescript
import { GeroBTCWallet, geroWalletOption } from './GeroBTCWallet';
```

Add to the wallet list array:

```typescript
geroWalletOption,
```

### 3. Update `src/providers/btc/index.ts`

Add the export:

```typescript
export { GeroBTCWallet, geroWalletOption } from './GeroBTCWallet';
```

## Detection

Gero Wallet injects `window.gero_btc` on every page when the extension is installed. The constructor checks for this property and throws if not found (standard Tomo pattern for "not installed" detection).

## Supported Methods

| Method | Supported |
|--------|-----------|
| `requestAccounts` | Yes |
| `getAccounts` | Yes |
| `getPublicKey` | Yes |
| `signPsbt` | Yes |
| `signPsbts` | Yes |
| `getNetwork` | Yes (mainnet/testnet) |
| `signMessage` | Yes (ecdsa, bip322-simple) |
| `switchNetwork` | No (throws) |
| `sendBitcoin` | No (throws) |
| `pushTx` | Yes |
| `getBalance` | Yes (returns satoshis) |
| `on`/`off` | Yes (accountsChanged, networkChanged) |
