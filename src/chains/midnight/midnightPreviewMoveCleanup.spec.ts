// The login half of the move to Preview (issue 1453): a moved wallet drops what
// Stagenet left on this device before it starts, so it syncs Preview from empty.
// Real (in-memory) IndexedDB for the wallet databases; the stores and the SDK
// checkpoint database are observed through their entry points.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { bech32m } from 'bech32';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  forgetWallet: vi.fn(),
  deleteStoreCacheScope: vi.fn(async (_scope: string) => undefined),
  clearCheckpoints: vi.fn(async (_network: string) => undefined),
}));
vi.mock('@/stores/midnightStore', () => ({ midnightActions: { forgetWallet: calls.forgetWallet } }));
vi.mock('@/utils/storeCache', () => ({ deleteStoreCacheScope: calls.deleteStoreCacheScope }));
vi.mock('./midnightSyncGeneration', () => ({ clearMidnightNetworkCheckpoints: calls.clearCheckpoints }));

import { applyPendingPreviewMove } from './midnightPreviewMoveCleanup';
import { PREVIEW_MOVE_NOTICE_CONFIG_KEY } from './midnightPreviewMove';
import { walletDBSchema, walletDBVersion } from '@/db/schema';
import { Blockchain, Network } from '@/models/types';

const words = (fill: number) => bech32m.toWords(Buffer.alloc(32, fill));
const encode = (prefix: string, fill: number) => bech32m.encode(prefix, words(fill), 1023);
const OLD_ADDRESS = encode('mn_addr_stagenet', 1);

let geroDb: Dexie;
let nextId = 100;

function walletDb(id: number): Dexie {
  const db = new Dexie(`wallet-${id}`);
  db.version(walletDBVersion).stores(walletDBSchema);
  return db;
}

async function seedWallet(record: Record<string, unknown>, tables: { contacts?: object[]; dapps?: object[]; config?: object[] } = {}): Promise<number> {
  const id = nextId++;
  await geroDb.table('wallets').add({ id, name: `w${id}`, ...record });
  const db = walletDb(id);
  await db.open();
  if (tables.contacts) await db.table('contacts').bulkAdd(tables.contacts);
  if (tables.dapps) await db.table('connected_dapps').bulkAdd(tables.dapps);
  if (tables.config) await db.table('config').bulkAdd(tables.config);
  db.close();
  return id;
}

async function readWallet(id: number) {
  const db = walletDb(id);
  try {
    return {
      contacts: await db.table('contacts').toArray(),
      dapps: await db.table('connected_dapps').toArray(),
      notice: (await db.table('config').get(PREVIEW_MOVE_NOTICE_CONFIG_KEY))?.value,
      currency: (await db.table('config').get('currency'))?.value,
    };
  } finally {
    db.close();
  }
}

const moved = (extra: Record<string, unknown> = {}) => ({
  chain: Blockchain.MIDNIGHT, network: Network.PREVIEW, publicKey: '{}', previewMovePending: { stagenetUnshielded: OLD_ADDRESS }, ...extra,
});

beforeEach(async () => {
  calls.forgetWallet.mockReset();
  calls.deleteStoreCacheScope.mockReset().mockResolvedValue(undefined);
  calls.clearCheckpoints.mockReset().mockResolvedValue(undefined);
  geroDb = new Dexie(`gero-preview-move-${nextId}`);
  geroDb.version(1).stores({ wallets: '++id, chain, network' });
  await geroDb.open();
});

describe('applyPendingPreviewMove', () => {
  it('drops the old chain\'s state, clears connected sites, moves contacts and raises the notice, once', async () => {
    const contacts = [
      { address: encode('mn_addr_stagenet', 2), name: 'Alice' },
      { address: encode('mn_shield-addr_stagenet', 3), name: 'Bob (private)' },
      { address: encode('mn_addr_stagenet', 4), name: 'Carol on Stagenet' },
      { address: encode('mn_addr_preview', 4), name: 'Carol on Preview' },
      { address: encode('mn_addr', 5), name: 'Dave on mainnet' },
    ];
    const id = await seedWallet(moved(), {
      contacts,
      dapps: [{ domain: 'https://dapp.example', time: 1 }],
      config: [{ key: 'currency', value: 'usd' }],
    });

    expect(await applyPendingPreviewMove(geroDb, id)).toBe(true);

    expect(calls.forgetWallet).toHaveBeenCalledWith(OLD_ADDRESS);
    expect(calls.deleteStoreCacheScope).toHaveBeenCalledWith(OLD_ADDRESS);
    expect(calls.clearCheckpoints.mock.calls.map(([network]) => network).sort()).toEqual(['midnight-preview', 'midnight-stagenet']);

    const after = await readWallet(id);
    expect(after.dapps).toEqual([]);
    expect(after.notice).toBe(true);
    expect(after.currency).toBe('usd');
    expect(after.contacts.map((c: { address: string; name: string }) => [c.address, c.name]).sort()).toEqual([
      [encode('mn_addr', 5), 'Dave on mainnet'],
      [encode('mn_addr_preview', 2), 'Alice'],
      [encode('mn_addr_preview', 4), 'Carol on Preview'],
      [encode('mn_shield-addr_preview', 3), 'Bob (private)'],
    ].sort());
    expect('previewMovePending' in await geroDb.table('wallets').get(id)).toBe(false);

    // Consumed: the next login changes nothing, and a dismissed notice stays dismissed.
    const db = walletDb(id);
    await db.table('config').put({ key: PREVIEW_MOVE_NOTICE_CONFIG_KEY, value: false });
    await db.table('connected_dapps').add({ domain: 'https://preview-dapp.example', time: 2 });
    db.close();
    calls.forgetWallet.mockClear();
    calls.clearCheckpoints.mockClear();
    expect(await applyPendingPreviewMove(geroDb, id)).toBe(false);
    expect(calls.forgetWallet).not.toHaveBeenCalled();
    expect(calls.clearCheckpoints).not.toHaveBeenCalled();
    expect((await readWallet(id)).notice).toBe(false);
    expect((await readWallet(id)).dapps).toHaveLength(1);
  });

  it('keeps the stamp when the old state cannot be cleared, so the next login tries again', async () => {
    const id = await seedWallet(moved());
    calls.clearCheckpoints.mockRejectedValueOnce(new Error('Cannot clear Midnight checkpoints'));
    await expect(applyPendingPreviewMove(geroDb, id)).rejects.toThrow('Cannot clear Midnight checkpoints');
    expect((await geroDb.table('wallets').get(id)).previewMovePending).toEqual({ stagenetUnshielded: OLD_ADDRESS });
    expect(await applyPendingPreviewMove(geroDb, id)).toBe(true);
    expect('previewMovePending' in await geroDb.table('wallets').get(id)).toBe(false);
  });

  it('skips the address-scoped caches of a record whose Stagenet address was unreadable', async () => {
    const id = await seedWallet(moved({ previewMovePending: { stagenetUnshielded: '' } }));
    expect(await applyPendingPreviewMove(geroDb, id)).toBe(true);
    expect(calls.forgetWallet).not.toHaveBeenCalled();
    expect(calls.deleteStoreCacheScope).not.toHaveBeenCalled();
    expect(calls.clearCheckpoints).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a wallet that was not moved, or that is not a Midnight wallet', async () => {
    const preview = await seedWallet({ chain: Blockchain.MIDNIGHT, network: Network.PREVIEW, publicKey: '{}' }, { dapps: [{ domain: 'https://a.example', time: 1 }] });
    const cardano = await seedWallet({ chain: Blockchain.CARDANO, network: Network.PREVIEW, publicKey: 'xpub1', previewMovePending: { stagenetUnshielded: OLD_ADDRESS } }, { dapps: [{ domain: 'https://b.example', time: 1 }] });
    for (const id of [preview, cardano, 9999]) expect(await applyPendingPreviewMove(geroDb, id)).toBe(false);
    expect(calls.forgetWallet).not.toHaveBeenCalled();
    expect(calls.deleteStoreCacheScope).not.toHaveBeenCalled();
    expect(calls.clearCheckpoints).not.toHaveBeenCalled();
    expect((await readWallet(preview)).dapps).toHaveLength(1);
    expect((await readWallet(cardano)).dapps).toHaveLength(1);
    expect((await readWallet(cardano)).notice).toBeUndefined();
  });

  it('runs at login before the wallet starts, never failing the login', () => {
    // Read from the source: the login path is too large to drive here.
    const src = readFileSync(join(__dirname, '../../services/walletManager.service.ts'), 'utf8');
    const loginPaths = src.split('await this.recheckBackup(wallet.id);\n        await this.completePreviewMove(wallet.id);');
    expect(loginPaths).toHaveLength(3); // both login paths
    const body = src.slice(src.indexOf('private async completePreviewMove'), src.indexOf('Login with a wallet'));
    expect(body).toContain('applyPendingPreviewMove(await getDb(), walletId)');
    expect(body).toMatch(/catch \(error\)/);
  });
});
