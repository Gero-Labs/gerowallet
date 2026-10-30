// A PassKey unlock is accepted only when the PassKey's PRF output opens something
// sealed with that same PassKey for that same wallet. Real AES-GCM, no mocks.
import { describe, it, expect } from 'vitest';
import { PassKeyUnlockSetupRequiredError, verifyPassKeyUnlockProof } from './passKeyUnlockProof';
import { encryptPrivateKeyWithPrf, sealPassKeyUnlockVerifier } from './webauthn-prf';

const CREDENTIAL = 'Y3JlZGVudGlhbC1pZC1ieXRlcw==';
const prfOf = (fill: number) => new Uint8Array(32).fill(fill);
const asBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

async function unlockConfig(walletId: number, fill = 7) {
  return {
    passKeyForUnlock: true,
    webAuthnCredentialId: CREDENTIAL,
    passKeyUnlockVerifier: await sealPassKeyUnlockVerifier(asBuffer(prfOf(fill)), CREDENTIAL, String(walletId)),
  };
}

describe('verifyPassKeyUnlockProof', () => {
  it('accepts the PassKey the verifier was sealed with, and nothing else', async () => {
    const config = await unlockConfig(10);
    await expect(verifyPassKeyUnlockProof({}, config, 10, prfOf(7))).resolves.toBe(true);
    await expect(verifyPassKeyUnlockProof({}, config, 10, prfOf(8))).resolves.toBe(false);
    // Bound to the wallet and to the credential.
    await expect(verifyPassKeyUnlockProof({}, config, 11, prfOf(7))).resolves.toBe(false);
    await expect(verifyPassKeyUnlockProof({}, { ...config, webAuthnCredentialId: 'b3RoZXI=' }, 10, prfOf(7))).resolves.toBe(false);
  });

  it('refuses anything that is not a 32-byte PRF output', async () => {
    const config = await unlockConfig(10);
    await expect(verifyPassKeyUnlockProof({}, config, 10, new Uint8Array(31).fill(7))).resolves.toBe(false);
    await expect(verifyPassKeyUnlockProof({}, config, 10, new Uint8Array(0))).resolves.toBe(false);
  });

  it('refuses when PassKey unlock is off, even with a verifier left behind', async () => {
    const config = { ...(await unlockConfig(10)), passKeyForUnlock: false };
    await expect(verifyPassKeyUnlockProof({}, config, 10, prfOf(7))).resolves.toBe(false);
  });

  it('asks for set-up again when PassKey unlock is on but nothing was sealed to check it', async () => {
    const config = { passKeyForUnlock: true, webAuthnCredentialId: CREDENTIAL };
    await expect(verifyPassKeyUnlockProof({}, config, 10, prfOf(7))).rejects.toBeInstanceOf(PassKeyUnlockSetupRequiredError);
  });

  it("checks a PassKey wallet against its own PRF-encrypted key, never the page's settings", async () => {
    const record = {
      encryptionMethod: 'prf',
      webAuthnCredentialId: CREDENTIAL,
      prfEncryptedPrivateKey: await encryptPrivateKeyWithPrf(new Uint8Array(96).fill(1), CREDENTIAL, '20', asBuffer(prfOf(9))),
    };
    await expect(verifyPassKeyUnlockProof(record, {}, 20, prfOf(9))).resolves.toBe(true);
    await expect(verifyPassKeyUnlockProof(record, {}, 20, prfOf(4))).resolves.toBe(false);
    await expect(verifyPassKeyUnlockProof(record, await unlockConfig(20, 4), 20, prfOf(4))).resolves.toBe(false);
  });

  it('wipes the PRF output it was given', async () => {
    const prf = prfOf(7);
    await verifyPassKeyUnlockProof({}, await unlockConfig(10), 10, prf);
    expect(prf.every(byte => byte === 0)).toBe(true);
  });
});
