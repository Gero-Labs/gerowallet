import { describe, it, expect } from 'vitest';
import {
  CROSS_DEVICE_PROTOCOL_VERSION,
  isDeviceRegister,
  isSignRequest,
  isSignResponse,
  parseCrossDeviceMessage,
  type DeviceRegister,
  type SignRequest,
  type SignResponse,
} from './protocol';

const validRegister: DeviceRegister = {
  v: CROSS_DEVICE_PROTOCOL_VERSION,
  type: 'DEVICE_REGISTER',
  deviceId: 'dev1',
  label: "Adam's Chrome",
  platform: 'extension',
  pubKey: 'aa'.repeat(32),
  hasSigningKey: true,
  createdAt: 1000,
};

const validRequest: SignRequest = {
  v: CROSS_DEVICE_PROTOCOL_VERSION,
  type: 'SIGN_REQUEST',
  reqId: 'req-1',
  fromDeviceId: 'dev1',
  toDeviceId: 'any',
  stakeAddress: 'stake1xyz',
  unsignedCbor: '84a400...',
  intent: 'Swap 10 ADA for MIN',
  nonce: 'n1',
  createdAt: 1000,
  ttlMs: 60000,
  sig: 'bb'.repeat(64),
};

const validResponse: SignResponse = {
  v: CROSS_DEVICE_PROTOCOL_VERSION,
  type: 'SIGN_RESPONSE',
  reqId: 'req-1',
  fromDeviceId: 'dev2',
  decision: 'approved',
  witnessSetCbor: 'a100...',
  nonce: 'n1',
  createdAt: 2000,
  sig: 'cc'.repeat(64),
};

describe('type guards', () => {
  it('isDeviceRegister narrows only DEVICE_REGISTER', () => {
    expect(isDeviceRegister(validRegister)).toBe(true);
    expect(isDeviceRegister(validRequest)).toBe(false);
    expect(isDeviceRegister(null)).toBe(false);
  });

  it('isSignRequest narrows only SIGN_REQUEST', () => {
    expect(isSignRequest(validRequest)).toBe(true);
    expect(isSignRequest(validResponse)).toBe(false);
  });

  it('isSignResponse narrows only SIGN_RESPONSE', () => {
    expect(isSignResponse(validResponse)).toBe(true);
    expect(isSignResponse(validRequest)).toBe(false);
  });
});

describe('parseCrossDeviceMessage', () => {
  it('accepts each valid message type', () => {
    expect(parseCrossDeviceMessage(validRegister)).toEqual(validRegister);
    expect(parseCrossDeviceMessage(validRequest)).toEqual(validRequest);
    expect(parseCrossDeviceMessage(validResponse)).toEqual(validResponse);
  });

  it('rejects a wrong protocol version', () => {
    expect(parseCrossDeviceMessage({ ...validRequest, v: 999 })).toBeNull();
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

  it('rejects a SIGN_REQUEST with a wrong field type', () => {
    expect(parseCrossDeviceMessage({ ...validRequest, ttlMs: 'soon' })).toBeNull();
  });

  it('rejects a SIGN_RESPONSE with an invalid decision', () => {
    expect(parseCrossDeviceMessage({ ...validResponse, decision: 'maybe' })).toBeNull();
  });

  it('accepts a rejected SIGN_RESPONSE without a witness', () => {
    const rejected = {
      ...validResponse,
      decision: 'rejected' as const,
      witnessSetCbor: undefined,
      reason: 'user_declined',
    };
    delete (rejected as { witnessSetCbor?: string }).witnessSetCbor;
    expect(parseCrossDeviceMessage(rejected)).not.toBeNull();
  });

  it('rejects a DEVICE_REGISTER with a bad platform', () => {
    expect(parseCrossDeviceMessage({ ...validRegister, platform: 'windows' })).toBeNull();
  });
});
