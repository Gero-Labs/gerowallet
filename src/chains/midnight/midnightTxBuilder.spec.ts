// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { getMidnightEndpoints } from './midnightConfig';
import { syncDustWalletAndBalanceFees } from './midnightTxBuilder';

const mocks = vi.hoisted(() => ({ reconstruct: vi.fn(), balance: vi.fn(), transport: vi.fn(), identity: vi.fn(), recheck: vi.fn() }));
vi.mock('./midnightDustLightSync', () => ({ reconstructDustState: mocks.reconstruct }));
vi.mock('./midnightDustLightLedger8', () => ({ dustLedger8: {}, balanceLightDust8: mocks.balance }));
vi.mock('./midnightDustLightTransport', () => ({ createDustLightTransport: mocks.transport }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: mocks.identity, assertMidnightChainIdentityUnchanged: mocks.recheck }));

const args = () => ({ sdkNetworkId: 'mainnet', endpoints: getMidnightEndpoints('Mainnet')!,
  dustSecretSeed: new Uint8Array(32).fill(42), ttl: new Date(Date.now() + 300000) });
const txs = () => [ledger.Transaction.fromParts('mainnet')];

describe('DUST send preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ network: 'midnight-mainnet', chain_generation: 2, genesis_hash: `0x${'11'.repeat(32)}` });
    mocks.recheck.mockResolvedValue(undefined);
    mocks.transport.mockReturnValue({});
    mocks.reconstruct.mockResolvedValue({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params' } });
    mocks.balance.mockReturnValue(ledger.Transaction.fromParts('mainnet'));
  });
  afterEach(() => vi.useRealTimers());

  it('uses compact sync for restored wallets regardless of local creation time', async () => {
    await syncDustWalletAndBalanceFees({ ...args(), dustRegisteredAt: new Date() }, txs());
    expect(mocks.reconstruct).toHaveBeenCalledOnce();
    expect(mocks.balance).toHaveBeenCalledOnce();
    expect(mocks.recheck).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls[0][1].aborted).toBe(true);
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  it('fails without balancing if snapshot verification fails, with no replay fallback', async () => {
    mocks.reconstruct.mockRejectedValue(new Error('DUST commitment root verification failed'));
    await expect(syncDustWalletAndBalanceFees(args(), txs())).rejects.toThrow('root verification');
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.reconstruct).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls[0][1].aborted).toBe(true);
  });

  it('rejects a chain reset after reconstruction instead of returning a fee transaction', async () => {
    mocks.recheck.mockRejectedValue(new Error('Midnight chain changed'));
    await expect(syncDustWalletAndBalanceFees(args(), txs())).rejects.toThrow('chain changed');
    expect(mocks.balance).toHaveBeenCalledOnce();
  });

  it('aborts a stalled network operation and clears the DUST key', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    mocks.reconstruct.mockImplementation(async () => new Promise((_resolve, reject) => {
      const signal: AbortSignal = mocks.transport.mock.calls[0][1];
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      started();
    }));
    const result = expect(syncDustWalletAndBalanceFees(args(), txs())).rejects.toThrow('timed out');
    await ready;
    await vi.advanceTimersByTimeAsync(120000);
    await result;
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  it('checks endpoint network and expiry before fetching state', async () => {
    await expect(syncDustWalletAndBalanceFees({ ...args(), endpoints: getMidnightEndpoints('Preprod')! }, txs())).rejects.toThrow('network mismatch');
    await expect(syncDustWalletAndBalanceFees({ ...args(), ttl: new Date(0) }, txs())).rejects.toThrow('expiry');
    expect(mocks.identity).not.toHaveBeenCalled();
  });
});
