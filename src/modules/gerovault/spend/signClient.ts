/**
 * Page side of `GEROVAULT_SIGN_VAULT_BUNDLE` (`signBundleFlow.ts`): this wallet's own signature on
 * a vault spend, made in the background worker. The page sends the bundle, the vault id and the
 * spending password, and gets back a witness file, never a key. The answer is read again as any
 * witness file is, and the screen verifies it against the vault before it counts.
 *
 * Never log `password`.
 */
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { UnsignedTxBundle, VaultWitnessFile } from '@/modules/gerovault/contracts';
import { signingFileText } from './bundle';
import { VaultSpendError, type VaultSpendErrorCode } from './errors';
import { parseWitnessFile } from './witnesses';

export type SendToBackground = (request: { method: string; data: unknown }) => Promise<unknown>;

interface SignReply {
  data?: { success?: unknown; witnessFile?: unknown; error?: unknown; detail?: unknown; retryAfterMs?: unknown };
}

const CODES: Readonly<Record<string, VaultSpendErrorCode>> = {
  'wrong-password': 'WRONG_PASSWORD',
  throttled: 'WRONG_PASSWORD',
  'not-found': 'UNSUPPORTED_WALLET',
  'not-supported': 'UNSUPPORTED_WALLET',
  'not-accepted': 'VAULT_NOT_ACCEPTED',
  'vault-invalid': 'VAULT_INVALID',
  'not-owner': 'NOT_AN_OWNER',
  'bundle-invalid': 'BUNDLE_INVALID',
  'bundle-refused': 'BUNDLE_INVALID',
  'key-mismatch': 'KEY_MISMATCH',
};

const defaultSend: SendToBackground = request => Messaging.sendToBackgroundFromOptions(request);

/** Throws `VaultSpendError`: `WRONG_PASSWORD` (detail `throttled` during a wait), `KEY_MISMATCH`, and the rest of `CODES`. */
export async function requestVaultWitnessFile(
  input: { readonly walletId: number; readonly vaultId: string; readonly bundle: UnsignedTxBundle; readonly password: string },
  send: SendToBackground = defaultSend,
): Promise<VaultWitnessFile> {
  const reply = await send({
    method: MessageTypes.GEROVAULT_SIGN_VAULT_BUNDLE,
    data: { walletId: input.walletId, vaultId: input.vaultId, bundle: input.bundle, password: input.password },
  }).catch(() => undefined) as SignReply | null | undefined;
  const data = reply?.data;
  if (!data) throw new VaultSpendError('UNSUPPORTED_WALLET', 'The background did not answer', 'unavailable');
  if (data.success === true && data.witnessFile && typeof data.witnessFile === 'object') {
    return parseWitnessFile(signingFileText(data.witnessFile));
  }
  const error = typeof data.error === 'string' ? data.error : '';
  const code = Object.prototype.hasOwnProperty.call(CODES, error) ? CODES[error] : 'UNSUPPORTED_WALLET';
  const detail = error === 'throttled' ? 'throttled' : error === 'bundle-refused' ? `refused:${typeof data.detail === 'string' ? data.detail : ''}` : typeof data.detail === 'string' ? data.detail : undefined;
  throw new VaultSpendError(code, 'The vault transaction was not signed', detail);
}
