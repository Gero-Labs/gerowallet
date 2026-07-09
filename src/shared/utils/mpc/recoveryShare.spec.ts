import { describe, it, expect } from 'vitest';
import { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
import { RecoveryDecryptError } from './types';

const encodedShare = 'gmpc1.03.AAAA.BBBB'; // opaque payload; encryption treats it as a string

describe('recoveryShare', () => {
  it('round-trips with the correct password', async () => {
    const blob = await encryptRecoveryShare(encodedShare, 'correct horse battery staple');
    expect(blob.startsWith('gmpc-recovery1.')).toBe(true);
    const out = await decryptRecoveryShare(blob, 'correct horse battery staple');
    expect(out).toBe(encodedShare);
  });

  it('fails with the wrong password', async () => {
    const blob = await encryptRecoveryShare(encodedShare, 'right-password');
    await expect(decryptRecoveryShare(blob, 'wrong-password')).rejects.toBeInstanceOf(RecoveryDecryptError);
  });

  it('produces different ciphertext each time (random salt+nonce)', async () => {
    const a = await encryptRecoveryShare(encodedShare, 'pw');
    const b = await encryptRecoveryShare(encodedShare, 'pw');
    expect(a).not.toBe(b);
  });

  it('rejects a malformed blob', async () => {
    await expect(decryptRecoveryShare('garbage', 'pw')).rejects.toBeInstanceOf(RecoveryDecryptError);
  });
});

describe('recoveryShare — Argon2id v2', () => {
  it('round-trips an encrypted share', async () => {
    const blob = await encryptRecoveryShare('device-share-abc', 'correct horse battery');
    expect(blob.startsWith('gmpc-recovery1.')).toBe(true);
    const out = await decryptRecoveryShare(blob, 'correct horse battery');
    expect(out).toBe('device-share-abc');
  });

  it('rejects a wrong passphrase', async () => {
    const blob = await encryptRecoveryShare('device-share-abc', 'right-pass');
    await expect(decryptRecoveryShare(blob, 'wrong-pass')).rejects.toBeInstanceOf(RecoveryDecryptError);
  });

  it('writes a v2 (Argon2id) header', async () => {
    const blob = await encryptRecoveryShare('x', 'p');
    // decode base64url body, first byte is version
    const { fromB64url } = await import('./base64url');
    const raw = fromB64url(blob.split('.')[1]);
    expect(raw[0]).toBe(2);
  });
});
