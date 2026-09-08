import type { Wallet } from '@/models/types';

export interface WalletCategory { id: string; name: string; collapsed: boolean }
export interface WalletLibraryPreferences { categories: WalletCategory[]; uncategorizedCollapsed: boolean }
export type WalletOrganization = Pick<Wallet, 'id' | 'order' | 'isFavorite' | 'categoryId'>;
export interface WalletSearchAddresses { addresses: string[]; stakeAddress: string }
export type LibraryWallet = Wallet & WalletSearchAddresses;
export const LIBRARY_CONFIG_KEY = 'walletLibrary';

export function normalizePreferences(value: unknown): WalletLibraryPreferences {
  const source = value as Partial<WalletLibraryPreferences> | null;
  const ids = new Set<string>();
  const categories = (Array.isArray(source?.categories) ? source.categories : []).filter(category => {
    if (!category || typeof category.id !== 'string' || !category.id || ids.has(category.id)
      || typeof category.name !== 'string' || !category.name.trim()) return false;
    ids.add(category.id);
    return true;
  }).map(category => ({ id: category.id, name: category.name.trim(), collapsed: category.collapsed === true }));
  return { categories, uncategorizedCollapsed: source?.uncategorizedCollapsed === true };
}

export function sortWallets<T extends WalletOrganization>(wallets: T[]): T[] {
  return [...wallets].sort((a, b) => {
    const orderA = Number.isFinite(a.order) ? a.order! : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.order) ? b.order! : Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.id - b.id;
  });
}

export function categoryFor(wallet: WalletOrganization, preferences: WalletLibraryPreferences): string | null {
  return preferences.categories.some(category => category.id === wallet.categoryId) ? wallet.categoryId! : null;
}

export function matchesWallet(wallet: LibraryWallet, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const fields = [wallet.name, ...wallet.addresses, wallet.stakeAddress].map(value => (value || '').toLocaleLowerCase());
  return terms.every(term => fields.some(field => field.includes(term)));
}
