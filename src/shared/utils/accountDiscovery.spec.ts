import { describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Blockchain, CoinTypes, HARDENED, Network, WalletTypePurpose } from '@/models/types';
import { getAddress, getRewardAddress } from '@/chrome/serialization';
import { resolvePrivateKey } from './resolver';
import { hardwareAccount, type HardwareAccount } from './walletAccount';
import { discoverAccounts, mergeScannedAccounts, nextScanIndices } from './accountDiscovery';

const rootKey = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
const account = (index: number): HardwareAccount => {
  const hex = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]).toPublic().hex();
  return hardwareAccount(hex.slice(0, 64), hex.slice(64), `m/1852'/1815'/${index}'`);
};
const stake = (index: number) => getRewardAddress(account(index).publicKey, Blockchain.CARDANO, Network.PREPROD).toBech32();

/** An account API answering per stake address. */
function api(info: Record<string, unknown>, transactions: Record<string, unknown[]> = {}) {
  return {
    getAccountInfo: vi.fn(async (address: string) => {
      const answer = info[address];
      if (answer instanceof Error) throw answer;
      return answer ?? { active: false, pool_id: null, drep_id: null, rewards_sum: '0', withdrawable_amount: '0' };
    }),
    getAccountTransactions: vi.fn(async (address: string) => transactions[address] ?? []),
  };
}

describe('discoverAccounts', () => {
  it('derives each account’s addresses from its xpub', async () => {
    const [found] = await discoverAccounts(Blockchain.CARDANO, Network.PREPROD, [account(1)], api({}));
    expect(found.stakeAddress).toBe(stake(1));
    expect(found.address).toBe(getAddress(account(1).publicKey, Blockchain.CARDANO, Network.PREPROD, 0).toBech32());
  });

  it('calls an account with a balance used, without fetching its history', async () => {
    const accountApi = api({ [stake(0)]: { controlled_amount: '1204500000' } });
    const [found] = await discoverAccounts(Blockchain.CARDANO, Network.PREPROD, [account(0)], accountApi);
    expect(found).toMatchObject({ activity: 'used', balance: '1204500000' });
    expect(accountApi.getAccountTransactions).not.toHaveBeenCalled();
  });

  it('calls an emptied account used when it has history, and an untouched one unused', async () => {
    const accountApi = api({}, { [stake(1)]: [{ tx_hash: 'aa' }] });
    const found = await discoverAccounts(Blockchain.CARDANO, Network.PREPROD, [account(1), account(2)], accountApi);
    expect(found.map((a) => a.activity)).toEqual(['used', 'unused']);
  });

  it('calls a delegated account used', async () => {
    const accountApi = api({ [stake(3)]: { controlled_amount: '0', pool_id: 'pool1xyz' } });
    const [found] = await discoverAccounts(Blockchain.CARDANO, Network.PREPROD, [account(3)], accountApi);
    expect(found.activity).toBe('used');
  });

  it('marks only the account whose probe failed as unknown', async () => {
    const accountApi = api({ [stake(1)]: new Error('timeout'), [stake(0)]: { controlled_amount: '5' } });
    const found = await discoverAccounts(Blockchain.CARDANO, Network.PREPROD, [account(0), account(1)], accountApi);
    expect(found.map((a) => a.activity)).toEqual(['used', 'unknown']);
  });
});

describe('scanning', () => {
  it('asks for account 0 again with the next accounts', () => {
    expect(nextScanIndices([0, 1, 2, 3, 4])).toEqual([0, 5, 6, 7, 8, 9]);
    expect(nextScanIndices([0, 9, 2])).toEqual([0, 10, 11, 12, 13, 14]);
  });

  it('merges a scan of the same device by index', () => {
    const merged = mergeScannedAccounts([account(0), account(1)], [account(0), account(5)]);
    expect(merged?.map((a) => a.accountIndex)).toEqual([0, 1, 5]);
  });

  it('refuses a scan whose account 0 is another device’s', () => {
    const otherDevice = { ...account(0), publicKey: bech32.encode('xpub', bech32.toWords(Buffer.alloc(64, 7)), 1023) };
    expect(mergeScannedAccounts([account(0), account(1)], [otherDevice, account(5)])).toBeNull();
  });

  it('takes the first scan as it is', () => {
    expect(mergeScannedAccounts([], [account(1), account(0)])?.map((a) => a.accountIndex)).toEqual([0, 1]);
  });
});
