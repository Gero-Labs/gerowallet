// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as addressFormat from '@midnightntwrk/wallet-sdk-address-format';
import { connectorShieldedAddresses } from './midnightConnectorAddresses';

const { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey, MidnightBech32m } = addressFormat;

describe('connectorShieldedAddresses', () => {
  it('returns the address and both public keys as bech32m that round-trip through the SDK codecs', () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(9));
    const coin = ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey);
    const enc = ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey);
    const address = ShieldedAddress.codec.encode('preprod', new ShieldedAddress(coin, enc)).toString();

    const out = connectorShieldedAddresses(addressFormat, 'preprod', address);

    expect(out.shieldedAddress).toBe(address);
    expect(out.shieldedCoinPublicKey).toMatch(/^mn_shield-cpk_preprod1[a-z0-9]+$/);
    expect(out.shieldedEncryptionPublicKey).toMatch(/^mn_shield-epk_preprod1[a-z0-9]+$/);
    // What a dapp does with them (midnight-js decodeShieldedCoinPublicKey etc.).
    expect(ShieldedCoinPublicKey.codec.decode('preprod', MidnightBech32m.parse(out.shieldedCoinPublicKey)).toHexString())
      .toBe(keys.coinPublicKey);
    expect(ShieldedEncryptionPublicKey.codec.decode('preprod', MidnightBech32m.parse(out.shieldedEncryptionPublicKey)).toHexString())
      .toBe(keys.encryptionPublicKey);
    // Never the raw hex the wallet used to return.
    expect(out.shieldedCoinPublicKey).not.toBe(keys.coinPublicKey);
    keys.clear();
  });

  it('rejects an address from another network', () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(4));
    const address = ShieldedAddress.codec.encode('mainnet', new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey), ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey),
    )).toString();
    keys.clear();
    expect(() => connectorShieldedAddresses(addressFormat, 'preprod', address)).toThrow();
  });
});
