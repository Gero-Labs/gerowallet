import { blake2b } from '@noble/hashes/blake2.js';
import { describe, expect, it } from 'vitest';
import { SIGNING_BUNDLE_HASH_TAG, signingBundleHash, vaultNetworkOf } from './contracts';

describe('GeroVault slice contracts', () => {
  it('hashes the tag, the vault id and the body, in that order', () => {
    const vaultId = '11'.repeat(32);
    const body = 'a400818258200000';
    const preimage = Buffer.concat([Buffer.from(SIGNING_BUNDLE_HASH_TAG, 'utf8'), Buffer.from(vaultId, 'hex'), Buffer.from(body, 'hex')]);
    expect(signingBundleHash(vaultId, body)).toBe(Buffer.from(blake2b(preimage, { dkLen: 32 })).toString('hex'));
    expect(signingBundleHash(vaultId, body)).not.toBe(signingBundleHash('22'.repeat(32), body));
  });

  it('refuses anything but lowercase hex', () => {
    expect(() => signingBundleHash('11'.repeat(31), '00')).toThrow(TypeError);
    expect(() => signingBundleHash('AA'.repeat(32), '00')).toThrow(TypeError);
    expect(() => signingBundleHash('11'.repeat(32), '')).toThrow(TypeError);
    expect(() => signingBundleHash('11'.repeat(32), '0')).toThrow(TypeError);
  });

  it('maps a wallet network to a vault network', () => {
    expect(vaultNetworkOf('Preprod')).toBe('preprod');
    expect(vaultNetworkOf('Mainnet')).toBe('mainnet');
    expect(vaultNetworkOf('Preview')).toBe('preview');
    expect(vaultNetworkOf('Testnet')).toBeUndefined();
    expect(vaultNetworkOf(undefined)).toBeUndefined();
  });
});
