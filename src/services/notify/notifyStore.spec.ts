import { describe, it, expect } from 'vitest';
import { createNotifyStore, memoryNotifyStorage, DEFAULT_DEVICE_STATE, type NotifyStorage, type NotifyWalletState } from './notifyStore';

const wallet = (tag: string): NotifyWalletState => ({
  walletTag: tag, eventKey: '11'.repeat(16), network: 'cardano-preprod', stakeAddress: 'stake_test1abc',
  paymentCreds: ['aa'.repeat(28)], credsHash: 'h', registeredAt: null, prefs: null, servedCategories: [], needsProof: false,
});

describe('notifyStore', () => {
  it('returns defaults for an empty store and merges device patches', async () => {
    const s = createNotifyStore(memoryNotifyStorage());
    expect(await s.getDevice()).toEqual(DEFAULT_DEVICE_STATE);
    await s.updateDevice({ browserEnabled: true, clockOffsetMs: 250 });
    expect(await s.getDevice()).toMatchObject({ browserEnabled: true, clockOffsetMs: 250, targetStatus: 'none' });
  });

  it('keeps wallets keyed by walletId and removes one without touching the others', async () => {
    const s = createNotifyStore(memoryNotifyStorage());
    await s.setWallet(4, wallet('a'.repeat(32)));
    await s.setWallet(7, wallet('b'.repeat(32)));
    expect((await s.getWallet(4))?.walletTag).toBe('a'.repeat(32));
    await s.removeWallet(4);
    expect(await s.getWallet(4)).toBeNull();
    expect(Object.keys(await s.getWallets())).toEqual(['7']);
  });

  it('the pending-delete queue is durable and deduplicated', async () => {
    const storage = memoryNotifyStorage();
    const s = createNotifyStore(storage);
    await s.enqueueDelete({ kind: 'wallet', walletTag: 't1', enqueuedAt: 1 });
    await s.enqueueDelete({ kind: 'wallet', walletTag: 't1', enqueuedAt: 2 });
    await s.enqueueDelete({ kind: 'device', enqueuedAt: 3 });
    expect(await s.getPendingDeletes()).toHaveLength(2);
    // A "restarted worker" reads the same storage.
    const again = createNotifyStore(memoryNotifyStorage(storage.dump()));
    expect(await again.getPendingDeletes()).toEqual([{ kind: 'wallet', walletTag: 't1', enqueuedAt: 1 }, { kind: 'device', enqueuedAt: 3 }]);
  });

  it('ignores corrupt values and survives a storage that throws', async () => {
    const broken: NotifyStorage = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); }, remove: async () => { throw new Error('quota'); } };
    const logs: string[] = [];
    const s = createNotifyStore(broken, (m) => logs.push(m));
    expect(await s.getDevice()).toEqual(DEFAULT_DEVICE_STATE);
    expect(await s.getWallets()).toEqual({});
    await expect(s.updateDevice({ browserEnabled: true })).resolves.toMatchObject({ browserEnabled: true });
    expect(logs.length).toBeGreaterThan(0);
    const corrupt = createNotifyStore(memoryNotifyStorage({ notifyDevice: 'nope', notifyWallets: [1, 2], notifyPendingDeletes: 'x', notifyRetry: { dueAt: 'soon' } }));
    expect(await corrupt.getDevice()).toEqual(DEFAULT_DEVICE_STATE);
    expect(await corrupt.getWallets()).toEqual({});
    expect(await corrupt.getPendingDeletes()).toEqual([]);
    expect(await corrupt.getRetry()).toBeNull();
  });

  it('intro state is complete from nothing, merges patches and keeps earlier "offered" wallets', async () => {
    const s = createNotifyStore(memoryNotifyStorage());
    expect(await s.getIntro()).toEqual({ systemShownAt: null, dismissedAt: null, offered: {} });
    await s.updateIntro({ systemShownAt: 10 });
    await s.updateIntro({ offered: { '4': 20 } });
    expect(await s.updateIntro({ offered: { '5': 30 }, dismissedAt: 40 })).toEqual({ systemShownAt: 10, dismissedAt: 40, offered: { '4': 20, '5': 30 } });
    const corrupt = createNotifyStore(memoryNotifyStorage({ notifyIntro: 'x' }));
    expect(await corrupt.getIntro()).toEqual({ systemShownAt: null, dismissedAt: null, offered: {} });
  });

  it('config cache and retry round-trip, and null clears them', async () => {
    const s = createNotifyStore(memoryNotifyStorage());
    const config = { protocol: 1, protocols: [1], minClientProtocol: 1, enabled: true, vapidPublicKey: 'k', vapidKid: 'v1', categories: [], securityCategories: [], networks: [], servedCategories: {}, limits: { walletsPerDevice: 20, devicesPerWallet: 50, paymentCredsPerLink: 200, paymentCredsPerWallet: 200 }, serverTime: 1 };
    await s.setConfigCache({ config, fetchedAt: 5 });
    expect((await s.getConfigCache())?.fetchedAt).toBe(5);
    await s.setConfigCache(null);
    expect(await s.getConfigCache()).toBeNull();
    await s.setRetry({ dueAt: 10, attempt: 1, reason: 'nonce_store_unavailable' });
    expect(await s.getRetry()).toEqual({ dueAt: 10, attempt: 1, reason: 'nonce_store_unavailable' });
    await s.setRetry(null);
    expect(await s.getRetry()).toBeNull();
  });
});

describe('inbox (the bell, B-M3)', () => {
  const item = (e: string, ts: number, over: Partial<import('./notifyStore').NotifyInboxItem> = {}): import('./notifyStore').NotifyInboxItem => ({
    e, t: 'funds', c: 'funds', d: 'activity', walletId: 4, walletName: 'Daily', title: 'Funds Received', body: 'You received funds', ts, readAt: null, needsYou: false, ...over,
  });

  it('keeps rows newest first, replaces a repeated e, and caps at INBOX_MAX', async () => {
    const { INBOX_MAX } = await import('./notifyStore');
    const s = createNotifyStore(memoryNotifyStorage());
    await s.addInbox(item('a'.repeat(32), 1));
    await s.addInbox(item('b'.repeat(32), 2));
    expect((await s.getInbox()).map((i) => i.e[0])).toEqual(['b', 'a']);
    await s.addInbox(item('a'.repeat(32), 3, { readAt: null }));
    expect((await s.getInbox()).map((i) => [i.e[0], i.ts])).toEqual([['a', 3], ['b', 2]]);
    for (let n = 0; n < INBOX_MAX + 5; n++) await s.addInbox(item(n.toString(16).padStart(32, '0'), 10 + n));
    expect(await s.getInbox()).toHaveLength(INBOX_MAX);
  });

  it('marks one row or every row read, and clear empties it', async () => {
    const s = createNotifyStore(memoryNotifyStorage());
    await s.addInbox(item('a'.repeat(32), 1));
    await s.addInbox(item('b'.repeat(32), 2));
    await s.markInboxRead('a'.repeat(32), 100);
    expect((await s.getInbox()).map((i) => i.readAt)).toEqual([null, 100]);
    await s.markInboxRead(null, 200);
    expect((await s.getInbox()).map((i) => i.readAt)).toEqual([200, 100]);
    await s.clearInbox();
    expect(await s.getInbox()).toEqual([]);
  });

  it('ignores a malformed stored value', async () => {
    const s = createNotifyStore(memoryNotifyStorage({ notifyInbox: [{ nope: 1 }] }));
    expect(await s.getInbox()).toEqual([]);
  });
});
