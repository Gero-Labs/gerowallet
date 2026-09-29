import Vue, { nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  destination: vi.fn(),
  batch: vi.fn(),
  registrations: vi.fn(),
  enumerate: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/api/midnight-api', async (importOriginal) => ({
  // Keep the real `DustDestinationUnsupportedError`: the composable branches on `instanceof`.
  ...(await importOriginal<typeof import('@/api/midnight-api')>()),
  getMidnightApi: () => ({
    getDustDestination: mocks.destination,
    getDustStatusBatch: mocks.batch,
    getDustRegistrations: mocks.registrations,
  }),
}));
vi.mock('@/shared/composables/useCardanoStakeEnumeration', () => ({
  enumerateCardanoStakeIdentities: mocks.enumerate,
}));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ dustAddressToHex: () => 'aabb' }));
vi.mock('@/utils/debug', () => ({ debugLog: mocks.log }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive({ loggedWallet: { network: 'Mainnet' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: reactive({ addresses: { dust: 'mn_dust1start' } }) }));

import { midnightStore } from '@/stores/midnightStore';
import { DustDestinationUnsupportedError, type MidnightDustDestinationDto } from '@/api/midnight-api';
import { useDustPathB, type DustPathB } from './useDustPathB';

// Destination figures from the mainnet capture: seven stakes on one dust address, each of which
// the indexer reported as 935253826. Path B must show that ONCE.
const NIGHT = '935253826';
const RATE = '7731743379542';
const CAP = '4676269130000000000';

function destination(over: Partial<MidnightDustDestinationDto> = {}): MidnightDustDestinationDto {
  return {
    dustAddress: 'mn_dust1test',
    registered: true,
    nightBalance: NIGHT,
    generationRate: RATE,
    maxCapacity: CAP,
    currentCapacity: '1000',
    stakes: [
      { cardanoRewardAddress: 'stake1a', state: 'active', registrationUtxoTxHash: 'aa', registrationUtxoOutputIndex: 0 },
      { cardanoRewardAddress: 'stake1b', state: 'active', registrationUtxoTxHash: 'bb', registrationUtxoOutputIndex: 0 },
      { cardanoRewardAddress: 'stake1c', state: 'active', registrationUtxoTxHash: 'cc', registrationUtxoOutputIndex: 0 },
    ],
    ...over,
  };
}

let counter = 0;
/** A fresh dust address per test: the composable's module state is keyed on it, so this resets everything. */
function switchToNewWallet(): string {
  counter += 1;
  midnightStore.addresses.dust = `mn_dust1wallet${counter}`;
  return midnightStore.addresses.dust;
}

let views: Vue[] = [];
function mount(): DustPathB {
  let pathB!: DustPathB;
  const view = new Vue({ setup() { pathB = useDustPathB(); return {}; }, render: (h) => h('div') });
  view.$mount();
  views.push(view);
  return pathB;
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  await nextTick();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.destination.mockReset();
  mocks.batch.mockReset();
  mocks.registrations.mockReset();
  mocks.enumerate.mockReset();
  mocks.log.mockClear();
  switchToNewWallet();
});
afterEach(() => {
  for (const view of views) view.$destroy();
  views = [];
  vi.useRealTimers();
});

describe('useDustPathB — destination path', () => {
  it('shows the destination totals ONCE, however many stakes feed the address', async () => {
    const dust = midnightStore.addresses.dust;
    mocks.destination.mockResolvedValue(destination());

    const pathB = mount();
    await settle();

    // Three active stakes, one destination: the figures are the destination's, not three times them.
    expect(pathB.pathBNight.value).toBe(935_253_826n);
    expect(pathB.pathBRate.value).toBe(7_731_743_379_542n);
    expect(pathB.pathBCap.value).toBe(4_676_269_130_000_000_000n);
    expect(pathB.pathBBalance.value).toBe(1000n);
    expect(pathB.pathBRegistered.value).toBe(true);
    expect(pathB.pathBIsDestinationWide.value).toBe(true);
    // One request, for this wallet's own dust address; nothing about stakes is enumerated or summed.
    expect(mocks.destination).toHaveBeenCalledTimes(1);
    expect(mocks.destination).toHaveBeenCalledWith(dust);
    expect(mocks.enumerate).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('puts active stakes in pathBStakes and relaying stakes in pathBIncomingStakes; duplicated in neither', async () => {
    mocks.destination.mockResolvedValue(destination({
      stakes: [
        { cardanoRewardAddress: 'stake1active', state: 'active', registrationUtxoTxHash: 'aa', registrationUtxoOutputIndex: 0 },
        { cardanoRewardAddress: 'stake1relaying', state: 'relaying', registrationUtxoTxHash: 'bb', registrationUtxoOutputIndex: 0 },
        { cardanoRewardAddress: 'stake1duplicated', state: 'duplicated', registrationUtxoTxHash: 'cc', registrationUtxoOutputIndex: 0 },
      ],
    }));

    const pathB = mount();
    await settle();

    expect(pathB.pathBStakes.value).toEqual(['stake1active']);
    expect(pathB.pathBIncomingStakes.value).toEqual(['stake1relaying']);
  });

  it('a relaying-only destination is unregistered with zero figures and an incoming stake', async () => {
    mocks.destination.mockResolvedValue(destination({
      registered: false, nightBalance: '0', generationRate: '0', maxCapacity: '0', currentCapacity: '0',
      stakes: [{ cardanoRewardAddress: 'stake1relaying', state: 'relaying', registrationUtxoTxHash: 'bb', registrationUtxoOutputIndex: 0 }],
    }));

    const pathB = mount();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(false);
    expect(pathB.pathBNight.value).toBe(0n);
    expect(pathB.pathBStakes.value).toEqual([]);
    expect(pathB.pathBIncomingStakes.value).toEqual(['stake1relaying']);
  });

  it('a registered answer stamps pathBBatchAsOfMs together with pathBAsOfMs', async () => {
    mocks.destination.mockResolvedValue(destination());

    const pathB = mount();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(true);
    expect(pathB.pathBAsOfMs.value).toBeGreaterThan(0);
    expect(pathB.pathBBatchAsOfMs.value).toBe(pathB.pathBAsOfMs.value);
  });

  it('an unregistered zero answer stamps pathBBatchAsOfMs: Path B has reported, though the zero is no verified balance', async () => {
    // A wallet with no registration at all (a token-only wallet, or one whose registration was removed
    // externally) gets exactly this from Nexus: no active stakes, zero figures. The stamp means only
    // "Path B has answered". It must be set, or such a wallet would never settle and the send notice
    // and sponsor picker would never appear. It says nothing about spendable DUST: the indexer counts
    // live generation only, and DUST generated earlier still decays down and stays spendable
    // (ledger DustOutput::updated_value). The guard therefore warns on it and never blocks.
    mocks.destination.mockResolvedValue(destination({
      registered: false, nightBalance: '0', generationRate: '0', maxCapacity: '0', currentCapacity: '0', stakes: [],
    }));

    const pathB = mount();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(false);
    expect(pathB.pathBAsOfMs.value).toBeGreaterThan(0);
    expect(pathB.pathBBatchAsOfMs.value).toBe(pathB.pathBAsOfMs.value);
    expect(mocks.enumerate).not.toHaveBeenCalled();
  });

  it('an active registration answering all zeros stamps pathBBatchAsOfMs too', async () => {
    // Every backing cNIGHT moved away while the registration stays active: registered, an active
    // stake, four zeros. Reported, like any other answer.
    mocks.destination.mockResolvedValue(destination({
      nightBalance: '0', generationRate: '0', maxCapacity: '0', currentCapacity: '0',
    }));

    const pathB = mount();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(true);
    expect(pathB.pathBBalance.value).toBe(0n);
    expect(pathB.pathBBatchAsOfMs.value).toBe(pathB.pathBAsOfMs.value);
  });

  it('keeps Path B reported when a registered answer is followed by an unregistered one', async () => {
    // Same wallet, same session: the registration is removed between two polls. Path B answered both
    // times, so the stamp stays set and advances with the new answer.
    mocks.destination.mockResolvedValueOnce(destination());
    const pathB = mount();
    await settle();
    const firstStamp = pathB.pathBBatchAsOfMs.value;
    expect(firstStamp).toBeGreaterThan(0);

    mocks.destination.mockResolvedValueOnce(destination({
      registered: false, nightBalance: '0', generationRate: '0', maxCapacity: '0', currentCapacity: '0', stakes: [],
    }));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.destination).toHaveBeenCalledTimes(2);
    expect(pathB.pathBRegistered.value).toBe(false);
    expect(pathB.pathBNight.value).toBe(0n);
    expect(pathB.pathBAsOfMs.value).toBeGreaterThan(0);
    expect(pathB.pathBBatchAsOfMs.value).toBe(pathB.pathBAsOfMs.value);
    expect(pathB.pathBBatchAsOfMs.value).toBeGreaterThan(firstStamp);
  });

  it('keeps the last values for the same wallet across a transient error', async () => {
    mocks.destination.mockResolvedValueOnce(destination());
    const pathB = mount();
    await settle();
    const stamp = pathB.pathBBatchAsOfMs.value;
    expect(pathB.pathBNight.value).toBe(935_253_826n);

    mocks.destination.mockRejectedValueOnce(JSON.stringify({ status: 503 }));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.destination).toHaveBeenCalledTimes(2);
    expect(pathB.pathBNight.value).toBe(935_253_826n);
    expect(pathB.pathBRegistered.value).toBe(true);
    expect(pathB.pathBBatchAsOfMs.value).toBe(stamp);
    expect(mocks.batch).not.toHaveBeenCalled(); // not "unsupported": no fallback
  });

  it('does not treat a malformed answer as a zero: it keeps the last values too', async () => {
    mocks.destination.mockResolvedValueOnce(destination());
    const pathB = mount();
    await settle();

    mocks.destination.mockRejectedValueOnce(new Error('Invalid Midnight DUST destination response'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pathB.pathBNight.value).toBe(935_253_826n);
    expect(pathB.pathBRegistered.value).toBe(true);
  });

  it('discards a response that lands after the wallet switched, and shows the new wallet only', async () => {
    let resolveFirst!: (value: MidnightDustDestinationDto) => void;
    mocks.destination.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const pathB = mount(); // starts the poll for the first wallet
    await settle();

    mocks.destination.mockResolvedValueOnce(destination({
      nightBalance: '7', currentCapacity: '70',
      stakes: [{ cardanoRewardAddress: 'stake1second', state: 'active', registrationUtxoTxHash: 'dd', registrationUtxoOutputIndex: 0 }],
    }));
    switchToNewWallet();
    await settle();
    expect(pathB.pathBNight.value).toBe(7n);

    // The first wallet's request finally answers, with very different figures.
    resolveFirst(destination({ nightBalance: '999999', currentCapacity: '999999' }));
    await settle();

    expect(pathB.pathBNight.value).toBe(7n);
    expect(pathB.pathBBalance.value).toBe(70n);
    expect(pathB.pathBStakes.value).toEqual(['stake1second']);
  });

  it('wipes the previous wallet synchronously on a switch, before the new answer arrives', async () => {
    mocks.destination.mockResolvedValueOnce(destination());
    const pathB = mount();
    await settle();
    expect(pathB.pathBRegistered.value).toBe(true);

    mocks.destination.mockImplementationOnce(() => new Promise(() => {})); // never answers
    switchToNewWallet();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(false);
    expect(pathB.pathBNight.value).toBe(0n);
    expect(pathB.pathBAsOfMs.value).toBe(0);
    expect(pathB.pathBIsDestinationWide.value).toBe(false);
  });
});

describe('useDustPathB — fallback for a Nexus without dust/destination', () => {
  const unsupported = () => mocks.destination.mockRejectedValue(new DustDestinationUnsupportedError(404));
  const row = (stake: string) => ({
    cardanoRewardAddress: stake, dustAddress: midnightStore.addresses.dust.toUpperCase(), registered: true,
    nightBalance: '50', generationRate: '3', maxCapacity: '200', currentCapacity: '100',
  });

  it('takes the figures from ONE row, not the sum, when several stakes point at the address', async () => {
    unsupported();
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }, { stakeAddress: 'stake1b' }, { stakeAddress: 'stake1c' }]);
    mocks.batch.mockResolvedValue([row('stake1a'), row('stake1b'), row('stake1c')]);

    const pathB = mount();
    await settle();

    expect(pathB.pathBBalance.value).toBe(100n); // not 300n
    expect(pathB.pathBCap.value).toBe(200n);
    expect(pathB.pathBRate.value).toBe(3n);
    expect(pathB.pathBNight.value).toBe(50n);
    expect(pathB.pathBRegistered.value).toBe(true);
    expect(pathB.pathBStakes.value).toEqual(['stake1a', 'stake1b', 'stake1c']);
    // A per-stake row is not known to include native NIGHT, so Path A must not be dropped for it.
    expect(pathB.pathBIsDestinationWide.value).toBe(false);
    expect(pathB.pathBBatchAsOfMs.value).toBeGreaterThan(0);
  });

  it('ignores rows registered to a different dust address', async () => {
    unsupported();
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
    mocks.batch.mockResolvedValue([{ ...row('stake1a'), dustAddress: 'mn_dust1someoneelse' }]);
    mocks.registrations.mockResolvedValue([]);

    const pathB = mount();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(false);
    expect(pathB.pathBNight.value).toBe(0n);
  });

  it('is NOT definitive when the profile has no stakes: it stamps pathBAsOfMs only', async () => {
    unsupported();
    mocks.enumerate.mockResolvedValue([]);

    const pathB = mount();
    await settle();

    expect(pathB.pathBAsOfMs.value).toBeGreaterThan(0);
    expect(pathB.pathBBatchAsOfMs.value).toBe(0);
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('still reports a stake registered on Cardano to this address as incoming', async () => {
    unsupported();
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
    mocks.batch.mockResolvedValue([]);
    mocks.registrations.mockResolvedValue([{ txHash: 't', outputIndex: 0, dustAddressHex: 'AABB', lovelace: '1' }]);

    const pathB = mount();
    await settle();

    expect(pathB.pathBRegistered.value).toBe(false);
    expect(pathB.pathBIncomingStakes.value).toEqual(['stake1a']);
  });

  it('keeps the last values when the fallback batch itself fails', async () => {
    unsupported();
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
    mocks.batch.mockResolvedValueOnce([row('stake1a')]);
    const pathB = mount();
    await settle();
    expect(pathB.pathBBalance.value).toBe(100n);

    mocks.batch.mockRejectedValueOnce(JSON.stringify({ status: 503 }));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pathB.pathBBalance.value).toBe(100n);
    expect(pathB.pathBRegistered.value).toBe(true);
  });

  it('returns to the destination path as soon as Nexus serves it', async () => {
    unsupported();
    mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
    mocks.batch.mockResolvedValue([row('stake1a')]);
    const pathB = mount();
    await settle();
    expect(pathB.pathBIsDestinationWide.value).toBe(false);

    mocks.destination.mockReset().mockResolvedValue(destination());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pathB.pathBIsDestinationWide.value).toBe(true);
    expect(pathB.pathBNight.value).toBe(935_253_826n);
  });

  describe('the source flag moves with the figures, never before them', () => {
    // A destination-wide total already includes native NIGHT, so useMidnightDustLive must keep
    // dropping Path A for as long as those figures are what is shown. Flipping the flag to false
    // while the destination figures are retained makes it add Path A on top: a double count.
    /** A registered destination reading, taken by the first poll. */
    async function firstPollIsDestination() {
      mocks.destination.mockResolvedValueOnce(destination({ currentCapacity: '500' }));
      const pathB = mount();
      await settle();
      expect(pathB.pathBBalance.value).toBe(500n);
      expect(pathB.pathBIsDestinationWide.value).toBe(true);
      return pathB;
    }

    it('destination success, then unsupported, then a failed fallback batch: figures, flag and timestamps are kept', async () => {
      const pathB = await firstPollIsDestination();
      const asOf = pathB.pathBAsOfMs.value;
      const batchAsOf = pathB.pathBBatchAsOfMs.value;
      const stakes = pathB.pathBStakes.value;

      mocks.destination.mockRejectedValueOnce(new DustDestinationUnsupportedError(501));
      mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
      mocks.batch.mockRejectedValueOnce(JSON.stringify({ status: 503 }));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mocks.batch).toHaveBeenCalledTimes(1); // the fallback really ran, and failed
      expect(pathB.pathBBalance.value).toBe(500n);
      expect(pathB.pathBNight.value).toBe(935_253_826n);
      expect(pathB.pathBRegistered.value).toBe(true);
      expect(pathB.pathBStakes.value).toEqual(stakes);
      expect(pathB.pathBIsDestinationWide.value).toBe(true);
      expect(pathB.pathBAsOfMs.value).toBe(asOf);
      expect(pathB.pathBBatchAsOfMs.value).toBe(batchAsOf);
    });

    it('destination success, then unsupported, then an empty enumeration: figures, flag and timestamps are kept', async () => {
      const pathB = await firstPollIsDestination();
      const asOf = pathB.pathBAsOfMs.value;
      const batchAsOf = pathB.pathBBatchAsOfMs.value;

      mocks.destination.mockRejectedValueOnce(new DustDestinationUnsupportedError(404));
      mocks.enumerate.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mocks.enumerate).toHaveBeenCalledTimes(1); // the fallback really ran, and found nothing
      expect(mocks.batch).not.toHaveBeenCalled();
      expect(pathB.pathBBalance.value).toBe(500n);
      expect(pathB.pathBRegistered.value).toBe(true);
      expect(pathB.pathBIsDestinationWide.value).toBe(true);
      expect(pathB.pathBAsOfMs.value).toBe(asOf); // not advanced: nothing refreshed these figures
      expect(pathB.pathBBatchAsOfMs.value).toBe(batchAsOf);
    });

    it('a fallback that succeeds replaces the figures and clears the flag in the same step', async () => {
      const pathB = await firstPollIsDestination();
      const asOf = pathB.pathBAsOfMs.value;

      mocks.destination.mockRejectedValueOnce(new DustDestinationUnsupportedError(404));
      mocks.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }]);
      mocks.batch.mockResolvedValueOnce([row('stake1a')]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(pathB.pathBBalance.value).toBe(100n); // the fallback row, not the destination's 500
      expect(pathB.pathBNight.value).toBe(50n);
      expect(pathB.pathBIsDestinationWide.value).toBe(false);
      expect(pathB.pathBAsOfMs.value).toBeGreaterThan(asOf);
      expect(pathB.pathBBatchAsOfMs.value).toBe(pathB.pathBAsOfMs.value);
    });

  });
});
