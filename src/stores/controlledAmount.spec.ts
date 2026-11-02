// src/stores/controlledAmount.spec.ts
//
// `controlled_amount` is a stake-level total, and CIP-113 UTxOs sit at the shared
// programmable-logic-base script address under the wallet's own stake credential — so
// their lovelace is inside that total while being unspendable through Gero. Every
// max-send, swap-sizing and delegation surface reads the field as spendable ADA, so the
// subtraction has to survive every order the account and the partition can arrive in.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

// clearForWalletSwitch() and logout() clear the wallet-scoped alarms; there is no extension API here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: { getAll: (cb: (alarms: unknown[]) => void) => cb([]), clear: vi.fn() },
  tabs: { query: vi.fn() },
};

import WalletStore, {
  walletStore,
  spendableControlledAmount,
  hasProgrammableLockedLovelace,
  hasListedLockedLovelace,
  hasLockedLovelace,
  totalProgrammableLockedLovelace,
  totalListedLockedLovelace,
  type Account,
} from './walletStore';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';

const account = (controlled: string) => ({ controlled_amount: controlled } as Account);

describe('spendable controlled_amount', () => {
  beforeEach(() => {
    WalletStore.setProgrammableTokens({}, '0');
    WalletStore.setListedListings([], '0');
    WalletStore.setAccount(null);
  });

  it('leaves the account untouched when nothing is locked', () => {
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('10000000');
  });

  it('subtracts the locked lovelace when the partition is already known', () => {
    WalletStore.setProgrammableTokens({}, '4000000');
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('6000000');
    expect(walletStore.account?.controlled_amount_total).toBe('10000000');
  });

  // The SYNC push carries both, and the account is applied first.
  it('re-derives when the partition arrives after the account', () => {
    WalletStore.setAccount(account('10000000'));
    WalletStore.setProgrammableTokens({}, '4000000');

    expect(walletStore.account?.controlled_amount).toBe('6000000');
  });

  it('does not subtract twice when the same account is applied again', () => {
    WalletStore.setProgrammableTokens({}, '4000000');
    WalletStore.setAccount(account('10000000'));
    WalletStore.setAccount(walletStore.account);

    expect(walletStore.account?.controlled_amount).toBe('6000000');
  });

  it('restores the full amount once the locked holdings are gone', () => {
    WalletStore.setProgrammableTokens({}, '4000000');
    WalletStore.setAccount(account('10000000'));
    WalletStore.setProgrammableTokens({}, '0');

    expect(walletStore.account?.controlled_amount).toBe('10000000');
  });

  // controlled_amount also carries withdrawable rewards, so a locked share larger than
  // the UTxO total is possible in principle; a negative balance is not.
  it('floors at zero rather than reporting a negative balance', () => {
    WalletStore.setProgrammableTokens({}, '12000000');
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('0');
  });

  it('passes an unparseable amount through untouched', () => {
    WalletStore.setProgrammableTokens({}, '4000000');

    expect(spendableControlledAmount('not-a-number')).toBe('not-a-number');
  });

  // Payment-key-owned CIP-113 UTxOs sit under another reward address: their lovelace was
  // never in this stake address's total, so taking it off would understate the balance.
  it('does not subtract lovelace locked under a payment-key owner', () => {
    WalletStore.setProgrammableTokens({}, '4000000', '2000000');
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('6000000');
  });

  it('still counts payment-key-owned lovelace as locked holdings', () => {
    WalletStore.setProgrammableTokens({}, '0', '2000000');

    expect(totalProgrammableLockedLovelace()).toBe(2_000_000n);
    expect(hasProgrammableLockedLovelace()).toBe(true);
  });
});

// The Gero NFT market's own listings sit at the listing script under the wallet's stake key, so
// their deposit is inside the same stake-level total. It comes off exactly like the CIP-113
// share, in whatever order the account, the partitions and repeated applications arrive.
describe('spendable controlled_amount with own listings', () => {
  const listing = (n: number): OwnListing => ({
    ref: `${String(n).repeat(64)}#0`,
    unit: `${'a'.repeat(56)}${n.toString(16).padStart(2, '0')}`,
    datum: {
      owner: '0'.repeat(56),
      sellerAddress: 'addr_test1vqeux7xwusdju9nmkq6w98zrx4u8lcgfjgnpm29r09dqsvqpq4cwy',
      price: 100_000_000n,
      royalties: [],
      buyer: null,
    },
    depositLovelace: '2000000',
    deploymentVersion: 1,
  });

  beforeEach(() => {
    WalletStore.setProgrammableTokens({}, '0');
    WalletStore.setListedListings([], '0');
    WalletStore.setAccount(null);
  });

  it('subtracts the listed lovelace when the listings are already known', () => {
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('8000000');
    expect(walletStore.account?.controlled_amount_total).toBe('10000000');
  });

  it('re-derives when the listings land after the account', () => {
    WalletStore.setAccount(account('10000000'));
    WalletStore.setListedListings([listing(1), listing(2)], '4000000');

    expect(walletStore.account?.controlled_amount).toBe('6000000');
  });

  it('subtracts the CIP-113 share and the listed share together', () => {
    WalletStore.setProgrammableTokens({}, '4000000');
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('4000000');
  });

  it('subtracts both whichever arrives last', () => {
    WalletStore.setAccount(account('10000000'));
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setProgrammableTokens({}, '4000000');
    expect(walletStore.account?.controlled_amount).toBe('4000000');

    WalletStore.setAccount(null);
    WalletStore.setProgrammableTokens({}, '4000000');
    WalletStore.setAccount(account('10000000'));
    WalletStore.setListedListings([listing(1)], '2000000');
    expect(walletStore.account?.controlled_amount).toBe('4000000');
  });

  it('does not subtract twice when the same account is applied again', () => {
    WalletStore.setProgrammableTokens({}, '4000000');
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setAccount(account('10000000'));
    WalletStore.setAccount(walletStore.account);
    WalletStore.setAccount(walletStore.account);

    expect(walletStore.account?.controlled_amount).toBe('4000000');
    expect(walletStore.account?.controlled_amount_total).toBe('10000000');
  });

  it('does not subtract twice when the same listings are applied again', () => {
    WalletStore.setAccount(account('10000000'));
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setListedListings([listing(1)], '2000000');

    expect(walletStore.account?.controlled_amount).toBe('8000000');
  });

  it('restores the amount once the listings are gone', () => {
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setAccount(account('10000000'));
    WalletStore.setListedListings([], '0');

    expect(walletStore.account?.controlled_amount).toBe('10000000');
  });

  it('floors at zero rather than reporting a negative balance', () => {
    WalletStore.setProgrammableTokens({}, '9000000');
    WalletStore.setListedListings([listing(1)], '2000000');
    WalletStore.setAccount(account('10000000'));

    expect(walletStore.account?.controlled_amount).toBe('0');
  });

  it('passes an unparseable stored amount through as zero locked', () => {
    WalletStore.setListedListings([listing(1)], 'not-a-number');

    expect(totalListedLockedLovelace()).toBe(0n);
    expect(hasListedLockedLovelace()).toBe(false);
  });

  it('counts the listed lovelace as locked holdings, apart from the CIP-113 helpers', () => {
    WalletStore.setListedListings([listing(1)], '2000000');

    expect(totalListedLockedLovelace()).toBe(2_000_000n);
    expect(hasListedLockedLovelace()).toBe(true);
    expect(hasProgrammableLockedLovelace()).toBe(false);
    expect(hasLockedLovelace()).toBe(true);
  });

  it('keeps the listings in the store and clears them on logout and on a wallet switch', () => {
    WalletStore.setListedListings([listing(1)], '2000000');
    expect(walletStore.listedListings).toHaveLength(1);
    expect(walletStore.listedLockedLovelace).toBe('2000000');

    WalletStore.clearForWalletSwitch();
    expect(walletStore.listedListings).toEqual([]);
    expect(walletStore.listedLockedLovelace).toBe('0');

    WalletStore.setListedListings([listing(2)], '2000000');
    WalletStore.logout();
    expect(walletStore.listedListings).toEqual([]);
    expect(walletStore.listedLockedLovelace).toBe('0');
  });
});
