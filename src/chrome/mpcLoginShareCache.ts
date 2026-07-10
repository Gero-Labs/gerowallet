/**
 * In-memory session cache for a wallet's MPC LOGIN share (the backend-held
 * share, fetched once per login after a Google idToken is verified).
 *
 * Purpose: let a logged-in MPC wallet be re-unlocked after a lock with only
 * the device secret (passkey / spending password) — no fresh Google sign-in —
 * for the rest of the logged-in session. Reconstruction still needs TWO shares:
 * the cached login share here PLUS the device share, which is decrypted with
 * the passkey/password. So this cache alone reconstructs nothing.
 *
 * Lifetime, deliberately narrow:
 *  - SET when the login share is fetched during an online (Google) unlock.
 *  - KEPT across `WalletStore` lock — that is what makes Google-free re-unlock
 *    possible while the wallet stays logged in.
 *  - CLEARED on logout and wallet switch (walletManager.service.ts), and it
 *    dies with the service worker.
 *
 * Memory-only BY DESIGN: never written to chrome.storage / IndexedDB and never
 * logged. Persisting it would put both the device share (at rest, encrypted)
 * and the login share on disk, collapsing the 2-of-3 model to a single
 * passkey/password factor — so it must stay in memory only.
 */

const loginShareByWalletId = new Map<number, string>();

export const mpcLoginShareCache = {
  /** Cache the login share for a wallet for the rest of the logged-in session. */
  set(walletId: number, loginShare: string): void {
    loginShareByWalletId.set(walletId, loginShare);
  },

  /** Read the cached login share, or undefined if none is cached this session. */
  get(walletId: number): string | undefined {
    return loginShareByWalletId.get(walletId);
  },

  /** Whether a login share is cached for this wallet (drives Google-free re-unlock). */
  has(walletId: number): boolean {
    return loginShareByWalletId.has(walletId);
  },

  /** Drop the cached login share for a single wallet. */
  clear(walletId: number): void {
    loginShareByWalletId.delete(walletId);
  },

  /** Drop all cached login shares. Call on logout / wallet switch (NOT on lock). */
  clearAll(): void {
    loginShareByWalletId.clear();
  },
};
