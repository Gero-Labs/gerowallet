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
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn() } }));

import WalletStore, { walletStore, spendableControlledAmount, type Account } from './walletStore';

const account = (controlled: string) => ({ controlled_amount: controlled } as Account);

describe('spendable controlled_amount', () => {
  beforeEach(() => {
    WalletStore.setProgrammableTokens({}, '0');
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
});
