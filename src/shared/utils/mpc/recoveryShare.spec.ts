import { describe, it, expect } from 'vitest';
import { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
import { RecoveryDecryptError } from './types';
import { fromB64url, toB64url } from './base64url';

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

  it('rejects a crafted blob with an oversized Argon2 memory-cost parameter', async () => {
    const blob = await encryptRecoveryShare('device-share-abc', 'correct horse battery');
    const raw = fromB64url(blob.split('.')[1]);
    const tampered = new Uint8Array(raw); // copy, don't mutate the original
    const view = new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength);
    // m field: bytes 5-8 (BE32), in KiB. A crafted "recovery backup" can set this to whatever an
    // attacker likes since it's read straight off the untrusted file header.
    view.setUint32(5, 0x00f00000, false); // ~15 GiB
    const badBlob = `gmpc-recovery1.${toB64url(tampered)}`;
    await expect(decryptRecoveryShare(badBlob, 'correct horse battery')).rejects.toBeInstanceOf(
      RecoveryDecryptError
    );
  });
});
