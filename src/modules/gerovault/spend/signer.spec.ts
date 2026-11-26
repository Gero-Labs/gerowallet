// Signing with this wallet's vault key in software: the password goes through the background
// check first, the key is the one at this wallet's own vault index and must be the vault's, and
// the opened root key is overwritten afterwards. Hardware, PassKey and Google wallets do not sign here yet.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Ed25519PublicKey, Ed25519PublicKeyHex, Ed25519Signature, Ed25519SignatureHex, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { WalletType } from '@/models/types';
import { signWithRootKey, signWithSpendingPassword, signerSupport } from './signer';
import { testOwner, type TestOwner } from './__fixtures__/testVault';

const TX_ID = '5a'.repeat(32);
const softwareWallet = { type: WalletType.Normal, encryptionMethod: 'password' as const, encryptedPrivateKey: 'sealed' };

let owner: TestOwner;

beforeAll(async () => {
  owner = await testOwner(4);
});

describe('vault signer', () => {
  it('signs the transaction id with the payment key at this wallet\'s vault index', async () => {
    const witness = await signWithRootKey(owner.rootKey, 4, owner.credential, TX_ID);
    expect(witness.vkey).toBe(owner.keys.payment);
    await ready();
    expect(Ed25519PublicKey.fromHex(Ed25519PublicKeyHex(witness.vkey)).verify(Ed25519Signature.fromHex(Ed25519SignatureHex(witness.signature)), HexBlob(TX_ID))).toBe(true);
  });

  it('refuses when the key at that index is not the vault\'s', async () => {
    await expect(signWithRootKey(owner.rootKey, 5, owner.credential, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    await expect(signWithRootKey(owner.rootKey, 4, owner.stakeKeyHash, TX_ID)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    await expect(signWithRootKey(owner.rootKey, 4, owner.credential, 'not-an-id')).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
  });

  it('checks the password with the background before opening the key, and wipes the key after', async () => {
    let opened: Uint8Array | undefined;
    const verifyPassword = vi.fn(async (password: string) => password === 'right');
    const openRootKey = vi.fn(async () => {
      opened = Uint8Array.from(owner.rootKey);
      return opened;
    });
    const input = { wallet: softwareWallet, ownIndex: 4, expectedCredential: owner.credential, txId: TX_ID };

    await expect(signWithSpendingPassword({ ...input, password: 'wrong' }, { verifyPassword, openRootKey })).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect(openRootKey).not.toHaveBeenCalled();

    const witness = await signWithSpendingPassword({ ...input, password: 'right' }, { verifyPassword, openRootKey });
    expect(witness.vkey).toBe(owner.keys.payment);
    expect(openRootKey).toHaveBeenCalledWith('sealed', 'right');
    expect(opened?.every(byte => byte === 0)).toBe(true);

    await expect(signWithSpendingPassword({ ...input, ownIndex: 7, password: 'right' }, { verifyPassword, openRootKey })).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(opened?.every(byte => byte === 0)).toBe(true);
  });

  it('treats a refused or failed check as a wrong password', async () => {
    const openRootKey = vi.fn();
    const input = { wallet: softwareWallet, password: 'x', ownIndex: 4, expectedCredential: owner.credential, txId: TX_ID };
    await expect(signWithSpendingPassword(input, { verifyPassword: async () => { throw new Error('throttled'); }, openRootKey })).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    await expect(signWithSpendingPassword({ ...input, password: '' }, { verifyPassword: async () => true, openRootKey })).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect(openRootKey).not.toHaveBeenCalled();
  });

  it('says which wallets sign here, and refuses the others', async () => {
    expect(signerSupport(softwareWallet)).toBe('software');
    expect(signerSupport({ type: WalletType.Ledger })).toBe('hardware');
    expect(signerSupport({ type: WalletType.Trezor })).toBe('hardware');
    expect(signerSupport({ type: WalletType.Keystone })).toBe('hardware');
    expect(signerSupport({ type: WalletType.Normal, encryptionMethod: 'prf' })).toBe('passkey');
    expect(signerSupport({ type: WalletType.Normal, prfEncryptedPrivateKey: 'x', webAuthnCredentialId: 'y', encryptedPrivateKey: 'z' })).toBe('passkey');
    expect(signerSupport({ type: WalletType.Google, encryptionMethod: 'mpc' })).toBe('none');
    expect(signerSupport({ type: WalletType.Watch })).toBe('none');
    expect(signerSupport(null)).toBe('none');
    const verifyPassword = vi.fn(async () => true);
    await expect(signWithSpendingPassword(
      { wallet: { type: WalletType.Ledger }, password: 'x', ownIndex: 4, expectedCredential: owner.credential, txId: TX_ID },
      { verifyPassword, openRootKey: vi.fn() },
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_WALLET' });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});
