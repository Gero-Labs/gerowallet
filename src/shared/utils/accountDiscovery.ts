// Which of a device's accounts have been used, so pairing can offer the ones
// that hold something. Each account is probed on its stake address: a balance,
// rewards or a delegation means used; otherwise its transaction history decides.
import { Api } from '@/api/api';
import { getAddress, getRewardAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';
import { Blockchain, type Wallet } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';

/** 'unknown': the probe failed. 'unchecked': the chain offers no probe (Midnight). */
export type AccountActivity = 'used' | 'unused' | 'unknown' | 'unchecked';

export interface DiscoveredAccount extends AccountXpub {
  /** First receive address, to show beside the account. */
  address: string;
  /** Cardano only; '' on Bitcoin. */
  stakeAddress: string;
  /** 'unknown' when the probe failed: the account is still offered, just not pre-selected. */
  activity: AccountActivity;
  /** Lovelace controlled by the stake address, when the probe returned it. */
  balance?: string;
}

type AccountApi = Pick<Api, 'getAccountInfo' | 'getAccountTransactions'>;

const positive = (value: unknown): boolean => {
  try {
    return BigInt(String(value ?? '0')) > 0n;
  } catch {
    return false;
  }
};

async function activityOf(api: AccountApi, stakeAddress: string): Promise<Pick<DiscoveredAccount, 'activity' | 'balance'>> {
  try {
    const info = await api.getAccountInfo(stakeAddress, true);
    const balance = info?.controlled_amount != null ? String(info.controlled_amount) : undefined;
    if (positive(info?.controlled_amount) || positive(info?.rewards_sum) || positive(info?.withdrawals_sum)
      || info?.pool_id || info?.drep_id) {
      return { activity: 'used', balance };
    }
    // An emptied account still has history, which the balance alone cannot show.
    const transactions = await api.getAccountTransactions(stakeAddress, 0);
    return { activity: Array.isArray(transactions) && transactions.length > 0 ? 'used' : 'unused', balance };
  } catch {
    return { activity: 'unknown' };
  }
}

/** Probes every account in parallel; a failed probe marks that account 'unknown' instead of failing the rest. */
export async function discoverAccounts(
  chain: string,
  network: string,
  accounts: AccountXpub[],
  api: AccountApi = new Api({ chain, network }, networks.resolveDefaultProvider(chain, network)),
): Promise<DiscoveredAccount[]> {
  return Promise.all(accounts.map(async (account) => {
    const stakeAddress = getRewardAddress(account.publicKey, chain, network).toBech32();
    const address = getAddress(account.publicKey, chain, network, 0).toBech32();
    return { ...account, address, stakeAddress, ...(await activityOf(api, stakeAddress)) };
  }));
}

/** Accounts asked of a device per scan. */
export const ACCOUNTS_PER_SCAN = 5;

/**
 * The indices for the next scan: the next ACCOUNTS_PER_SCAN after the highest
 * scanned, plus account 0 again, so the merge can check it is the same device.
 */
export function nextScanIndices(scanned: number[]): number[] {
  const from = scanned.length ? Math.max(...scanned) + 1 : 1;
  return [0, ...Array.from({ length: ACCOUNTS_PER_SCAN }, (_, i) => from + i)];
}

/**
 * Accounts from one more scan, merged into those scanned so far by index. Returns
 * null when the scan's account 0 is not the one already held: another device.
 */
export function mergeScannedAccounts(previous: AccountXpub[], scanned: AccountXpub[]): AccountXpub[] | null {
  const first = previous.find((account) => account.accountIndex === 0);
  const again = scanned.find((account) => account.accountIndex === 0);
  if (first && again?.publicKey !== first.publicKey) return null;
  const merged = new Map(previous.map((account) => [account.accountIndex, account]));
  scanned.forEach((account) => merged.set(account.accountIndex, account));
  return [...merged.values()].sort((a, b) => a.accountIndex - b.accountIndex);
}

/**
 * Midnight accounts, shown by their unshielded receive address and never probed
 * ('unchecked'): Nexus has no REST query for a Midnight account's history, and
 * the gero-sync socket belongs to the logged-in wallet. So only account #0 is
 * chosen by default.
 */
export function discoverMidnightAccounts(accounts: AccountXpub[]): DiscoveredAccount[] {
  return accounts.map((account) => ({ ...account, address: midnightUnshieldedAddress(account.publicKey), stakeAddress: '', activity: 'unchecked' }));
}

/** The unshielded address of a Midnight account's addresses JSON; '' for an unreadable blob. */
function midnightUnshieldedAddress(publicKey: string): string {
  try {
    const unshielded: unknown = JSON.parse(publicKey)?.unshielded;
    return typeof unshielded === 'string' ? unshielded : '';
  } catch {
    return '';
  }
}

/**
 * An account record's first receive address, as the accounts step shows it, so
 * a picker can tell a wallet's accounts apart. '' when none can be derived.
 */
export async function accountReceiveAddress(record: Pick<Wallet, 'chain' | 'network' | 'publicKey' | 'addressType'>): Promise<string> {
  if (!record.publicKey) return '';
  try {
    if (record.chain === Blockchain.MIDNIGHT) return midnightUnshieldedAddress(record.publicKey);
    if (record.chain === Blockchain.BITCOIN) {
      const { deriveBitcoinAddress } = await import('@/chains/bitcoin/bitcoinKeyManager');
      return deriveBitcoinAddress(record.publicKey, record.network, record.addressType || 'segwit', 0, 0);
    }
    return getAddress(record.publicKey, record.chain, record.network, 0).toBech32();
  } catch {
    return '';
  }
}

/** Receive addresses checked per Bitcoin account: wallets hand them out in order, so a used account has used one of its first. */
export const BITCOIN_PROBE_ADDRESSES = 5;

type BitcoinAddressApi = { getTransactions(address: string): Promise<unknown[]> };

/**
 * Which Bitcoin accounts have been used. There is no account-level query, so each
 * account's first receive addresses are checked for history, in order, until one
 * has some. A failed probe gives 'unknown'.
 */
export async function discoverBitcoinAccounts(
  network: string,
  addressType: string,
  accounts: AccountXpub[],
  api?: BitcoinAddressApi,
): Promise<DiscoveredAccount[]> {
  const [{ deriveBitcoinAddress }, client] = await Promise.all([
    import('@/chains/bitcoin/bitcoinKeyManager'),
    api ?? import('@/api/bitcoin-api').then(({ BitcoinApi }) => new BitcoinApi({ chain: Blockchain.BITCOIN, network }, networks.resolveDefaultProvider(Blockchain.BITCOIN, network))),
  ]);
  return Promise.all(accounts.map(async (account) => {
    const addresses = Array.from({ length: BITCOIN_PROBE_ADDRESSES }, (_, i) => deriveBitcoinAddress(account.publicKey, network, addressType, 0, i));
    let activity: AccountActivity = 'unused';
    try {
      for (const address of addresses) {
        if ((await client.getTransactions(address)).length) {
          activity = 'used';
          break;
        }
      }
    } catch {
      activity = 'unknown';
    }
    return { ...account, address: addresses[0], stakeAddress: '', activity };
  }));
}
