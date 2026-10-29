// What each wallet in the wallet list is worth (#1332): its coins, tokens and
// NFTs as Gero's portfolio server values them, the same server that draws the
// dashboard's portfolio chart. Read over REST for any wallet, logged in or not:
// the one Gero Sync socket belongs to the logged wallet. Mainnet Cardano only.
import marketApi, { pendingRetryDelayMs, type WalletSnapshot } from '@/api/market-api';
import { Blockchain, Network, type Wallet } from '@/models/types';

/** A wallet's value at one snapshot of the portfolio server. */
export interface WalletValue {
  ada: number;
  usd: number;
  eur: number;
  /** When the server took the snapshot, in ms. */
  at: number;
}

/** What a value request answered: the value (null when the server has none), or "not ready, ask again". */
export type WalletValueAnswer =
  | { state: 'ready'; value: WalletValue | null }
  | { state: 'pending'; retryAfterMs: number };

/** Whether the portfolio server can value this wallet: a Cardano mainnet one with a stake address. */
export function hasPortfolioValue(wallet: Pick<Wallet, 'chain' | 'network'>, stakeAddress: string | undefined): boolean {
  return (wallet.chain ?? Blockchain.CARDANO) === Blockchain.CARDANO && wallet.network === Network.MAINNET
    && typeof stakeAddress === 'string' && stakeAddress.startsWith('stake1');
}

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);

/** The newest snapshot of a history answer as a value; null when it holds none with readable totals. */
export function latestValue(snapshots: WalletSnapshot[] | null | undefined): WalletValue | null {
  let latest: WalletValue | null = null;
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const at = finite(snapshot?.timestamp) * 1000;
    const ada = finite(snapshot?.totalValueAda);
    const usd = finite(snapshot?.totalValueUsd);
    if (!(at > 0) || Number.isNaN(ada) || Number.isNaN(usd)) continue;
    if (latest && latest.at >= at) continue;
    // The server leaves EUR out of older snapshots; USD stands in for it then.
    const eur = finite(snapshot.totalValueEur);
    latest = { ada, usd, eur: Number.isNaN(eur) ? usd : eur, at };
  }
  return latest;
}

/** Asks the portfolio server for a wallet's value: its newest hourly snapshot, tokens and NFTs included. */
export async function fetchWalletValue(stakeAddress: string): Promise<WalletValueAnswer> {
  const history = await marketApi.getWalletHistory(stakeAddress, '1H', false);
  if (history.state === 'pending') return { state: 'pending', retryAfterMs: pendingRetryDelayMs(history.retryAfterSeconds) };
  return { state: 'ready', value: latestValue(history.data) };
}

// Last-known values, so the list shows a figure at once and asks again only when
// it is old. Kept in this browser's extension storage, never sent anywhere, and
// cleared when the user turns the list's balances off.
const CACHE_KEY = 'gero.walletListValues.v1';
/** How long a value is fresh enough not to ask the server again. */
export const VALUE_FRESH_MS = 5 * 60_000;

export interface CachedWalletValue extends WalletValue {
  /** When Gero read it from the server, in ms. */
  fetchedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Every cached value, by stake address. */
export function readCachedValues(): Record<string, CachedWalletValue> {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, CachedWalletValue> : {};
  } catch {
    return {};
  }
}

export function writeCachedValue(stakeAddress: string, value: WalletValue, fetchedAt = Date.now()): void {
  try {
    storage()?.setItem(CACHE_KEY, JSON.stringify({ ...readCachedValues(), [stakeAddress]: { ...value, fetchedAt } }));
  } catch {
    // A full or blocked storage only costs the cache.
  }
}

export function clearCachedValues(): void {
  try {
    storage()?.removeItem(CACHE_KEY);
  } catch {
    // Nothing cached to clear.
  }
}
