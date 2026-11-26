import { describe, expect, it } from 'vitest';
import { Bip32PrivateKey, Ed25519KeyHashHex, ready } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import {
  deriveParticipantKeyHashes,
  deriveSharedRoleKeys,
  deriveVaultKey,
  encodeSharedRoleKeys,
  encodeVaultKeyHash,
  multisigAccountPublicKey,
  parseSharedRoleKeys,
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

describe('CIP-1854 role keys against published vectors', () => {
  it('reproduces the CIP-1854 user-facing encoding example', async () => {
    const keys = parseSharedRoleKeys({
      payment: CIP1854_ENCODING_EXAMPLE.bech32,
      // Any other valid stake key; only the payment slot is under test here.
      stake: encodeSharedRoleKeys(await deriveSharedRoleKeys(await publishedAccountKey())).stake,
    });
    expect(keys.payment.hex).toBe(CIP1854_ENCODING_EXAMPLE.base16);
    expect(encodeSharedRoleKeys(keys).payment).toBe(CIP1854_ENCODING_EXAMPLE.bech32);
  });

  it("the published root derives the published account key at m/1854'/1815'/0'", async () => {
    await ready();
    const root = Bip32PrivateKey.fromBytes(bech32Bytes(CARDANO_ADDRESSES.rootXsk));
    expect((await accountKeyOfRoot(root)).hex).toBe((await publishedAccountKey()).hex);
  });

  it('derives the cardano-addresses keys at 0/0, 0/1, 0/2 and 2/0 from the role keys', async () => {
    const role = await deriveSharedRoleKeys(await publishedAccountKey());
    for (const [path, vk] of Object.entries(CARDANO_ADDRESSES.vk)) {
      const [r, y] = path.split('/').map(Number);
      const key = await deriveVaultKey(r === 0 ? role.payment : role.stake, y);
      expect(encode(r === 0 ? 'addr_shared_vk' : 'stake_shared_vk', key.publicKey)).toBe(vk);
    }
  });

  it('derives the cardano-addresses key hashes at 0/1..0/4 and 2/0', async () => {
    const role = await deriveSharedRoleKeys(await publishedAccountKey());
    for (const [path, vkh] of Object.entries(CARDANO_ADDRESSES.vkh)) {
      const [r, y] = path.split('/').map(Number);
      const key = await deriveVaultKey(r === 0 ? role.payment : role.stake, y);
      expect(key.keyHash).toBe(bech32Hex(vkh));
      expect(encodeVaultKeyHash(key.role, key.keyHash)).toBe(vkh);
    }
  });

  it('a key derived from a role key keeps the published chain code (extended keys at 0/1 and 0/2)', async () => {
    await ready();
    const account = Bip32PrivateKey.fromBytes(bech32Bytes(CARDANO_ADDRESSES.acctXsk)).toPublic();
    const role = await deriveSharedRoleKeys(await publishedAccountKey());
    for (const [path, xvk] of Object.entries(CARDANO_ADDRESSES.xvk)) {
      const y = Number(path.split('/')[1]);
      expect(encode('addr_shared_xvk', account.derive([0, y]).hex())).toBe(xvk);
      expect(role.payment.hex).toBe(account.derive([0]).hex());
    }
  });

  it('participant key hashes are the role 0 and role 2 keys at the same index', async () => {
    const role = await deriveSharedRoleKeys(await publishedAccountKey());
    const at0 = await deriveParticipantKeyHashes(role, 0);
    expect(at0.stake).toBe(bech32Hex(CARDANO_ADDRESSES.vkh['2/0']));
    const at1 = await deriveParticipantKeyHashes(role, 1);
    expect(at1.payment).toBe(bech32Hex(CARDANO_ADDRESSES.vkh['0/1']));
  });
});

describe('sharing role keys, never the account key', () => {
  it('round-trips the shared role keys through their bech32 form', async () => {
    const shared = await deriveSharedRoleKeys(await testCosignerAccount(7));
    const encoded = encodeSharedRoleKeys(shared);
    expect(encoded.payment.startsWith('addr_shared_xvk1')).toBe(true);
    expect(encoded.stake.startsWith('stake_shared_xvk1')).toBe(true);
    expect(parseSharedRoleKeys(encoded)).toEqual(shared);
  });

  it('refuses an account key offered as a shared key', async () => {
    const account = await publishedAccountKey();
    const acct = encode('acct_shared_xvk', account.hex);
    const shared = encodeSharedRoleKeys(await deriveSharedRoleKeys(account));
    expect(codeOf(() => parseSharedRoleKeys({ payment: acct, stake: shared.stake }))).toBe('ACCOUNT_KEY_NOT_SHAREABLE');
    expect(codeOf(() => parseSharedRoleKeys({ payment: shared.payment, stake: acct }))).toBe('ACCOUNT_KEY_NOT_SHAREABLE');
    expect(codeOf(() => parseSharedRoleKeys({ payment: encode('acct_xvk', account.hex), stake: shared.stake })))
      .toBe('ACCOUNT_KEY_NOT_SHAREABLE');
  });

  it('refuses to encode an account key as if it were a role key', async () => {
    const account = await publishedAccountKey();
    // @ts-expect-error: the account key is not a SharedRoleKeys, and the types say so.
    expect(codeOf(() => encodeSharedRoleKeys(account))).toBe('INVALID_ROLE_KEY');
    // @ts-expect-error: an account key cannot be passed where a role key is expected.
    expect(codeOf(() => encodeSharedRoleKeys({ payment: account, stake: account }))).toBe('INVALID_ROLE_KEY');
  });

  it('refuses role keys in the wrong slots, of the wrong length or with the wrong prefix', async () => {
    const shared = encodeSharedRoleKeys(await deriveSharedRoleKeys(await testCosignerAccount(8)));
    expect(codeOf(() => parseSharedRoleKeys({ payment: shared.stake, stake: shared.payment }))).toBe('INVALID_ROLE_KEY');
    expect(codeOf(() => parseSharedRoleKeys({ payment: encode('addr_shared_xvk', '00'.repeat(32)), stake: shared.stake })))
      .toBe('INVALID_ROLE_KEY');
    expect(codeOf(() => parseSharedRoleKeys({ payment: 'not bech32', stake: shared.stake }))).toBe('INVALID_ROLE_KEY');
    const samePayment = encode('stake_shared_xvk', Buffer.from(bech32Bytes(shared.payment)).toString('hex'));
    expect(codeOf(() => parseSharedRoleKeys({ payment: shared.payment, stake: samePayment }))).toBe('INVALID_ROLE_KEY');
  });

  it('accepts the account key as hex or acct_shared_xvk, and refuses a CIP-1852 account key', async () => {
    const account = await publishedAccountKey();
    expect(multisigAccountPublicKey(encode('acct_shared_xvk', account.hex)).hex).toBe(account.hex);
    expect(multisigAccountPublicKey(account.hex.toUpperCase()).hex).toBe(account.hex);
    expect(codeOf(() => multisigAccountPublicKey(encode('acct_xvk', account.hex)))).toBe('INVALID_ACCOUNT_KEY');
    expect(codeOf(() => multisigAccountPublicKey('00'))).toBe('INVALID_ACCOUNT_KEY');
  });

  it('refuses to derive role keys from a role key, or vault keys from an account key', async () => {
    const account = await publishedAccountKey();
    const shared = await deriveSharedRoleKeys(account);
    // @ts-expect-error: role keys come from the account key only.
    await expect(deriveSharedRoleKeys(shared.payment)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_KEY' });
    // @ts-expect-error: vault keys come from a role key only.
    await expect(deriveVaultKey(account, 0)).rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
    await expect(deriveVaultKey(shared.payment, -1)).rejects.toMatchObject({ code: 'INVALID_INDEX' });
    await expect(deriveVaultKey(shared.payment, 2 ** 31)).rejects.toMatchObject({ code: 'INVALID_INDEX' });
  });

  it('encodes key hashes for display only for vault roles', () => {
    const hash = Ed25519KeyHashHex(bech32Hex(CARDANO_ADDRESSES.vkh['0/1']));
    expect(encodeVaultKeyHash(ROLE.PAYMENT, hash)).toBe(CARDANO_ADDRESSES.vkh['0/1']);
    // @ts-expect-error: role 1 is unused for multisig keys.
    expect(codeOf(() => encodeVaultKeyHash(1, hash))).toBe('INVALID_ROLE');
  });
});
