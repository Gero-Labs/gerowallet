import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as bip39 from 'bip39';
import { Blockchain } from '@/models/types';
import { SecretPurpose, decrypt, decryptKeyBlob, decryptPrivateKey, encryptWithPassword, isRawEncryptedKey } from './crypto';
import { encryptSecret } from './passwordSecret';
import { isGpw2, openGpw2 } from './secretEnvelope';
import { setEnvelopeV2EnabledForTest } from './envelopeV2Flag';
import { sealKeySecret, sealTextSecret } from './secretWriters';
import { rootKeyFromMnemonic } from './rootKeyFromMnemonic';
import { resolvePrivateKey } from './resolver';
import { prepareSpendingPasswordRotation } from './passwordRotation';
import { SECRET_FORMAT_FIXTURES as F } from './__fixtures__/secretFormats';

afterEach(() => setEnvelopeV2EnabledForTest(null));

describe('secretWriters', () => {
  it('flag off: keeps the current formats (gpw1 text, raw PBKDF2 hex keys)', async () => {
    setEnvelopeV2EnabledForTest(false);
    const text = await sealTextSecret(F.mnemonic, F.pw, SecretPurpose.Mnemonic);
    const key = await sealKeySecret(Buffer.from(F.cardanoRootKeyHex, 'hex'), F.pw, SecretPurpose.RootKey);
    expect(text.startsWith('gpw1.')).toBe(true);
    expect(isRawEncryptedKey(key)).toBe(true);
    expect(decrypt(text, F.pw, SecretPurpose.Mnemonic)).toBe(F.mnemonic);
    expect(decryptPrivateKey(key, F.pw).toString('hex')).toBe(F.cardanoRootKeyHex);
  });

  it('flag on: seals purpose-bound gpw2 that the matching reader opens', async () => {
    setEnvelopeV2EnabledForTest(true);
    const text = await sealTextSecret('2fa', F.pw, SecretPurpose.SecurityData);
    const cold = await sealKeySecret(Buffer.from(F.coldKey.hex, 'hex'), F.pw, SecretPurpose.ColdKey);
    expect(isGpw2(text) && isGpw2(cold)).toBe(true);
    expect(decrypt(text, F.pw, SecretPurpose.SecurityData)).toBe('2fa');
    expect(decryptKeyBlob(cold, F.pw, SecretPurpose.ColdKey).toString('hex')).toBe(F.coldKey.hex);
    expect(() => openGpw2(cold, F.pw, SecretPurpose.StrikeKey)).toThrow(/purpose mismatch/);
  });
});

describe('rootKeyFromMnemonic (mirrors createWallet)', () => {
  it('Cardano and Apex: the Icarus root key the SDK derives', () => {
    const sdk = Buffer.from(resolvePrivateKey(F.mnemonic).bytes()).toString('hex');
    expect(Buffer.from(rootKeyFromMnemonic(Blockchain.CARDANO, F.mnemonic)).toString('hex')).toBe(sdk);
    expect(Buffer.from(rootKeyFromMnemonic(Blockchain.APEX_PRIME, F.mnemonic)).toString('hex')).toBe(sdk);
    expect(sdk).toBe(F.cardanoRootKeyHex);
  });

  it('Bitcoin: the BIP-32 master private key', () => {
    expect(Buffer.from(rootKeyFromMnemonic(Blockchain.BITCOIN, F.mnemonic)).toString('hex')).toBe(F.btcRootKeyHex);
  });

  it('Midnight: the 64-byte BIP-39 seed', () => {
    expect(Buffer.from(rootKeyFromMnemonic(Blockchain.MIDNIGHT, F.mnemonic)))
      .toEqual(Buffer.from(bip39.mnemonicToSeedSync(F.mnemonic)));
  });
});

describe('prepareSpendingPasswordRotation', () => {
  const NEW = 'a-brand-new-password';

  async function seedConfig(walletId: number, entries: Record<string, unknown>) {
    const { getDb } = await import('@/db/wallet-db');
    const db = (await getDb(walletId))!;
    for (const [key, value] of Object.entries(entries)) await db.table('config').put({ key, value });
    return db;
  }

  it('rotates a Bitcoin root key (a Cardano Bip32 wrapper used to reject 32-byte keys)', async () => {
    setEnvelopeV2EnabledForTest(false);
    const r = await prepareSpendingPasswordRotation(
      { id: 7001, encryptedPrivateKey: F.btcRootKey.legacyNested, encryptedMnemonic: F.mnemonicBlob.legacy },
      F.pw,
      NEW,
    );
    expect(decryptPrivateKey(r.encryptedPrivateKey, NEW).toString('hex')).toBe(F.btcRootKeyHex);
    expect(decrypt(r.encryptedMnemonic!, NEW, SecretPurpose.Mnemonic)).toBe(F.mnemonic);
  });

  it('rotates a Midnight seed', async () => {
    const seedHex = Buffer.from(bip39.mnemonicToSeedSync(F.mnemonic)).toString('hex');
    const r = await prepareSpendingPasswordRotation({ id: 7002, encryptedPrivateKey: encryptWithPassword(F.pw, seedHex) }, F.pw, NEW);
    expect(decryptPrivateKey(r.encryptedPrivateKey, NEW).toString('hex')).toBe(seedHex);
    expect(r.encryptedMnemonic).toBeNull();
  });

  it('throws on a wrong current password before writing anything', async () => {
    const db = await seedConfig(7003, { encryptedTotpSecret: encryptSecret('TOTP', F.pw) });
    await expect(prepareSpendingPasswordRotation({ id: 7003, encryptedPrivateKey: F.rootKey.rawHex }, 'wrong', NEW)).rejects.toThrow();
    expect(decrypt((await db.table('config').get('encryptedTotpSecret')).value, F.pw, SecretPurpose.SecurityData)).toBe('TOTP');
  });

  it('moves 2FA data and the password cold key to the new password; leaves a PassKey cold key and stale values alone', async () => {
    const stale = encryptSecret('OLD', 'some-older-password');
    const db = await seedConfig(7004, {
      encryptedTotpSecret: F.securityData.legacy,
      encryptedBackupCodes: [encryptSecret('c1', F.pw), encryptSecret('c2', F.pw)],
      encryptedPinHash: stale,
      spo_encryptedColdKey: F.coldKey.rawHex,
      spo_coldKeyEncryption: 'password',
    });
    const r = await prepareSpendingPasswordRotation({ id: 7004, encryptedPrivateKey: F.rootKey.legacyNested }, F.pw, NEW);
    // Nothing is written until the caller commits.
    expect((await db.table('config').get('encryptedTotpSecret')).value).toBe(F.securityData.legacy);
    await r.commitSecondary();

    const get = async (key: string) => (await db.table('config').get(key)).value;
    expect(decrypt(await get('encryptedTotpSecret'), NEW, SecretPurpose.SecurityData)).toBe('JBSWY3DPEHPK3PXP');
    expect((await get('encryptedBackupCodes') as string[]).map(c => decrypt(c, NEW, SecretPurpose.SecurityData))).toEqual(['c1', 'c2']);
    expect(decryptKeyBlob(await get('spo_encryptedColdKey'), NEW, SecretPurpose.ColdKey).toString('hex')).toBe(F.coldKey.hex);
    expect(await get('encryptedPinHash')).toBe(stale);

    const prfDb = await seedConfig(7005, { spo_encryptedColdKey: 'prf-blob', spo_coldKeyEncryption: 'prf' });
    await (await prepareSpendingPasswordRotation({ id: 7005, encryptedPrivateKey: F.rootKey.rawHex }, F.pw, NEW)).commitSecondary();
    expect((await prfDb.table('config').get('spo_encryptedColdKey')).value).toBe('prf-blob');
  });

  it('with the flag on, every rotated secret is gpw2', async () => {
    setEnvelopeV2EnabledForTest(true);
    const db = await seedConfig(7006, { encryptedTotpSecret: F.securityData.gpw1 });
    const r = await prepareSpendingPasswordRotation({ id: 7006, encryptedPrivateKey: F.rootKey.rawHex, encryptedMnemonic: F.mnemonicBlob.gpw1 }, F.pw, NEW);
    await r.commitSecondary();
    expect(isGpw2(r.encryptedPrivateKey) && isGpw2(r.encryptedMnemonic)).toBe(true);
    expect(isGpw2((await db.table('config').get('encryptedTotpSecret')).value)).toBe(true);
  });
});
