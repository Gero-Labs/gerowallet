// Issue 1470: pending sends survive a chain reset, a confirmed copy replaces
// them, and the user can dismiss or settle the ones that never confirmed.
import { beforeEach, describe, expect, it } from 'vitest';
import { midnightActions, midnightStore } from './midnightStore';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';

const IDENTITY = { network: 'midnight-mainnet', generation: 2, genesisHash: `0x${'ab'.repeat(32)}` };
const tx = (hash: string, status: MidnightTransaction['status'], extra: Partial<MidnightTransaction> = {}): MidnightTransaction => ({
  hash, type: 'send', token: 'NIGHT', amount: 40_000_000n, counterparty: 'mn_addr1to', timestamp: 1_000, status, fee: 0n, isShielded: false, ...extra,
});

beforeEach(() => {
  midnightStore.transactions = [];
});

describe('resetChainState with pending sends', () => {
  it('keeps the pending rows, marked as sent before the reset, and drops the rest of history', () => {
    midnightStore.transactions = [tx('aa', 'pending'), tx('bb', 'confirmed'), tx('cc', 'pending', { isShielded: true })];
    midnightActions.resetChainState(IDENTITY, { reason: 'upgrade' });
    expect(midnightStore.transactions.map((t) => t.hash)).toEqual(['aa', 'cc']);
    expect(midnightStore.transactions.every((t) => t.status === 'pending' && t.beforeReset?.upgrade === true)).toBe(true);
    expect(midnightStore.balances.nightUnshielded).toBe(0n);
  });

  it('a kept row the rebuilt history confirms is shown once, as confirmed', () => {
    midnightStore.transactions = [tx(`0x${'AA'.repeat(32)}`, 'pending')];
    midnightActions.resetChainState(IDENTITY);
    midnightActions.applyTransaction(tx('aa'.repeat(32), 'confirmed', { blockHeight: 7 }));
    expect(midnightStore.transactions).toHaveLength(1);
    expect(midnightStore.transactions[0].status).toBe('confirmed');
  });

  it('a worker that restarted (empty memory) keeps the pending rows it last persisted', () => {
    midnightStore.transactions = [];
    const persisted = {
      balances: midnightStore.balances, transactions: [tx('ee', 'pending', { ledgerHash: true }), tx('ff', 'confirmed')],
      utxos: [], dustState: null, tip: { hash: null, height: 0, timestamp: 0 },
    };
    midnightActions.resetChainState(IDENTITY, { persisted });
    expect(midnightStore.transactions.map((t) => [t.hash, t.ledgerHash, !!t.beforeReset])).toEqual([['ee', true, true]]);
  });

  it('a forced resync clears history but keeps pending sends', () => {
    midnightStore.transactions = [tx('aa', 'pending'), tx('bb', 'confirmed')];
    midnightActions.clearHistoryKeepingPending();
    expect(midnightStore.transactions.map((t) => t.hash)).toEqual(['aa']);
  });
});

describe('the actions on a send that never confirmed', () => {
  it('Dismiss removes a pending or failed row, never a confirmed one', () => {
    midnightStore.transactions = [tx('aa', 'pending'), tx('bb', 'confirmed'), tx('cc', 'failed')];
    midnightActions.dismissPendingTx('0xAA', 'NIGHT');
    midnightActions.dismissPendingTx('bb', 'NIGHT');
    midnightActions.dismissPendingTx('cc', 'NIGHT');
    expect(midnightStore.transactions.map((t) => t.hash)).toEqual(['bb']);
  });

  it('the lookup after the rebuild that finds nothing marks a kept row "not included", once', () => {
    midnightStore.transactions = [tx('aa', 'pending', { beforeReset: { at: 1, upgrade: false } }), tx('bb', 'pending')];
    midnightActions.markPendingNotIncluded('aa', 'NIGHT');
    midnightActions.markPendingNotIncluded('bb', 'NIGHT');
    expect(midnightStore.transactions.map((t) => t.beforeReset?.notFound ?? null)).toEqual([true, null]);
  });

  it('Check again that finds it settles the row and drops the reset mark', () => {
    midnightStore.transactions = [tx('aa', 'pending', { beforeReset: { at: 1, upgrade: true } }), tx('bb', 'pending')];
    midnightActions.settlePendingTx('aa', 'NIGHT', 'confirmed');
    midnightActions.settlePendingTx('bb', 'NIGHT', 'failed');
    expect(midnightStore.transactions.map((t) => [t.status, t.beforeReset])).toEqual([['confirmed', undefined], ['failed', undefined]]);
  });
});
