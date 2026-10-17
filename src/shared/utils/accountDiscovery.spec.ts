import { describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Blockchain, CoinTypes, HARDENED, Network, WalletTypePurpose } from '@/models/types';
import { getAddress, getRewardAddress } from '@/chrome/serialization';
import { resolvePrivateKey } from './resolver';
import { accountXpub, type AccountXpub } from './walletAccount';
import { BITCOIN_PROBE_ADDRESSES, discoverAccounts, discoverBitcoinAccounts, mergeScannedAccounts, nextScanIndices } from './accountDiscovery';

// bitcoinjs-lib rejects the test runner's Buffer: name each address after its xpub and index instead.
vi.mock('@/chains/bitcoin/bitcoinKeyManager', () => ({
  deriveBitcoinAddress: (xpub: string, _network: string, type: string, chain: number, index: number) => `${xpub}/${type}/${chain}/${index}`,
}));

const rootKey = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
const account = (index: number): AccountXpub => {
  const hex = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]).toPublic().hex();
  return accountXpub(hex.slice(0, 64), hex.slice(64), `m/1852'/1815'/${index}'`);
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

describe('discoverBitcoinAccounts', () => {
  const btc = (accountIndex: number): AccountXpub => ({ accountIndex, publicKey: `xpub-${accountIndex}`, keys: [] });
  /** Answers `getTransactions` per address: a history, nothing, or a failure. */
  const esplora = (histories: Record<string, unknown[] | Error>) => ({
    getTransactions: vi.fn(async (address: string) => {
      const answer = histories[address];
      if (answer instanceof Error) throw answer;
      return answer ?? [];
    }),
  });

  it('calls an account used when one of its first receive addresses has history, and shows the first', async () => {
    const api = esplora({ 'xpub-1/segwit/0/2': [{ txid: 'aa' }] });
    const [first, second] = await discoverBitcoinAccounts(Network.TESTNET, 'segwit', [btc(0), btc(1)], api);

    expect(first).toMatchObject({ accountIndex: 0, address: 'xpub-0/segwit/0/0', stakeAddress: '', activity: 'unused' });
    expect(second).toMatchObject({ accountIndex: 1, address: 'xpub-1/segwit/0/0', activity: 'used' });
    // The used account stops at the address that answered; the unused one checks them all.
    expect(api.getTransactions.mock.calls.filter(([address]) => address.startsWith('xpub-1'))).toHaveLength(3);
    expect(api.getTransactions.mock.calls.filter(([address]) => address.startsWith('xpub-0'))).toHaveLength(BITCOIN_PROBE_ADDRESSES);
  });

  it('marks an account whose probe failed as unknown, without failing the others', async () => {
    const api = esplora({ 'xpub-0/taproot/0/0': new Error('rate limited'), 'xpub-1/taproot/0/0': [{ txid: 'bb' }] });
    const found = await discoverBitcoinAccounts(Network.MAINNET, 'taproot', [btc(0), btc(1)], api);

    expect(found.map((account) => account.activity)).toEqual(['unknown', 'used']);
  });
});
