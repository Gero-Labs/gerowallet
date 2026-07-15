import { describe, it, expect } from 'vitest';
import { encryptDeviceShare, decryptDeviceShare, type DeviceShareSecret } from './deviceShareCipher';

const prf = (bytes = 7): DeviceShareSecret => ({
  kind: 'prf',
  prfOutput: new Uint8Array(32).fill(bytes),
  credentialId: 'cred-AAAA',
  saltId: 'salt-1234',
});

describe('deviceShareCipher', () => {
  it('password path round-trips under a pw.v1 tag', async () => {
    const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
    const env = await encryptDeviceShare('share-xyz', secret);
    expect(env.startsWith('pw.v1:')).toBe(true);
    expect(await decryptDeviceShare(env, secret)).toBe('share-xyz');
  });

  it('prf path round-trips under a prf.v1 tag (injected output, no WebAuthn)', async () => {
    const secret = prf();
    const env = await encryptDeviceShare('share-xyz', secret);
    expect(env.startsWith('prf.v1:')).toBe(true);
    expect(await decryptDeviceShare(env, secret)).toBe('share-xyz');
  });

  it('prf path rejects a different PRF output', async () => {
    const env = await encryptDeviceShare('share-xyz', prf(7));
    await expect(decryptDeviceShare(env, prf(9))).rejects.toBeTruthy();
  });

  it('prf path rejects a different credentialId (AAD binding)', async () => {
    const env = await encryptDeviceShare('share-xyz', prf(7));
    const wrongCred: DeviceShareSecret = { ...prf(7), credentialId: 'cred-BBBB' };
    await expect(decryptDeviceShare(env, wrongCred)).rejects.toBeTruthy();
  });

  it('decrypts a legacy untagged blob as password', async () => {
    const { encrypt } = await import('@/shared/utils/crypto');
    const legacy = encrypt('share-legacy', 'pw');
    expect(await decryptDeviceShare(legacy, { kind: 'password', password: 'pw' })).toBe('share-legacy');
  });

  it('rejects an unknown tag', async () => {
    await expect(decryptDeviceShare('bogus.v9:zzz', { kind: 'password', password: 'pw' })).rejects.toBeTruthy();
  });
});
