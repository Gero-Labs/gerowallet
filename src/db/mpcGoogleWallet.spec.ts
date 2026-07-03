// Exercises createMpcGoogleWallet against a real (in-memory) IndexedDB via
// fake-indexeddb, rather than mocking '@/db/gero-db': createMpcGoogleWallet,
// getDb, and getLatestWalletByOrder all live in the same module, so a
// vi.mock('@/db/gero-db', ...) cannot intercept those same-file calls — the
// internal getDb() call still resolves to the real Dexie/indexedDB binding
// regardless of what the mock factory returns. Running against a real
// (fake) IndexedDB exercises the actual Dexie schema/insert path and is a
// more faithful test of the persisted record than a same-module mock could
// be; the assertion set (fields written) matches the plan's intent.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createMpcGoogleWallet, getAllWallets } from '@/db/gero-db';
import { WalletType } from '@/models/types';

describe('createMpcGoogleWallet', () => {
  it('stores an mpc/Google record with sub, xpub, and encrypted device share', async () => {
    const id = await createMpcGoogleWallet({
      name: 'W', icon: 'i', theme: 't', chain: 'cardano', network: 'mainnet',
      userId: 'google-sub-1', publicKey: 'xpub-1', encryptedDeviceShare: 'enc-blob',
    });
    expect(typeof id).toBe('number');

    const wallets = await getAllWallets();
    const rec = wallets[id];
    expect(rec.type).toBe(WalletType.Google);
    expect(rec.encryptionMethod).toBe('mpc');
    expect(rec.userId).toBe('google-sub-1');
    expect(rec.publicKey).toBe('xpub-1');
    expect(rec.mpcDeviceShare).toBe('enc-blob');
  });
});
