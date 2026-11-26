// Signing with this wallet's vault key in software: the key is the one at this wallet's own vault
// index and must be the vault's. Hardware, PassKey and Google wallets do not sign here yet. The
// background flow around it (password, sheet, wipe) is in signBundleFlow.spec.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { Ed25519PublicKey, Ed25519PublicKeyHex, Ed25519Signature, Ed25519SignatureHex, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { WalletType } from '@/models/types';
import { signWithRootKey, signerSupport } from './signer';
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

  it('says which wallets sign here', () => {
    expect(signerSupport(softwareWallet)).toBe('software');
    expect(signerSupport({ type: WalletType.Ledger })).toBe('hardware');
    expect(signerSupport({ type: WalletType.Trezor })).toBe('hardware');
    expect(signerSupport({ type: WalletType.Keystone })).toBe('hardware');
    expect(signerSupport({ type: WalletType.Normal, encryptionMethod: 'prf' })).toBe('passkey');
    expect(signerSupport({ type: WalletType.Normal, prfEncryptedPrivateKey: 'x', webAuthnCredentialId: 'y', encryptedPrivateKey: 'z' })).toBe('passkey');
    expect(signerSupport({ type: WalletType.Google, encryptionMethod: 'mpc' })).toBe('none');
    expect(signerSupport({ type: WalletType.Watch })).toBe('none');
    expect(signerSupport(null)).toBe('none');
  });
});
