import { describe, expect, it } from 'vitest';
import { Bip32PrivateKey, Ed25519KeyHashHex, ready } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import {
  deriveParticipantKeyHashes,
  deriveRoleKeys,
  deriveVaultKey,
  deriveVaultPublicKeys,
  encodeVaultKeyHash,
  encodeVaultPublicKeys,
  multisigAccountPublicKey,
  parseExternalCosignerKeys,
  parseVaultPublicKeys,
  vaultKeyHashes,
} from './keys';
import { ROLE } from './types';
import { GeroVaultError } from './errors';
import {
  CARDANO_ADDRESSES,
  CIP1854_ENCODING_EXAMPLE,
  accountKeyOfRoot,
  bech32Bytes,
  bech32Hex,
  publishedAccountKey,
  testCosignerAccount,
} from './__fixtures__/vectors';

const encode = (prefix: string, hex: string) => bech32.encode(prefix, bech32.toWords(Buffer.from(hex, 'hex')), 1023);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof GeroVaultError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('CIP-1854 keys against published vectors', () => {
  it('reads the CIP-1854 user-facing encoding example as an external role key', async () => {
    const role = await deriveRoleKeys(await publishedAccountKey());
    const keys = await parseExternalCosignerKeys({
      payment: CIP1854_ENCODING_EXAMPLE.bech32,
      stake: encode('stake_shared_xvk', role.stake.hex),
    });
    expect(keys.payment.hex).toBe(CIP1854_ENCODING_EXAMPLE.base16);
  });

  it("the published root derives the published account key at m/1854'/1815'/0'", async () => {
    await ready();
    const root = Bip32PrivateKey.fromBytes(bech32Bytes(CARDANO_ADDRESSES.rootXsk));
    expect((await accountKeyOfRoot(root)).hex).toBe((await publishedAccountKey()).hex);
  });

  it('derives the cardano-addresses keys at 0/0, 0/1, 0/2 and 2/0 from the role keys', async () => {
    const role = await deriveRoleKeys(await publishedAccountKey());
    for (const [path, vk] of Object.entries(CARDANO_ADDRESSES.vk)) {
      const [r, y] = path.split('/').map(Number);
      const key = await deriveVaultKey(r === 0 ? role.payment : role.stake, y);
      expect(encode(r === 0 ? 'addr_shared_vk' : 'stake_shared_vk', key.publicKey)).toBe(vk);
    }
  });

  it('derives the cardano-addresses key hashes at 0/1..0/4 and 2/0', async () => {
    const role = await deriveRoleKeys(await publishedAccountKey());
    for (const [path, vkh] of Object.entries(CARDANO_ADDRESSES.vkh)) {
      const [r, y] = path.split('/').map(Number);
      const key = await deriveVaultKey(r === 0 ? role.payment : role.stake, y);
      expect(key.keyHash).toBe(bech32Hex(vkh));
      expect(encodeVaultKeyHash(key.role, key.keyHash)).toBe(vkh);
    }
  });

  it('role keys keep the published chain code (extended keys at 0/1 and 0/2)', async () => {
    await ready();
    const account = Bip32PrivateKey.fromBytes(bech32Bytes(CARDANO_ADDRESSES.acctXsk)).toPublic();
    const role = await deriveRoleKeys(await publishedAccountKey());
    expect(role.payment.hex).toBe(account.derive([0]).hex());
    for (const [path, xvk] of Object.entries(CARDANO_ADDRESSES.xvk)) {
      const y = Number(path.split('/')[1]);
      expect(encode('addr_shared_xvk', account.derive([0, y]).hex())).toBe(xvk);
    }
  });

  it("a vault's public keys are the published keys and hash to the published hashes", async () => {
    const role = await deriveRoleKeys(await publishedAccountKey());
    const at0 = await deriveVaultPublicKeys(role, 0);
    expect(encodeVaultPublicKeys(at0)).toEqual({ payment: CARDANO_ADDRESSES.vk['0/0'], stake: CARDANO_ADDRESSES.vk['2/0'] });
    expect((await vaultKeyHashes(at0)).stake).toBe(bech32Hex(CARDANO_ADDRESSES.vkh['2/0']));
    expect((await deriveParticipantKeyHashes(role, 1)).payment).toBe(bech32Hex(CARDANO_ADDRESSES.vkh['0/1']));
  });
});

describe('what Gero cosigners exchange: a vault keys, never an extended key', () => {
  it('round-trips the vault keys; the shared form carries no chain code and no index', async () => {
    const keys = await deriveVaultPublicKeys(await deriveRoleKeys(await testCosignerAccount(7)), 4);
    const shared = encodeVaultPublicKeys(keys);
    expect(Object.keys(shared).sort()).toEqual(['payment', 'stake']);
    expect(shared.payment.startsWith('addr_shared_vk1')).toBe(true);
    expect(shared.stake.startsWith('stake_shared_vk1')).toBe(true);
    expect(bech32Bytes(shared.payment)).toHaveLength(32);
    expect(parseVaultPublicKeys(shared)).toEqual(keys);
  });

  it('refuses an extended key of any level where vault keys belong', async () => {
    const account = await publishedAccountKey();
    const role = await deriveRoleKeys(account);
    const keys = encodeVaultPublicKeys(await deriveVaultPublicKeys(role, 1));
    for (const extended of [
      encode('acct_shared_xvk', account.hex),
      encode('addr_shared_xvk', role.payment.hex),
      encode('acct_xvk', account.hex),
    ]) {
      expect(codeOf(() => parseVaultPublicKeys({ payment: extended, stake: keys.stake }))).toBe('EXTENDED_KEY_NOT_ACCEPTED');
    }
    expect(codeOf(() => parseVaultPublicKeys({ payment: keys.payment, stake: encode('stake_shared_xvk', role.stake.hex) })))
      .toBe('EXTENDED_KEY_NOT_ACCEPTED');
  });

  it('refuses vault keys in the wrong slots, of the wrong length, or the same key twice', async () => {
    const keys = encodeVaultPublicKeys(await deriveVaultPublicKeys(await deriveRoleKeys(await testCosignerAccount(8)), 1));
    expect(codeOf(() => parseVaultPublicKeys({ payment: keys.stake, stake: keys.payment }))).toBe('INVALID_VAULT_KEYS');
    expect(codeOf(() => parseVaultPublicKeys({ payment: encode('addr_shared_vk', '00'.repeat(31)), stake: keys.stake })))
      .toBe('INVALID_VAULT_KEYS');
    expect(codeOf(() => parseVaultPublicKeys({ payment: 'not bech32', stake: keys.stake }))).toBe('INVALID_VAULT_KEYS');
    const samePayment = encode('stake_shared_vk', Buffer.from(bech32Bytes(keys.payment)).toString('hex'));
    expect(codeOf(() => parseVaultPublicKeys({ payment: keys.payment, stake: samePayment }))).toBe('INVALID_VAULT_KEYS');
  });

  it('the types keep extended keys out of the shared form', async () => {
    const account = await publishedAccountKey();
    const role = await deriveRoleKeys(account);
    // @ts-expect-error: an account key is not a vault's public keys.
    expect(codeOf(() => encodeVaultPublicKeys(account))).toBe('INVALID_VAULT_KEYS');
    // @ts-expect-error: role keys are not a vault's public keys either.
    expect(codeOf(() => encodeVaultPublicKeys(role))).toBe('INVALID_VAULT_KEYS');
  });
});

describe('extended keys as input from an external wallet', () => {
  it('accepts an account key or the two role keys, and derives the same vault keys locally', async () => {
    const account = await testCosignerAccount(9);
    const role = await deriveRoleKeys(account);
    const fromAccount = await parseExternalCosignerKeys({ account: encode('acct_shared_xvk', account.hex) });
    const fromRoles = await parseExternalCosignerKeys({
      payment: encode('addr_shared_xvk', role.payment.hex),
      stake: encode('stake_shared_xvk', role.stake.hex),
    });
    expect(fromAccount).toEqual(role);
    expect(fromRoles).toEqual(role);
    expect(await deriveVaultPublicKeys(fromRoles, 3)).toEqual(await deriveVaultPublicKeys(role, 3));
  });

  it('refuses a CIP-1852 account key, keys in the wrong slots and the same key twice', async () => {
    const account = await publishedAccountKey();
    const role = await deriveRoleKeys(account);
    await expect(parseExternalCosignerKeys({ account: encode('acct_xvk', account.hex) })).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_KEY' });
    await expect(parseExternalCosignerKeys({ payment: encode('stake_shared_xvk', role.stake.hex), stake: encode('stake_shared_xvk', role.stake.hex) }))
      .rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
    await expect(parseExternalCosignerKeys({ payment: encode('addr_shared_xvk', role.payment.hex), stake: encode('stake_shared_xvk', role.payment.hex) }))
      .rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
    await expect(parseExternalCosignerKeys({ payment: 'x', stake: 'y' })).rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
  });

  it('accepts the account key as hex or acct_shared_xvk', async () => {
    const account = await publishedAccountKey();
    expect(multisigAccountPublicKey(encode('acct_shared_xvk', account.hex)).hex).toBe(account.hex);
    expect(multisigAccountPublicKey(account.hex.toUpperCase()).hex).toBe(account.hex);
    expect(codeOf(() => multisigAccountPublicKey('00'))).toBe('INVALID_ACCOUNT_KEY');
  });

  it('refuses to derive role keys from a role key, or vault keys from an account key', async () => {
    const account = await publishedAccountKey();
    const role = await deriveRoleKeys(account);
    // @ts-expect-error: role keys come from the account key only.
    await expect(deriveRoleKeys(role.payment)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_KEY' });
    // @ts-expect-error: vault keys come from a role key only.
    await expect(deriveVaultKey(account, 0)).rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
    await expect(deriveVaultKey(role.payment, -1)).rejects.toMatchObject({ code: 'INVALID_INDEX' });
    await expect(deriveVaultKey(role.payment, 2 ** 31)).rejects.toMatchObject({ code: 'INVALID_INDEX' });
  });

  it('encodes key hashes for display only for vault roles', () => {
    const hash = Ed25519KeyHashHex(bech32Hex(CARDANO_ADDRESSES.vkh['0/1']));
    expect(encodeVaultKeyHash(ROLE.PAYMENT, hash)).toBe(CARDANO_ADDRESSES.vkh['0/1']);
    // @ts-expect-error: role 1 is unused for multisig keys.
    expect(codeOf(() => encodeVaultKeyHash(1, hash))).toBe('INVALID_ROLE');
  });
});
