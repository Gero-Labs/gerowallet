import { describe, expect, it } from 'vitest';
import { categoryFor, matchesWallet, normalizePreferences, sortWallets } from './model';
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
