// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { balanceAndSignLedger9Transfer } from './midnightLedger9';
import { getMidnightEndpoints } from './midnightConfig';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), wait: vi.fn(), balance: vi.fn(), serialize: vi.fn(),
  subscribe: vi.fn(), unsubscribe: vi.fn(), restore: vi.fn(), create: vi.fn(),
  load: vi.fn(), save: vi.fn(), clear: vi.fn(),
  identity: vi.fn(), recheck: vi.fn(), snapshot: vi.fn(),
}));

vi.mock('midnight-v9-dust-wallet', () => ({
  DustWallet: () => ({ restore: mocks.restore, startWithSecretKey: mocks.create }),
}));
vi.mock('./midnightWalletStatePersistence', () => ({
  loadWalletState: mocks.load, saveWalletState: mocks.save, clearWalletState: mocks.clear,
}));
vi.mock('./midnightChainIdentity', () => ({
  readVerifiedMidnightChainIdentity: mocks.identity,
  assertMidnightChainIdentityUnchanged: mocks.recheck,
  midnightCheckpointNamespace: () => 'midnight-stagenet-ledger9-rc3-genesis-1',
  fetchLedger9DustSnapshot: mocks.snapshot,
}));

function args() {
  const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: '01'.repeat(32) });
  const intent = ledger.Intent.new(new Date('2030-01-01T00:00:00Z'));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([
    { value: 10n, owner: key, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
  ], [{ value: 10n, owner: ledger.addressFromKey(key), type: '00'.repeat(32) }], []);
  return {
    sdkNetworkId: 'stagenet', endpoints: getMidnightEndpoints('Stagenet')!,
    unshieldedSecretKey: new Uint8Array(32).fill(1), dustSecretSeed: new Uint8Array(32).fill(2),
    ttl: new Date('2030-01-01T00:00:00Z'),
    unprovenTxHex: Buffer.from(ledger.Transaction.fromParts('stagenet', undefined, undefined, intent).serialize()).toString('hex'),
  };
}

describe('Stagenet DUST balancing lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const wallet = {
      start: mocks.start, stop: mocks.stop, waitForSyncedState: mocks.wait,
      balanceTransactions: mocks.balance, serializeState: mocks.serialize,
      state: { subscribe: mocks.subscribe },
    };
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.wait.mockResolvedValue({});
    mocks.serialize.mockResolvedValue('ledger9-state');
    mocks.subscribe.mockReturnValue({ unsubscribe: mocks.unsubscribe });
    mocks.create.mockReturnValue(wallet);
    mocks.restore.mockReturnValue(wallet);
    mocks.load.mockResolvedValue(null);
    mocks.save.mockResolvedValue(undefined);
    mocks.clear.mockResolvedValue(undefined);
    mocks.balance.mockResolvedValue({ transaction: ledger.Transaction.fromParts('stagenet'), blockData: {} });
    mocks.identity.mockResolvedValue({ network: 'midnight-stagenet', chain_generation: 1, genesis_hash: `0x${'11'.repeat(32)}` });
    mocks.recheck.mockResolvedValue(undefined);
    mocks.snapshot.mockResolvedValue(null);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('uses the v9 fee-result transaction and isolates checkpoint storage from ledger 8', async () => {
    const input = args();
    const signed = await balanceAndSignLedger9Transfer(input);
    const tx: ledger.UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(signed, 'hex'));
    expect(tx.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures).toHaveLength(1);
    expect(mocks.load).toHaveBeenCalledWith('midnight-stagenet-ledger9-rc3-genesis-1', 'dust', input.dustSecretSeed);
    expect(mocks.save).toHaveBeenCalledWith('midnight-stagenet-ledger9-rc3-genesis-1', 'dust', input.dustSecretSeed, 'ledger9-state');
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('discards an incompatible checkpoint and cold-starts without signing stale state', async () => {
    mocks.load.mockResolvedValue('incompatible');
    mocks.restore.mockImplementation(() => { throw new Error('Wrong ledger version'); });
    await balanceAndSignLedger9Transfer(args());
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('tears down and refuses to sign when the DUST fee operation fails', async () => {
    mocks.balance.mockRejectedValue(new Error('Insufficient DUST'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('Insufficient DUST');
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('bounds a non-settling fee operation and still tears down the wallet', async () => {
    vi.useFakeTimers();
    mocks.load.mockResolvedValue('before-registration');
    mocks.balance.mockImplementation(() => new Promise(() => {}));
    const result = expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('DUST fee calculation timed out');
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledOnce();
  });

  it('rejects mismatched endpoints before starting any wallet', async () => {
    const input = args();
    input.endpoints = getMidnightEndpoints('Preprod')!;
    await expect(balanceAndSignLedger9Transfer(input)).rejects.toThrow('endpoint network mismatch');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('leaves checkpoints untouched when chain identity cannot be verified', async () => {
    mocks.identity.mockRejectedValue(new Error('Chain identity unknown'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('unknown');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('rejects a reset detected after fee balancing instead of returning a signed old-chain transaction', async () => {
    mocks.recheck.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Chain changed'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('Chain changed');
    expect(mocks.balance).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('drops a restored empty checkpoint after insufficient DUST so the next attempt can replay registration', async () => {
    mocks.load.mockResolvedValue('before-registration');
    mocks.balance.mockRejectedValue(new Error('Insufficient DUST'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('Insufficient DUST');
    expect(mocks.clear).toHaveBeenCalledOnce();
  });

  it('restores a verified bootstrap snapshot on a local miss', async () => {
    mocks.snapshot.mockResolvedValue('verified-snapshot');
    await balanceAndSignLedger9Transfer({ ...args(), dustRegisteredAt: new Date('2026-01-01') });
    expect(mocks.restore).toHaveBeenCalledWith('verified-snapshot');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
