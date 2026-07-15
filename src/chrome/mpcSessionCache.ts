/**
 * In-memory session cache for validated MPC root-key bytes.
 *
 * Populated once per unlock (Google login share fetched + reconstructed +
 * validated against the wallet's expected xpub — see mpcWalletHandlers.ts
 * `unlockMpcWalletFlow`), then read by the sign path so individual signs
 * don't re-prompt Google for the rest of the unlocked session.
 *
 * Memory-only by design: never persisted to chrome.storage/IndexedDB, and
 * never logged. Must be cleared on wallet lock/logout (wired in
 * walletManager.service.ts `lock()`/`logout()`).
 */

const rootKeyBytesByWalletId = new Map<number, Uint8Array>();

export const mpcSessionCache = {
  /** Cache validated root-key bytes for a wallet for the rest of the unlocked session. */
  set(walletId: number, bytes: Uint8Array): void {
    rootKeyBytesByWalletId.set(walletId, bytes);
  },

  /** Read cached root-key bytes, or undefined if the wallet hasn't been unlocked via Google this session. */
  get(walletId: number): Uint8Array | undefined {
    return rootKeyBytesByWalletId.get(walletId);
  },

  /** Drop the cached bytes for a single wallet (e.g. explicit re-lock of one wallet). */
  clear(walletId: number): void {
    rootKeyBytesByWalletId.delete(walletId);
  },

  /** Drop all cached bytes. Call on wallet lock/logout. */
  clearAll(): void {
    rootKeyBytesByWalletId.clear();
  },
};
