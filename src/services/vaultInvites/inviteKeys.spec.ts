// This wallet's vault key for an invitation, opened in the background from test entropy: the right
// key at the right index, a verified CIP-8 attestation, the root key wiped, and every wrong
// credential refused. Never a real wallet.
import { beforeAll, describe, expect, it } from 'vitest';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { accountXpub, cardanoAccountPath } from '@/shared/utils/walletAccount';
import { deriveRoleKeys, deriveVaultPublicKeys, multisigAccountPublicKey, verifyAttestation } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { openVaultKey, type VaultKeyDeps } from './inviteKeys';

const HARDENED = 0x80000000;
let rootBytes: Uint8Array;
let accountZero: string;

beforeAll(async () => {
  await ready();
  const root = Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 1), '');
  rootBytes = Uint8Array.from(root.bytes());
  const zero = root.derive([HARDENED + 1852, HARDENED + 1815, HARDENED]).toPublic().hex();
  accountZero = accountXpub(zero.slice(0, 64), zero.slice(64), cardanoAccountPath(0)).publicKey;
});

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 7, name: 'Test', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal,
    encryptionMethod: 'password', encryptedPrivateKey: 'sealed', publicKey: accountZero, ...overrides,
  } as Wallet;
}

function deps(record: Wallet): VaultKeyDeps & { handed: Uint8Array[] } {
  const handed: Uint8Array[] = [];
  return {
    handed,
    getWallets: async () => ({ [record.id]: record }),
    sessionRootKey: () => undefined,
    decryptRootKey: (_sealed, password) => {
      if (password !== 'right') throw new Error('bad password');
      const copy = Uint8Array.from(rootBytes);
      handed.push(copy);
      return copy;
    },
  };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (error) {
    return (error as OwnAccountKeyError).code;
  }
}

describe('openVaultKey', () => {
  it('opens the vault keys at the index, attests with the payment key and wipes the root key', async () => {
    const d = deps(wallet());
    const material = await openVaultKey(7, { password: 'right' }, 3, d);
    // The fixtures' test cosigner 1 is the same entropy at m/1854'/1815'/0'.
    const account = (await testAccounts())[1];
    const expected = await deriveVaultPublicKeys(await deriveRoleKeys(multisigAccountPublicKey(account.toPublic().hex())), 3);
    expect(material).toMatchObject({ index: 3, payment: expected.payment, stake: expected.stake, accountKey: account.toPublic().hex() });
    expect(d.handed[0].every(b => b === 0)).toBe(true);

    const subject = { kind: 'invite' as const, digest: 'ab'.repeat(32), network: 'preprod' as const };
    const sig = await material.attest(subject);
    expect(await verifyAttestation(sig, material.credential, subject)).toEqual({ ok: true });
    material.wipe();
    expect(await codeOf(material.attest(subject))).toBe('locked');
  });

  it('refuses a wrong password, a hardware wallet, and PassKey bytes of another wallet', async () => {
    expect(await codeOf(openVaultKey(7, { password: 'wrong' }, 1, deps(wallet())))).toBe('wrong-password');
    expect(await codeOf(openVaultKey(7, { password: 'right' }, 1, deps(wallet({ type: WalletType.Ledger }))))).toBe('not-supported');
    const prf = wallet({ encryptionMethod: 'prf', encryptedPrivateKey: undefined, prfEncryptedPrivateKey: 'x', webAuthnCredentialId: 'c' } as Partial<Wallet>);
    const other = Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 2), '');
    expect(await codeOf(openVaultKey(7, { privateKeyBytes: Uint8Array.from(other.bytes()) }, 1, deps(prf)))).toBe('wrong-password');
    const own = await openVaultKey(7, { privateKeyBytes: Uint8Array.from(rootBytes) }, 1, deps(prf));
    expect(own.index).toBe(1);
  });

});
