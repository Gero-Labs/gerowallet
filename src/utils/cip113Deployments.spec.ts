// The hardware half of Send's signer gate: which devices Gero may ask to sign a CIP-113
// transfer. It ships empty and opens one device at a time, after that device's preprod run.
import { describe, expect, it } from 'vitest';
import { CIP113_SEND_HARDWARE_WALLET_TYPES, isCip113SendHardware } from './cip113Deployments';

describe('isCip113SendHardware', () => {
  it('allows no device in this build', () => {
    expect(CIP113_SEND_HARDWARE_WALLET_TYPES).toEqual([]);
    for (const type of ['Ledger', 'Trezor', 'Keystone']) expect(isCip113SendHardware(type)).toBe(false);
  });

  it('allows a listed device, and only that one', () => {
    expect(isCip113SendHardware('Ledger', ['Ledger'])).toBe(true);
    expect(isCip113SendHardware('Trezor', ['Ledger'])).toBe(false);
    expect(isCip113SendHardware('Keystone', ['Ledger', 'Trezor', 'Keystone'])).toBe(true);
  });

  it('never answers for a software, watch or unknown type, even when listed', () => {
    for (const type of ['Normal', 'Google', 'Watch', 'ledger', '', null, undefined]) {
      expect(isCip113SendHardware(type, ['Normal', 'Google', 'Watch', 'ledger', ''])).toBe(false);
    }
  });
});
