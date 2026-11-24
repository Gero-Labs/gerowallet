import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Serialization } from '@cardano-sdk/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletBg } from '@/chrome/walletBg';
import { Blockchain } from '@/models/types';
import { SyncService } from './sync.service';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

const cbor = '84a3008001800200a0f5f6';
const hash = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(cbor)).id;
const original = { id: hash, tx_hash: hash, block_hash: 'block-a', absolute_slot: 10, block_height: 5, pending: false };

type CborReply = {
  tx_hash: string;
  cbor: string;
  block_hash?: string;
  block_height?: number;
  absolute_slot?: number;
  epoch_no?: number;
  tx_size?: number;
};

describe('CBOR responses arriving after chain changes', () => {
  let db: Dexie;
  let service: SyncService;
  let answer: (rows: CborReply[]) => void;
  const getTransactionsCbor = vi.fn();

  beforeEach(async () => {
    db = new Dexie('test-cardano-cbor-rollback');
    db.version(1).stores({ transactions: 'id', sync: 'id' });
    await db.table('transactions').put(original);
    getTransactionsCbor.mockReset().mockImplementation(() => new Promise(resolve => {
      answer = rows => resolve({ status: 200, data: rows });
    }));
    service = new SyncService({
      chain: Blockchain.CARDANO,
      api: { getTransactionsCbor },
      getDb: async () => db,
      getLastSyncInfo: async () => null,
      setAccountTransactions: WalletBg.prototype.setAccountTransactions,
    } as unknown as WalletBg);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
  });

  it('keeps a rolled-back transaction out of history when a delayed response arrives', async () => {
    const healing = service.healMissingTxCbor();
    await vi.waitFor(() => expect(getTransactionsCbor).toHaveBeenCalledWith([hash]));
    await service.handleRollback(9);
    answer([{ tx_hash: hash, cbor, block_hash: 'block-a' }]);
    await healing;
    expect(await db.table('transactions').count()).toBe(0);
  });

  it('fills missing block details on legacy rows and preserves the recorded height', async () => {
    await db.table('transactions').put({ ...original, block_hash: null, absolute_slot: null });
    const healing = service.healMissingTxCbor();
    await vi.waitFor(() => expect(getTransactionsCbor).toHaveBeenCalledWith([hash]));
    answer([{ tx_hash: hash, cbor, block_hash: 'block-a', block_height: 4, absolute_slot: 10, epoch_no: 0, tx_size: 11 }]);
    await healing;
    expect(await db.table('transactions').get(hash)).toMatchObject({
      ...original, cbor, epoch_no: 0, tx_size: 11, body: { fee: 0n },
    });
  });

  it('retries a stale backend slot when a legacy row has no block hash', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const legacy = { ...original, block_hash: null };
    await db.table('transactions').put(legacy);
    const healing = service.healMissingTxCbor();
    await vi.waitFor(() => expect(getTransactionsCbor).toHaveBeenCalledWith([hash]));
    answer([{ tx_hash: hash, cbor, block_hash: 'other-block', absolute_slot: 20 }]);
    await healing;
    expect(await db.table('transactions').get(hash)).toEqual(legacy);
    clock.mockReturnValue(now + 121_000);
    const retry = service.healMissingTxCbor();
    await vi.waitFor(() => expect(getTransactionsCbor).toHaveBeenCalledTimes(2));
    answer([{ tx_hash: hash, cbor, block_hash: 'block-a', absolute_slot: 10 }]);
    await retry;
    expect(await db.table('transactions').get(hash)).toMatchObject({ ...original, cbor });
  });

  it('allows a fresh repair after the same transaction is adopted in a different block', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = service.healMissingTxCbor();
    await vi.waitFor(() => expect(getTransactionsCbor).toHaveBeenCalledTimes(1));
    await service.handleRollback(9);
    const adopted = { ...original, block_hash: 'block-b', absolute_slot: 22, block_height: 9 };
    await db.table('transactions').put(adopted);
    answer([{ tx_hash: hash, cbor }]);
    await first;
    expect(await db.table('transactions').get(hash)).toEqual(adopted);

    clock.mockReturnValue(now + 121_000);
    const second = service.healMissingTxCbor();
    await vi.waitFor(() => expect(getTransactionsCbor).toHaveBeenCalledTimes(2));
    answer([{ tx_hash: hash, cbor, block_hash: 'block-b' }]);
    await second;
    expect(await db.table('transactions').get(hash)).toMatchObject({ ...adopted, cbor, body: { fee: 0n } });
    expect(await db.table('transactions').count()).toBe(1);
  });
});
