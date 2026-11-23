// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { balanceAndSignLedger9Transfer } from './midnightLedger9';
import { getMidnightEndpoints } from './midnightConfig';
import type { DustSpendCheckpoint, ReconstructDustOptions } from './midnightDustLightSync';

const mocks = vi.hoisted(() => ({
  reconstruct: vi.fn(), balance: vi.fn(), identity: vi.fn(), recheck: vi.fn(), load: vi.fn(), writer: vi.fn(), save: vi.fn(),
  /** The signal the fee builder gave its transport: aborted when the build is stopped. */
  stop: { signal: null as AbortSignal | null },
}));
vi.mock('./midnightDustLightSync', () => ({ reconstructDustState: mocks.reconstruct }));
vi.mock('./midnightDustLightLedger9', () => ({ dustLedger9: {}, balanceLightDust9: mocks.balance }));
vi.mock('./midnightDustLightTransport', () => ({ createDustLightTransport: (_endpoints: unknown, signal: AbortSignal) => { mocks.stop.signal = signal; return {}; } }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: mocks.identity, assertMidnightChainIdentityUnchanged: mocks.recheck }));
vi.mock('./midnightDustSpendCheckpoint', () => ({ loadDustSpendCheckpoint: mocks.load, dustSpendCheckpointWriter: mocks.writer }));

const identity = { network: 'midnight-stagenet', chain_generation: 1, genesis_hash: `0x${'11'.repeat(32)}` };
const seed = new Uint8Array(32).fill(2);

function args() {
  const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: '01'.repeat(32) });
  const ttl = new Date(Date.now() + 300000);
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([
    { value: 10n, owner: key, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
  ], [{ value: 10n, owner: ledger.addressFromKey(key), type: '00'.repeat(32) }], []);
  return { sdkNetworkId: 'stagenet', endpoints: getMidnightEndpoints('Stagenet')!,
    unshieldedSecretKey: new Uint8Array(32).fill(1), dustSecretSeed: seed, ttl,
    unprovenTxHex: Buffer.from(ledger.Transaction.fromParts('stagenet', undefined, undefined, intent).serialize()).toString('hex') };
}
const options = (): ReconstructDustOptions => mocks.reconstruct.mock.calls[0][5];
const checkpoint = (checkedThrough: number): DustSpendCheckpoint => ({ checkedThrough, heads: {} });

describe('ledger 9 DUST fee: the spend scan is kept as it goes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue(identity);
    mocks.recheck.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue(null);
    mocks.writer.mockReturnValue(mocks.save);
    mocks.save.mockResolvedValue(undefined);
    mocks.balance.mockReturnValue(ledger.Transaction.fromParts('stagenet'));
  });

  it('a build that fails mid-scan has already stored how far it got', async () => {
    mocks.reconstruct.mockImplementation(async () => {
      options().onCheckpoint!(checkpoint(100));
      options().onCheckpoint!(checkpoint(250));
      throw new Error('DUST synchronization is temporarily unavailable. Please try again shortly.');
    });
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('temporarily unavailable');
    expect(mocks.writer.mock.calls).toEqual([['stagenet', seed, identity]]);
    expect(mocks.save.mock.calls).toEqual([[checkpoint(100)], [checkpoint(250)]]);
    expect(mocks.balance).not.toHaveBeenCalled();
  });

  it('the next build resumes from what the failed one stored', async () => {
    mocks.load.mockResolvedValue(checkpoint(250));
    mocks.reconstruct.mockResolvedValue({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params', height: 400 }, checkpoint: checkpoint(300) });
    await balanceAndSignLedger9Transfer(args());
    expect(mocks.load).toHaveBeenCalledWith('stagenet', seed, identity);
    expect(options().checkpoint).toEqual(checkpoint(250));
    expect(mocks.writer.mock.calls).toEqual([['stagenet', seed, identity]]);
    expect(mocks.save.mock.calls).toEqual([[checkpoint(300)]]);
  });

  it('a store that never answers does not hold the build back', async () => {
    mocks.save.mockReturnValue(new Promise(() => {}));
    mocks.reconstruct.mockImplementation(async () => {
      options().onCheckpoint!(checkpoint(100));
      return { state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params', height: 400 }, checkpoint: checkpoint(300) };
    });
    await expect(balanceAndSignLedger9Transfer(args())).resolves.toMatch(/^[0-9a-f]+$/);
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('every save of a build goes through one writer, the save at its end last', async () => {
    mocks.reconstruct.mockImplementation(async () => {
      options().onCheckpoint!(checkpoint(100));
      options().onCheckpoint!(checkpoint(250));
      return { state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params', height: 400 }, checkpoint: checkpoint(300) };
    });
    await balanceAndSignLedger9Transfer(args());
    expect(mocks.writer).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls).toEqual([[checkpoint(100)], [checkpoint(250)], [checkpoint(300)]]);
  });

  it('a build stopped at the transaction\'s expiry, its scan unfinished, has stored the stages the scan settled', async () => {
    vi.useFakeTimers();
    try {
      const ttlMs = 300_000;
      mocks.reconstruct.mockImplementation(async (_ledger, _key, _network, _transport, progress: (percent: number, detail: string) => void) => {
        // A scan longer than the build may take: it settles a stage a minute, and its requests fail once the build is stopped.
        const stopped = new Promise<never>((_, reject) => mocks.stop.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
        stopped.catch(() => {});
        for (let stage = 1; ; stage++) {
          await Promise.race([new Promise(resolve => setTimeout(resolve, 50_000)), stopped]);
          progress(30 + stage, '');
          options().onCheckpoint!(checkpoint(stage * 1_000));
        }
      });
      const started = Date.now();
      const building = balanceAndSignLedger9Transfer(args());
      const failed = expect(building).rejects.toThrow('DUST synchronization timed out');
      await vi.advanceTimersByTimeAsync(ttlMs + 60_000);
      await failed;
      // Stopped by the expiry, not by silence: the scan was answering all along.
      expect(mocks.save.mock.calls.length).toBe(Math.floor(ttlMs / 50_000));
      expect(mocks.save.mock.calls.at(-1)).toEqual([checkpoint(Math.floor(ttlMs / 50_000) * 1_000)]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(ttlMs);
      expect(mocks.balance).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
