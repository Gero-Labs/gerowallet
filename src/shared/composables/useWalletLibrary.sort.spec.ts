import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vue, { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useWalletLibrary, WALLET_SORT_STORAGE_KEY } from './useWalletLibrary';
import { normalizePreferences } from '@/services/walletLibrary/model';
import type { WalletLibrarySnapshot } from '@/services/walletLibrary/model';

vi.mock('dexie', () => ({ liveQuery: (read: () => Promise<WalletLibrarySnapshot>) => ({
  subscribe: ({ next }: { next: (value: WalletLibrarySnapshot) => void }) => {
    void read().then(next);
    return { unsubscribe: vi.fn() };
  },
}) }));
vi.mock('@/db/gero-db', () => ({ getDb: vi.fn() }));
vi.mock('@/services/walletLibrary/addresses', () => ({ walletSearchAddresses: async () => ({ addresses: [], stakeAddress: '' }) }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Saved order 1..4; wallet 4 is a favorite, so it sits in its own section.
const WALLETS = [
  { id: 1, name: 'Zeta', chain: 'Cardano', network: 'Mainnet' },
  { id: 2, name: 'Beta', chain: 'Bitcoin', network: 'Mainnet' },
  { id: 3, name: 'Alpha', chain: 'Cardano', network: 'Preprod' },
  { id: 4, name: 'Aardvark', chain: 'Cardano', network: 'Mainnet' },
];
const snapshot: WalletLibrarySnapshot = {
  preferences: normalizePreferences(null),
  wallets: [{ id: 1, order: 0 }, { id: 2, order: 1 }, { id: 3, order: 2 }, { id: 4, order: 3, isFavorite: true }],
};
const repo = {
  initialize: vi.fn(async () => undefined),
  read: vi.fn(async () => structuredClone(snapshot)),
  setFavorite: vi.fn(async () => undefined),
  moveWallet: vi.fn(async () => undefined),
  saveCategory: vi.fn(async () => undefined),
  deleteCategory: vi.fn(async () => undefined),
  setCollapsed: vi.fn(async () => undefined),
};

let library: ReturnType<typeof useWalletLibrary>;
let wrapper: ReturnType<typeof mount>;
async function mountLibrary() {
  wrapper = mount(Vue.extend({ setup() {
    library = useWalletLibrary(ref(WALLETS), repo);
    return {};
  }, render(h) { return h('div'); } }));
  await flush();
}
const section = (key: string) => library.groups.value.find(group => group.key === key)!.wallets.map(wallet => wallet.id);

beforeEach(() => localStorage.clear());
afterEach(() => {
  wrapper.destroy();
  localStorage.clear();
});

describe('wallet library sorting', () => {
  it('starts in the saved order, where dragging is allowed', async () => {
    await mountLibrary();
    expect(library.sort.value).toBe('custom');
    expect(section('uncategorized')).toEqual([1, 2, 3]);
    expect(library.reorderable.value).toBe(true);
  });

  it('sorts inside each section without moving wallets between them', async () => {
    await mountLibrary();
    library.sort.value = 'name';
    expect(section('uncategorized')).toEqual([3, 2, 1]);
    expect(section('favorites')).toEqual([4]);
    library.sort.value = 'chain';
    expect(section('uncategorized')).toEqual([2, 1, 3]);
  });

  it('locks dragging while a sort rearranges the saved order', async () => {
    await mountLibrary();
    library.sort.value = 'newest';
    expect(library.reorderable.value).toBe(false);
    // A sort is not a filter: sections keep their collapse state and counts.
    expect(library.filtering.value).toBe(false);
    library.sort.value = 'custom';
    expect(library.reorderable.value).toBe(true);
  });

  it('remembers the choice for the next visit', async () => {
    await mountLibrary();
    library.sort.value = 'network';
    await Vue.nextTick();
    expect(localStorage.getItem(WALLET_SORT_STORAGE_KEY)).toBe('network');
    wrapper.destroy();
    await mountLibrary();
    expect(library.sort.value).toBe('network');
    expect(section('uncategorized')).toEqual([2, 1, 3]);
  });

  it('ignores an unknown saved value', async () => {
    localStorage.setItem(WALLET_SORT_STORAGE_KEY, 'balance');
    await mountLibrary();
    expect(library.sort.value).toBe('custom');
  });
});
