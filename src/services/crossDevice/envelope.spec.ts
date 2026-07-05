import { describe, it, expect } from 'vitest';
import { buildSubject, blake2b256Hex, signMessage, verifyMessage } from './envelope';
import { generateDeviceKeypair } from './deviceIdentity';
import type { SignRequest, SignResponse, PairConfirm, PairAck } from './protocol';

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

// QR pairing (PAIR_CONFIRM). `to` is INSIDE the subject (binds the scanned desktop),
// unlike SIGN_*. The iOS scanner must reproduce this exact pipe-joined string.
const pairProof = { coseSign1: 'a0', coseKey: 'a1', stakeAddress: 'stake1uxyz' };
const pair: Omit<PairConfirm, 'sig'> = {
  type: 'PAIR_CONFIRM',
  from: 'ios-abc',
  pubKey: 'deadbeef',
  to: 'ext-123',
  nonce: 'nonce1',
  stakeAddress: 'stake1uxyz',
  proof: pairProof,
  label: "Adam's iPhone",
  platform: 'ios',
  hasSigningKey: true,
};

describe('buildSubject PAIR_CONFIRM (cross-client conformance vector)', () => {
  it('binds from|pubKey|to|nonce|stakeAddress in that exact order', () => {
    expect(buildSubject(pair)).toBe(
      'gero-xdev/v1|PAIR_CONFIRM|ios-abc|deadbeef|ext-123|nonce1|stake1uxyz',
    );
  });

  it('excludes advisory fields (proof/label/platform/hasSigningKey) from the subject', () => {
    const stripped = buildSubject({
      ...pair,
      proof: { coseSign1: 'ff', coseKey: 'ff', stakeAddress: 'stake1uxyz' },
      label: 'different label',
      platform: 'android',
      hasSigningKey: false,
    });
    expect(stripped).toBe('gero-xdev/v1|PAIR_CONFIRM|ios-abc|deadbeef|ext-123|nonce1|stake1uxyz');
  });
});

describe('signMessage / verifyMessage PAIR_CONFIRM', () => {
  it('round-trips with the matching key', async () => {
    const signed = await signMessage<PairConfirm>(pair, kp.privKeyHex);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyMessage(signed, kp.pubKeyHex)).toBe(true);
  });

  it('re-targeting `to` after signing breaks verify (anti cross-desktop replay)', async () => {
    const signed = await signMessage<PairConfirm>(pair, kp.privKeyHex);
    expect(await verifyMessage({ ...signed, to: 'ext-999' }, kp.pubKeyHex)).toBe(false);
  });

  it('tampering with pubKey or nonce breaks verify', async () => {
    const signed = await signMessage<PairConfirm>(pair, kp.privKeyHex);
    expect(await verifyMessage({ ...signed, pubKey: 'cafe' }, kp.pubKeyHex)).toBe(false);
    expect(await verifyMessage({ ...signed, nonce: 'nonce2' }, kp.pubKeyHex)).toBe(false);
  });
});

// PAIR_ACK (desktop -> phone cosmetic tick). Subject binds from|to|nonce only. The iOS
// listener must reproduce this exact string (goldenPairAckSubjectVector).
const ack: Omit<PairAck, 'sig'> = { type: 'PAIR_ACK', from: 'ext-123', to: 'ios-abc', nonce: 'nonce1' };

describe('buildSubject PAIR_ACK (cross-client conformance vector)', () => {
  it('joins from|to|nonce in that exact order', () => {
    expect(buildSubject(ack)).toBe('gero-xdev/v1|PAIR_ACK|ext-123|ios-abc|nonce1');
  });
});

describe('signMessage / verifyMessage PAIR_ACK', () => {
  it('round-trips with the matching key', async () => {
    const signed = await signMessage<PairAck>(ack, kp.privKeyHex);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyMessage(signed, kp.pubKeyHex)).toBe(true);
  });

  it('tampering with any subject field breaks verify', async () => {
    const signed = await signMessage<PairAck>(ack, kp.privKeyHex);
    expect(await verifyMessage({ ...signed, from: 'ext-999' }, kp.pubKeyHex)).toBe(false);
    expect(await verifyMessage({ ...signed, to: 'ios-999' }, kp.pubKeyHex)).toBe(false);
    expect(await verifyMessage({ ...signed, nonce: 'nonce2' }, kp.pubKeyHex)).toBe(false);
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
