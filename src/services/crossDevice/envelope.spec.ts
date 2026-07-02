import { describe, it, expect } from 'vitest';
import { buildSubject, blake2b256Hex, signMessage, verifyMessage } from './envelope';
import { generateDeviceKeypair } from './deviceIdentity';
import type { SignRequest, SignResponse } from './protocol';

const kp = generateDeviceKeypair((n) => new Uint8Array(n).fill(3));
const otherKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(4));

const req: Omit<SignRequest, 'sig'> = {
  type: 'SIGN_REQUEST',
  reqId: 'req-1',
  nonce: 'n1',
  from: 'dev1',
  stakeAddress: 'stake1xyz',
  unsignedCbor: '84a4',
  intent: 'Swap 10 ADA for MIN',
  expiresAt: 1000,
};

const resApproved: Omit<SignResponse, 'sig'> = {
  type: 'SIGN_RESPONSE',
  reqId: 'req-1',
  nonce: 'n2',
  deviceId: 'dev2',
  decision: 'approved',
  witnessSetCbor: 'a100',
};

// CONFORMANCE VECTORS — the iOS approver must reproduce these exact strings +
// hashes byte-for-byte. blake2b-256 of raw CBOR bytes; pipe-joined subject.
const HASH_84A4 = '95206ecbc3a90dd4117931c4a7802e99ec301fb896734b0b721d40177602fc50';
const HASH_A100 = 'a04d341ee1aea805c0a3d888b0d7135f99f067c0ed74e64de80aefefedc6ff26';

describe('blake2b256Hex', () => {
  it('matches the blake2b-256 vector for the CBOR bytes', () => {
    expect(blake2b256Hex(new Uint8Array([0x84, 0xa4]))).toBe(HASH_84A4);
  });
});

describe('buildSubject (cross-client conformance vectors)', () => {
  it('SIGN_REQUEST subject is the exact pipe-joined string', () => {
    expect(buildSubject(req)).toBe(
      `gero-xdev/v1|SIGN_REQUEST|req-1|n1|dev1|stake1xyz|1000|${HASH_84A4}`,
    );
  });

  it('SIGN_REQUEST omits intent from the subject and uses empty for missing stakeAddress', () => {
    const noStake = buildSubject({ ...req, stakeAddress: undefined, intent: 'ignored' });
    expect(noStake).toBe(`gero-xdev/v1|SIGN_REQUEST|req-1|n1|dev1||1000|${HASH_84A4}`);
  });

  it('approved SIGN_RESPONSE subject hashes the witness', () => {
    expect(buildSubject(resApproved)).toBe(
      `gero-xdev/v1|SIGN_RESPONSE|req-1|n2|dev2|approved|${HASH_A100}`,
    );
  });

  it('rejected SIGN_RESPONSE subject has an empty witness-hash slot', () => {
    const rejected: Omit<SignResponse, 'sig'> = {
      type: 'SIGN_RESPONSE',
      reqId: 'req-1',
      nonce: 'n2',
      deviceId: 'dev2',
      decision: 'rejected',
    };
    expect(buildSubject(rejected)).toBe('gero-xdev/v1|SIGN_RESPONSE|req-1|n2|dev2|rejected|');
  });
});

describe('signMessage / verifyMessage', () => {
  it('sign then verify with the matching public key returns true', async () => {
    const signed = await signMessage<SignRequest>(req, kp.privKeyHex);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyMessage(signed, kp.pubKeyHex)).toBe(true);
  });

  it('verify with the wrong public key returns false', async () => {
    const signed = await signMessage<SignRequest>(req, kp.privKeyHex);
    expect(await verifyMessage(signed, otherKp.pubKeyHex)).toBe(false);
  });

  it('tampering with a subject field after signing makes verify false', async () => {
    const signed = await signMessage<SignRequest>(req, kp.privKeyHex);
    expect(await verifyMessage({ ...signed, expiresAt: 9999 }, kp.pubKeyHex)).toBe(false);
    expect(await verifyMessage({ ...signed, unsignedCbor: '84a5' }, kp.pubKeyHex)).toBe(false);
  });

  it('returns false for a malformed signature rather than throwing', async () => {
    expect(await verifyMessage({ ...req, sig: 'notavalidsig' }, kp.pubKeyHex)).toBe(false);
  });

  it('response round-trips too', async () => {
    const signed = await signMessage<SignResponse>(resApproved, kp.privKeyHex);
    expect(await verifyMessage(signed, kp.pubKeyHex)).toBe(true);
  });
});
