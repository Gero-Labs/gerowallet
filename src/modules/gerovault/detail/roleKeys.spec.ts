// The recovery screens' role keys from the wallet itself: the CIP-1854 account public key comes
// from the background (GEROVAULT_DERIVE_ACCOUNT_KEY) or, for a PassKey wallet, from the page's
// WebAuthn path; the role keys derive from that public key alone.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveRoleKeys, multisigAccountPublicKey, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { RoleKeysError, walletRoleKeysSource, type RoleKeysWallet } from './roleKeys';

let account: MultisigAccountPublicKey;

beforeAll(async () => {
  account = multisigAccountPublicKey((await testAccounts())[1].toPublic().hex());
});

const PASSWORD_WALLET: RoleKeysWallet = { id: 5, encryptionMethod: 'password' } as RoleKeysWallet;
const GOOGLE_WALLET: RoleKeysWallet = { id: 5, encryptionMethod: 'mpc' } as RoleKeysWallet;
const PASSKEY_WALLET: RoleKeysWallet = { id: 5, encryptionMethod: 'prf', webAuthnCredentialId: 'cred', prfEncryptedPrivateKey: 'sealed' } as RoleKeysWallet;

const failure = async (work: Promise<unknown>) => work.then(() => 'none', (error: unknown) => (error instanceof RoleKeysError ? error.code : 'OTHER'));

describe('the wallet\'s own role keys', () => {
  it('asks the background with the spending password, and derives the role keys from the public key', async () => {
    const request = vi.fn(async () => account);
    const passKey = vi.fn();
    const source = walletRoleKeysSource(() => PASSWORD_WALLET, { request, passKey });

    expect(source.needsSpendingPassword).toBe(true);
    expect(await source.roleKeys({ walletId: 5, spendingPassword: 'right' })).toEqual(await deriveRoleKeys(account));
    expect(request).toHaveBeenCalledWith(5, 'right');
    expect(passKey).not.toHaveBeenCalled();
  });

  it('needs no password for a Google session, and uses the page\'s WebAuthn path for a PassKey wallet', async () => {
    const request = vi.fn(async () => account);
    const passKey = vi.fn(async () => account);
    expect(walletRoleKeysSource(() => GOOGLE_WALLET, { request, passKey }).needsSpendingPassword).toBe(false);
    const viaPassKey = walletRoleKeysSource(() => PASSKEY_WALLET, { request, passKey });
    expect(viaPassKey.needsSpendingPassword).toBe(false);
    await viaPassKey.roleKeys({ walletId: 5 });
    expect(passKey).toHaveBeenCalledWith(PASSKEY_WALLET);
    expect(request).not.toHaveBeenCalled();
  });

  it('says why the keys could not be read', async () => {
    const refusing = (code: ConstructorParameters<typeof OwnAccountKeyError>[0]) =>
      walletRoleKeysSource(() => PASSWORD_WALLET, { request: async () => { throw new OwnAccountKeyError(code); }, passKey: vi.fn() });
    expect(await failure(refusing('wrong-password').roleKeys({ walletId: 5, spendingPassword: 'wrong' }))).toBe('WRONG_PASSWORD');
    expect(await failure(refusing('locked').roleKeys({ walletId: 5 }))).toBe('LOCKED');
    expect(await failure(refusing('unavailable').roleKeys({ walletId: 5 }))).toBe('UNAVAILABLE');
    expect(await failure(refusing('not-supported').roleKeys({ walletId: 5 }))).toBe('NOT_SUPPORTED');
  });

  it('answers only for the logged-in wallet', async () => {
    const request = vi.fn(async () => account);
    expect(await failure(walletRoleKeysSource(() => PASSWORD_WALLET, { request, passKey: vi.fn() }).roleKeys({ walletId: 6 }))).toBe('NOT_SUPPORTED');
    expect(await failure(walletRoleKeysSource(() => null, { request, passKey: vi.fn() }).roleKeys({ walletId: 5 }))).toBe('NOT_SUPPORTED');
    expect(request).not.toHaveBeenCalled();
  });
});
