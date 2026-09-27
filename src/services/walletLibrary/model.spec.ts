import { describe, expect, it } from 'vitest';
import { categoryFor, isWalletSort, matchesWallet, normalizePreferences, sortLibraryWallets, sortWallets } from './model';
const wallet = { id: 1, name: 'Operations Treasury', chain: 'Cardano', network: 'Mainnet',
  addresses: ['addr1qexampleABC123', 'addr1another456'], stakeAddress: 'stake1uXYZ789' };
describe('wallet library search and ordering', () => {
  it.each(['treasury', 'OPERATIONS', 'ABC123', 'another456', 'STake1uXYZ', ' operations  treasury ', 'treasury XYZ789', ''])('matches names and complete or partial addresses: %s', query => {
    expect(matchesWallet(wallet, query)).toBe(true);
  });
  it('does not match unrelated properties or require a stake address', () => {
    expect(matchesWallet(wallet, 'Mainnet')).toBe(false);
    expect(matchesWallet({ ...wallet, stakeAddress: '' }, 'treasury')).toBe(true);
    expect(matchesWallet(wallet, 'not-found')).toBe(false);
  });
  it('sorts legacy order values deterministically without changing the input', () => {
    const rows = [{ id: 5 }, { id: 3, order: 0 }, { id: 1, order: 0 }, { id: 2, order: NaN }];
    expect(sortWallets(rows).map(row => row.id)).toEqual([1, 3, 2, 5]);
    expect(rows[0].id).toBe(5);
  });
  it('places orphaned memberships in Uncategorized and tolerates invalid preferences', () => {
    const preferences = normalizePreferences({ categories: [null, { id: 'a', name: ' Work ' }, { id: 'a', name: 'Duplicate' }] });
    expect(preferences.categories).toEqual([{ id: 'a', name: 'Work', collapsed: false }]);
    expect(categoryFor({ id: 1, categoryId: 'deleted' }, preferences)).toBe(null);
  });
});

describe('wallet library sort orders', () => {
  // In saved (custom) order, the order the library hands to the sort.
  const saved = [
    { id: 4, name: 'wallet 10', chain: 'Cardano', network: 'Preprod' },
    { id: 1, name: 'Savings', chain: 'Bitcoin', network: 'Mainnet' },
    { id: 3, name: 'wallet 2', chain: 'Cardano', network: 'Mainnet' },
    { id: 2, name: 'Alpha', chain: 'Bitcoin', network: 'Testnet' },
    { id: 5, name: 'alpha', chain: 'Cardano', network: 'Preview' },
  ];
  const ids = (sort: Parameters<typeof sortLibraryWallets>[1]) => sortLibraryWallets(saved, sort).map(wallet => wallet.id);

  it('keeps the saved order for custom', () => {
    expect(ids('custom')).toEqual([4, 1, 3, 2, 5]);
  });
  it('sorts names case-insensitively and numerically, ties keeping the saved order', () => {
    expect(ids('name')).toEqual([2, 5, 1, 3, 4]);
  });
  it('groups by blockchain, mainnet first within each', () => {
    expect(ids('chain')).toEqual([1, 2, 3, 4, 5]);
  });
  it('puts mainnets first, then each test network together', () => {
    expect(ids('network')).toEqual([1, 3, 4, 5, 2]);
  });
  it('orders by when a wallet was added, from its auto-increment id', () => {
    expect(ids('newest')).toEqual([5, 4, 3, 2, 1]);
    expect(ids('oldest')).toEqual([1, 2, 3, 4, 5]);
  });
  it('never reorders the list it was given', () => {
    sortLibraryWallets(saved, 'name');
    expect(saved.map(wallet => wallet.id)).toEqual([4, 1, 3, 2, 5]);
  });
  it('accepts only known sort names from storage', () => {
    expect(isWalletSort('network')).toBe(true);
    expect(isWalletSort('balance')).toBe(false);
    expect(isWalletSort(null)).toBe(false);
  });
});
