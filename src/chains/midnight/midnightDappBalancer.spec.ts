// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { balanceDappTransaction } from './midnightDappBalancer';
import type { BalanceDappTransactionDeps, UnshieldedSdkWallet } from './midnightDappBalancer';
import type { UnboundTransaction } from './midnightConnectorBalance';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
// The real prover client statically imports ledger-v9 (absent in this
// checkout) and has its own spec; the fee envelopes here are circuit-free, so
// a provider that refuses every call is both sufficient and a stronger check.
vi.mock('./midnightLocalProver', () => ({
  makeLocalProvingProvider: () => ({
    check: async () => { throw new Error('unexpected /check'); },
    prove: async () => { throw new Error('unexpected /prove'); },
  }),
}));

afterEach(() => vi.unstubAllGlobals());

/** Circuit-free envelopes never reach the prover; this one proves it. */
const noProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected /check'); },
  prove: async () => { throw new Error('unexpected /prove'); },
};

async function unbound(network = 'preprod'): Promise<UnboundTransaction> {
  return ledger.Transaction.fromParts(network).prove(noProver, ledger.CostModel.initialCostModel()) as Promise<UnboundTransaction>;
}

function fakeDeps(overrides: Partial<BalanceDappTransactionDeps> = {}) {
  const order: string[] = [];
  const wallet = {
    waitForSyncedState: vi.fn(async () => { order.push('sync'); }),
    balanceUnboundTransaction: vi.fn(async (tx: UnboundTransaction) => { order.push('balance'); return tx; }),
    signUnboundTransaction: vi.fn(async (tx: UnboundTransaction) => { order.push('sign'); return tx; }),
    stop: vi.fn(async () => { order.push('stop'); }),
  };
  const keystore = { signData: vi.fn() };
  const deps: BalanceDappTransactionDeps = {
    startUnshieldedWallet: vi.fn(async () => ({ wallet: wallet as unknown as UnshieldedSdkWallet, keystore })),
    balanceFees: vi.fn(async () => { order.push('fees'); return ledger.Transaction.fromParts('preprod'); }),
    ...overrides,
  };
  return { deps, order, wallet };
}

const base = {
  sdkNetworkId: 'preprod',
  endpoints: {
    sdkNetworkId: 'preprod', publicIndexerUrl: 'https://indexer.invalid', publicIndexerWsUrl: 'wss://indexer.invalid',
  } as never,
  unshieldedSecretKey: new Uint8Array(32).fill(1),
  dustSecretSeed: new Uint8Array(32).fill(2),
  proving: { url: 'http://localhost:6300' },
};

describe('balanceDappTransaction', () => {
  it('syncs, balances, prices fees on the balanced tx, proves the fee tx, merges, signs, binds, stops', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { deps, order, wallet } = fakeDeps();
    const txHex = Buffer.from((await unbound()).serialize()).toString('hex');

    const result = await balanceDappTransaction({ ...base, txHex }, deps);

    expect(order).toEqual(['sync', 'balance', 'fees', 'sign', 'stop']);
    expect(() => ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(result.txHex, 'hex'))).not.toThrow();
    expect(result.contributions).toEqual([]);
    expect(wallet.balanceUnboundTransaction).toHaveBeenCalledTimes(1);
    // The fee helper is priced on what balancing returned, with the dapp's deadline.
    const [feeArgs, feeTxs] = (deps.balanceFees as ReturnType<typeof vi.fn>).mock.calls[0] as [{ ttl: Date; sdkNetworkId: string }, unknown[]];
    expect(feeArgs.sdkNetworkId).toBe('preprod');
    expect(feeArgs.ttl).toBeInstanceOf(Date);
    expect(feeTxs).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled(); // empty envelopes need no circuit call
  });

  it('treats an "already balanced" (undefined) SDK result as the input tx', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { deps, wallet } = fakeDeps();
    wallet.balanceUnboundTransaction.mockResolvedValue(undefined);
    const txHex = Buffer.from((await unbound()).serialize()).toString('hex');
    await expect(balanceDappTransaction({ ...base, txHex }, deps)).resolves.toMatchObject({ txHex: expect.any(String) });
    expect(wallet.signUnboundTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a transaction from another network before touching any wallet', async () => {
    const { deps } = fakeDeps();
    const txHex = Buffer.from((await unbound('mainnet')).serialize()).toString('hex');
    await expect(balanceDappTransaction({ ...base, txHex }, deps)).rejects.toThrow();
    expect(deps.startUnshieldedWallet).not.toHaveBeenCalled();
  });

  it('refuses Stagenet outright', async () => {
    const { deps } = fakeDeps();
    await expect(balanceDappTransaction({ ...base, sdkNetworkId: 'stagenet', txHex: '00' }, deps)).rejects.toThrow(/Stagenet/);
    expect(deps.startUnshieldedWallet).not.toHaveBeenCalled();
  });

  it('stops the wallet and surfaces the fee-balancing failure', async () => {
    const { deps, wallet } = fakeDeps({
      balanceFees: vi.fn(async () => { throw new Error('proof server /prove: HTTP 503'); }),
    });
    const txHex = Buffer.from((await unbound()).serialize()).toString('hex');
    await expect(balanceDappTransaction({ ...base, txHex }, deps)).rejects.toThrow(/HTTP 503/);
    expect(wallet.stop).toHaveBeenCalled();
    expect(wallet.signUnboundTransaction).not.toHaveBeenCalled();
  });
});
