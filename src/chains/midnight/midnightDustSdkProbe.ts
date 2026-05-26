// Smoke probe — forces `@midnight-ntwrk/wallet-sdk-dust-wallet` into the BG
// vite bundle and verifies it loads cleanly inside the Chrome MV3 service
// worker. Imported once from background.ts. Logs to BG console at SW boot.
//
// Why this exists: before wiring the real BG-side NIGHT-transfer handler
// (which needs the dust SDK for `balanceTransactions(dustSecretKey, ...)`
// fee construction), we want to confirm the dust SDK bundles without new
// vite shims — its transitive deps are identical to wallet-sdk-unshielded-
// wallet which already works in BG, so this should be a no-op. If the BG
// fails to boot after this file lands, that assumption was wrong and we
// know to fix the bundler before going further.
//
// SAFE TO DELETE once the real BG-side tx handler is in place — the SDK
// will be pulled in via real imports there.

import { DustWallet, sampleDustSecretKey } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

// Touch both exports to make sure rollup actually emits them; bare imports
// can get tree-shaken even with side-effect intent.
void DustWallet;
void sampleDustSecretKey;

// eslint-disable-next-line no-console
console.log('[midnight] dust-wallet SDK loaded in BG');
