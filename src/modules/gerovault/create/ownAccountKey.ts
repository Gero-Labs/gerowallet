/**
 * Page side of `ownAccountKeyFlow.ts`: this wallet's CIP-1854 multisig account key, the public half,
 * behind the wallet's own credential.
 *
 * - Recovery-phrase and Google wallets ask the background (`GEROVAULT_DERIVE_ACCOUNT_KEY`), which
 *   decrypts the root key there and answers with the public key only.
 * - PassKey wallets decrypt in this page, where WebAuthn runs, and wipe the root key at once (the
 *   documented PRF exception, as "Add account" does).
 *
 * The account key stays in memory for the create flow and is never stored, logged or shown.
 */
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { Wallet } from '@/models/types';
import { multisigAccountPublicKey, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { secretsWalletId } from '@/shared/utils/walletAccount';
import { OwnAccountKeyError, multisigAccountKeyOfRoot, ownAccountKeyErrorCode } from './ownAccountKeyFlow';

/**
 * The background request (`background.ts`, `deriveMultisigAccountKeyFlow` with the same
 * dependencies as `DERIVE_ACCOUNT_XPUB`). An older background answers nothing: `unavailable`.
 */
export const GEROVAULT_DERIVE_ACCOUNT_KEY = MessageTypes.GEROVAULT_DERIVE_ACCOUNT_KEY;

interface DeriveResponse {
  data?: { success?: boolean; publicKey?: unknown; error?: unknown };
  error?: string;
}

/** Recovery-phrase (with `password`) and Google wallets. Never log `password`. */
export async function requestMultisigAccountKey(walletId: number, password?: string): Promise<MultisigAccountPublicKey> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: GEROVAULT_DERIVE_ACCOUNT_KEY,
    data: { walletId, ...(password ? { password } : {}) },
  }) as DeriveResponse | undefined;
  const data = response?.data;
  // No handler answered: an older background, or this build does not wire the request yet.
  if (!data) throw new OwnAccountKeyError('unavailable');
  if (data.success !== true || typeof data.publicKey !== 'string') throw new OwnAccountKeyError(ownAccountKeyErrorCode(data.error));
  return multisigAccountPublicKey(data.publicKey);
}

/** A PassKey wallet: WebAuthn decrypts the root key here, which is wiped before returning. */
export async function passKeyMultisigAccountKey(
  wallet: Pick<Wallet, 'id' | 'publicKey' | 'webAuthnCredentialId' | 'webAuthnTransports' | 'prfEncryptedPrivateKey'> & { secretsWalletId?: number },
): Promise<MultisigAccountPublicKey> {
  const { webAuthnCredentialId, prfEncryptedPrivateKey } = wallet;
  if (!webAuthnCredentialId || !prfEncryptedPrivateKey) throw new OwnAccountKeyError('not-supported');
  const [{ evaluateWalletPrf }, { decryptPrivateKeyWithPrf }] = await Promise.all([
    import('@/shared/utils/passkeyPrf'),
    import('@/shared/utils/webauthn-prf'),
  ]);
  let prf: ArrayBuffer;
  try {
    prf = await evaluateWalletPrf({ id: wallet.id, webAuthnCredentialId, webAuthnTransports: wallet.webAuthnTransports });
  } catch {
    throw new OwnAccountKeyError('cancelled');
  }
  let rootKeyBytes: Uint8Array | undefined;
  try {
    rootKeyBytes = await decryptPrivateKeyWithPrf(prfEncryptedPrivateKey, webAuthnCredentialId, String(secretsWalletId(wallet)), prf);
    return multisigAccountPublicKey(await multisigAccountKeyOfRoot(rootKeyBytes, wallet.publicKey));
  } finally {
    rootKeyBytes?.fill(0);
    new Uint8Array(prf).fill(0);
  }
}
