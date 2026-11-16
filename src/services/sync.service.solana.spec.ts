// Gero Sync SOLANA messages applied to the wallet (gero-sync docs/solana-wire.md).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service';
import type { WalletBg } from '@/chrome/walletBg';
import type { WsSyncMessage } from '@/services/websocket.service';
import { Blockchain } from '@/models/types';

const store = vi.hoisted(() => {
  const empty = () => ({ lamports: null, tokens: null, tipSlot: null, historyTruncated: false });
  const state: { solana: Record<string, unknown>; solanaTransactions: Array<Record<string, unknown>> } = {
    solana: empty(),
    solanaTransactions: [],
  };
  return {
    empty,
    state,
    setSolanaTransactions: vi.fn((txs: Array<Record<string, unknown>>) => { state.solanaTransactions = txs; }),
    setSolanaState: vi.fn((update: Record<string, unknown>) => { state.solana = { ...state.solana, ...update }; }),
  };
});

vi.mock('@/api/api', () => ({ Api: class {} }));
vi.mock('@/api/blockchain-api', () => ({ default: {} }));
vi.mock('@/chrome/walletBg', () => ({ WalletBg: class {} }));
vi.mock('@cardano-sdk/core', () => ({ Serialization: {} }));
vi.mock('@/stores/loading', () => ({ default: {} }));
vi.mock('@/stores/networkStore', () => ({ default: { setTip: vi.fn() } }));
vi.mock('@/stores/walletStore', () => ({
  default: { state: {}, setSolanaTransactions: store.setSolanaTransactions, setSolanaState: store.setSolanaState },
  walletStore: store.state,
  emptySolanaState: store.empty,
}));
vi.mock('@/services/websocket.service', () => ({ default: {} }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

function setup(chain = Blockchain.SOLANA, cursor = 0) {
  let syncRow: Record<string, unknown> | undefined = cursor ? { id: 1, height: cursor } : undefined;
  const put = vi.fn(async (row: Record<string, unknown>) => { syncRow = row; });
  const wallet = {
    chain,
    getLastSyncInfo: vi.fn(async () => syncRow),
    getDb: vi.fn(async () => ({ table: () => ({ put }) })),
  };
  const service = new SyncService(wallet as unknown as WalletBg);
  return { service, put, syncRow: () => syncRow };
}

const tx = (sig: string, slot: number, extra: Record<string, unknown> = {}) =>
  ({ tx_hash: sig, block_height: slot, absolute_slot: slot, tx_timestamp: 1731456000, solana_success: true, ...extra });

beforeEach(() => {
  store.state.solana = store.empty();
  store.state.solanaTransactions = [];
  store.setSolanaTransactions.mockClear();
  store.setSolanaState.mockClear();
});

describe('applySolanaSync', () => {
  it('stores history, balance and tokens, and moves the cursor to the newest delivered slot', async () => {
    const { service, syncRow } = setup();
    await service.applySolanaSync({
      type: 'SYNC',
      block: { height: 120, slot: 120, hash: '' },
      transactions: [tx('a', 100, { solana_fee: 5000 }), tx('b', 120, { solana_success: false })],
      solana_lamports: '1500000000',
      solana_tokens: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '2500000', decimals: 6, token_account: null, program_id: null }],
      solana_slot: 130,
    } as unknown as WsSyncMessage);

    expect(store.state.solanaTransactions.map((t) => t['signature'])).toEqual(['b', 'a']);
    expect(store.state.solanaTransactions[0]).toMatchObject({ success: false, slot: 120 });
    expect(store.state.solana).toEqual({
      lamports: '1500000000',
      tokens: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '2500000', decimals: 6 }],
      tipSlot: 130,
      historyTruncated: false,
    });
    expect(syncRow()).toMatchObject({ id: 1, height: 120 });
  });

  it('never persists the tip as the cursor (catch-up re-tagged as SYNC)', async () => {
    const { service, syncRow } = setup(Blockchain.SOLANA, 50);
    await service.applySolanaSync({
      type: 'SYNC',
      block: { height: 999, slot: 999, hash: 'tiphash' },
      transactions: [tx('a', 80)],
      solana_slot: 999,
    } as unknown as WsSyncMessage);
    expect(syncRow()).toMatchObject({ height: 80 });
  });

  it('keeps the cursor monotonic', async () => {
    const { service, put } = setup(Blockchain.SOLANA, 500);
    await service.applySolanaSync({ type: 'SYNC', transactions: [tx('old', 400)] } as unknown as WsSyncMessage);
    expect(put).not.toHaveBeenCalled();
  });

  it('a snapshot without balance leaves the known balance alone (unknown is not zero)', async () => {
    store.state.solana = { ...store.empty(), lamports: '42' };
    const { service } = setup();
    await service.applySolanaSync({ type: 'SYNC', block: { height: 1, slot: 1 }, solana_slot: 7 } as unknown as WsSyncMessage);
    expect(store.state.solana).toMatchObject({ lamports: '42', tipSlot: 7 });
  });

  it('dedupes a transaction re-delivered after a reconnect', async () => {
    const { service } = setup();
    await service.applySolanaSync({ type: 'SYNC', transactions: [tx('a', 10)] } as unknown as WsSyncMessage);
    await service.applySolanaSync({ type: 'SYNC', transactions: [tx('a', 10), tx('b', 11)] } as unknown as WsSyncMessage);
    expect(store.state.solanaTransactions.map((t) => t['signature'])).toEqual(['b', 'a']);
  });

  it('records truncated history', async () => {
    const { service } = setup();
    await service.applySolanaSync({ type: 'SYNC', transactions: [tx('a', 10)], solana_history_truncated: true } as unknown as WsSyncMessage);
    expect(store.state.solana['historyTruncated']).toBe(true);
  });

  it('ignores other chains and failed answers', async () => {
    const cardano = setup(Blockchain.CARDANO);
    await cardano.service.applySolanaSync({ type: 'SYNC', transactions: [tx('a', 10)] } as unknown as WsSyncMessage);
    const solana = setup();
    await solana.service.applySolanaSync({ type: 'ERROR', transactions: [tx('a', 10)] } as unknown as WsSyncMessage);
    expect(store.setSolanaTransactions).not.toHaveBeenCalled();
  });
});

describe('handleSolanaForceResync', () => {
  it('drops history and snapshot and rewinds the cursor to 0', async () => {
    store.state.solanaTransactions = [{ signature: 'a', slot: 10 }];
    store.state.solana = { ...store.empty(), lamports: '5' };
    const { service, syncRow } = setup(Blockchain.SOLANA, 900);
    await service.handleSolanaForceResync();
    expect(store.state.solanaTransactions).toEqual([]);
    expect(store.state.solana).toEqual(store.empty());
    expect(syncRow()).toMatchObject({ id: 1, height: 0 });
  });
});
