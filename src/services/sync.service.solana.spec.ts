// Gero Sync SOLANA messages applied to the wallet (gero-sync docs/solana-wire.md).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SOLANA_LAST_SYNC_MIN_INTERVAL_MS, SyncService } from './sync.service';
import type { WalletBg } from '@/chrome/walletBg';
import type { WsSyncMessage } from '@/services/websocket.service';
import { Blockchain } from '@/models/types';

const store = vi.hoisted(() => {
  const empty = () => ({ lamports: null, tokens: null, tipSlot: null, historyTruncated: false });
  const state: { solana: Record<string, unknown>; solanaTransactions: Array<Record<string, unknown>>; solanaNfts: Record<string, unknown>; solanaAssets: unknown[] } = {
    solana: empty(),
    solanaTransactions: [],
    solanaNfts: {},
    solanaAssets: [],
  };
  return {
    empty,
    state,
    setSolanaTransactions: vi.fn((txs: Array<Record<string, unknown>>) => { state.solanaTransactions = txs; }),
    setSolanaState: vi.fn((update: Record<string, unknown>) => { state.solana = { ...state.solana, ...update }; }),
    flush: vi.fn(async () => undefined),
    setSolanaNfts: vi.fn((nfts: Record<string, unknown>) => { state.solanaNfts = nfts; }),
    setSolanaAssets: vi.fn((assets: unknown[]) => { state.solanaAssets = assets; }),
  };
});

vi.mock('@/api/api', () => ({ Api: class {} }));
vi.mock('@/api/blockchain-api', () => ({ default: {} }));
vi.mock('@/chrome/walletBg', () => ({ WalletBg: class {} }));
vi.mock('@cardano-sdk/core', () => ({ Serialization: {} }));
vi.mock('@/stores/loading', () => ({ default: {} }));
vi.mock('@/stores/networkStore', () => ({ default: { setTip: vi.fn() } }));
vi.mock('@/stores/walletStore', () => ({
  default: { state: {}, setSolanaTransactions: store.setSolanaTransactions, setSolanaState: store.setSolanaState, setSolanaNfts: store.setSolanaNfts, setSolanaAssets: store.setSolanaAssets },
  walletStore: store.state,
  emptySolanaState: store.empty,
  flushWalletStorePersistence: store.flush,
}));
vi.mock('@/services/websocket.service', () => ({ default: {} }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/api/solana-api', () => ({
  SolanaApi: class {
    getNftMetadata = vi.fn(async () => { throw new Error('no network in tests'); });
    getAssets = vi.fn(async () => { throw new Error('no network in tests'); });
  },
}));

function setup(chain = Blockchain.SOLANA, cursor = 0) {
  let syncRow: Record<string, unknown> | undefined = cursor ? { id: 1, height: cursor } : undefined;
  const put = vi.fn(async (row: Record<string, unknown>) => { syncRow = row; });
  const wallet = {
    chain,
    id: 7,
    network: 'Devnet',
    publicKey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
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
  store.flush.mockClear();
  store.state.solanaNfts = {};
  store.setSolanaNfts.mockClear();
  store.state.solanaAssets = [];
  store.setSolanaAssets.mockClear();
});

describe('applySolanaSync', () => {
  it('stores history, balance and tokens, and moves the cursor to the newest delivered slot', async () => {
    const { service, put, syncRow } = setup();
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
      lastSyncAt: expect.any(Number),
    });
    expect(syncRow()).toMatchObject({ id: 1, height: 120 });
    // The history is written before the cursor moves past it.
    expect(store.flush.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]);
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

  it('records when the last update arrived, even one that changes nothing', async () => {
    const { service } = setup();
    const before = Date.now();
    await service.applySolanaSync({ type: 'SYNC_CHECK_OK', success: true } as unknown as WsSyncMessage);
    expect(store.state.solana['lastSyncAt']).toBeGreaterThanOrEqual(before);
  });

  it('rewrites the store for a message that changes nothing else at most every 30 s', async () => {
    const { service } = setup();
    const check = { type: 'SYNC_CHECK_OK', success: true } as unknown as WsSyncMessage;
    await service.applySolanaSync(check);
    store.setSolanaState.mockClear();
    await service.applySolanaSync(check);
    expect(store.setSolanaState).not.toHaveBeenCalled();

    // Anything that does change is written at once, with the time.
    await service.applySolanaSync({ type: 'SYNC', solana_slot: 9 } as unknown as WsSyncMessage);
    expect(store.setSolanaState).toHaveBeenCalledWith({ tipSlot: 9, lastSyncAt: expect.any(Number) });

    // And a quiet one again once the interval has passed.
    store.setSolanaState.mockClear();
    store.state.solana = { ...store.state.solana, lastSyncAt: Date.now() - SOLANA_LAST_SYNC_MIN_INTERVAL_MS };
    await service.applySolanaSync(check);
    expect(store.setSolanaState).toHaveBeenCalledTimes(1);
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
    expect(store.setSolanaState).not.toHaveBeenCalled();
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

describe('syncSolanaNfts', () => {
  const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const C = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const held = (...mints: string[]) => mints.map((mint) => ({ mint, amount: '1', decimals: 0 }));
  const row = (mint: string) => ({ mint, standard: 'nonFungible', name: mint.slice(0, 3), offChain: true, fetchedAt: 1 });

  it('asks Nexus only about mints it does not know, and keeps what it knows', async () => {
    const { service } = setup();
    store.state.solanaNfts = { [A]: row(A) };
    const api = { getNftMetadata: vi.fn(async (mints: string[]) => mints.map((m) => (m === B ? row(B) : false))) };
    await service.syncSolanaNfts([...held(A, B, C), { mint: 'X', amount: '5', decimals: 6 }], api as never);
    expect(api.getNftMetadata).toHaveBeenCalledWith([B, C]);
    expect(store.setSolanaNfts).toHaveBeenCalledWith({ [A]: row(A), [B]: row(B), [C]: false });
  });

  it('drops NFTs no longer held, without asking anything', async () => {
    const { service } = setup();
    store.state.solanaNfts = { [A]: row(A), [B]: row(B) };
    const api = { getNftMetadata: vi.fn() };
    await service.syncSolanaNfts(held(B), api as never);
    expect(api.getNftMetadata).not.toHaveBeenCalled();
    expect(store.setSolanaNfts).toHaveBeenCalledWith({ [B]: row(B) });
  });

  it('keeps what it knows when Nexus fails, and changes nothing when nothing changed', async () => {
    const { service } = setup();
    store.state.solanaNfts = { [A]: row(A) };
    await service.syncSolanaNfts(held(A, B), { getNftMetadata: vi.fn(async () => { throw new Error('down'); }) } as never);
    expect(store.setSolanaNfts).not.toHaveBeenCalled();
  });

  it('reads a token update that came in during a read once that read ends', async () => {
    const { service } = setup();
    let finish: () => void = () => undefined;
    const api = {
      getNftMetadata: vi.fn((mints: string[]) => new Promise((resolve) => {
        finish = () => resolve(mints.map((m) => row(m)));
      })),
    };
    const first = service.syncSolanaNfts(held(A), api as never);
    await service.syncSolanaNfts(held(A, B), api as never); // arrives mid-read: kept, not dropped
    finish();
    await vi.waitFor(() => expect(api.getNftMetadata).toHaveBeenCalledTimes(2));
    finish();
    await first;
    expect(api.getNftMetadata.mock.calls.map((c) => c[0])).toEqual([[A], [B]]);
    expect(store.setSolanaNfts).toHaveBeenLastCalledWith({ [A]: row(A), [B]: row(B) });
  });

  it('drops a pending update from a wallet that is no longer logged in', async () => {
    const { service } = setup();
    let finish: () => void = () => undefined;
    const api = { getNftMetadata: vi.fn((mints: string[]) => new Promise((resolve) => { finish = () => resolve(mints.map((m) => row(m))); })) };
    const first = service.syncSolanaNfts(held(A), api as never);
    await service.syncSolanaNfts(held(A, B), api as never);
    (service as unknown as { walletBg: { id: number } }).walletBg.id = 8; // switched mid-read
    finish();
    await first;
    expect(api.getNftMetadata).toHaveBeenCalledTimes(1);
  });

  it('does nothing for another chain', async () => {
    const { service } = setup(Blockchain.CARDANO);
    const api = { getNftMetadata: vi.fn() };
    await service.syncSolanaNfts(held(A), api as never);
    expect(api.getNftMetadata).not.toHaveBeenCalled();
  });
});

describe('syncSolanaAssets', () => {
  const asset = (mint: string) => ({ mint, kind: 'compressed', name: mint.slice(0, 3), fetchedAt: 1 });

  it('stores the compressed and Core NFTs Nexus lists, and only when they changed', async () => {
    const { service } = setup();
    const api = { getAssets: vi.fn(async () => [asset('A'), asset('B')]) };
    await service.syncSolanaAssets(api as never);
    expect(api.getAssets).toHaveBeenCalledWith('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
    expect(store.setSolanaAssets).toHaveBeenCalledWith([asset('A'), asset('B')]);
    store.setSolanaAssets.mockClear();
    const later = { getAssets: vi.fn(async () => [{ ...asset('A'), fetchedAt: 2 }, { ...asset('B'), fetchedAt: 2 }]) };
    await service.syncSolanaAssets(later as never);
    expect(store.setSolanaAssets).not.toHaveBeenCalled();
  });

  it('keeps what it knows when Nexus fails (no DAS configured answers 503)', async () => {
    const { service } = setup();
    store.state.solanaAssets = [asset('A')];
    await service.syncSolanaAssets({ getAssets: vi.fn(async () => { throw new Error('503'); }) } as never);
    expect(store.setSolanaAssets).not.toHaveBeenCalled();
  });

  it('drops an answer for a wallet that is no longer logged in', async () => {
    const { service } = setup();
    const api = { getAssets: vi.fn(async () => { (service as unknown as { walletBg: { id: number } }).walletBg.id = 8; return [asset('A')]; }) };
    await service.syncSolanaAssets(api as never);
    expect(store.setSolanaAssets).not.toHaveBeenCalled();
  });
});
