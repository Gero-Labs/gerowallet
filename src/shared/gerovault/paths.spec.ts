import { describe, expect, it } from 'vitest';
import { CIP1854_ACCOUNT_PATH, formatVaultKeyPath, parseVaultKeyPath, roleKeyPath, vaultKeyPath } from './paths';
import { MAX_VAULT_INDEX, ROLE } from './types';

const H = 0x80000000;

describe('CIP-1854 vault paths', () => {
  it("formats the one notation m/1854'/1815'/0'/role/y", () => {
    expect(formatVaultKeyPath(ROLE.PAYMENT, 0)).toBe("m/1854'/1815'/0'/0/0");
    expect(formatVaultKeyPath(ROLE.STAKE, 14)).toBe("m/1854'/1815'/0'/2/14");
    expect(formatVaultKeyPath(ROLE.PAYMENT, MAX_VAULT_INDEX)).toBe("m/1854'/1815'/0'/0/2147483647");
    expect(formatVaultKeyPath(ROLE.STAKE)).toBe("m/1854'/1815'/0'/2");
  });

  it('gives BIP32 index arrays for the hardware signers', () => {
    expect(CIP1854_ACCOUNT_PATH).toEqual([H + 1854, H + 1815, H]);
    expect(roleKeyPath(ROLE.STAKE)).toEqual([H + 1854, H + 1815, H, 2]);
    expect(vaultKeyPath(ROLE.PAYMENT, 1337)).toEqual([H + 1854, H + 1815, H, 0, 1337]);
  });

  it('parses exactly what it formats', () => {
    expect(parseVaultKeyPath("m/1854'/1815'/0'/2/42")).toEqual({ role: 2, index: 42 });
    for (const bad of [
      "m/1854'/1815'/0'/1/0", // role 1 is unused for multisig
      "m/1854'/1815'/1'/0/0", // CIP-0146 fixes account 0
      "m/1852'/1815'/0'/0/0",
      'm/1854H/1815H/0H/0/0', // one notation only
      "m/1854'/1815'/0'/0/01",
      "m/1854'/1815'/0'/0/2147483648",
      "m/1854'/1815'/0'/0/0'",
      "m/1854'/1815'/0'/0",
    ]) {
      expect(() => parseVaultKeyPath(bad)).toThrow(expect.objectContaining({ code: 'INVALID_PATH' }));
    }
  });

  it('refuses roles and indices outside the CIP-1854 domain', () => {
    // @ts-expect-error: role 1 is not a vault role.
    expect(() => vaultKeyPath(1, 0)).toThrow(expect.objectContaining({ code: 'INVALID_ROLE' }));
    expect(() => vaultKeyPath(ROLE.PAYMENT, -1)).toThrow(expect.objectContaining({ code: 'INVALID_INDEX' }));
    expect(() => vaultKeyPath(ROLE.PAYMENT, 1.5)).toThrow(expect.objectContaining({ code: 'INVALID_INDEX' }));
    expect(() => vaultKeyPath(ROLE.PAYMENT, MAX_VAULT_INDEX + 1)).toThrow(expect.objectContaining({ code: 'INVALID_INDEX' }));
  });
});
