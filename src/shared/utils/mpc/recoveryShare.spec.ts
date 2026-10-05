import { describe, it, expect } from 'vitest';
import { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
import { RecoveryDecryptError } from './types';
import { fromB64url, toB64url } from './base64url';
import { argon2id } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

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

  it('writes the raised cost (t=3, m=64 MiB, p=1) into new blobs', async () => {
    const raw = fromB64url((await encryptRecoveryShare('x', 'p')).split('.')[1]);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    expect([view.getUint32(1, false), view.getUint32(5, false), view.getUint32(9, false)]).toEqual([3, 65_536, 1]);
  });

  it('still decrypts a blob written at the previous cost (t=2, m=19 MiB)', async () => {
    const salt = new Uint8Array(16).fill(7);
    const nonce = new Uint8Array(24).fill(9);
    const key = argon2id('old-generation pass', salt, { t: 2, m: 19_456, p: 1, dkLen: 32 });
    const ct = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode('legacy-share'));
    const raw = new Uint8Array(53 + ct.length);
    const view = new DataView(raw.buffer);
    raw[0] = 2;
    view.setUint32(1, 2, false);
    view.setUint32(5, 19_456, false);
    view.setUint32(9, 1, false);
    raw.set(salt, 13);
    raw.set(nonce, 29);
    raw.set(ct, 53);
    await expect(decryptRecoveryShare(`gmpc-recovery1.${toB64url(raw)}`, 'old-generation pass')).resolves.toBe('legacy-share');
  });
});
