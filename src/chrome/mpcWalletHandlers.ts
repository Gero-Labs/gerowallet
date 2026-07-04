/**
 * Pure orchestration for the MPC "Sign in with Google" wallet (Plan D, D1).
 *
 * These functions take all side-effecting dependencies (backend calls, crypto
 * utils, DB writes, the session cache) as injected `deps`, so they're unit
 * testable against stubs with no running backend. `src/chrome/background.ts`
 * wires the real implementations in and calls these from thin
 * `app.addToOptions(...)` handlers.
 *
 * Secret hygiene: never log idToken, spendingPassword, device/login/recovery
 * shares, entropy, or key bytes. Catch-handler discipline lives in
 * background.ts; these flows just throw/rethrow.
 */
import { MpcValidationError } from '@/shared/utils/mpc';
import type { MpcShareSet } from '@/shared/utils/mpc';

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
  spendingPassword: string;
}

export interface CreateMpcGoogleWalletDeps {
  prepareMpcWalletCreation: () => Promise<{ entropy: Uint8Array; shareSet: MpcShareSet; expectedXpub: string }>;
  encryptDeviceShare: (deviceShare: string, password: string) => string;
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
  }) => Promise<number>;
  subFromIdToken: (idToken: string) => string;
}

export interface CreateMpcGoogleWalletResult {
  walletId: number;
  /** Return to the caller for encrypted-download backup. Never log or persist server-side. */
  recoveryShare: string;
}

/**
 * Create a new MPC Google wallet: split fresh entropy into 3 shares, enroll
 * the login share with the backend (verifies idToken), encrypt the device
 * share at rest under the spending password, and persist the wallet record.
 * The recovery share is returned to the caller — it is never logged and
 * never sent anywhere by this flow (the UI is responsible for the
 * encrypted-download backup step).
 */
export async function createMpcGoogleWalletFlow(
  input: CreateMpcGoogleWalletInput,
  deps: CreateMpcGoogleWalletDeps,
): Promise<CreateMpcGoogleWalletResult> {
  const { name, icon, theme, chain, network, idToken, spendingPassword } = input;
  const { prepareMpcWalletCreation, encryptDeviceShare, enrollLoginShare, createMpcGoogleWallet, subFromIdToken: getSub } = deps;

  const { shareSet, expectedXpub } = await prepareMpcWalletCreation();
  const encryptedDeviceShare = encryptDeviceShare(shareSet.deviceShare, spendingPassword);
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
  });

  return { walletId, recoveryShare: shareSet.recoveryShare };
}

// ---------------------------------------------------------------------------
// Task 3: unlock
// ---------------------------------------------------------------------------

export interface MpcWalletRecord {
  chain: string;
  network: string;
  publicKey: string;
  mpcDeviceShare: string;
}

export interface UnlockMpcWalletInput {
  walletId: number;
  idToken: string;
  spendingPassword: string;
}

export interface UnlockMpcWalletDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  reconstructRootKeyBytes: (
    encryptedDeviceShare: string,
    password: string,
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
  const { walletId, idToken, spendingPassword } = input;
  const { getWallet, getLoginShare, reconstructRootKeyBytes, sessionCache } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);

  try {
    const bytes = await reconstructRootKeyBytes(
      wallet.mpcDeviceShare,
      spendingPassword,
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
  recoveryBlob: string;
  recoveryPassword: string;
  newSpendingPassword: string;
}

export interface RecoverMpcGoogleWalletDeps {
  decryptRecoveryShare: (blob: string, password: string) => Promise<string>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  reconstructEntropy: (encodedA: string, encodedB: string) => Promise<Uint8Array>;
  deriveExpectedXpub: (entropy: Uint8Array) => Promise<string>;
  encryptDeviceShare: (deviceShare: string, password: string) => string;
  createMpcGoogleWallet: (params: {
    name: string;
    icon: string;
    theme: string;
    chain: string;
    network: string;
    userId: string;
    publicKey: string;
    encryptedDeviceShare: string;
  }) => Promise<number>;
  subFromIdToken: (idToken: string) => string;
}

export interface RecoverMpcGoogleWalletResult {
  walletId: number;
  publicKey: string;
}

/**
 * Restore an MPC Google wallet on a fresh device using the encrypted
 * recovery-share backup + Google sign-in.
 *
 * v1 decision (Plan D Task 5 OPEN note, resolved for build): reuse the
 * recovery share as the local device factor on the new device instead of
 * re-splitting entropy into a brand-new 3-share set. The login share stays
 * enrolled and unchanged on the backend — no re-enroll/replace endpoint is
 * needed. There is no locally-stored xpub to validate against on a fresh
 * device, so the xpub is *derived* from the reconstructed entropy and
 * persisted as this wallet's `publicKey` going forward.
 */
export async function recoverMpcGoogleWalletFlow(
  input: RecoverMpcGoogleWalletInput,
  deps: RecoverMpcGoogleWalletDeps,
): Promise<RecoverMpcGoogleWalletResult> {
  const { name, icon, theme, chain, network, idToken, recoveryBlob, recoveryPassword, newSpendingPassword } = input;
  const {
    decryptRecoveryShare,
    getLoginShare,
    reconstructEntropy,
    deriveExpectedXpub,
    encryptDeviceShare,
    createMpcGoogleWallet,
    subFromIdToken: getSub,
  } = deps;

  const recoveryShare = await decryptRecoveryShare(recoveryBlob, recoveryPassword);
  const loginShare = await getLoginShare(idToken, chain, network);
  const entropy = await reconstructEntropy(recoveryShare, loginShare);
  const publicKey = await deriveExpectedXpub(entropy);

  // Reuse the recovery share as the new device's local device factor (see decision above).
  const encryptedDeviceShare = encryptDeviceShare(recoveryShare, newSpendingPassword);
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
  });

  return { walletId, publicKey };
}
