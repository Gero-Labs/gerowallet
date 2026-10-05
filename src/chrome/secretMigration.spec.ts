import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as bip39 from 'bip39';
import { Blockchain } from '@/models/types';
import { SecretPurpose, decrypt, decryptKeyBlob, decryptPrivateKey, encryptWithPassword } from '@/shared/utils/crypto';
import { encryptSecret } from '@/shared/utils/passwordSecret';
import { isGpw2 } from '@/shared/utils/secretEnvelope';
import { setEnvelopeV2EnabledForTest } from '@/shared/utils/envelopeV2Flag';
import { SECRET_FORMAT_FIXTURES as F } from '@/shared/utils/__fixtures__/secretFormats';
import {
  createDexieSecretStore,
  migrateWalletSecrets,
  type ConfigRow,
  type SecretMigrationStore,
  type WalletSecretRow,
} from './secretMigration';

const PW = F.pw;
const TOTP = 'JBSWY3DPEHPK3PXP';

/** In-memory store with real compare-and-swap semantics plus fault hooks. */
class MemoryStore implements SecretMigrationStore {
  wallets = new Map<number, WalletSecretRow>();
  config = new Map<number, ConfigRow[]>();
  casWalletCalls = 0;
  /** Runs inside casWallet before the comparison: simulates a concurrent writer. */
  beforeCasWallet?: () => void;
  failCasWallet = false;
  failCasConfig = false;
  /** Returned instead of the real row on the post-write read-back. */
  tamperReadBack?: Partial<WalletSecretRow>;
  private written = false;

  async getWallet(id: number) {
    const row = this.wallets.get(id);
    if (row && this.written && this.tamperReadBack) return { ...row, ...this.tamperReadBack };
    return row ? { ...row } : undefined;
  }

  async casWallet(id: number, expected: Partial<WalletSecretRow>, next: Partial<WalletSecretRow>) {
    this.casWalletCalls++;
    this.beforeCasWallet?.();
    if (this.failCasWallet) throw new Error('QuotaExceededError');
    const row = this.wallets.get(id);
    if (!row) return false;
    for (const [k, v] of Object.entries(expected)) if (row[k as keyof WalletSecretRow] !== v) return false;
    this.wallets.set(id, { ...row, ...next });
    this.written = true;
    return true;
  }

  async getConfig(id: number, keys: readonly string[]) {
    return (this.config.get(id) ?? []).filter(r => keys.includes(r.key)).map(r => ({ ...r }));
  }

  async casConfig(id: number, updates: Array<{ key: string; expected: unknown; next: unknown }>) {
    if (this.failCasConfig) throw new Error('QuotaExceededError');
    const rows = this.config.get(id) ?? [];
    for (const u of updates) {
      const row = rows.find(r => r.key === u.key);
      if (!row || JSON.stringify(row.value) !== JSON.stringify(u.expected)) return false;
    }
    for (const u of updates) rows.find(r => r.key === u.key)!.value = u.next;
    return true;
  }
}

function legacyCardanoStore(): MemoryStore {
  const store = new MemoryStore();
  store.wallets.set(1, {
    id: 1,
    chain: Blockchain.CARDANO,
    encryptedPrivateKey: F.rootKey.legacyNested,
    encryptedMnemonic: F.mnemonicBlob.legacy,
  });
  store.config.set(1, [
    { key: 'encryptedTotpSecret', value: F.securityData.legacy },
    { key: 'encryptedBackupCodes', value: [encryptSecret('code-1', PW), encryptSecret('code-2', PW)] },
    { key: 'spo_encryptedColdKey', value: F.coldKey.rawHex },
    { key: 'spo_coldKeyEncryption', value: 'password' },
    { key: 'unrelated', value: 'x' },
  ]);
  return store;
}

function configValue(store: MemoryStore, key: string): unknown {
  return store.config.get(1)!.find(r => r.key === key)!.value;
}

beforeEach(() => setEnvelopeV2EnabledForTest(true));
afterEach(() => setEnvelopeV2EnabledForTest(null));

describe('migrateWalletSecrets', () => {
  it('does nothing while the kill switch is off', async () => {
    setEnvelopeV2EnabledForTest(false);
    const store = legacyCardanoStore();
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('disabled');
    expect(store.wallets.get(1)!.encryptedPrivateKey).toBe(F.rootKey.legacyNested);
    expect(store.casWalletCalls).toBe(0);
  });

  it('upgrades every password secret of a legacy Cardano wallet to gpw2 without changing any key', async () => {
    const store = legacyCardanoStore();
    const result = await migrateWalletSecrets(1, PW, store);
    expect(result.outcome).toBe('migrated');

    const row = store.wallets.get(1)!;
    expect(isGpw2(row.encryptedPrivateKey)).toBe(true);
    expect(isGpw2(row.encryptedMnemonic)).toBe(true);
    expect(result.encryptedPrivateKey).toBe(row.encryptedPrivateKey);
    expect(result.encryptedMnemonic).toBe(row.encryptedMnemonic);
    expect(decryptPrivateKey(row.encryptedPrivateKey!, PW).toString('hex')).toBe(F.cardanoRootKeyHex);
    expect(decrypt(row.encryptedMnemonic!, PW, SecretPurpose.Mnemonic)).toBe(F.mnemonic);

    const totp = configValue(store, 'encryptedTotpSecret') as string;
    const codes = configValue(store, 'encryptedBackupCodes') as string[];
    const cold = configValue(store, 'spo_encryptedColdKey') as string;
    expect(isGpw2(totp) && codes.every(isGpw2) && isGpw2(cold)).toBe(true);
    expect(decrypt(totp, PW, SecretPurpose.SecurityData)).toBe(TOTP);
    expect(codes.map(c => decrypt(c, PW, SecretPurpose.SecurityData))).toEqual(['code-1', 'code-2']);
    expect(decryptKeyBlob(cold, PW, SecretPurpose.ColdKey).toString('hex')).toBe(F.coldKey.hex);
    expect(configValue(store, 'unrelated')).toBe('x');
  });

  it('is idempotent: a second run is a no-op', async () => {
    const store = legacyCardanoStore();
    await migrateWalletSecrets(1, PW, store);
    const snapshot = JSON.stringify([...store.wallets.values(), ...store.config.values()]);
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('already-current');
    expect(JSON.stringify([...store.wallets.values(), ...store.config.values()])).toBe(snapshot);
  });

  it('migrates Bitcoin and Midnight root keys (equivalence per chain)', async () => {
    const store = new MemoryStore();
    store.wallets.set(2, { id: 2, chain: Blockchain.BITCOIN, encryptedPrivateKey: F.btcRootKey.legacyNested, encryptedMnemonic: F.mnemonicBlob.gpw1 });
    const seedHex = Buffer.from(bip39.mnemonicToSeedSync(F.mnemonic)).toString('hex');
    store.wallets.set(3, { id: 3, chain: Blockchain.MIDNIGHT, encryptedPrivateKey: encryptWithPassword(PW, seedHex), encryptedMnemonic: F.mnemonicBlob.gpw1 });

    expect((await migrateWalletSecrets(2, PW, store)).outcome).toBe('migrated');
    expect((await migrateWalletSecrets(3, PW, store)).outcome).toBe('migrated');
    expect(decryptPrivateKey(store.wallets.get(2)!.encryptedPrivateKey!, PW).toString('hex')).toBe(F.btcRootKeyHex);
    expect(decryptPrivateKey(store.wallets.get(3)!.encryptedPrivateKey!, PW).toString('hex')).toBe(seedHex);
  });

  it('writes nothing on a wrong password', async () => {
    const store = legacyCardanoStore();
    expect((await migrateWalletSecrets(1, 'wrong', store)).outcome).toBe('decrypt_fail');
    expect(store.wallets.get(1)!.encryptedPrivateKey).toBe(F.rootKey.legacyNested);
    expect(configValue(store, 'encryptedTotpSecret')).toBe(F.securityData.legacy);
  });

  it('writes nothing when the root key and mnemonic do not belong together', async () => {
    const store = legacyCardanoStore();
    const other = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';
    store.wallets.get(1)!.encryptedMnemonic = encryptSecret(other, PW);
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('equivalence_fail');
    expect(store.wallets.get(1)!.encryptedPrivateKey).toBe(F.rootKey.legacyNested);
    expect(store.casWalletCalls).toBe(0);
  });

  it('never overwrites a concurrent password change (compare-and-swap)', async () => {
    const store = legacyCardanoStore();
    const newPasswordBlob = encryptWithPassword('new-password', F.cardanoRootKeyHex);
    store.beforeCasWallet = () => { store.wallets.get(1)!.encryptedPrivateKey = newPasswordBlob; };
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('cas_conflict');
    const row = store.wallets.get(1)!;
    expect(row.encryptedPrivateKey).toBe(newPasswordBlob);
    expect(decryptPrivateKey(row.encryptedPrivateKey!, 'new-password').toString('hex')).toBe(F.cardanoRootKeyHex);
  });

  it('leaves a config secret that does not open with this password untouched', async () => {
    const store = legacyCardanoStore();
    const stale = encryptSecret(TOTP, 'an-older-password');
    store.config.get(1)!.find(r => r.key === 'encryptedTotpSecret')!.value = stale;
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('migrated');
    expect(configValue(store, 'encryptedTotpSecret')).toBe(stale);
    expect(isGpw2(configValue(store, 'spo_encryptedColdKey'))).toBe(true);
  });

  it('does not touch a PassKey-encrypted SPO cold key', async () => {
    const store = legacyCardanoStore();
    store.config.get(1)!.find(r => r.key === 'spo_coldKeyEncryption')!.value = 'prf';
    await migrateWalletSecrets(1, PW, store);
    expect(configValue(store, 'spo_encryptedColdKey')).toBe(F.coldKey.rawHex);
  });

  it('a failed write (quota) leaves every blob as it was', async () => {
    const store = legacyCardanoStore();
    store.failCasWallet = true;
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('write_error');
    expect(store.wallets.get(1)!.encryptedPrivateKey).toBe(F.rootKey.legacyNested);
    expect(configValue(store, 'encryptedTotpSecret')).toBe(F.securityData.legacy);
  });

  it('an interruption between the two databases leaves a usable wallet, and the next run finishes', async () => {
    const store = legacyCardanoStore();
    store.failCasConfig = true;
    const interrupted = await migrateWalletSecrets(1, PW, store);
    expect(interrupted.outcome).toBe('write_error');
    // The wallets row was written and read back, so its new blobs are handed to the caller.
    expect(interrupted.encryptedPrivateKey).toBe(store.wallets.get(1)!.encryptedPrivateKey);
    expect(isGpw2(interrupted.encryptedPrivateKey)).toBe(true);
    // Wallets row upgraded, config still legacy: every reader still opens everything.
    expect(decryptPrivateKey(store.wallets.get(1)!.encryptedPrivateKey!, PW).toString('hex')).toBe(F.cardanoRootKeyHex);
    expect(decrypt(configValue(store, 'encryptedTotpSecret') as string, PW, SecretPurpose.SecurityData)).toBe(TOTP);

    store.failCasConfig = false;
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('migrated');
    expect(isGpw2(configValue(store, 'encryptedTotpSecret'))).toBe(true);
  });

  it('serializes concurrent unlocks into one migration', async () => {
    const store = legacyCardanoStore();
    const results = await Promise.all([1, 2, 3].map(() => migrateWalletSecrets(1, PW, store)));
    expect(results.map(r => r.outcome).sort()).toEqual(['already-current', 'already-current', 'migrated']);
    expect(store.casWalletCalls).toBe(1);
  });

  it('a config conflict after the wallets row is written returns only read-back-verified blobs', async () => {
    const store = legacyCardanoStore();
    const original = store.casConfig.bind(store);
    store.casConfig = async (id, updates) => {
      store.config.get(1)!.find(r => r.key === 'encryptedTotpSecret')!.value = 'changed-meanwhile';
      return original(id, updates);
    };
    const result = await migrateWalletSecrets(1, PW, store);
    expect(result.outcome).toBe('cas_conflict');
    expect(result.encryptedPrivateKey).toBe(store.wallets.get(1)!.encryptedPrivateKey);
    expect(decryptPrivateKey(result.encryptedPrivateKey!, PW).toString('hex')).toBe(F.cardanoRootKeyHex);
    expect(configValue(store, 'encryptedTotpSecret')).toBe('changed-meanwhile');
  });

  it('hands no blobs to the caller when the wallets row fails its read-back', async () => {
    const store = legacyCardanoStore();
    store.tamperReadBack = { encryptedPrivateKey: F.rootKey.rawHex };
    const result = await migrateWalletSecrets(1, PW, store);
    expect(result.outcome).toBe('readback_fail');
    expect(result.encryptedPrivateKey).toBeUndefined();
  });

  it('reports a read-back mismatch', async () => {
    const store = legacyCardanoStore();
    store.tamperReadBack = { encryptedPrivateKey: F.rootKey.rawHex };
    expect((await migrateWalletSecrets(1, PW, store)).outcome).toBe('readback_fail');
  });

  it('skips PassKey, MPC and key-less wallets', async () => {
    const store = new MemoryStore();
    store.wallets.set(4, { id: 4, encryptionMethod: 'prf', encryptedPrivateKey: F.rootKey.rawHex });
    store.wallets.set(5, { id: 5, encryptionMethod: 'mpc', encryptedPrivateKey: F.rootKey.rawHex });
    store.wallets.set(6, { id: 6 });
    for (const id of [4, 5, 6]) expect((await migrateWalletSecrets(id, PW, store)).outcome).toBe('not-applicable');
    expect(store.casWalletCalls).toBe(0);
  });
});

describe('createDexieSecretStore (IndexedDB compare-and-swap)', () => {
  it('writes when the expected blobs match and refuses when they do not', async () => {
    const { getDb } = await import('@/db/gero-db');
    const db = await getDb();
    const id = (await db.table('wallets').add({ name: 'fixture', encryptedPrivateKey: 'aa', encryptedMnemonic: 'bb' })) as number;
    const store = createDexieSecretStore();

    expect(await store.casWallet(id, { encryptedPrivateKey: 'stale' }, { encryptedPrivateKey: 'cc' })).toBe(false);
    expect((await store.getWallet(id))?.encryptedPrivateKey).toBe('aa');
    expect(await store.casWallet(id, { encryptedPrivateKey: 'aa', encryptedMnemonic: 'bb' }, { encryptedPrivateKey: 'cc' })).toBe(true);
    expect((await store.getWallet(id))?.encryptedPrivateKey).toBe('cc');
    expect((await store.getWallet(id))?.encryptedMnemonic).toBe('bb');
  });

  it('config compare-and-swap (rows keyed by key) is all-or-nothing', async () => {
    const { getDb } = await import('@/db/wallet-db');
    const db = (await getDb(9001))!;
    await db.table('config').put({ key: 'encryptedTotpSecret', value: 'old-a' });
    await db.table('config').put({ key: 'encryptedBackupCodes', value: ['old-b'] });
    const store = createDexieSecretStore();

    const rows = await store.getConfig(9001, ['encryptedTotpSecret', 'encryptedBackupCodes']);
    expect(rows.map(r => r.key).sort()).toEqual(['encryptedBackupCodes', 'encryptedTotpSecret']);

    expect(await store.casConfig(9001, [
      { key: 'encryptedTotpSecret', expected: 'old-a', next: 'new-a' },
      { key: 'encryptedBackupCodes', expected: ['changed-meanwhile'], next: ['new-b'] },
    ])).toBe(false);
    expect((await db.table('config').get('encryptedTotpSecret')).value).toBe('old-a');

    expect(await store.casConfig(9001, [
      { key: 'encryptedTotpSecret', expected: 'old-a', next: 'new-a' },
      { key: 'encryptedBackupCodes', expected: ['old-b'], next: ['new-b'] },
    ])).toBe(true);
    expect((await db.table('config').get('encryptedTotpSecret')).value).toBe('new-a');
    expect((await db.table('config').get('encryptedBackupCodes')).value).toEqual(['new-b']);
  });
});
