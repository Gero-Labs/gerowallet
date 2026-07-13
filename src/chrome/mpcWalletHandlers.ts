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
import { MpcValidationError } from '@/shared/utils/mpc';
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
  const { getWallet, getLoginShare, reconstructRootKeyBytes, sessionCache } = deps;

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
    sessionCache.set(walletId, bytes);
  } catch (err) {
    if (err instanceof MpcValidationError) {
      throw new Error('Recovery data mismatch — unable to unlock this wallet with Google');
    }
    throw err;
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

  // Backend serves the encrypted recovery blob + the xpub anchor (404 → no recovery on file).
  const { encryptedRecovery, publicKey } = await fetchRecovery(idToken, chain, network);
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
