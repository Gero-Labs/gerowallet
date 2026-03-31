/**
 * Strike v2 API Key Wiring
 *
 * Connects the Cardano wallet's Ed25519 keys to the Strike v2 API client.
 *
 * The Strike v2 API requires Ed25519 authentication. In Cardano:
 * - Public key: available from wallet account (WalletAccount.publicKey)
 * - Private key: derived from mnemonic (requires spending password decryption)
 *
 * Flow:
 * 1. User navigates to perpetuals trading page
 * 2. If not already authenticated, prompt for spending password
 * 3. Derive Ed25519 key pair from mnemonic
 * 4. Call setStrikeApiKeys(privateKeyHex, publicKeyHex)
 * 5. Keys persist in memory until wallet lock/logout
 * 6. On lock/logout, call clearStrikeApiKeys()
 *
 * NOTE: Which specific Cardano key Strike expects needs confirmation:
 * - Option A: Account-level Ed25519 key (m/1852'/1815'/0')
 * - Option B: Stake key (used for on-chain identity)
 * - Option C: A dedicated API key generated separately on Strike's platform
 *
 * The current implementation supports all options — just pass the correct
 * hex key pair to setStrikeApiKeys().
 */

import { setStrikeApiKeys, clearStrikeApiKeys, hasStrikeApiKeys } from './strike-v2.client';
import { walletStore } from '@/stores/walletStore';

/**
 * Initialize Strike API keys from the wallet's Ed25519 key pair.
 * Call this after the user authenticates (enters spending password or PassKey).
 *
 * @param privateKeyHex - Ed25519 private key (64 hex chars = 32 bytes)
 */
export function initStrikeAuth(privateKeyHex: string): void {
  const publicKey = walletStore.loggedWallet?.publicKey;
  if (!publicKey) {
    console.warn('[Strike] Cannot init auth: no wallet public key available');
    return;
  }
  setStrikeApiKeys(privateKeyHex, publicKey);
}

/**
 * Clear Strike API keys (call on wallet lock/logout).
 */
export function resetStrikeAuth(): void {
  clearStrikeApiKeys();
}

/**
 * Check if Strike API authentication is ready.
 */
export function isStrikeAuthReady(): boolean {
  return hasStrikeApiKeys();
}
