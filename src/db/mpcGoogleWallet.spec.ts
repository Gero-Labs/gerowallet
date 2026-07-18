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
import { createMpcGoogleWallet, getAllWallets, findMpcGoogleWallet, getDb } from '@/db/gero-db';
import { WalletType } from '@/models/types';

describe('createMpcGoogleWallet', () => {
  it('stores an mpc/Google record with sub, xpub, and encrypted device share', async () => {
    const id = await createMpcGoogleWallet({
      name: 'W', icon: 'i', theme: 't', chain: 'cardano', network: 'mainnet',
      userId: 'google-sub-1', publicKey: 'xpub-1', encryptedDeviceShare: 'enc-blob',
      webAuthnCredentialId: 'cred-1', mpcPrfSaltId: 'salt-1',
    });
    expect(typeof id).toBe('number');

    const wallets = await getAllWallets();
    const rec = wallets[id];
    expect(rec.type).toBe(WalletType.Google);
    expect(rec.encryptionMethod).toBe('mpc');
    expect(rec.userId).toBe('google-sub-1');
    expect(rec.publicKey).toBe('xpub-1');
    expect(rec.mpcDeviceShare).toBe('enc-blob');
    expect(rec.webAuthnCredentialId).toBe('cred-1');
    expect(rec.mpcPrfSaltId).toBe('salt-1');
  });
});

describe('findMpcGoogleWallet', () => {
  const base = {
    name: 'W', icon: 'i', theme: 't', chain: 'cardano',
    publicKey: 'xpub', encryptedDeviceShare: 'enc',
  };

  it('scopes the match to chain+network so one Google account can hold a wallet per network', async () => {
    await createMpcGoogleWallet({ ...base, network: 'mainnet', userId: 'sub-x' });

    // Same account, DIFFERENT network → no existing wallet, so create must be allowed.
    expect(await findMpcGoogleWallet('sub-x', 'cardano', 'preprod')).toBeNull();

    // Same account, SAME network → found (still blocks a same-network duplicate).
    const mainnet = await findMpcGoogleWallet('sub-x', 'cardano', 'mainnet');
    expect(mainnet?.userId).toBe('sub-x');
    expect(mainnet?.network).toBe('mainnet');

    // Once the preprod wallet exists too, each network resolves to its own record.
    await createMpcGoogleWallet({ ...base, network: 'preprod', userId: 'sub-x' });
    expect((await findMpcGoogleWallet('sub-x', 'cardano', 'preprod'))?.network).toBe('preprod');
    expect((await findMpcGoogleWallet('sub-x', 'cardano', 'mainnet'))?.network).toBe('mainnet');
  });

  it('does not match a different account', async () => {
    await createMpcGoogleWallet({ ...base, network: 'mainnet', userId: 'sub-a' });
    expect(await findMpcGoogleWallet('sub-b', 'cardano', 'mainnet')).toBeNull();
  });

  it('does not match a non-mpc wallet on the same account+network', async () => {
    // A non-MPC Google record sharing the same sub/chain/network must be ignored:
    // the guard only offers "log in instead" for an actual MPC Google wallet.
    const db = await getDb();
    await db['wallets'].add({
      name: 'legacy', icon: 'i', type: WalletType.Google, theme: 't', order: 1,
      chain: 'cardano', network: 'mainnet', userId: 'sub-legacy',
      encryptionMethod: 'password',
    });
    expect(await findMpcGoogleWallet('sub-legacy', 'cardano', 'mainnet')).toBeNull();
  });
});
