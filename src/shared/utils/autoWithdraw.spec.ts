import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: { config: undefined, loggedWallet: undefined, account: undefined },
}));

import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { currentRewardWithdrawals, clearWithdrawableAmount } from './autoWithdraw';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for the dynamic store bag
const store = walletStore as any;

const cardanoWallet = { chain: Blockchain.CARDANO, stakeAddress: 'stake_test1uq' };

beforeEach(() => {
  store.config = { autoWithdrawRewards: true };
  store.loggedWallet = { ...cardanoWallet };
  store.account = { withdrawable_amount: '5000000', drep_id: 'drep1abc' };
});

describe('currentRewardWithdrawals — DRep gate (#939)', () => {
  it('skips the withdrawal when a Cardano stake key has no DRep delegation', () => {
    // The blocking bug: without this gate every send carried a withdrawal the
    // Conway node rejects, so the wallet could not send ADA at all.
    store.account.drep_id = undefined;
    expect(currentRewardWithdrawals()).toBeUndefined();
  });

  it('attaches the withdrawal once a DRep is delegated', () => {
    expect(currentRewardWithdrawals()).toEqual([
      { stakeAddress: 'stake_test1uq', amount: '5000000' },
    ]);
  });

  it('leaves non-Cardano chains ungated — the DRep rule is Conway-only', () => {
    store.loggedWallet = { chain: Blockchain.APEX_PRIME, stakeAddress: 'stake_test1uq' };
    store.account.drep_id = undefined;
    expect(currentRewardWithdrawals()).toEqual([
      { stakeAddress: 'stake_test1uq', amount: '5000000' },
    ]);
  });
});

describe('currentRewardWithdrawals — existing preconditions', () => {
  it('returns undefined when the toggle is off', () => {
    store.config = { autoWithdrawRewards: false };
    expect(currentRewardWithdrawals()).toBeUndefined();
  });

  it('returns undefined with no config at all', () => {
    store.config = undefined;
    expect(currentRewardWithdrawals()).toBeUndefined();
  });

  it('returns undefined without a stake address', () => {
    store.loggedWallet = { chain: Blockchain.CARDANO };
    expect(currentRewardWithdrawals()).toBeUndefined();
  });

  it('returns undefined for a zero or absent balance', () => {
    store.account.withdrawable_amount = '0';
    expect(currentRewardWithdrawals()).toBeUndefined();
    store.account.withdrawable_amount = undefined;
    expect(currentRewardWithdrawals()).toBeUndefined();
  });

  it('swallows an unparseable balance instead of throwing', () => {
    store.account.withdrawable_amount = 'not-a-number';
    expect(() => currentRewardWithdrawals()).not.toThrow();
    expect(currentRewardWithdrawals()).toBeUndefined();
  });
});

describe('clearWithdrawableAmount — optimistic reset (#941)', () => {
  it('zeroes the balance so a second tx cannot re-attach a claimed withdrawal', () => {
    clearWithdrawableAmount();
    expect(store.account.withdrawable_amount).toBe('0');
  });

  it('makes the very next currentRewardWithdrawals() call a no-op', () => {
    expect(currentRewardWithdrawals()).toBeDefined();
    clearWithdrawableAmount();
    expect(currentRewardWithdrawals()).toBeUndefined();
  });

  it('is idempotent and safe with no account loaded', () => {
    clearWithdrawableAmount();
    clearWithdrawableAmount();
    expect(store.account.withdrawable_amount).toBe('0');

    store.account = null;
    expect(() => clearWithdrawableAmount()).not.toThrow();
  });
});
