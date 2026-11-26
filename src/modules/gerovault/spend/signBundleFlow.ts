/**
 * Background side of `GEROVAULT_SIGN_VAULT_BUNDLE`: this wallet's own signature on a vault spend,
 * made where the root key is, so no extension page ever holds it.
 *
 * In order:
 * 1. the spending password, checked under the wallet's back-off (`verifySpendingPassword`);
 * 2. the vault, read again from this wallet's own store, accepted, and this wallet one of its owners;
 * 3. the bundle, parsed again as a file would be, and held to the same sheet the screen showed
 *    (`reviewBundle`), against the worker's own chain tip and the wallet's other accepted vaults;
 * 4. the key at the record's own index, `m/1854'/1815'/0'/0/i`, which must hash to the credential
 *    the record holds for this wallet;
 * 5. a signature over the transaction id only, after which the opened root key bytes are
 *    overwritten.
 *
 * Only the `VaultWitnessFile` goes back. Never log `input`: it holds the spending password.
 * Kept free of page-only imports: the background imports this file.
 */
import { SIGNING_FILE_VERSION, UNSIGNED_BUNDLE_TYPE, type VaultRecord, type VaultWitnessFile } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';
import { parseUnsignedBundle, checkBundleForVault, signingFileText } from './bundle';
import { VaultSpendError } from './errors';
import { knownVaultsOf, reviewBundle } from './review';
import { signerSupport, signWithRootKey, type SignerWallet } from './signer';
import { spendContextOf } from './vaultSpendContext';
import { createWitnessFile, verifyOwnWitness } from './witnesses';

/**
 * - `not-found`: no logged-in wallet, another wallet than the request names, or no such vault.
 * - `not-supported`: a wallet that cannot sign a vault spend here (hardware, PassKey, Google, watch).
 * - `wrong-password`: the spending password was refused, or did not open the stored key.
 * - `not-accepted`: a candidate vault is never signed for.
 * - `vault-invalid`: the stored record does not give the scripts and keys it claims.
 * - `not-owner`: this wallet holds no owner key of the vault.
 * - `bundle-invalid`: the bundle is malformed, or for another vault or network.
 * - `bundle-refused`: the sheet refuses it (`detail` lists the refusal codes).
 * - `key-mismatch`: the key at the record's index is not the one the vault holds for this wallet.
 * A back-off wait is the background's own error (`UnlockThrottledError`), passed through unchanged.
 */
export type SignVaultBundleErrorCode =
  | 'not-found'
  | 'not-supported'
  | 'wrong-password'
  | 'not-accepted'
  | 'vault-invalid'
  | 'not-owner'
  | 'bundle-invalid'
  | 'bundle-refused'
  | 'key-mismatch';

export class SignVaultBundleError extends Error {
  readonly code: SignVaultBundleErrorCode;
  readonly detail?: string;

  constructor(code: SignVaultBundleErrorCode, detail?: string) {
    super(`Could not sign the vault transaction: ${code}`);
    this.name = 'SignVaultBundleError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code: SignVaultBundleErrorCode, detail?: string): never => {
  throw new SignVaultBundleError(code, detail);
};

const HEX32 = /^[0-9a-f]{64}$/;

export type SignBundleWallet = SignerWallet & { readonly id: number };

export interface SignVaultBundleDeps {
  /** The wallet the background has logged in, or null. */
  wallet(): SignBundleWallet | null | undefined;
  /** The wallet's own check, counted toward its back-off; throws while a wait runs. */
  verifyPassword(password: string): Promise<boolean>;
  /** The single reader for a stored root key (`decryptPrivateKey`); throws on a wrong password. */
  decryptRootKey(encryptedPrivateKey: string, password: string): Uint8Array;
  getVault(walletId: number, vaultId: string): Promise<VaultRecord | undefined>;
  /** The wallet's accepted vaults on `network`, for the sheet's "moves to vault X". */
  acceptedVaults(walletId: number, network: VaultNetwork): Promise<readonly VaultRecord[]>;
  /** The worker's Cardano chain tip slot, or null when it has none. */
  currentSlot(): number | null;
  now?(): number;
}

function asSpendFailure(error: unknown): never {
  if (error instanceof VaultSpendError) {
    if (error.code === 'NOT_AN_OWNER') return fail('not-owner');
    if (error.code === 'KEY_MISMATCH') return fail('key-mismatch');
    if (error.code === 'BUNDLE_INVALID' || error.code === 'BUNDLE_OTHER_VAULT') return fail('bundle-invalid', error.detail);
    if (error.code === 'WITNESS_INVALID') return fail('key-mismatch', error.detail);
  }
  return fail('vault-invalid');
}

export async function signVaultBundleFlow(
  input: { readonly walletId?: unknown; readonly vaultId?: unknown; readonly bundle?: unknown; readonly password?: unknown },
  deps: SignVaultBundleDeps,
): Promise<VaultWitnessFile> {
  const wallet = deps.wallet();
  if (!wallet || typeof input?.walletId !== 'number' || wallet.id !== input.walletId) return fail('not-found');
  if (signerSupport(wallet) !== 'software' || !wallet.encryptedPrivateKey) return fail('not-supported');
  const password = input.password;
  if (typeof password !== 'string' || !password) return fail('wrong-password');
  if (!(await deps.verifyPassword(password))) return fail('wrong-password');

  const vaultId = input.vaultId;
  if (typeof vaultId !== 'string' || !HEX32.test(vaultId)) return fail('not-found');
  const record = await deps.getVault(wallet.id, vaultId);
  if (!record) return fail('not-found');
  if (record.status !== 'accepted') return fail('not-accepted');
  const context = await spendContextOf(record).catch(asSpendFailure);

  // The bundle as a file would be read, never as the page shaped it.
  const raw = input.bundle as { type?: unknown; version?: unknown } | null | undefined;
  if (!raw || typeof raw !== 'object' || raw.type !== UNSIGNED_BUNDLE_TYPE || raw.version !== SIGNING_FILE_VERSION) return fail('bundle-invalid', 'shape');
  let bundle: ReturnType<typeof parseUnsignedBundle>;
  try {
    bundle = parseUnsignedBundle(signingFileText(raw));
    checkBundleForVault(bundle, context);
  } catch (error) {
    return asSpendFailure(error);
  }
  const review = await reviewBundle(bundle, context, {
    currentSlot: deps.currentSlot(),
    knownVaults: knownVaultsOf(await deps.acceptedVaults(wallet.id, record.network), record.vaultId),
  });
  if (review.status !== 'ready') return fail('bundle-refused', review.refusals.map(refusal => refusal.code).join(','));

  let rootKey: Uint8Array | undefined;
  try {
    let opened: Uint8Array;
    try {
      opened = deps.decryptRootKey(wallet.encryptedPrivateKey, password);
    } catch {
      return fail('wrong-password');
    }
    rootKey = Uint8Array.from(opened);
    opened.fill(0);
    const witness = await signWithRootKey(rootKey, context.ownIndex, context.self.credential, bundle.txId).catch(asSpendFailure);
    await verifyOwnWitness(witness, bundle, context).catch(asSpendFailure);
    return createWitnessFile(bundle, context.self, [witness], deps.now?.() ?? Date.now());
  } finally {
    rootKey?.fill(0);
  }
}
