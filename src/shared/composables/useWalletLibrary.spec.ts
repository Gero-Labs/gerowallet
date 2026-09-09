import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vue, { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useWalletLibrary } from './useWalletLibrary';
import { favoriteWallet, moveWalletOrder, normalizePreferences } from '@/services/walletLibrary/model';
import type { WalletLibrarySnapshot } from '@/services/walletLibrary/model';

const observer = vi.hoisted(() => ({ next: undefined as undefined | ((value: WalletLibrarySnapshot) => void) }));
vi.mock('dexie', () => ({ liveQuery: (read: () => Promise<WalletLibrarySnapshot>) => ({
  subscribe: ({ next }: { next: (value: WalletLibrarySnapshot) => void }) => {
    observer.next = next;
    void read().then(next);
    return { unsubscribe: vi.fn() };
  },
}) }));
vi.mock('@/db/gero-db', () => ({ getDb: vi.fn() }));
vi.mock('@/services/walletLibrary/addresses', () => ({ walletSearchAddresses: async () => ({ addresses: [], stakeAddress: '' }) }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let snapshot: WalletLibrarySnapshot;
let library: ReturnType<typeof useWalletLibrary>;
let wrapper: ReturnType<typeof mount>;
const repo = {
  initialize: vi.fn(async () => undefined),
  read: vi.fn(async () => structuredClone(snapshot)),
  setFavorite: vi.fn(async (id: number, favorite: boolean) => { snapshot.wallets = favoriteWallet(snapshot.wallets, id, favorite); }),
  moveWallet: vi.fn(async (id: number, categoryId: string | null | undefined, before: number | null = null, favorite?: boolean) => {
    snapshot.wallets = moveWalletOrder(snapshot.wallets, snapshot.preferences, id, categoryId, before, favorite);
  }),
  saveCategory: vi.fn(async () => undefined),
  deleteCategory: vi.fn(async () => undefined),
  setCollapsed: vi.fn(async () => undefined),
};
beforeEach(async () => {
  vi.clearAllMocks();
  snapshot = { preferences: normalizePreferences(null), wallets: [{ id: 1, order: 0 }, { id: 2, order: 1 }, { id: 3, order: 2 }] };
  wrapper = mount(Vue.extend({ setup() {
    library = useWalletLibrary(ref(snapshot.wallets.map(wallet => ({ ...wallet, name: `Wallet ${wallet.id}`, chain: 'Cardano', network: 'Mainnet' }))), repo);
    return {};
  }, render(h) { return h('div'); } }));
  await flush();
});
afterEach(() => wrapper.destroy());

describe('responsive wallet organization', () => {
  it('pins immediately while storage is stalled and preserves newer clicks over a stale live query', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    repo.setFavorite.mockImplementationOnce(async (id, favorite) => {
      await gate;
      snapshot.wallets = favoriteWallet(snapshot.wallets, id, favorite);
    });
    const first = library.toggleFavorite(3);
    expect(library.groups.value[0].wallets.map(wallet => wallet.id)).toEqual([3]);
    expect(library.saving.value).toBe(false);
    const second = library.toggleFavorite(2);
    observer.next!(structuredClone(snapshot));
    expect(library.groups.value[0].wallets.map(wallet => wallet.id)).toEqual([2, 3]);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(library.groups.value[0].wallets.map(wallet => wallet.id)).toEqual([2, 3]);
    expect(library.pendingCount.value).toBe(0);
  });
  it('saves every rapid toggle in order instead of dropping clicks behind a global busy flag', async () => {
    const jobs = [library.toggleFavorite(1), library.toggleFavorite(1), library.toggleFavorite(1)];
    expect(library.wallets.value.find(wallet => wallet.id === 1)?.isFavorite).toBe(true);
    await Promise.all(jobs);
    expect(repo.setFavorite.mock.calls).toEqual([[1, true], [1, false], [1, true]]);
    expect(snapshot.wallets.find(wallet => wallet.id === 1)?.isFavorite).toBe(true);
  });
  it('rolls back a failed star while preserving a later successful reorder', async () => {
    repo.setFavorite.mockRejectedValueOnce(new Error('Storage unavailable'));
    const favorite = library.toggleFavorite(1);
    const move = library.moveWallet(3, null, 2, false);
    expect(library.groups.value[1].wallets.map(wallet => wallet.id)).toEqual([3, 2]);
    expect(await favorite).toBe(false);
    expect(await move).toBe(true);
    expect(library.error.value).toBe('saveFailed');
    expect(library.favoriteCount.value).toBe(0);
    expect(library.groups.value[1].wallets.map(wallet => wallet.id)).toEqual([1, 3, 2]);
  });
  it('reorders immediately while storage is stalled', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    repo.moveWallet.mockImplementationOnce(async (id, categoryId, before = null, favorite) => {
      await gate;
      snapshot.wallets = moveWalletOrder(snapshot.wallets, snapshot.preferences, id, categoryId, before, favorite);
    });
    const job = library.moveWallet(3, null, 1, false);
    expect(library.groups.value[1].wallets.map(wallet => wallet.id)).toEqual([3, 1, 2]);
    release();
    expect(await job).toBe(true);
    expect(library.groups.value[1].wallets.map(wallet => wallet.id)).toEqual([3, 1, 2]);
  });
});
