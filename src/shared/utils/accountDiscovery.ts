// Which of a device's accounts have been used, so pairing can offer the ones
// that hold something. Each account is probed on its stake address: a balance,
// rewards or a delegation means used; otherwise its transaction history decides.
import { Api } from '@/api/api';
import { getAddress, getRewardAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';
import type { HardwareAccount } from '@/shared/utils/walletAccount';

export type AccountActivity = 'used' | 'unused' | 'unknown';

export interface DiscoveredAccount extends HardwareAccount {
  /** First receive address, to show beside the account. */
  address: string;
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
  accounts: HardwareAccount[],
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
export function mergeScannedAccounts(previous: HardwareAccount[], scanned: HardwareAccount[]): HardwareAccount[] | null {
  const first = previous.find((account) => account.accountIndex === 0);
  const again = scanned.find((account) => account.accountIndex === 0);
  if (first && again?.publicKey !== first.publicKey) return null;
  const merged = new Map(previous.map((account) => [account.accountIndex, account]));
  scanned.forEach((account) => merged.set(account.accountIndex, account));
  return [...merged.values()].sort((a, b) => a.accountIndex - b.accountIndex);
}
