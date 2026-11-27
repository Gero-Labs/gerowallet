// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import {
  HARDENED,
  MAX_KEY_INDEX,
  formatMidnightKeyPath,
  midnightKeyPath,
  networkFromLevel,
  parseMidnightKeyPath,
  roleFromLevel,
} from './paths';
import { deriveDelegateKeys, deriveGuardianKeys, deriveOwnerKeys, midnightChildKey, wipeGuardianKeys, wipeOwnerKeys } from './derive';
import { toHex } from './bytes';
import { MidnightKeyRole, MidnightNetwork } from './types';

const SEED = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const code = (c: string) => expect.objectContaining({ code: c });

describe('paths: m/1854\'/2400\'/n\'/r\'/i\'', () => {
  it('numbers the networks 0 mainnet, 1 preprod, 2 preview and the roles 0 approval, 1 upgrade, 2 guardian, 3 delegate', () => {
    const cases: [MidnightNetwork, MidnightKeyRole, string][] = [
      ['mainnet', 'approval', "m/1854'/2400'/0'/0'/1'"],
      ['preprod', 'upgrade', "m/1854'/2400'/1'/1'/1'"],
      ['preview', 'guardian', "m/1854'/2400'/2'/2'/1'"],
      ['preprod', 'delegate', "m/1854'/2400'/1'/3'/1'"],
    ];
    for (const [network, role, path] of cases) {
      expect(formatMidnightKeyPath(network, role, 1)).toBe(path);
      expect(parseMidnightKeyPath(path)).toEqual({ network, role, index: 1 });
    }
  });

  it('hardens every level', () => {
    expect(midnightKeyPath('preprod', 'guardian', 7)).toEqual([1854, 2400, 1, 2, 7].map(n => n + HARDENED));
  });

  it('refuses the reserved network level 3', () => {
    expect(() => networkFromLevel(3)).toThrow(code('RESERVED_NETWORK'));
    expect(() => parseMidnightKeyPath("m/1854'/2400'/3'/0'/1'")).toThrow(code('RESERVED_NETWORK'));
    expect(() => networkFromLevel(4)).toThrow(code('INVALID_NETWORK'));
    expect(() => parseMidnightKeyPath("m/1854'/2400'/4'/0'/1'")).toThrow(code('INVALID_NETWORK'));
  });

  it('refuses the reserved role levels 4 to 9', () => {
    for (let r = 4; r <= 9; r++) {
      expect(() => roleFromLevel(r)).toThrow(code('RESERVED_ROLE'));
      expect(() => parseMidnightKeyPath(`m/1854'/2400'/1'/${r}'/1'`)).toThrow(code('RESERVED_ROLE'));
    }
    expect(() => roleFromLevel(10)).toThrow(code('INVALID_ROLE'));
    expect(() => parseMidnightKeyPath("m/1854'/2400'/1'/10'/1'")).toThrow(code('INVALID_ROLE'));
  });

  it('refuses index 0 and indexes beyond the hardened range', () => {
    expect(() => formatMidnightKeyPath('preprod', 'approval', 0)).toThrow(code('INVALID_INDEX'));
    expect(() => parseMidnightKeyPath("m/1854'/2400'/1'/0'/0'")).toThrow(code('INVALID_INDEX'));
    expect(() => formatMidnightKeyPath('preprod', 'approval', MAX_KEY_INDEX + 1)).toThrow(code('INVALID_INDEX'));
    expect(() => parseMidnightKeyPath(`m/1854'/2400'/1'/0'/${MAX_KEY_INDEX + 1}'`)).toThrow(code('INVALID_INDEX'));
    expect(formatMidnightKeyPath('preprod', 'approval', MAX_KEY_INDEX)).toBe(`m/1854'/2400'/1'/0'/${MAX_KEY_INDEX}'`);
    expect(() => formatMidnightKeyPath('preprod', 'approval', 1.5)).toThrow(code('INVALID_INDEX'));
  });

  it('refuses any other notation: soft levels, another purpose or coin, leading zeros, spaces', () => {
    for (const bad of [
      "m/1854'/2400'/1'/0'/1",
      "m/1854'/2400'/1'/0/1'",
      "m/1854'/1815'/1'/0'/1'",
      "m/44'/2400'/1'/0'/1'",
      "m/1854'/2400'/01'/0'/1'",
      "m/1854'/2400'/1'/0'/1'/0'",
      " m/1854'/2400'/1'/0'/1'",
      "m/1854h/2400h/1h/0h/1h",
    ]) {
      expect(() => parseMidnightKeyPath(bad)).toThrow(code('INVALID_PATH'));
    }
  });

  it('refuses an unknown network or role name', () => {
    expect(() => formatMidnightKeyPath('testnet' as MidnightNetwork, 'approval', 1)).toThrow(code('INVALID_NETWORK'));
    expect(() => formatMidnightKeyPath('preprod', 'owner' as MidnightKeyRole, 1)).toThrow(code('INVALID_ROLE'));
  });
});

describe('derive: own keys from the BIP-39 seed', () => {
  it('matches @scure/bip32 at the same path', () => {
    const expected = HDKey.fromMasterSeed(SEED).derive("m/1854'/2400'/2'/3'/42'").privateKey as Uint8Array;
    expect(toHex(midnightChildKey(SEED, 'preview', 'delegate', 42))).toBe(toHex(expected));
  });

  it('gives different keys for each network, role and index', () => {
    const seen = new Set<string>();
    for (const network of ['mainnet', 'preprod', 'preview'] as MidnightNetwork[]) {
      for (const role of ['approval', 'upgrade', 'guardian', 'delegate'] as MidnightKeyRole[]) {
        for (const index of [1, 2]) seen.add(toHex(midnightChildKey(SEED, network, role, index)));
      }
    }
    expect(seen.size).toBe(24);
  });

  it('gives an owner its approval and upgrade keys at the same index', () => {
    const owner = deriveOwnerKeys(SEED, 'preprod', 5);
    expect(owner.index).toBe(5);
    expect(owner.network).toBe('preprod');
    expect(deriveOwnerKeys(SEED, 'preprod', 5)).toEqual(owner);
    expect(deriveOwnerKeys(SEED, 'preprod', 6).approval.publicKey).not.toEqual(owner.approval.publicKey);
  });

  it('wipes the upgrade secret and the guardian salt', () => {
    const owner = deriveOwnerKeys(SEED, 'preprod', 1);
    wipeOwnerKeys(owner);
    expect(owner.upgrade.secretKey.every(b => b === 0)).toBe(true);
    const guardian = deriveGuardianKeys(SEED, 'preprod', 2);
    wipeGuardianKeys(guardian);
    expect(guardian.salt.every(b => b === 0)).toBe(true);
    expect(deriveDelegateKeys(SEED, 'preprod', 3).key.publicKey).toBeDefined();
  });

  it('refuses a seed that is not 64 bytes, and bad levels', () => {
    expect(() => midnightChildKey(SEED.subarray(0, 32), 'preprod', 'approval', 1)).toThrow(code('INVALID_SEED'));
    expect(() => deriveOwnerKeys('seed' as unknown as Uint8Array, 'preprod', 1)).toThrow(code('INVALID_SEED'));
    expect(() => deriveOwnerKeys(SEED, 'preprod', 0)).toThrow(code('INVALID_INDEX'));
    expect(() => deriveGuardianKeys(SEED, 'devnet' as MidnightNetwork, 1)).toThrow(code('INVALID_NETWORK'));
  });
});
