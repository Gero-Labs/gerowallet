// The staking reads: the (large) validator list only when something needs it, read once at a
// time, kept through ordinary reloads and dropped on an account switch.
import * as Vue from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getStakes: vi.fn(),
  getStakeInfo: vi.fn(),
  getValidators: vi.fn(),
}));
vi.mock('@/api/solana-api', () => ({
  SolanaApi: class {
    getStakes = api.getStakes;
    getStakeInfo = api.getStakeInfo;
    getValidators = api.getValidators;
  },
}));
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({
    loggedWallet: { chain: 'Solana', network: 'Devnet', publicKey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' },
    solanaTransactions: [] as Array<{ signature: string }>,
  }),
}));

import { useSolanaStaking } from './useSolanaStaking';
import { walletStore } from '@/stores/walletStore';

const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const INFO = { epoch: 1, slotIndex: 0, slotsInEpoch: 1, minimumDelegation: 1n, rentExemptReserve: 1n };
const stakes = (voter: string) => ({ epoch: 1, accounts: [{ address: 'x', voter }], truncated: false, dropped: 0 });
const VALIDATORS = { epoch: 1, validators: [{ votePubkey: VOTE, name: 'Certus' }] };

function host() {
  let exposed!: ReturnType<typeof useSolanaStaking>;
  mount(Vue.defineComponent({
    setup() {
      exposed = useSolanaStaking();
      return () => Vue.h('div');
    },
  }));
  return exposed;
}

enableAutoUnmount(afterEach);

describe('useSolanaStaking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (walletStore as unknown as { loggedWallet: { publicKey: string } }).loggedWallet.publicKey = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
    api.getStakeInfo.mockResolvedValue(INFO);
    api.getValidators.mockResolvedValue(VALIDATORS);
  });

  it('does not read the validator list for an account with no delegated stake', async () => {
    api.getStakes.mockResolvedValue({ epoch: 1, accounts: [], truncated: false, dropped: 0 });
    const s = host();
    await flushPromises();
    expect(s.stakes.value?.accounts).toEqual([]);
    expect(s.info.value).toEqual(INFO);
    expect(api.getValidators).not.toHaveBeenCalled();
  });

  it('reads it to name delegated accounts, and keeps it through a reload', async () => {
    api.getStakes.mockResolvedValue(stakes(VOTE));
    const s = host();
    await flushPromises();
    expect(s.byVote.value.get(VOTE)?.name).toBe('Certus');
    await s.load();
    await flushPromises();
    expect(api.getValidators).toHaveBeenCalledTimes(1);
  });

  it('reads it once for the Stake picker, however often asked, even while a reload runs', async () => {
    api.getStakes.mockResolvedValue({ epoch: 1, accounts: [], truncated: false, dropped: 0 });
    let release!: (v: unknown) => void;
    api.getValidators.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const s = host();
    await flushPromises();
    s.ensureValidators();
    s.ensureValidators();
    await s.load();
    release(VALIDATORS);
    await flushPromises();
    expect(api.getValidators).toHaveBeenCalledTimes(1);
    expect(s.validators.value).toHaveLength(1);
  });

  it('drops a list read for another account and says when the read failed', async () => {
    api.getStakes.mockResolvedValue({ epoch: 1, accounts: [], truncated: false, dropped: 0 });
    let release!: (v: unknown) => void;
    api.getValidators.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const s = host();
    await flushPromises();
    s.ensureValidators();
    (walletStore as unknown as { loggedWallet: { publicKey: string } }).loggedWallet.publicKey = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
    await flushPromises();
    release(VALIDATORS);
    await flushPromises();
    expect(s.validators.value).toBeNull();

    api.getValidators.mockRejectedValueOnce(new Error('503'));
    s.ensureValidators();
    await flushPromises();
    expect(s.validatorsFailed.value).toBe(true);
  });
});
