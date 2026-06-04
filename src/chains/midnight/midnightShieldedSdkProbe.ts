// Smoke probe — forces `@midnight-ntwrk/wallet-sdk-shielded` into the BG vite
// bundle so we know it loads cleanly inside the Chrome MV3 service worker
// before wiring real shielded code. Same pattern we used for dust-wallet
// (deleted after the real handler shipped).
//
// What we're checking:
//   1. No new vite shim required (the SDK's transitive deps are already in
//      the BG bundle via wallet-sdk-unshielded-wallet + ledger-v8).
//   2. No runtime crash at SW import time (top-level side effects, WASM
//      loading, ESM resolution all happy).
//   3. Bundle-weight delta is sane (compare BG `index.js` byte size pre/post).
//
// SAFE TO DELETE once `midnightTxBuilder.ts` (or a new `…Shielded.ts` split)
// imports `ShieldedWallet` for real.

import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';

// Touch the export so rollup actually emits it; bare imports get tree-shaken
// even with side-effect intent.
void ShieldedWallet;

// eslint-disable-next-line no-console
console.log('[midnight] shielded-wallet SDK loaded in BG');
