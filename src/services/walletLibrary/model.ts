import type { Wallet } from '@/models/types';

export interface WalletCategory { id: string; name: string; collapsed: boolean }
export interface WalletLibraryPreferences { categories: WalletCategory[]; uncategorizedCollapsed: boolean }
export type WalletOrganization = Pick<Wallet, 'id' | 'order' | 'isFavorite' | 'categoryId'>;
export interface WalletSearchAddresses { addresses: string[]; stakeAddress: string }
export type LibraryWallet = Wallet & WalletSearchAddresses;
export const LIBRARY_CONFIG_KEY = 'walletLibrary';

export class WalletLibraryError extends Error {
  constructor(public code: 'duplicateName' | 'invalidName' | 'missingWallet' | 'missingCategory') { super(code); }
}

export interface WalletLibrarySnapshot {
  preferences: WalletLibraryPreferences;
  wallets: WalletOrganization[];
}

// Leave category membership intact when pinning a wallet in Favorites.
export function favoriteWallet(wallets: WalletOrganization[], id: number, favorite: boolean): WalletOrganization[] {
  if (!wallets.some(wallet => wallet.id === id)) throw new WalletLibraryError('missingWallet');
  const firstOrder = Math.min(0, ...wallets.map(wallet => Number.isFinite(wallet.order) ? wallet.order! : 0));
  return wallets.map(wallet => wallet.id === id
    ? { ...wallet, isFavorite: favorite, ...(favorite && !wallet.isFavorite ? { order: firstOrder - 1 } : {}) }
    : wallet);
}

// Numeric ranks normally change one row per drop. Rebalance only legacy/tied
// ranks or when repeated insertions have exhausted floating-point precision.
export function moveWalletOrder(wallets: WalletOrganization[], preferences: WalletLibraryPreferences,
  id: number, categoryId: string | null | undefined, beforeId: number | null, favorite?: boolean): WalletOrganization[] {
  if (categoryId != null && !preferences.categories.some(category => category.id === categoryId)) throw new WalletLibraryError('missingCategory');
  const moving = wallets.find(wallet => wallet.id === id);
  if (!moving) throw new WalletLibraryError('missingWallet');
  if (beforeId === id) return wallets;
  const updated = { ...moving, ...(categoryId !== undefined ? { categoryId } : {}), ...(favorite !== undefined ? { isFavorite: favorite } : {}) };
  const remaining = sortWallets(wallets).filter(wallet => wallet.id !== id);
  const sameGroup = (wallet: WalletOrganization) => !!wallet.isFavorite === !!updated.isFavorite
    && (updated.isFavorite || categoryFor(wallet, preferences) === categoryFor(updated, preferences));
  let index: number;
  if (beforeId !== null) {
    index = remaining.findIndex(wallet => wallet.id === beforeId && sameGroup(wallet));
    if (index < 0) throw new WalletLibraryError('missingWallet');
  } else {
    const last = remaining.map(sameGroup).lastIndexOf(true);
    index = last < 0 ? remaining.length : last + 1;
  }
  const previous = remaining[index - 1]?.order;
  const next = remaining[index]?.order;
  const rank = index === 0 ? (next ?? 1) - 1 : index === remaining.length ? (previous ?? 0) + 1 : previous! + (next! - previous!) / 2;
  const valid = remaining.every(wallet => Number.isFinite(wallet.order)) && Number.isFinite(rank)
    && (index === 0 || rank > previous!) && (index === remaining.length || rank < next!);
  remaining.splice(index, 0, { ...updated, order: rank });
  return valid ? remaining : remaining.map((wallet, order) => ({ ...wallet, order }));
}

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
