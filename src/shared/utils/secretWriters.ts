import { Buffer } from 'buffer';
import { encryptSecret } from './passwordSecret';
import { encryptWithPassword, type TextSecretPurpose } from './crypto';
import { SecretPurpose, sealGpw2, sealGpw2Text } from './secretEnvelope';
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
