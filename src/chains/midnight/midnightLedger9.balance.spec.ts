// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { balanceAndSignLedger9Transfer } from './midnightLedger9';
import { getMidnightEndpoints } from './midnightConfig';
import { DUST_SYNC_INACTIVITY_MS } from './midnightDustSyncWatch';

const mocks = vi.hoisted(() => ({ reconstruct: vi.fn(), balance: vi.fn(), transport: vi.fn(), identity: vi.fn(), recheck: vi.fn() }));
vi.mock('./midnightDustLightSync', () => ({ reconstructDustState: mocks.reconstruct }));
vi.mock('./midnightDustLightLedger9', () => ({ dustLedger9: {}, balanceLightDust9: mocks.balance }));
vi.mock('./midnightDustLightTransport', () => ({ createDustLightTransport: mocks.transport }));
vi.mock('./midnightChainIdentity', () => ({ readVerifiedMidnightChainIdentity: mocks.identity, assertMidnightChainIdentityUnchanged: mocks.recheck }));

function args() {
  const key = ledger.signatureVerifyingKey({ tag: 'schnorr', value: '01'.repeat(32) });
  const ttl = new Date(Date.now() + 300000);
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([
    { value: 10n, owner: key, type: '00'.repeat(32), intentHash: '11'.repeat(32), outputNo: 0 },
  ], [{ value: 10n, owner: ledger.addressFromKey(key), type: '00'.repeat(32) }], []);
  return { sdkNetworkId: 'stagenet', endpoints: getMidnightEndpoints('Stagenet')!,
    unshieldedSecretKey: new Uint8Array(32).fill(1), dustSecretSeed: new Uint8Array(32).fill(2), ttl,
    unprovenTxHex: Buffer.from(ledger.Transaction.fromParts('stagenet', undefined, undefined, intent).serialize()).toString('hex') };
}

describe('Stagenet compact DUST balancing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ network: 'midnight-stagenet', chain_generation: 1, genesis_hash: `0x${'11'.repeat(32)}` });
    mocks.recheck.mockResolvedValue(undefined);
    mocks.transport.mockReturnValue({});
    mocks.reconstruct.mockResolvedValue({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params' } });
    mocks.balance.mockReturnValue(ledger.Transaction.fromParts('stagenet'));
  });

  it('signs the transfer after compact state verification and fee preparation', async () => {
    const signed = await balanceAndSignLedger9Transfer(args());
    const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(signed, 'hex'));
    expect(tx.intents!.get(1)!.guaranteedUnshieldedOffer!.signatures).toHaveLength(1);
    expect(mocks.reconstruct).toHaveBeenCalledOnce();
    expect(mocks.recheck).toHaveBeenCalledOnce();
    expect(mocks.transport.mock.calls[0][1].aborted).toBe(true);
    expect(() => mocks.reconstruct.mock.calls[0][1].publicKey).toThrow();
  });

  it('refuses to sign an unverified snapshot', async () => {
    mocks.reconstruct.mockRejectedValue(new Error('DUST root mismatch'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('root mismatch');
    expect(mocks.balance).not.toHaveBeenCalled();
  });

  it('rejects a reset detected after fee balancing', async () => {
    mocks.recheck.mockRejectedValue(new Error('Chain changed'));
    await expect(balanceAndSignLedger9Transfer(args())).rejects.toThrow('Chain changed');
  });

  it('rejects mismatched endpoints before any synchronization', async () => {
    await expect(balanceAndSignLedger9Transfer({ ...args(), endpoints: getMidnightEndpoints('Preprod')! })).rejects.toThrow('endpoint network mismatch');
    expect(mocks.reconstruct).not.toHaveBeenCalled();
  });

  // Bounded like the ledger 8 builder (gero-ios#241): by silence and the TTL, not a flat 120 s.
  describe('synchronization bounds', () => {
    afterEach(() => vi.useRealTimers());
    const tick = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
    const withTtl = (minutes: number) => ({ ...args(), ttl: new Date(Date.now() + minutes * 60_000) });
    const transportSignal = (): AbortSignal => mocks.transport.mock.calls[0][1];
    const transportActivity = (): (() => void) => mocks.transport.mock.calls[0][2];
    const synced = () => ({ state: {}, block: { timestamp: Date.now(), ledgerParameters: 'params' } });

    it('lets a slow synchronization finish while the network keeps answering', async () => {
      vi.useFakeTimers();
      mocks.reconstruct.mockImplementation(async () => {
        for (let reply = 0; reply < 10; reply++) { await tick(30_000); transportSignal().throwIfAborted(); transportActivity()(); }
        return synced();
      });
      const result = balanceAndSignLedger9Transfer(withTtl(15));
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await expect(result).resolves.toMatch(/^[0-9a-f]+$/);
    });

    it('aborts after the inactivity limit of silence', async () => {
      vi.useFakeTimers();
      mocks.reconstruct.mockImplementation(async () => new Promise((_resolve, reject) => {
        transportSignal().addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      const outcome = expect(balanceAndSignLedger9Transfer(withTtl(15))).rejects
        .toThrow('DUST synchronization timed out. Please try again shortly.');
      await vi.advanceTimersByTimeAsync(DUST_SYNC_INACTIVITY_MS - 1);
      expect(transportSignal().aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(mocks.balance).not.toHaveBeenCalled();
    });

    it('stops at the transaction TTL even while the network keeps answering', async () => {
      vi.useFakeTimers();
      mocks.reconstruct.mockImplementation(async () => {
        for (;;) { await tick(10_000); transportSignal().throwIfAborted(); transportActivity()(); }
      });
      const outcome = expect(balanceAndSignLedger9Transfer(withTtl(5))).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await outcome;
      expect(mocks.balance).not.toHaveBeenCalled();
    });

    it('forwards sync steps to the caller', async () => {
      const onDustSyncProgress = vi.fn();
      mocks.reconstruct.mockImplementation(async (_ledger, _key, _network, _transport, progress) => {
        progress(30, '');
        return synced();
      });
      await balanceAndSignLedger9Transfer({ ...args(), onDustSyncProgress });
      expect(onDustSyncProgress).toHaveBeenCalledWith(30, '');
    });
  });
});
