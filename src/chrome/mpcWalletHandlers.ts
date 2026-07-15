/**
 * Pure orchestration for the MPC "Sign in with Google" wallet (Plan D, D1).
 *
 * These functions take all side-effecting dependencies (backend calls, crypto
 * utils, DB writes, the session cache) as injected `deps`, so they're unit
 * testable against stubs with no running backend. `src/chrome/background.ts`
 * wires the real implementations in and calls these from thin
 * `app.addToOptions(...)` handlers.
 *
 * Secret hygiene: never log idToken, device-share secrets (password or PRF
 * output), device/login/recovery shares, entropy, or key bytes. Catch-handler
 * discipline lives in background.ts; these flows just throw/rethrow.
 */
import { MpcValidationError, RecoveryBackupStoreError, NoRecoveryBackupError } from '@/shared/utils/mpc';
import type { MpcShareSet, DeviceShareSecret } from '@/shared/utils/mpc';
import { mpcSessionCache } from '@/chrome/mpcSessionCache';

/** Minimal wallet shape the sign-path helpers need. */
export interface SignableWallet {
  id?: number;
  encryptionMethod?: string;
}

/**
 * Resolve the pre-decrypted root-key bytes to pass to walletBg.signTx/signData.
 *
 * - Explicit bytes (PRF wallets, unlocked via WebAuthn in the UI) always win —
 *   PRF/hardware behavior is unchanged.
 * - Non-MPC wallets with no explicit bytes get `undefined` — the password
 *   decrypt path is unchanged.
 * - MPC ('mpc') wallets never send key bytes over the wire; the validated
 *   root-key bytes live only in the background session cache (populated once
 *   per session by UNLOCK_MPC_WALLET). If the cache is empty, throw a clean
 *   "unlock with Google" error instead of letting signTx decrypt(undefined).
 *
 * Routing every Cardano sign call-site through this is safe for ALL wallet
 * types: it only changes behavior for `encryptionMethod === 'mpc'`.
 */
export function resolveSignPrivateKeyBytes(
  wallet: SignableWallet | null | undefined,
  explicitBytes: Uint8Array | undefined,
  sessionCache: Pick<typeof mpcSessionCache, 'get'> = mpcSessionCache,
): Uint8Array | undefined {
  if (explicitBytes) return explicitBytes;
  if (wallet?.encryptionMethod === 'mpc') {
    const cached = wallet.id != null ? sessionCache.get(wallet.id) : undefined;
    if (!cached) {
      throw new Error('This wallet needs to be unlocked with Google before signing.');
    }
    return cached;
  }
  return explicitBytes;
}

/**
 * Guard for sign paths where MPC key material is NOT applicable yet (e.g.
 * Bitcoin-specific signers — an MPC Google wallet reconstructs a Cardano
 * root key only). Throws a clean error for `mpc` wallets so they never fall
 * through to a raw decrypt(undefined); a no-op for every other wallet type.
 */
export function assertMpcActionSupported(
  wallet: SignableWallet | null | undefined,
  action: string,
): void {
  if (wallet?.encryptionMethod === 'mpc') {
    throw new Error(`Sign in with Google (MPC) is not yet supported for ${action}.`);
  }
}

/** Decode the JWT PAYLOAD only (base64url middle segment) and return its `sub` claim.
 *  Does NOT verify the signature — the backend already verifies it on enroll/login-share.
 *  Used only to key the local wallet record. */
export function subFromIdToken(idToken: string): string {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed idToken');
  }
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('utf-8');
  const payload = JSON.parse(json);
  if (!payload?.sub) {
    throw new Error('idToken payload missing sub');
  }
  return payload.sub as string;
}

// ---------------------------------------------------------------------------
// Task 2: create
// ---------------------------------------------------------------------------

export interface CreateMpcGoogleWalletInput {
  name: string;
  icon: string;
  theme: string;
  chain: string;
  network: string;
  idToken: string;
  secret: DeviceShareSecret;
  /** Present when secret.kind === 'prf'; persisted so unlock can re-derive. */
  webAuthnCredentialId?: string;
  mpcPrfSaltId?: string;
}

export interface CreateMpcGoogleWalletDeps {
  prepareMpcWalletCreation: () => Promise<{ entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string }>;
  encryptDeviceShare: (deviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  enrollLoginShare: (idToken: string, chain: string, network: string, loginShare: string) => Promise<{ stored: boolean }>;
  createMpcGoogleWallet: (params: {
    name: string;
    icon: string;
    theme: string;
    chain: string;
    network: string;
    userId: string;
    publicKey: string;
    encryptedDeviceShare: string;
    webAuthnCredentialId?: string;
    mpcPrfSaltId?: string;
  }) => Promise<number>;
  subFromIdToken: (idToken: string) => string;
}

export interface CreateMpcGoogleWalletResult {
  walletId: number;
  /** Return to the caller for encrypted-download backup. Never log or persist server-side. */
  recoveryShare: string;
  /**
   * The wallet's CIP-1852 xpub. Written (unencrypted — it is not secret) into
   * the recovery-file envelope as an anchor so a restore on a fresh device can
   * validate the reconstructed key actually belongs to this wallet+Google
   * account, rather than silently minting a phantom wallet from a mismatched
   * recovery-file / Google-account pairing.
   */
  publicKey: string;
}

/**
 * Create a new MPC Google wallet: split fresh entropy into 3 shares, enroll
 * the login share with the backend (verifies idToken), encrypt the device
 * share at rest under the device-share secret (password or passkey PRF
 * output), and persist the wallet record.
 * The recovery share is returned to the caller — it is never logged and
 * never sent anywhere by this flow (the UI is responsible for the
 * encrypted-download backup step).
 */
export async function createMpcGoogleWalletFlow(
  input: CreateMpcGoogleWalletInput,
  deps: CreateMpcGoogleWalletDeps,
): Promise<CreateMpcGoogleWalletResult> {
  const { name, icon, theme, chain, network, idToken, secret, webAuthnCredentialId, mpcPrfSaltId } = input;
  const { prepareMpcWalletCreation, encryptDeviceShare, enrollLoginShare, createMpcGoogleWallet, subFromIdToken: getSub } = deps;

  const { shareSet, expectedXpub } = await prepareMpcWalletCreation();
  const encryptedDeviceShare = await encryptDeviceShare(shareSet.deviceShare, secret);
  await enrollLoginShare(idToken, chain, network, shareSet.loginShare);
  const userId = getSub(idToken);

  const walletId = await createMpcGoogleWallet({
    name,
    icon,
    theme,
    chain,
    network,
    userId,
    publicKey: expectedXpub,
    encryptedDeviceShare,
    webAuthnCredentialId,
    mpcPrfSaltId,
  });

  return { walletId, recoveryShare: shareSet.recoveryShare, publicKey: expectedXpub };
}

// ---------------------------------------------------------------------------
// Task 3: unlock
// ---------------------------------------------------------------------------

export interface MpcWalletRecord {
  chain: string;
  network: string;
  publicKey: string;
  mpcDeviceShare: string;
  /** Staged next-generation device share written by a crash-safe re-split (setRecoveryPasswordFlow). */
  mpcDeviceShareNext?: string;
  webAuthnCredentialId?: string;
  mpcPrfSaltId?: string;
}

export interface UnlockMpcWalletInput {
  walletId: number;
  idToken: string;
  secret: DeviceShareSecret;
}

export interface UnlockMpcWalletDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  reconstructRootKeyBytes: (
    encryptedDeviceShare: string,
    secret: DeviceShareSecret,
    loginShare: string,
    expectedXpub: string,
  ) => Promise<Uint8Array>;
  sessionCache: { set: (walletId: number, bytes: Uint8Array) => void };
  /** Finish a crashed re-split: make the staged `mpcDeviceShareNext` the primary device share. Optional. */
  promoteMpcDeviceShareNext?: (walletId: number) => Promise<void>;
}

/**
 * Unlock an MPC wallet for the session: fetch the login share (backend
 * verifies idToken), reconstruct + validate the root key against the
 * wallet's stored xpub, and cache the validated bytes so signs don't
 * re-prompt Google for the rest of the unlocked session.
 * On MpcValidationError (shares don't reconstruct to this wallet's key), the
 * cache is left untouched and a clean error is thrown instead of the raw one.
 */
export async function unlockMpcWalletFlow(
  input: UnlockMpcWalletInput,
  deps: UnlockMpcWalletDeps,
): Promise<void> {
  const { walletId, idToken, secret } = input;
  const { getWallet, getLoginShare, reconstructRootKeyBytes, sessionCache, promoteMpcDeviceShareNext } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);

  try {
    const bytes = await reconstructRootKeyBytes(
      wallet.mpcDeviceShare,
      secret,
      loginShare,
      wallet.publicKey,
    );
    // Primary device+login reconstructs → unlocked. NEVER touch `mpcDeviceShareNext`
    // here. A staged next may be the ONLY device share compatible with a rotated
    // backend login (a re-split that crashed after `rotate` but before `promote`);
    // if the primary succeeds only because a STALE login share survived in the
    // session cache, destroying that next would brick the wallet on the next fresh
    // fetch of S'.login. A leftover next is harmless — the next re-split overwrites
    // it via `setMpcDeviceShareNext`.
    sessionCache.set(walletId, bytes);
    return;
  } catch (primaryErr) {
    // Resume-on-unlock: a re-split (setRecoveryPasswordFlow) that crashed AFTER the
    // backend login-share rotate but BEFORE the local promote leaves the backend on
    // S'.login while the device share is still S.device → primary reconstruct fails
    // the xpub check. If a staged S'.device is present, try IT against the (new)
    // login share; on success finish the interrupted promote and continue unlocked.
    if (wallet.mpcDeviceShareNext && promoteMpcDeviceShareNext) {
      try {
        const bytes = await reconstructRootKeyBytes(
          wallet.mpcDeviceShareNext,
          secret,
          loginShare,
          wallet.publicKey,
        );
        // Promote ONLY now that next+login has actually reconstructed.
        await promoteMpcDeviceShareNext(walletId);
        sessionCache.set(walletId, bytes);
        return;
      } catch {
        // The staged next didn't reconstruct with this login share/secret (wrong
        // spending password, or a genuinely stale next). NEVER drop it — it may be
        // the only device share compatible with the live backend login. Fall through
        // to fail the unlock cleanly (same tail as a no-next primary failure); the
        // caller can retry / fall back to a fresh Google re-fetch.
      }
    }
    if (primaryErr instanceof MpcValidationError) {
      throw new Error('Recovery data mismatch — unable to unlock this wallet with Google');
    }
    throw primaryErr;
  }
}

// ---------------------------------------------------------------------------
// Task 5: recover on a new device
// ---------------------------------------------------------------------------

export interface RecoverMpcGoogleWalletInput {
  name: string;
  icon: string;
  theme: string;
  chain: string;
  network: string;
  idToken: string;
  /** The memorized recovery password. Never logged, never persisted. */
  recoveryPassword: string;
  newSecret: DeviceShareSecret;
  /** Present when newSecret.kind === 'prf'; persisted so unlock can re-derive. */
  webAuthnCredentialId?: string;
  mpcPrfSaltId?: string;
}

export interface RecoverMpcGoogleWalletDeps {
  /**
   * Fetch the password-encrypted recovery blob + the non-secret xpub anchor for
   * this Google account from the backend. Throws on 404 ("no recovery on file")
   * before any local state is written. Replaces the removed recovery-file upload.
   */
  fetchRecovery: (idToken: string, chain: string, network: string) => Promise<{ encryptedRecovery: string; publicKey: string }>;
  decryptRecoveryShare: (blob: string, password: string) => Promise<string>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  /** Reconstruct entropy from the two shares AND validate its xpub === expectedXpub (throws MpcValidationError on mismatch). */
  reconstructAndValidateEntropy: (
    recoveryShare: string,
    loginShare: string,
    expectedXpub: string,
  ) => Promise<Uint8Array>;
  encryptDeviceShare: (deviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  createMpcGoogleWallet: (params: {
    name: string;
    icon: string;
    theme: string;
    chain: string;
    network: string;
    userId: string;
    publicKey: string;
    encryptedDeviceShare: string;
    webAuthnCredentialId?: string;
    mpcPrfSaltId?: string;
  }) => Promise<number>;
  subFromIdToken: (idToken: string) => string;
}

export interface RecoverMpcGoogleWalletResult {
  walletId: number;
  publicKey: string;
}

/**
 * Restore an MPC Google wallet on a fresh device — MetaMask-style, fileless.
 *
 * There is nothing to keep: the third factor is the memorized recovery
 * password. The backend serves the password-encrypted recovery blob plus the
 * non-secret xpub anchor (`fetchRecovery`); the user types the recovery
 * password to decrypt it locally. Recovery + login (2 of 3) then reconstruct
 * the entropy, validated against the fetched xpub anchor.
 *
 * A fresh device has no locally-stored xpub, so the reconstructed key can't be
 * trusted blindly: pairing account A's recovery with account B's login would
 * combine into garbage entropy whose per-share checksums still pass, silently
 * cementing a phantom wallet. To prevent that, `reconstructAndValidateEntropy`
 * checks the derived xpub against the anchor — a mismatch throws
 * MpcValidationError and NO wallet is persisted.
 *
 * Failure atomicity: `fetchRecovery` (404 → no recovery on file), decrypt
 * (wrong password), and anchor validation (wrong account) all throw BEFORE any
 * device share is encrypted or any wallet row is written — retry is clean.
 * Reuses the recovery share as the new device's local device factor; the login
 * share stays enrolled and unchanged on the backend.
 */
export async function recoverMpcGoogleWalletFlow(
  input: RecoverMpcGoogleWalletInput,
  deps: RecoverMpcGoogleWalletDeps,
): Promise<RecoverMpcGoogleWalletResult> {
  const { name, icon, theme, chain, network, idToken, recoveryPassword, newSecret, webAuthnCredentialId, mpcPrfSaltId } = input;
  const {
    fetchRecovery,
    decryptRecoveryShare,
    getLoginShare,
    reconstructAndValidateEntropy,
    encryptDeviceShare,
    createMpcGoogleWallet,
    subFromIdToken: getSub,
  } = deps;

  // Backend serves the encrypted recovery blob + the xpub anchor. A 404 means
  // this Google account has no stored recovery (never backed up / predates the
  // feature) — surface that as a distinct, clear error rather than a generic one.
  // parseHttpError stringifies the axios error, so a 404 shows up as "status":404.
  let encryptedRecovery: string;
  let publicKey: string;
  try {
    ({ encryptedRecovery, publicKey } = await fetchRecovery(idToken, chain, network));
  } catch (fetchErr) {
    const asText = typeof fetchErr === 'string' ? fetchErr : (fetchErr instanceof Error ? fetchErr.message : '');
    if (asText.includes('"status":404')) {
      throw new NoRecoveryBackupError('No recovery backup found for this Google account');
    }
    throw fetchErr;
  }
  const recoveryShare = await decryptRecoveryShare(encryptedRecovery, recoveryPassword);
  const loginShare = await getLoginShare(idToken, chain, network);
  // Anchor check: reconstruct AND validate the derived xpub === publicKey.
  // Throws MpcValidationError on mismatch (before anything is persisted).
  await reconstructAndValidateEntropy(recoveryShare, loginShare, publicKey);

  // Reuse the recovery share as the new device's local device factor.
  const encryptedDeviceShare = await encryptDeviceShare(recoveryShare, newSecret);
  const userId = getSub(idToken);

  const walletId = await createMpcGoogleWallet({
    name,
    icon,
    theme,
    chain,
    network,
    userId,
    publicKey,
    encryptedDeviceShare,
    webAuthnCredentialId,
    mpcPrfSaltId,
  });

  return { walletId, publicKey };
}

// ---------------------------------------------------------------------------
// Task 7: store the recovery share (MetaMask-style: Google account + recovery
// password, nothing to download)
// ---------------------------------------------------------------------------

export interface StoreRecoveryShareInput {
  idToken: string;
  chain: string;
  network: string;
  /** Encoded recovery share (one of the 3 MPC shares). Never logged/persisted locally. */
  recoveryShare: string;
  /** User-chosen recovery passphrase (floor 12 chars, enforced in the UI). Never logged. */
  recoveryPassword: string;
  /**
   * The wallet's CIP-1852 xpub. Uploaded alongside the encrypted recovery blob as the
   * restore-time anchor so a fresh-device restore can validate the reconstructed key
   * belongs to this wallet+Google account. Not secret.
   */
  publicKey: string;
}

export interface StoreRecoveryShareDeps {
  encryptRecoveryShare: (encodedShare: string, password: string) => Promise<string>;
  storeRecovery: (
    idToken: string,
    chain: string,
    network: string,
    encryptedRecovery: string,
    publicKey: string,
  ) => Promise<{ stored: boolean }>;
}

/**
 * Encrypt the recovery share under the user's recovery passphrase (Argon2id) and
 * upload the resulting blob to the backend, keyed by the verified Google subject.
 * This arms cross-device restore: recovery = Google account + this password, with
 * nothing for the user to download.
 *
 * The recovery passphrase never leaves the device — only the encrypted blob and the
 * (non-secret) xpub anchor are uploaded. Secret hygiene: neither the plaintext share
 * nor the passphrase nor the blob is ever logged here.
 *
 * This flow deliberately has NO wallet/DB dependency: the wallet is already created and
 * usable on this device (device + login = 2 of 3). If the upload fails, the caller
 * (background handler) reports it non-fatally and offers a retry — no local state is
 * touched, so the wallet cannot be corrupted by an upload error.
 */
export async function storeRecoveryShareFlow(
  input: StoreRecoveryShareInput,
  deps: StoreRecoveryShareDeps,
): Promise<{ stored: boolean }> {
  const { idToken, chain, network, recoveryShare, recoveryPassword, publicKey } = input;
  const { encryptRecoveryShare, storeRecovery } = deps;

  const encryptedRecovery = await encryptRecoveryShare(recoveryShare, recoveryPassword);
  return storeRecovery(idToken, chain, network, encryptedRecovery, publicKey);
}

// ---------------------------------------------------------------------------
// Task 9: reveal SRP (seed phrase) — escape hatch
// ---------------------------------------------------------------------------

export interface RevealMpcSrpInput {
  walletId: number;
  /** Fresh Google idToken (or '' when the handler resolves the login share from
   *  this session's cache). The backend verifies it before releasing the login share. */
  idToken: string;
  /** Device-secret re-auth: password or passkey-PRF output. Required even in an
   *  unlocked session — revealing the seed is gated on proving device possession. */
  secret: DeviceShareSecret;
}

export interface RevealMpcSrpDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  decryptDeviceShare: (encryptedDeviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  /** Reconstruct entropy from device+login AND validate its xpub === expectedXpub
   *  (throws MpcValidationError on mismatch). */
  reconstructAndValidateEntropy: (
    deviceShare: string,
    loginShare: string,
    expectedXpub: string,
  ) => Promise<Uint8Array>;
  entropyToMnemonic: (entropy: Uint8Array) => string;
}

export interface RevealMpcSrpResult {
  /** The BIP39 seed phrase. Returned to the UI EXACTLY ONCE for display — never
   *  persisted, never logged, never echoed into any storage or response body but this. */
  mnemonic: string;
}

/**
 * Reveal the MPC wallet's BIP39 seed phrase (escape hatch). Reconstructs entropy
 * from the local device share (decrypted under the re-auth device secret) + the
 * backend login share — exactly the daily-unlock reconstruction — validates it
 * against the wallet's stored xpub, then derives the mnemonic. Returns it once.
 *
 * Secret hygiene: entropy, device/login shares and the mnemonic never leave this
 * function except as the returned `{ mnemonic }`; nothing here logs. On an
 * MpcValidationError (shares don't reconstruct to this wallet) a clean error is
 * thrown and no mnemonic is produced.
 */
export async function revealMpcSrpFlow(
  input: RevealMpcSrpInput,
  deps: RevealMpcSrpDeps,
): Promise<RevealMpcSrpResult> {
  const { walletId, idToken, secret } = input;
  const { getWallet, getLoginShare, decryptDeviceShare, reconstructAndValidateEntropy, entropyToMnemonic } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);
  const deviceShare = await decryptDeviceShare(wallet.mpcDeviceShare, secret);

  try {
    const entropy = await reconstructAndValidateEntropy(deviceShare, loginShare, wallet.publicKey);
    return { mnemonic: entropyToMnemonic(entropy) };
  } catch (err) {
    if (err instanceof MpcValidationError) {
      throw new Error('Recovery data mismatch — unable to reveal the seed phrase for this wallet');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Task 10: set / change recovery password (crash-safe re-split)
// ---------------------------------------------------------------------------

export interface SetRecoveryPasswordInput {
  walletId: number;
  idToken: string;
  /** The NEW recovery password. Load-bearing secret — never logged, never persisted plaintext. */
  newRecoveryPassword: string;
  /** Device-secret re-auth (spending password or passkey PRF output) for the unlocked session. */
  secret: DeviceShareSecret;
}

export interface SetRecoveryPasswordDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  /** Decrypt the current at-rest device share under the re-auth secret. */
  decryptDeviceShare: (envelope: string, secret: DeviceShareSecret) => Promise<string>;
  /** Reconstruct entropy from device+login AND validate xpub === wallet.publicKey (throws MpcValidationError on mismatch). */
  reconstructAndValidateEntropy: (deviceShare: string, loginShare: string, expectedXpub: string) => Promise<Uint8Array>;
  /** Fresh 2-of-3 re-split of the SAME entropy → new device/login/recovery shares. */
  createMpcShareSet: (entropy: Uint8Array) => Promise<MpcShareSet>;
  encryptDeviceShare: (deviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  encryptRecoveryShare: (recoveryShare: string, password: string) => Promise<string>;
  /** Stage (value=blob) or drop (value=undefined) the next-generation device share. */
  setMpcDeviceShareNext: (walletId: number, encryptedDeviceShareNext: string | undefined) => Promise<void>;
  /** Replace the backend login share with the fresh S'.login. */
  rotate: (idToken: string, chain: string, network: string, loginShare: string) => Promise<{ rotated: boolean }>;
  /** Promote the staged next device share to primary (device = S'.device, next cleared). */
  promoteMpcDeviceShareNext: (walletId: number) => Promise<void>;
  storeRecovery: (idToken: string, chain: string, network: string, encryptedRecovery: string, publicKey: string) => Promise<{ stored: boolean }>;
  /** Drop the now-stale cached login share so the next unlock fetches S'.login fresh. */
  clearLoginShareCache: (walletId: number) => Promise<void>;
}

/**
 * Set / change the recovery password from an UNLOCKED wallet (MetaMask parity:
 * NEVER asks for the old recovery password). Because a 2-of-3 recovery share
 * cannot be cheaply re-wrapped without hand-rolled GF(256) math (D4), this does
 * a full crash-safe RE-SPLIT of the same entropy and stores a fresh recovery
 * blob under the new password. Rotating the underlying shares also voids any
 * previously-leaked recovery blob (doubles as compromise-rotation).
 *
 * Crash-safe order — never bricks, never asks the old password:
 *   1. stage next device share (old still live)
 *   2. rotate the backend login share to S'.login  (rollback: drop next, stay old split)
 *   3. promote the staged device share to primary
 *   4. store the fresh recovery blob (new password) — LAST, only once S' is live.
 *      By this point the wallet is ALREADY on the new split (daily unlock via
 *      device+login already works) and the OLD recovery password is already
 *      dead (its share was rotated away in step 2-3). A failure here must not
 *      read to the caller as "nothing changed". One quiet retry absorbs a
 *      transient network blip; if it still fails, throws the distinct
 *      RecoveryBackupStoreError instead of the raw error so the UI can say so.
 *   5. clear the stale cached login share
 *
 * Secret hygiene: entropy, shares, and the new password are never logged or
 * persisted in plaintext.
 */
export async function setRecoveryPasswordFlow(
  input: SetRecoveryPasswordInput,
  deps: SetRecoveryPasswordDeps,
): Promise<void> {
  const { walletId, idToken, newRecoveryPassword, secret } = input;
  const {
    getWallet,
    getLoginShare,
    decryptDeviceShare,
    reconstructAndValidateEntropy,
    createMpcShareSet,
    encryptDeviceShare,
    encryptRecoveryShare,
    setMpcDeviceShareNext,
    rotate,
    promoteMpcDeviceShareNext,
    storeRecovery,
    clearLoginShareCache,
  } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  // Reconstruct entropy from the CURRENT device+login under the re-auth secret,
  // validating the derived key still belongs to this wallet. No old recovery
  // password is ever involved (MetaMask parity).
  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);
  const currentDeviceShare = await decryptDeviceShare(wallet.mpcDeviceShare, secret);
  const entropy = await reconstructAndValidateEntropy(currentDeviceShare, loginShare, wallet.publicKey);

  // Fresh 2-of-3 re-split of the SAME entropy → all three shares rotate.
  // xpub is unchanged (entropy unchanged), so createMpcGoogleWallet's anchor holds.
  const next = await createMpcShareSet(entropy);

  // Corrupt-split guard: PROVE the fresh S' reconstructs to THIS wallet's xpub
  // BEFORE anything destructive runs (staging, and especially rotating the backend
  // login share to S'.login). A bad split slipping through here would rotate the
  // backend to a DIFFERENT key and brick the wallet. Throws MpcValidationError on
  // mismatch, before step 1.
  await reconstructAndValidateEntropy(next.deviceShare, next.loginShare, wallet.publicKey);

  const encryptedNextDeviceShare = await encryptDeviceShare(next.deviceShare, secret);

  // 1. Stage next (old device share still primary).
  await setMpcDeviceShareNext(walletId, encryptedNextDeviceShare);

  // 2. Rotate the backend login share. On failure, rethrow WITHOUT dropping the
  //    staged next — a thrown error does NOT prove the backend didn't apply the
  //    rotation (a timeout/dropped response after the backend committed the
  //    UPDATE also throws). Dropping `next` here would delete the only device
  //    share (S'.device) compatible with a possibly-already-rotated backend
  //    login (S'.login) → permanent brick. `mpcDeviceShareNext` is cleared ONLY
  //    via a successful promote (design invariant). Resume-on-unlock self-heals
  //    both outcomes: genuine failure → primary S.device+S.login still unlocks
  //    (stale next is harmless, overwritten by the next re-split); silent success
  //    → primary fails, resume finds S'.device+S'.login and promotes.
  await rotate(idToken, wallet.chain, wallet.network, next.loginShare);

  // 3. Backend now holds S'.login → promote the staged device share to primary.
  await promoteMpcDeviceShareNext(walletId);

  // 4. Only now that S' is fully live, store the fresh recovery blob under the
  //    new password (+ the non-secret xpub anchor). Stored LAST. One quiet retry
  //    before surfacing a distinct error — see the crash-safe order note above.
  const recoveryBlob = await encryptRecoveryShare(next.recoveryShare, newRecoveryPassword);
  try {
    await storeRecovery(idToken, wallet.chain, wallet.network, recoveryBlob, wallet.publicKey);
  } catch {
    try {
      await storeRecovery(idToken, wallet.chain, wallet.network, recoveryBlob, wallet.publicKey);
    } catch {
      throw new RecoveryBackupStoreError(
        'recovery password rotation succeeded but storing the new encrypted backup failed',
      );
    }
  }

  // 5. The cached login share is now stale (rotated) → clear it.
  await clearLoginShareCache(walletId);
}
