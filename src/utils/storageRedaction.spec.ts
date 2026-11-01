import { describe, it, expect } from 'vitest';
import {
  SECRET_CONFIG_KEYS,
  WALLET_RECORD_SECRET_FIELDS,
  redactWalletConfig,
  redactWalletRecord,
  redactWalletRecords,
} from './storageRedaction';
import { CONFIG_SECRET_FIELDS } from '@/shared/utils/walletSecretFields';
import { GROUP_SECRET_FIELDS } from '@/shared/utils/walletAccount';
import { PRIVATE_CONFIG_KEYS } from '@/db/loaders/walletLoader';
import { SUBMIT_API_AUTH_CONFIG_KEY } from '@/shared/utils/submitApiConfig';

const record = {
  id: 3,
  name: 'Main',
  chain: 'Cardano',
  publicKey: 'xpub1',
  encryptionMethod: 'prf',
  webAuthnCredentialId: 'cred',
  encryptedPrivateKey: 'k',
  encryptedMnemonic: 'm',
  prfEncryptedPrivateKey: 'pk',
  prfEncryptedMnemonic: 'pm',
  prfSpendingPassword: 'hash',
  mpcDeviceShare: 's',
  mpcDeviceShareNext: 'sn',
};

describe('storage redaction', () => {
  it('takes every encrypted secret and secret hash off a wallet record and keeps the rest', () => {
    const redacted = redactWalletRecord(record);
    WALLET_RECORD_SECRET_FIELDS.forEach((field) => expect(redacted).not.toHaveProperty(field));
    expect(redacted).toEqual({ id: 3, name: 'Main', chain: 'Cardano', publicKey: 'xpub1', encryptionMethod: 'prf', webAuthnCredentialId: 'cred' });
    // The store keeps its own copy.
    expect(record.encryptedPrivateKey).toBe('k');
  });

  it('returns a record without secrets unchanged, and passes null through', () => {
    const plain = { id: 1, name: 'Watch' };
    expect(redactWalletRecord(plain)).toBe(plain);
    expect(redactWalletRecord(null)).toBeNull();
  });

  it('redacts every record of a wallet map', () => {
    const out = redactWalletRecords({ 3: record, 4: { ...record, id: 4 } });
    expect(JSON.stringify(out)).not.toMatch(/"(k|m|pk|pm|hash|s|sn)"/);
    expect(Object.keys(out)).toEqual(['3', '4']);
  });

  it('takes the secret config rows off a config map', () => {
    const config = Object.fromEntries([...SECRET_CONFIG_KEYS, SUBMIT_API_AUTH_CONFIG_KEY, 'currency'].map((k) => [k, `v-${k}`]));
    expect(redactWalletConfig(config)).toEqual({ currency: 'v-currency' });
  });

  it('covers every password-encrypted config secret (walletSecretFields.ts)', () => {
    CONFIG_SECRET_FIELDS.forEach(({ key }) => expect(SECRET_CONFIG_KEYS).toContain(key));
  });

  it('keeps every secret config row out of walletStore (ConfigLoader)', () => {
    SECRET_CONFIG_KEYS.forEach((key) => expect(PRIVATE_CONFIG_KEYS.has(key)).toBe(true));
  });

  it('redacts every encrypted group secret', () => {
    // GROUP_SECRET_FIELDS also lists identifiers the pages need (encryptionMethod,
    // webAuthnCredentialId, …); the encrypted ones must all be in the redaction list.
    const encrypted = GROUP_SECRET_FIELDS.filter((f) => /encrypted|Encrypted|Share|SpendingPassword/.test(f));
    expect(encrypted.length).toBeGreaterThan(0);
    encrypted.forEach((field) => expect(WALLET_RECORD_SECRET_FIELDS).toContain(field));
  });
});
