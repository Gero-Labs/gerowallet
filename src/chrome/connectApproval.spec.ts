// A dApp connect prompt can connect another account of the logged wallet
// (#1331): the answer names it, and the background switches to it first. Only
// an account of the wallet the prompt was shown for can ever be named.
import { describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import {
  approvalNamesActiveAccount,
  connectApprovalData,
  connectApprovedAccount,
  connectTarget,
  readConnectApproval,
  type ConnectDeps,
} from './connectApproval';

const record = (id: number, extra: Partial<Wallet> = {}) =>
  ({ id, name: `Wallet ${id}`, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal, ...extra }) as Wallet;

const WALLETS: Record<number, Wallet> = {
  1: record(1, { name: 'Main' }),
  2: record(2, { name: 'Account #1', accountIndex: 1, parentWalletId: 1 }),
  3: record(3, { name: 'Account #2', accountIndex: 2, parentWalletId: 1 }),
  7: record(7, { name: 'Other' }),
  // Claims wallet 7 as its parent on another network: not one of its accounts.
  8: record(8, { name: 'Stale', accountIndex: 1, parentWalletId: 7, network: Network.PREPROD }),
};

describe('readConnectApproval', () => {
  it('reads an explicit true as the logged account, and a named account by its id', () => {
    expect(readConnectApproval({ data: true })).toEqual({});
    expect(readConnectApproval({ data: { accountId: 3 } })).toEqual({ accountId: 3 });
  });

  it('reads anything else as no approval', () => {
    for (const data of [{}, [], [3], 'yes', 3, false, null, undefined, { accountId: 0 }, { accountId: -1 }, { accountId: '3' }, { accountId: 2.5 }]) {
      expect(readConnectApproval({ data })).toBeNull();
    }
    expect(readConnectApproval(null)).toBeNull();
  });
});

describe('connectApprovalData', () => {
  it('names the chosen account only when there was a choice', () => {
    expect(connectApprovalData(3, 3)).toEqual({ accountId: 3 });
    expect(connectApprovalData(1, 1)).toBe(true);
    expect(connectApprovalData(undefined, 3)).toBe(true);
  });
});

describe('connectTarget', () => {
  it('finds any account of the group the prompt was shown for, account #0 included', () => {
    expect(connectTarget(3, 1, WALLETS)?.id).toBe(3);
    expect(connectTarget(1, 2, WALLETS)?.id).toBe(1);
    expect(connectTarget(2, 2, WALLETS)?.id).toBe(2);
  });

  it('refuses a wallet outside that group, a stale child and an unknown prompt wallet', () => {
    expect(connectTarget(7, 1, WALLETS)).toBeNull();
    expect(connectTarget(8, 7, WALLETS)).toBeNull();
    expect(connectTarget(99, 1, WALLETS)).toBeNull();
    expect(connectTarget(2, undefined, WALLETS)).toBeNull();
    expect(connectTarget(2, 99, WALLETS)).toBeNull();
  });
});

describe('approvalNamesActiveAccount', () => {
  it('lets a connect approval through when it names the account now active', () => {
    expect(approvalNamesActiveAccount('enable', { data: { accountId: 3 } }, 3)).toBe(true);
    expect(approvalNamesActiveAccount('midnight_connect', { data: { accountId: 3 } }, 3)).toBe(true);
  });

  it('holds every other answer to the wallet-switch guard', () => {
    expect(approvalNamesActiveAccount('enable', { data: { accountId: 3 } }, 1)).toBe(false);
    expect(approvalNamesActiveAccount('enable', { data: true }, 3)).toBe(false);
    expect(approvalNamesActiveAccount('signTx', { data: { accountId: 3 } }, 3)).toBe(false);
    expect(approvalNamesActiveAccount('enable', { data: { accountId: '3' } }, '3')).toBe(false);
  });
});

describe('connectApprovedAccount', () => {
  function deps(logged: number | null, loginResult?: (record: Wallet) => { id: number } | null) {
    const calls: string[] = [];
    const value: ConnectDeps<{ id: number }> = {
      loggedWallet: vi.fn(() => (logged === null ? null : { id: logged })),
      wallets: vi.fn(async () => WALLETS),
      login: vi.fn(async (target: Wallet) => {
        calls.push(`login ${target.id}`);
        return loginResult ? loginResult(target) : { id: target.id };
      }),
      addConnectedDapp: vi.fn(async (walletId: number) => { calls.push(`connect ${walletId}`); }),
    };
    return { value, calls };
  }

  it('connects the logged wallet on a plain approval, without reading the wallets or logging in', async () => {
    const { value, calls } = deps(1);

    expect(await connectApprovedAccount({}, 1, 'https://dapp.example', value)).toEqual({ id: 1 });
    expect(calls).toEqual(['connect 1']);
    expect(value.addConnectedDapp).toHaveBeenCalledWith(1, 'https://dapp.example');
    expect(value.wallets).not.toHaveBeenCalled();
  });

  it('switches to the account the user picked, then connects that account', async () => {
    const { value, calls } = deps(1);

    expect(await connectApprovedAccount({ accountId: 3 }, 1, 'https://dapp.example', value)).toEqual({ id: 3 });
    expect(calls).toEqual(['login 3', 'connect 3']);
    expect(value.login).toHaveBeenCalledWith(WALLETS[3]);
  });

  it('connects the logged account it names without logging it in again', async () => {
    const { value, calls } = deps(3);

    expect(await connectApprovedAccount({ accountId: 3 }, 3, 'https://dapp.example', value)).toEqual({ id: 3 });
    expect(calls).toEqual(['connect 3']);
  });

  it('refuses a named logged account outside the group the prompt was shown for', async () => {
    // The prompt was shown for wallet 1; wallet 7 was logged in from elsewhere meanwhile.
    const { value, calls } = deps(7);

    expect(await connectApprovedAccount({ accountId: 7 }, 1, 'https://dapp.example', value)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('uses the group of the wallet logged now when the prompt had none (a cold start)', async () => {
    const { value, calls } = deps(2);

    expect(await connectApprovedAccount({ accountId: 1 }, undefined, 'https://dapp.example', value)).toEqual({ id: 1 });
    expect(calls).toEqual(['login 1', 'connect 1']);
  });

  it('connects nothing for a wallet outside the group, and logs nothing in', async () => {
    const { value, calls } = deps(1);

    expect(await connectApprovedAccount({ accountId: 7 }, 1, 'https://dapp.example', value)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('connects nothing when the switch fails or lands on another wallet', async () => {
    const failed = deps(1, () => null);
    expect(await connectApprovedAccount({ accountId: 3 }, 1, 'https://dapp.example', failed.value)).toBeNull();
    expect(failed.calls).toEqual(['login 3']);

    const elsewhere = deps(1, () => ({ id: 1 }));
    expect(await connectApprovedAccount({ accountId: 3 }, 1, 'https://dapp.example', elsewhere.value)).toBeNull();
    expect(elsewhere.value.addConnectedDapp).not.toHaveBeenCalled();
  });

  it('connects nothing with no wallet logged in', async () => {
    const { value } = deps(null);

    expect(await connectApprovedAccount({}, undefined, 'https://dapp.example', value)).toBeNull();
    expect(value.addConnectedDapp).not.toHaveBeenCalled();
  });
});
