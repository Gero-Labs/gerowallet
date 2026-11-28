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

import { clearSolanaValidatorCache, useSolanaStaking } from './useSolanaStaking';
import { walletStore } from '@/stores/walletStore';

const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const INFO = { epoch: 1, slotIndex: 0, slotsInEpoch: 1, minimumDelegation: 1n, rentExemptReserve: 1n };
const stakes = (voter: string) => ({ epoch: 1, accounts: [{ address: 'x', voter }], truncated: false, dropped: 0 });
const VALIDATORS = { epoch: 1, validators: [{ votePubkey: VOTE, name: 'Certus' }] };
const OTHER = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const EMPTY = { epoch: 1, accounts: [], truncated: false, dropped: 0 };
const logged = () => (walletStore as unknown as { loggedWallet: { publicKey: string; network: string } }).loggedWallet;

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
    vi.resetAllMocks();
    clearSolanaValidatorCache();
    logged().publicKey = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
    logged().network = 'Devnet';
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

  it('keeps it for a remounted component, without a second download', async () => {
    api.getStakes.mockResolvedValue(stakes(VOTE));
    host();
    await flushPromises();
    const again = host();
    await flushPromises();
    expect(again.byVote.value.get(VOTE)?.name).toBe('Certus');
    expect(api.getValidators).toHaveBeenCalledTimes(1);
  });

  it('reads it once for the Stake picker, however often asked, even while a reload needs it', async () => {
    api.getStakes.mockResolvedValue(stakes(VOTE));
    let release!: (v: unknown) => void;
    api.getValidators.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const s = host();
    await flushPromises();
    s.ensureValidators();
    s.ensureValidators();
    const reload = s.load();
    release(VALIDATORS);
    await reload;
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
    // The next read (for the new network) fails.
    api.getValidators.mockRejectedValueOnce(new Error('503'));
    logged().network = 'Mainnet';
    logged().publicKey = OTHER;
    await flushPromises();
    release(VALIDATORS);
    await flushPromises();
    // Devnet's list is never shown for Mainnet, and Mainnet's failure is.
    expect(s.validators.value).toBeNull();
    await vi.waitFor(() => expect(s.validatorsFailed.value).toBe(true));
  });

  it('shows a retry as loading again, not as the earlier failure', async () => {
    api.getStakes.mockResolvedValue(EMPTY);
    api.getValidators.mockRejectedValueOnce(new Error('503'));
    const s = host();
    await flushPromises();
    s.ensureValidators();
    await flushPromises();
    expect(s.validatorsFailed.value).toBe(true);
    api.getValidators.mockReturnValueOnce(new Promise(() => {}));
    s.ensureValidators();
    expect(s.validatorsFailed.value).toBe(false);
  });

  it('gives a Stake picker left open across a switch the list again, without a second download', async () => {
    api.getStakes.mockResolvedValue(EMPTY);
    const s = host();
    await flushPromises();
    s.ensureValidators();
    await vi.waitFor(() => expect(s.validators.value).toHaveLength(1));
    logged().publicKey = OTHER;
    await Vue.nextTick();
    expect(s.validators.value).toHaveLength(1);
    // The switch cleared it; the picker got the network's list back (held, not downloaded again).
    expect(api.getValidators).toHaveBeenCalledTimes(1);
  });
});
