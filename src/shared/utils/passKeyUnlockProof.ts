/**
 * Background-side check of a PassKey unlock.
 *
 * WebAuthn cannot run in the service worker, so the page evaluates the PassKey's
 * PRF (salted with the secrets record's id, `evaluateWalletPrf`) and sends the
 * 32 output bytes. The worker accepts them only if they open something that was
 * sealed with that same PassKey for that same record:
 *  - a PRF wallet: its own PRF-encrypted root key (or recovery phrase);
 *  - any other wallet with PassKey unlock on: the unlock verifier sealed when it
 *    was switched on, or else the PassKey-encrypted spending password (autofill).
 * AES-GCM authenticates, so a wrong or made-up PRF output never opens either.
 * Whatever is opened is wiped (bytes) or dropped (strings) at once; nothing is kept.
 */
import {
  decryptMnemonicWithPrfOutput,
  decryptPrivateKeyWithPrf,
  decryptSpendingPasswordWithPrf,
  openPassKeyUnlockVerifier,
} from '@/shared/utils/webauthn-prf';

/** Thrown when PassKey unlock is on but nothing sealed with the PassKey exists to check it against. */
export class PassKeyUnlockSetupRequiredError extends Error {
  constructor() {
    super('passkey-unlock-setup-required');
    this.name = 'PassKeyUnlockSetupRequiredError';
  }
}

export interface PassKeyProofRecord {
  encryptionMethod?: string;
  webAuthnCredentialId?: string | null;
  prfEncryptedPrivateKey?: string | null;
  prfEncryptedMnemonic?: string | null;
}

export interface PassKeyProofConfig {
  passKeyForUnlock?: unknown;
  webAuthnCredentialId?: unknown;
  passKeyUnlockVerifier?: unknown;
  passKeyEncryptedSpendingPassword?: unknown;
}

function asPrfBuffer(prfOutput: Uint8Array): ArrayBuffer {
  return prfOutput.buffer.slice(prfOutput.byteOffset, prfOutput.byteOffset + prfOutput.byteLength) as ArrayBuffer;
}

/**
 * Whether `prfOutput` is the PassKey of the secrets record `walletId`. False for a
 * wrong PassKey or one that is not set up for unlocking. Throws
 * PassKeyUnlockSetupRequiredError when PassKey unlock is on but has nothing to be
 * checked against (switched on by a release that did not seal a verifier).
 */
export async function verifyPassKeyUnlockProof(
  record: PassKeyProofRecord,
  config: PassKeyProofConfig,
  walletId: number,
  prfOutput: Uint8Array,
): Promise<boolean> {
  if (prfOutput.length !== 32) return false;
  const id = String(walletId);
  const prf = asPrfBuffer(prfOutput);
  try {
    if (record.encryptionMethod === 'prf') {
      const credentialId = record.webAuthnCredentialId;
      if (!credentialId) return false;
      if (record.prfEncryptedPrivateKey) {
        try {
          const key = await decryptPrivateKeyWithPrf(record.prfEncryptedPrivateKey, credentialId, id, prf);
          key.fill(0);
          return true;
        } catch {
          return false;
        }
      }
      if (record.prfEncryptedMnemonic) {
        try {
          await decryptMnemonicWithPrfOutput(record.prfEncryptedMnemonic, prf, credentialId, id);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }

    const credentialId = typeof config.webAuthnCredentialId === 'string' ? config.webAuthnCredentialId : '';
    if (config.passKeyForUnlock !== true || !credentialId) return false;
    if (typeof config.passKeyUnlockVerifier === 'string' && config.passKeyUnlockVerifier) {
      return openPassKeyUnlockVerifier(config.passKeyUnlockVerifier, prf, credentialId, id);
    }
    if (typeof config.passKeyEncryptedSpendingPassword === 'string' && config.passKeyEncryptedSpendingPassword) {
      try {
        await decryptSpendingPasswordWithPrf(config.passKeyEncryptedSpendingPassword, credentialId, id, prf);
        return true;
      } catch {
        return false;
      }
    }
    throw new PassKeyUnlockSetupRequiredError();
  } finally {
    new Uint8Array(prf).fill(0);
    prfOutput.fill(0);
  }
}
