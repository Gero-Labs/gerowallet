// Issue 1118: a dApp asking for a Midnight wallet's DUST got Nexus's Path-A figure,
// which reads zero for a wallet whose DUST comes from a Cardano cNIGHT registration.
// The background now reads both paths with the rule the battery uses.
import { describe, expect, it, vi } from 'vitest';
import { DustDestinationUnsupportedError } from '@/api/midnight-api';
import {
  dustBatteryPercent,
  readMergedDustBalance,
  reusedDustReader,
  type MergedDustReadInput,
} from './midnightDustBalance';
import type { MidnightDustState } from './midnightTypes';

const DUST = 'mn_dust1destination';
const HOLLOW = {
  dust_balance: '0', dust_generating: '0', dust_cap: '0', night_registered: '0',
  dust_registration_status: 'Unregistered', dust_generation_status: 'empty', dust_time_remaining_seconds: null,
};
const accountState = (balance: string, cap: string) => ({
  ...HOLLOW, dust_balance: balance, dust_cap: cap, dust_generating: '10', night_registered: '1000',
  dust_registration_status: 'Registered',
});
const destination = (registered: boolean, current: string, max: string) => ({
  dustAddress: DUST, registered, nightBalance: '0', generationRate: '0',
  maxCapacity: max, currentCapacity: current, stakes: [],
});
const store = (current: bigint, cap: bigint) => ({ current, cap } as MidnightDustState);

function input(api: Partial<MergedDustReadInput['api']>, extra: Partial<MergedDustReadInput> = {}): MergedDustReadInput {
  return {
    api: {
      getDustAccountState: vi.fn(async () => HOLLOW),
      getDustDestination: vi.fn(async () => destination(false, '0', '0')),
      getDustStatusBatch: vi.fn(async () => []),
      ...api,
    } as MergedDustReadInput['api'],
    unshieldedAddress: 'mn_addr1wallet',
    dustAddress: DUST,
    storeDustState: null,
    enumerateStakes: vi.fn(async () => []),
    ...extra,
  };
}

describe('readMergedDustBalance', () => {
  it('reports a cNIGHT-backed wallet\'s DUST, which the store\'s Path-A figure reads as zero', async () => {
    const figures = await readMergedDustBalance(input(
      { getDustDestination: vi.fn(async () => destination(true, '3381912800', '5000000000')) },
      { storeDustState: store(0n, 0n) },
    ));

    expect(figures).toEqual({ balance: 3_381_912_800n, cap: 5_000_000_000n });
  });

  it('does not add native NIGHT on top of a destination total that already contains it', async () => {
    const figures = await readMergedDustBalance(input({
      getDustAccountState: vi.fn(async () => accountState('700', '1000')),
      getDustDestination: vi.fn(async () => destination(true, '700', '1000')),
    }));

    expect(figures).toEqual({ balance: 700n, cap: 1000n });
  });

  it('reads Path A when nothing is registered through Cardano', async () => {
    const figures = await readMergedDustBalance(input({
      getDustAccountState: vi.fn(async () => accountState('250', '900')),
    }));

    expect(figures).toEqual({ balance: 250n, cap: 900n });
  });

  it('falls back to the gero-sync snapshot when the account-state answer says nothing or fails', async () => {
    expect(await readMergedDustBalance(input({}, { storeDustState: store(40n, 80n) })))
      .toEqual({ balance: 40n, cap: 80n });
    expect(await readMergedDustBalance(input(
      { getDustAccountState: vi.fn(async () => { throw new Error('timeout'); }) },
      { storeDustState: store(40n, 80n) },
    ))).toEqual({ balance: 40n, cap: 80n });
  });

  it('reports a zero only once both paths have answered', async () => {
    expect(await readMergedDustBalance(input({}))).toEqual({ balance: 0n, cap: 0n });
  });

  it('says nothing rather than zero while Path B has not answered', async () => {
    const figures = await readMergedDustBalance(input(
      { getDustDestination: vi.fn(async () => { throw new Error('HTTP 503'); }) },
      { storeDustState: store(0n, 0n) },
    ));

    expect(figures).toBeNull();
  });

  it('says nothing while Path A is unknown, unless Path B alone is the balance', async () => {
    const failing = { getDustAccountState: vi.fn(async () => { throw new Error('timeout'); }) };
    expect(await readMergedDustBalance(input(failing))).toBeNull();
    expect(await readMergedDustBalance(input({
      ...failing,
      getDustDestination: vi.fn(async () => destination(true, '12', '20')),
    }))).toEqual({ balance: 12n, cap: 20n });
  });

  describe('on a Nexus without dust/destination', () => {
    const unsupported = { getDustDestination: vi.fn(async () => { throw new DustDestinationUnsupportedError(404); }) };
    const row = (stake: string, dustAddress: string | null, registered = true) => ({
      cardanoRewardAddress: stake, dustAddress, registered, currentCapacity: '300', maxCapacity: '600',
    });

    it('takes one matching dust/status row, not a sum, and adds Path A to it', async () => {
      const batch = vi.fn(async () => [
        row('stake1a', DUST), row('stake1b', DUST.toUpperCase()), row('stake1c', 'mn_dust1other'), row('stake1d', DUST, false),
      ]);
      const figures = await readMergedDustBalance(input(
        { ...unsupported, getDustStatusBatch: batch, getDustAccountState: vi.fn(async () => accountState('5', '10')) },
        { enumerateStakes: vi.fn(async () => ['stake1a', 'stake1b', 'stake1c', 'stake1d']) },
      ));

      expect(batch).toHaveBeenCalledWith(['stake1a', 'stake1b', 'stake1c', 'stake1d']);
      expect(figures).toEqual({ balance: 305n, cap: 610n });
    });

    it('answers Path A when this profile holds no stake to ask about', async () => {
      const figures = await readMergedDustBalance(input(
        { ...unsupported, getDustAccountState: vi.fn(async () => accountState('5', '10')) },
      ));

      expect(figures).toEqual({ balance: 5n, cap: 10n });
    });

    it('asks for at most 50 stakes at a time', async () => {
      const batch = vi.fn(async (_chunk: string[]) => []);
      const stakes = Array.from({ length: 51 }, (_, i) => `stake1${i}`);
      await readMergedDustBalance(input({ ...unsupported, getDustStatusBatch: batch }, { enumerateStakes: async () => stakes }));

      expect(batch.mock.calls.map(([chunk]) => chunk.length)).toEqual([50, 1]);
    });
  });
});

describe('reusedDustReader', () => {
  it('shares one read between asks within the reuse window, including asks made while it is in flight', async () => {
    let now = 1_000;
    const reader = reusedDustReader(5_000, () => now);
    const read = vi.fn(async () => ({ balance: 1n, cap: 2n }));

    const [first, second] = await Promise.all([reader('w1', read), reader('w1', read)]);
    now += 4_999;
    await reader('w1', read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    now += 1;
    await reader('w1', read);
    await reader('w2', read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('asks again after a read that came back with nothing or failed', async () => {
    const reader = reusedDustReader(5_000, () => 1_000);
    const empty = vi.fn(async () => null);
    await reader('w1', empty);
    await reader('w1', empty);
    expect(empty).toHaveBeenCalledTimes(2);

    const failing = vi.fn(async () => { throw new Error('offline'); });
    await expect(reader('w2', failing)).rejects.toThrow('offline');
    await expect(reader('w2', failing)).rejects.toThrow('offline');
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('dustBatteryPercent', () => {
  it('shows nothing without a capacity, and clamps to 0..100', () => {
    expect(dustBatteryPercent(5n, 0n)).toBeNull();
    expect(dustBatteryPercent(3_381n, 5_000n)).toEqual({ percent: 68 });
    expect(dustBatteryPercent(7n, 5n)).toEqual({ percent: 100 });
  });
});
