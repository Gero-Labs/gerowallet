import { describe, it, expect } from 'vitest';
import { canonicalBytes, signMessage, verifyMessage } from './envelope';
import { generateDeviceKeypair } from './deviceIdentity';

interface DummyMsg {
  type: string;
  reqId: string;
  n: number;
  sig: string;
}

const kp = generateDeviceKeypair((n) => new Uint8Array(n).fill(3));
const otherKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(4));

describe('canonicalBytes', () => {
  it('is stable regardless of key insertion order', () => {
    const a = canonicalBytes({ type: 'X', reqId: 'r1', n: 5 });
    const b = canonicalBytes({ n: 5, reqId: 'r1', type: 'X' });
    expect(a).toEqual(b);
  });

  it('ignores an existing sig field (never signs over the signature)', () => {
    const without = canonicalBytes({ type: 'X', reqId: 'r1', n: 5 });
    const withSig = canonicalBytes({ type: 'X', reqId: 'r1', n: 5, sig: 'deadbeef' });
    expect(withSig).toEqual(without);
  });

  it('changes when a field value changes', () => {
    const a = canonicalBytes({ type: 'X', reqId: 'r1', n: 5 });
    const b = canonicalBytes({ type: 'X', reqId: 'r1', n: 6 });
    expect(a).not.toEqual(b);
  });
});

describe('signMessage / verifyMessage', () => {
  it('sign then verify with the matching public key returns true', async () => {
    const signed = await signMessage<DummyMsg>(
      { type: 'X', reqId: 'r1', n: 5 },
      kp.privKeyHex,
    );
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyMessage(signed, kp.pubKeyHex)).toBe(true);
  });

  it('verify with the wrong public key returns false', async () => {
    const signed = await signMessage<DummyMsg>(
      { type: 'X', reqId: 'r1', n: 5 },
      kp.privKeyHex,
    );
    expect(await verifyMessage(signed, otherKp.pubKeyHex)).toBe(false);
  });

  it('tampering with any field after signing makes verify false', async () => {
    const signed = await signMessage<DummyMsg>(
      { type: 'X', reqId: 'r1', n: 5 },
      kp.privKeyHex,
    );
    const tampered = { ...signed, n: 999 };
    expect(await verifyMessage(tampered, kp.pubKeyHex)).toBe(false);
  });

  it('returns false for a malformed signature rather than throwing', async () => {
    const bad = { type: 'X', reqId: 'r1', n: 5, sig: 'notavalidsig' };
    expect(await verifyMessage(bad, kp.pubKeyHex)).toBe(false);
  });
});
