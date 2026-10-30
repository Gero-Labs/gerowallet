import { Buffer } from 'buffer';
import { encryptSecret } from './passwordSecret';
import { encryptWithPassword, type TextSecretPurpose } from './crypto';
import { SecretPurpose, isGpw2, sealGpw2, sealGpw2Text } from './secretEnvelope';
import { refreshEnvelopeV2Flag } from './envelopeV2Flag';

/**
 * The single writer for every secret stored under the spending password.
 *
 * With `isKeyEnvelopeV2Enabled` on, everything is sealed as purpose-bound `gpw2`.
 * With it off (the default), each field keeps its current format so behaviour is
 * unchanged: `gpw1` for text secrets, raw PBKDF2 hex for key bytes. Read the
 * result back with the matching reader in `crypto.ts`.
 */

export type KeySecretPurpose =
  | typeof SecretPurpose.RootKey
  | typeof SecretPurpose.ColdKey
  | typeof SecretPurpose.StrikeKey;

/** Seal a UTF-8 secret (mnemonic, MPC device share, 2FA data). */
export async function sealTextSecret(text: string, password: string, purpose: TextSecretPurpose): Promise<string> {
  if (await refreshEnvelopeV2Flag()) return sealGpw2Text(text, password, purpose);
  return encryptSecret(text, password);
}

/** Seal raw key bytes (root key, SPO cold key, Strike key). */
export async function sealKeySecret(keyBytes: Uint8Array, password: string, purpose: KeySecretPurpose): Promise<string> {
  if (await refreshEnvelopeV2Flag()) return sealGpw2(keyBytes, password, purpose);
  return encryptWithPassword(password, Buffer.from(keyBytes).toString('hex'));
}

/** True when a stored value (a blob, or a list of blobs) is already in `gpw2`, in whole or in part. */
function storedAsGpw2(stored: unknown): boolean {
  if (Array.isArray(stored)) return stored.some(v => typeof v === 'string' && isGpw2(v));
  return typeof stored === 'string' && isGpw2(stored);
}

/**
 * Re-seal a text secret that replaces `stored` (a spending-password change, a
 * re-split). Never weaker than what it replaces: a field already in `gpw2` stays
 * `gpw2` even with the flag off, since every build that wrote it reads it. The
 * flag-off writer is `gpw1`, which is never weaker than a legacy blob.
 */
export async function resealTextSecret(text: string, password: string, purpose: TextSecretPurpose, stored: unknown): Promise<string> {
  if (storedAsGpw2(stored)) return sealGpw2Text(text, password, purpose);
  return sealTextSecret(text, password, purpose);
}

/** As `resealTextSecret`, for key bytes: a `gpw2` key never goes back to PBKDF2 hex. */
export async function resealKeySecret(keyBytes: Uint8Array, password: string, purpose: KeySecretPurpose, stored: unknown): Promise<string> {
  if (storedAsGpw2(stored)) return sealGpw2(keyBytes, password, purpose);
  return sealKeySecret(keyBytes, password, purpose);
}
