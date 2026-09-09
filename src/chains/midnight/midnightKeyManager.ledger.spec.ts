// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bech32m } from 'bech32';
import * as ledger8 from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import * as format8 from '@midnightntwrk/wallet-sdk-address-format';
import * as format9 from 'midnight-v9-address-format';
import { deriveMidnightKeys, type MidnightDerivedKeys } from './midnightKeyManager';

// These Cardano-only imports initialize browser stores at module load. The
// signing path explicitly skips Cardano; fail if it accidentally calls them.
vi.mock('@/shared/utils/resolver', () => ({
  resolvePrivateKey: () => { throw new Error('Cardano derivation must be skipped'); },
}));
vi.mock('@/chrome/serialization', () => ({
  getAddress: () => { throw new Error('Cardano derivation must be skipped'); },
  getPaymentKeyExternal: () => { throw new Error('Cardano derivation must be skipped'); },
  getRewardAddress: () => { throw new Error('Cardano derivation must be skipped'); },
}));

// Public BIP39 test vector; never fund these wallets.
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const networks = ['Mainnet', 'Preprod', 'Stagenet'] as const;
const keys = new Map<string, MidnightDerivedKeys>();

describe('Midnight full HD derivation across ledger versions', () => {
  beforeAll(async () => {
    for (const network of networks) {
      keys.set(network, await deriveMidnightKeys(mnemonic, network, 0, { skipCardano: true }));
    }
  });

  afterAll(() => {
    for (const derived of keys.values()) {
      derived.seed.fill(0);
      derived.unshieldedSecretKey.fill(0);
      derived.dustSecretKey.fill(0);
      derived.zswapSecretKey.fill(0);
    }
  });

  it('preserves HD role keys and Schnorr identity when switching networks', () => {
    const mainnet = keys.get('Mainnet')!;
    expect(mainnet.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(mainnet.addressHex).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger8.signatureVerifyingKey(Buffer.from(mainnet.unshieldedSecretKey).toString('hex')))
      .toBe(mainnet.publicKeyHex);
    expect(ledger8.addressFromKey(mainnet.publicKeyHex)).toBe(mainnet.addressHex);
    expect(mainnet.unshieldedSecretKey).not.toEqual(mainnet.dustSecretKey);
    expect(mainnet.dustSecretKey).not.toEqual(mainnet.zswapSecretKey);
    for (const network of networks) {
      const derived = keys.get(network)!;
      expect(derived.publicKeyHex).toBe(mainnet.publicKeyHex);
      expect(derived.addressHex).toBe(mainnet.addressHex);
      expect(derived.unshieldedSecretKey).toEqual(mainnet.unshieldedSecretKey);
      expect(derived.dustSecretKey).toEqual(mainnet.dustSecretKey);
      expect(derived.zswapSecretKey).toEqual(mainnet.zswapSecretKey);
      expect(derived.cardanoXpub).toBe('');
      expect(derived.cardanoBaseAddress).toBe('');
    }
  });

  it.each(networks)('%s addresses and viewing key decode with the matching ledger', (network) => {
    const derived = keys.get(network)!;
    const sdkNetwork = network.toLowerCase();
    const ledger = network === 'Stagenet' ? ledger9 : ledger8;
    const format = network === 'Stagenet' ? format9 : format8;
    const suffix = network === 'Mainnet' ? '' : `_${sdkNetwork}`;
    const entries = [
      [derived.addresses.unshielded, `mn_addr${suffix}`],
      [derived.addresses.shielded, `mn_shield-addr${suffix}`],
      [derived.addresses.dust, `mn_dust${suffix}`],
      [derived.zswapViewingKey, `mn_shield-esk${suffix}`],
    ];
    for (const [encoded, prefix] of entries) {
      expect(bech32m.decode(encoded!, 1024).prefix).toBe(prefix);
    }
    const unshielded = format.UnshieldedAddress.codec.decode(sdkNetwork, format.MidnightBech32m.parse(derived.addresses.unshielded));
    expect(unshielded.hexString).toBe(derived.addressHex);

    const dust = ledger.DustSecretKey.fromSeed(derived.dustSecretKey);
    const zswap = ledger.ZswapSecretKeys.fromSeed(derived.zswapSecretKey);
    try {
      const decodedDust = format.DustAddress.codec.decode(sdkNetwork, format.MidnightBech32m.parse(derived.addresses.dust!));
      expect(decodedDust.data).toBe(dust.publicKey);
      // Public shielded addresses still use the legacy address codec in the
      // key manager. beta.2's newer @scure/base decoder caps input at 90 chars,
      // below this 133-character address. Parse its checksum with the existing
      // codec, then verify the payload against the matching ledger-9 codec.
      const publicAddress = format8.MidnightBech32m.parse(derived.addresses.shielded!);
      const shielded = network === 'Stagenet'
        ? format9.ShieldedAddress.codec.decode(sdkNetwork,
          new format9.MidnightBech32m(publicAddress.type, sdkNetwork, publicAddress.data))
        : format8.ShieldedAddress.codec.decode(sdkNetwork, publicAddress);
      expect(shielded.coinPublicKeyString()).toBe(zswap.coinPublicKey);
      expect(shielded.encryptionPublicKeyString()).toBe(zswap.encryptionPublicKey);
      const viewing = format.ShieldedEncryptionSecretKey.codec.decode(sdkNetwork, format.MidnightBech32m.parse(derived.zswapViewingKey));
      expect(viewing.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize())
        .toEqual(zswap.encryptionSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize());
      const wrongNetwork = network === 'Mainnet' ? 'preprod' : 'mainnet';
      expect(() => format.ShieldedEncryptionSecretKey.codec.decode(wrongNetwork, format.MidnightBech32m.parse(derived.zswapViewingKey))).toThrow();
    } finally {
      dust.clear();
      zswap.clear();
    }
  });
});
