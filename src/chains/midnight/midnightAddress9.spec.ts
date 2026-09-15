// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bech32m } from 'bech32';
import * as ledger from '@midnightntwrk/ledger-v9';
import { ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from 'midnight-v9-address-format';
import { decodeShieldedAddress9, parseMidnightAddress9 } from './midnightAddress9';

function address(network: string): { encoded: string; coin: string; encryption: string } {
  const keys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(3));
  try {
    return {
      encoded: ShieldedAddress.codec.encode(network, new ShieldedAddress(
        ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey),
        ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey),
      )).toString(),
      coin: keys.coinPublicKey,
      encryption: keys.encryptionPublicKey,
    };
  } finally { keys.clear(); }
}

describe('Midnight ledger-9 long addresses', () => {
  it.each(['mainnet', 'preprod', 'stagenet'])('round-trips real WASM-derived %s public keys', (network) => {
    const input = address(network);
    expect(input.encoded.length).toBeGreaterThan(90);
    const decoded = decodeShieldedAddress9(network, input.encoded);
    expect(decoded.coinPublicKey.toHexString()).toBe(input.coin);
    expect(decoded.encryptionPublicKey.toHexString()).toBe(input.encryption);
    expect(ShieldedAddress.codec.encode(network, decoded).toString()).toBe(input.encoded);
  });

  it('rejects wrong checksums, mixed case and the wrong network', () => {
    const { encoded } = address('stagenet');
    const changed = encoded.slice(0, -1) + (encoded.endsWith('q') ? 'p' : 'q');
    expect(() => decodeShieldedAddress9('stagenet', changed)).toThrow();
    expect(() => decodeShieldedAddress9('stagenet', `M${encoded.slice(1)}`)).toThrow();
    expect(() => decodeShieldedAddress9('preprod', encoded)).toThrow();
  });

  it('rejects valid-checksum malformed payloads and HRPs', () => {
    const payload = new Uint8Array(64).fill(1);
    const encode = (prefix: string, bytes = payload) => bech32m.encode(prefix, bech32m.toWords(bytes), 1024);
    expect(() => decodeShieldedAddress9('stagenet', encode('other_shield-addr_stagenet'))).toThrow();
    expect(() => decodeShieldedAddress9('stagenet', encode('mn_shield-addr_stagenet_extra'))).toThrow();
    expect(() => decodeShieldedAddress9('stagenet', encode('mn_addr_stagenet'))).toThrow();
    expect(() => decodeShieldedAddress9('stagenet', encode('mn_shield-addr_stagenet', new Uint8Array(63)))).toThrow();
    expect(() => parseMidnightAddress9('m'.repeat(1025))).toThrow();
  });
});
