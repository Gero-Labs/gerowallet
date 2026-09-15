import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { toStakeAddress, hasScriptPaymentCredential } from './serialization';

// Both addresses are from mainnet tx
// daf2524d4a30e201e6c678f10f43d8934e0e0709550e6ce3e64e7bafcd2a8dce, where a
// 104 ADA send to a Strike script address was accounted as an incoming payment
// because the script carries the sender's OWN stake credential.
const OWN_BASE_ADDRESS =
  'addr1q8xf2scs38ttgmhmgpuxv73fcckwa65r56rptlhv3akdyty0wdhwf8eevhfg8cxc6r70ncprncasd2x87x7q9ezxe95q37pkan';
const SCRIPT_ADDRESS_WITH_OWN_STAKE =
  'addr1z8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcny0wdhwf8eevhfg8cxc6r70ncprncasd2x87x7q9ezxe95qz8xxe9';
const MAINNET = Cardano.NetworkId.Mainnet;

describe('hasScriptPaymentCredential', () => {
  it('reports false for a base address whose payment credential is a key hash', () => {
    expect(hasScriptPaymentCredential(OWN_BASE_ADDRESS)).toBe(false);
  });

  it('reports true for a base address whose payment credential is a script hash', () => {
    expect(hasScriptPaymentCredential(SCRIPT_ADDRESS_WITH_OWN_STAKE)).toBe(true);
  });

  it('reports false for an unparseable or empty address rather than throwing', () => {
    expect(hasScriptPaymentCredential('')).toBe(false);
    expect(hasScriptPaymentCredential('not-an-address')).toBe(false);
  });

  it('is the only thing separating the two: their stake addresses are identical', () => {
    // This is why stake-credential matching alone cannot decide ownership.
    expect(toStakeAddress(SCRIPT_ADDRESS_WITH_OWN_STAKE, MAINNET))
      .toBe(toStakeAddress(OWN_BASE_ADDRESS, MAINNET));
  });
});
