import { describe, it, expect } from 'vitest';
import {
  isDeviceRegister,
  isDevicesSnapshot,
  isSignRequest,
  isSignResponse,
  isPairConfirm,
  isPairAck,
  isDeviceChallenge,
  isDeviceRegisterAck,
  isDeviceUnregisterAck,
  parseCrossDeviceMessage,
  type DeviceRegister,
  type DevicesSnapshot,
  type SignRequest,
  type SignResponse,
  type PairConfirm,
  type PairAck,
} from './protocol';

const validRegister: DeviceRegister = {
  type: 'DEVICE_REGISTER',
  deviceId: 'dev1',
  label: "Adam's Chrome",
  platform: 'extension',
  pubKey: 'aa'.repeat(32),
  hasSigningKey: true,
};

const validDevices: DevicesSnapshot = {
  type: 'DEVICES',
  devices: [
    { deviceId: 'dev1', label: 'Chrome', platform: 'extension', pubKey: 'aa'.repeat(32), hasSigningKey: false },
    { deviceId: 'dev2', label: 'iPhone', platform: 'ios', pubKey: 'bb'.repeat(32), hasSigningKey: true },
  ],
};

const validRequest: SignRequest = {
  type: 'SIGN_REQUEST',
  reqId: 'req-1',
  nonce: 'n1',
  from: 'dev1',
  stakeAddress: 'stake1xyz',
  unsignedCbor: '84a400',
  intent: 'Swap 10 ADA for MIN',
  expiresAt: 1000,
  sig: 'bb'.repeat(64),
};

const validResponse: SignResponse = {
  type: 'SIGN_RESPONSE',
  reqId: 'req-1',
  nonce: 'n2',
  deviceId: 'dev2',
  decision: 'approved',
  witnessSetCbor: 'a100',
  sig: 'cc'.repeat(64),
};

const validPairConfirm: PairConfirm = {
  type: 'PAIR_CONFIRM',
  from: 'ios-uuid',
  pubKey: 'bb'.repeat(32),
  to: 'ext-abc',
  nonce: 'n3',
  stakeAddress: 'stake1uxyz',
  proof: { coseSign1: 'a0', coseKey: 'a1', stakeAddress: 'stake1uxyz' },
  label: "Adam's iPhone",
  platform: 'ios',
  hasSigningKey: true,
  sig: 'dd'.repeat(64),
};

const validPairAck: PairAck = {
  type: 'PAIR_ACK',
  from: 'ext-abc',
  to: 'ios-uuid',
  nonce: 'n3',
  sig: 'ee'.repeat(64),
};

describe('type guards', () => {
  it('isDeviceRegister narrows only DEVICE_REGISTER', () => {
    expect(isDeviceRegister(validRegister)).toBe(true);
    expect(isDeviceRegister(validRequest)).toBe(false);
    expect(isDeviceRegister(null)).toBe(false);
  });

  it('isDevicesSnapshot narrows only DEVICES with valid device entries', () => {
    expect(isDevicesSnapshot(validDevices)).toBe(true);
    expect(isDevicesSnapshot({ type: 'DEVICES', devices: [{ deviceId: 'x' }] })).toBe(false);
    expect(isDevicesSnapshot(validRegister)).toBe(false);
  });

  it('isSignRequest narrows only SIGN_REQUEST', () => {
    expect(isSignRequest(validRequest)).toBe(true);
    expect(isSignRequest(validResponse)).toBe(false);
  });

  it('isSignRequest accepts an omitted optional stakeAddress/intent', () => {
    const { stakeAddress: _s, intent: _i, ...rest } = validRequest;
    void _s;
    void _i;
    expect(isSignRequest(rest)).toBe(true);
  });

  it('isSignResponse narrows only SIGN_RESPONSE', () => {
    expect(isSignResponse(validResponse)).toBe(true);
    expect(isSignResponse(validRequest)).toBe(false);
  });

  it('isPairConfirm narrows only PAIR_CONFIRM with a well-formed proof', () => {
    expect(isPairConfirm(validPairConfirm)).toBe(true);
    expect(isPairConfirm(validResponse)).toBe(false);
    // proof is required and must be a {coseSign1, coseKey, stakeAddress} object
    const { proof: _p, ...noProof } = validPairConfirm;
    void _p;
    expect(isPairConfirm(noProof)).toBe(false);
    expect(isPairConfirm({ ...validPairConfirm, proof: { coseSign1: 'a0' } })).toBe(false);
  });

  it('isPairConfirm requires the signed fields (from/pubKey/to/nonce/stakeAddress)', () => {
    for (const field of ['from', 'pubKey', 'to', 'nonce', 'stakeAddress'] as const) {
      const { [field]: _omit, ...rest } = validPairConfirm;
      void _omit;
      expect(isPairConfirm(rest)).toBe(false);
    }
  });

  it('isPairAck narrows only PAIR_ACK and requires from/to/nonce/sig', () => {
    expect(isPairAck(validPairAck)).toBe(true);
    expect(isPairAck(validPairConfirm)).toBe(false);
    for (const field of ['from', 'to', 'nonce', 'sig'] as const) {
      const { [field]: _omit, ...rest } = validPairAck;
      void _omit;
      expect(isPairAck(rest)).toBe(false);
    }
  });
});

describe('parseCrossDeviceMessage', () => {
  it('accepts each valid message type', () => {
    expect(parseCrossDeviceMessage(validRegister)).toEqual(validRegister);
    expect(parseCrossDeviceMessage(validDevices)).toEqual(validDevices);
    expect(parseCrossDeviceMessage(validRequest)).toEqual(validRequest);
    expect(parseCrossDeviceMessage(validResponse)).toEqual(validResponse);
    expect(parseCrossDeviceMessage(validPairConfirm)).toEqual(validPairConfirm);
    expect(parseCrossDeviceMessage(validPairAck)).toEqual(validPairAck);
    expect(parseCrossDeviceMessage({ type: 'DEVICE_REGISTER_ACK', deviceId: 'dev1' })).not.toBeNull();
  });

  it('rejects an unknown type', () => {
    expect(parseCrossDeviceMessage({ ...validRequest, type: 'SUBSCRIBE' })).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(parseCrossDeviceMessage(null)).toBeNull();
    expect(parseCrossDeviceMessage('SIGN_REQUEST')).toBeNull();
    expect(parseCrossDeviceMessage(42)).toBeNull();
    expect(parseCrossDeviceMessage(undefined)).toBeNull();
  });

  it('rejects a SIGN_REQUEST missing a required field', () => {
    const { unsignedCbor: _omit, ...rest } = validRequest;
    void _omit;
    expect(parseCrossDeviceMessage(rest)).toBeNull();
  });

  it('rejects a SIGN_REQUEST with a wrong field type (expiresAt not a number)', () => {
    expect(parseCrossDeviceMessage({ ...validRequest, expiresAt: 'soon' })).toBeNull();
  });

  it('rejects a SIGN_RESPONSE with an invalid decision', () => {
    expect(parseCrossDeviceMessage({ ...validResponse, decision: 'maybe' })).toBeNull();
  });

  it('accepts a rejected SIGN_RESPONSE without a witness', () => {
    const rejected: SignResponse = {
      type: 'SIGN_RESPONSE',
      reqId: 'req-1',
      nonce: 'n2',
      deviceId: 'dev2',
      decision: 'rejected',
      reason: 'user_declined',
      sig: 'cc'.repeat(64),
    };
    expect(parseCrossDeviceMessage(rejected)).not.toBeNull();
  });

  it('rejects a DEVICE_REGISTER with a bad platform', () => {
    expect(parseCrossDeviceMessage({ ...validRegister, platform: 'windows' })).toBeNull();
  });
});

// ---- Relay contract §5 (Track A): session-bound registration frames ----------
describe('§5 session frames', () => {
  const challenge = { type: 'DEVICE_CHALLENGE', challenge: 'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf', network: 'cardano-mainnet', stakeAddress: 'stake1uyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpswtcyrc' };

  it('isDeviceChallenge requires a 32-hex challenge, network and stakeAddress', () => {
    expect(isDeviceChallenge(challenge)).toBe(true);
    expect(parseCrossDeviceMessage(challenge)).toEqual(challenge);
    expect(isDeviceChallenge({ ...challenge, challenge: 'C0C1' })).toBe(false);
    expect(isDeviceChallenge({ ...challenge, challenge: 'zz'.repeat(16) })).toBe(false);
    for (const field of ['challenge', 'network', 'stakeAddress'] as const) {
      const { [field]: _omit, ...rest } = challenge;
      void _omit;
      expect(isDeviceChallenge(rest)).toBe(false);
    }
    expect(isDeviceChallenge(validDevices)).toBe(false);
  });

  it('isDeviceRegister accepts the session fields (challenge + sessionSig) alongside the device info', () => {
    const signed = { ...validRegister, challenge: challenge.challenge, sessionSig: 'ab'.repeat(64) };
    expect(isDeviceRegister(signed)).toBe(true);
    expect(parseCrossDeviceMessage(signed)).toEqual(signed);
  });

  it('isDevicesSnapshot accepts the restricted marker (§5.6) and rejects a non-boolean one', () => {
    expect(isDevicesSnapshot({ type: 'DEVICES', devices: [], restricted: true })).toBe(true);
    expect(isDevicesSnapshot({ type: 'DEVICES', devices: [], restricted: 'yes' })).toBe(false);
    expect(isDevicesSnapshot(validDevices)).toBe(true);
  });

  it('isDeviceRegisterAck accepts the legacy ack, the full §5.5 ack, and rejects unknown status values', () => {
    expect(isDeviceRegisterAck({ type: 'DEVICE_REGISTER_ACK' })).toBe(true);
    expect(isDeviceRegisterAck({ type: 'DEVICE_REGISTER_ACK', deviceId: 'dev1' })).toBe(true);
    expect(isDeviceRegisterAck({ type: 'DEVICE_REGISTER_ACK', deviceId: 'dev1', proofStatus: 'verified', sessionStatus: 'stale_challenge', registered: false })).toBe(true);
    expect(isDeviceRegisterAck({ type: 'DEVICE_REGISTER_ACK', proofStatus: 'ok' })).toBe(false);
    expect(isDeviceRegisterAck({ type: 'DEVICE_REGISTER_ACK', sessionStatus: 'expired' })).toBe(false);
    expect(isDeviceRegisterAck({ type: 'DEVICE_REGISTER_ACK', registered: 'true' })).toBe(false);
  });

  it('isDeviceUnregisterAck narrows DEVICE_UNREGISTER_ACK', () => {
    const ack = { type: 'DEVICE_UNREGISTER_ACK', deviceId: 'dev1', removed: true };
    expect(isDeviceUnregisterAck(ack)).toBe(true);
    expect(parseCrossDeviceMessage(ack)).toEqual(ack);
    expect(isDeviceUnregisterAck({ ...ack, removed: 1 })).toBe(false);
  });
});
