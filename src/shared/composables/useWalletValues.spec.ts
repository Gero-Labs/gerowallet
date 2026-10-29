// The wallet list's values (#1332): the last-known value at once, the server
// asked only when it is old, a wallet still being indexed asked again, at most
// two requests at a time, and nothing at all while the setting is off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const fetchWalletValue = vi.hoisted(() => vi.fn());
vi.mock('@/services/walletLibrary/walletValues', async (original) => ({
  ...(await original<object>()),
  fetchWalletValue,
}));

import { useWalletValues } from './useWalletValues';
import { VALUE_FRESH_MS, readCachedValues, writeCachedValue } from '@/services/walletLibrary/walletValues';
import type { LibraryWallet } from '@/services/walletLibrary/model';
import { Blockchain, Network, WalletType } from '@/models/types';

const wallet = (id: number, network = Network.MAINNET) => ({
  id, name: `Wallet ${id}`, chain: Blockchain.CARDANO, network, type: WalletType.Normal, addresses: [], stakeAddress: `stake1wallet${id}`,
}) as unknown as LibraryWallet;
const value = (ada: number) => ({ ada, usd: ada / 2, eur: ada / 3, at: 1_000 });

function setup(list: LibraryWallet[], on = true) {
  const wallets = ref(list);
  const enabled = ref(on);
  let api!: ReturnType<typeof useWalletValues>;
  const view = mount(defineComponent({ setup() { api = useWalletValues(wallets, enabled); return () => h('div'); } }));
  return { wallets, enabled, view, valueOf: (w: LibraryWallet) => api.valueOf(w), isPending: (w: LibraryWallet) => api.isPending(w) };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  fetchWalletValue.mockReset().mockImplementation(async (stake: string) => ({ state: 'ready', value: value(Number(stake.replace('stake1wallet', '')) * 10) }));
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('useWalletValues', () => {
  it('values each mainnet wallet and keeps what the server said', async () => {
    const one = wallet(1);
    const { valueOf } = setup([one, wallet(2, Network.PREPROD)]);
    await flushPromises();

    expect(fetchWalletValue).toHaveBeenCalledExactlyOnceWith('stake1wallet1');
    expect(valueOf(one)).toEqual(value(10));
    expect(readCachedValues()['stake1wallet1']).toMatchObject(value(10));
  });

  it('shows the last-known value at once and asks again only when it is old', async () => {
    writeCachedValue('stake1wallet1', value(5), Date.now());
    writeCachedValue('stake1wallet2', value(7), Date.now() - VALUE_FRESH_MS);
    const [one, two] = [wallet(1), wallet(2)];
    const { valueOf } = setup([one, two]);

    expect(valueOf(one)).toEqual(value(5));
    expect(valueOf(two)).toEqual(value(7));
    await flushPromises();
    expect(fetchWalletValue).toHaveBeenCalledExactlyOnceWith('stake1wallet2');
    expect(valueOf(two)).toEqual(value(20));
  });

  it('asks again after the server\'s hint while it is still indexing a wallet', async () => {
    fetchWalletValue.mockResolvedValueOnce({ state: 'pending', retryAfterMs: 30_000 });
    const one = wallet(1);
    const { valueOf, isPending } = setup([one]);
    await flushPromises();

    expect(isPending(one)).toBe(true);
    expect(valueOf(one)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    expect(fetchWalletValue).toHaveBeenCalledTimes(2);
    expect(isPending(one)).toBe(false);
    expect(valueOf(one)).toEqual(value(10));
  });

  it('keeps at most two requests going at a time', async () => {
    const answers: Array<() => void> = [];
    fetchWalletValue.mockImplementation((stake: string) => new Promise((resolve) => {
      answers.push(() => resolve({ state: 'ready', value: value(Number(stake.replace('stake1wallet', ''))) }));
    }));
    setup([wallet(1), wallet(2), wallet(3), wallet(4)]);
    await flushPromises();

    expect(fetchWalletValue).toHaveBeenCalledTimes(2);
    answers.shift()!();
    await flushPromises();
    expect(fetchWalletValue).toHaveBeenCalledTimes(3);
  });

  it('asks nothing while off, and forgets the values when switched off', async () => {
    const one = wallet(1);
    const { enabled, valueOf } = setup([one], false);
    await flushPromises();
    expect(fetchWalletValue).not.toHaveBeenCalled();

    enabled.value = true;
    await nextTick();
    await flushPromises();
    expect(valueOf(one)).toEqual(value(10));

    enabled.value = false;
    await nextTick();
    expect(valueOf(one)).toBeUndefined();
  });

  it('keeps the last-known value when the server fails', async () => {
    writeCachedValue('stake1wallet1', value(5), Date.now() - VALUE_FRESH_MS);
    fetchWalletValue.mockRejectedValue(new Error('offline'));
    const one = wallet(1);
    const { valueOf, isPending } = setup([one]);
    await flushPromises();

    expect(valueOf(one)).toEqual(value(5));
    expect(isPending(one)).toBe(false);
  });
});
