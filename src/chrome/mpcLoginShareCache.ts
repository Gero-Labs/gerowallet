/**
 * Session cache for a wallet's MPC LOGIN share (the backend-held share, fetched
 * once per login after a Google idToken is verified).
 *
 * Purpose: let a logged-in MPC wallet be re-unlocked after a lock with only the
 * device secret (passkey / spending password) — no repeat Google sign-in — for
 * the rest of the BROWSER session. Reconstruction still needs TWO shares: the
 * cached login share here PLUS the device share, which is decrypted with the
 * passkey/password and validated against the wallet's xpub. So this cache alone
 * reconstructs nothing.
 *
 * Backed by chrome.storage.session (NOT chrome.storage.local / IndexedDB):
 *  - In MEMORY only — never written to disk. Cleared automatically when the
 *    browser closes. Access level is the default TRUSTED_CONTEXTS, so content
 *    scripts / web pages cannot read it.
 *  - Survives service-worker restarts. The previous plain in-memory Map died
 *    with the MV3 worker (~30s idle), which made "logged in" re-prompt Google;
 *    session storage fixes that while keeping the share off disk.
 *
 * Lifetime, deliberately narrow:
 *  - SET after a successful Google unlock (reconstruct+validate passed).
 *  - KEPT across WalletStore lock — that is what enables Google-free re-unlock.
 *  - CLEARED on logout / wallet switch (walletManager.service.ts) and on browser
 *    close (chrome.storage.session semantics).
 *
 * Persisting this to disk would put both the (at-rest encrypted) device share
 * and the login share on disk, collapsing the durable 2-of-3 posture — so it
 * stays in session storage only.
 */

const KEY_PREFIX = 'mpcLoginShare:';
const keyFor = (walletId: number): string => `${KEY_PREFIX}${walletId}`;

export const mpcLoginShareCache = {
  /** Cache the login share for a wallet for the rest of the browser session. */
  async set(walletId: number, loginShare: string): Promise<void> {
    await chrome.storage.session.set({ [keyFor(walletId)]: loginShare });
  },

  /** Read the cached login share, or undefined if none is cached this session. */
  async get(walletId: number): Promise<string | undefined> {
    const key = keyFor(walletId);
    const result = await chrome.storage.session.get(key);
    const value = result[key];
    return typeof value === 'string' ? value : undefined;
  },

  /** Whether a login share is cached for this wallet (drives Google-free re-unlock). */
  async has(walletId: number): Promise<boolean> {
    return (await this.get(walletId)) !== undefined;
  },

  /** Drop the cached login share for a single wallet. */
  async clear(walletId: number): Promise<void> {
    await chrome.storage.session.remove(keyFor(walletId));
  },

  /** Drop all cached login shares (this cache's keys only). Call on logout / wallet switch. */
  async clearAll(): Promise<void> {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
    if (keys.length) await chrome.storage.session.remove(keys);
  },
};
