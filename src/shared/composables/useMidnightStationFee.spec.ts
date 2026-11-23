import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { effectScope, nextTick, ref } from 'vue';
import { Network } from '@/models/types';

const mocks = vi.hoisted(() => ({ status: vi.fn(), flag: vi.fn() }));
vi.mock('@/services/midnightStationSend.service', () => ({ getMidnightStationStatus: mocks.status }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isMidnightSponsoredFeesEnabled: mocks.flag } }));

import { useMidnightStationFee } from './useMidnightStationFee';

function setup(overrides: Partial<{ mayLackDust: boolean; feeWalletChosen: boolean; shielded: boolean; network: string }> = {}) {
  const inputs = {
    mayLackDust: ref(overrides.mayLackDust ?? true),
    feeWalletChosen: ref(overrides.feeWalletChosen ?? false),
    shielded: ref(overrides.shielded ?? false),
    network: ref<string | undefined>(overrides.network ?? Network.PREPROD),
  };
  const scope = effectScope();
  const station = scope.run(() => useMidnightStationFee(inputs))!;
  return { inputs, station, scope };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flag.mockReturnValue(true);
  mocks.status.mockResolvedValue({ available: true, remaining: 2 });
});

describe('the fee station on a send screen', () => {
  it('asks the worker only when the flag is on, the network is listed and the wallet may lack DUST', async () => {
    mocks.flag.mockReturnValue(false);
    const flagOff = setup();
    mocks.flag.mockReturnValue(true);
    const otherNetwork = setup({ network: Network.MAINNET });
    const hasDust = setup({ mayLackDust: false });
    const shielded = setup({ shielded: true });
    await flushPromises();
    for (const { station } of [flagOff, otherNetwork, hasDust, shielded]) {
      expect(station.shown.value).toBe(false);
      expect(station.source.value).toBe('own');
    }
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('offers the station and makes it the fee source once the worker says it is available', async () => {
    const { station } = setup();
    expect(station.source.value).toBe('own');
    await flushPromises();
    expect(station.shown.value).toBe(true);
    expect(station.status.value).toEqual({ available: true, remaining: 2 });
    expect(station.source.value).toBe('station');
  });

  it('steps back for a chosen fee wallet and for a user who opts out', async () => {
    const { station, inputs } = setup();
    await flushPromises();
    inputs.feeWalletChosen.value = true;
    await nextTick();
    expect(station.source.value).toBe('feeWallet');
    expect(station.shown.value).toBe(false);
    inputs.feeWalletChosen.value = false;
    station.optedOut.value = true;
    await nextTick();
    expect(station.source.value).toBe('own');
    expect(station.shown.value).toBe(true);
  });

  it('shows why a wallet is not eligible, and stays out of the way when the station is simply not there', async () => {
    mocks.status.mockResolvedValue({ available: false, remaining: 0, reason: 'NOT_DELEGATED' });
    const first = setup();
    await flushPromises();
    expect(first.station.shown.value).toBe(true);
    expect(first.station.source.value).toBe('own');
    mocks.status.mockResolvedValue({ available: false, remaining: 0, reason: 'STATION_UNAVAILABLE' });
    const second = setup();
    await flushPromises();
    expect(second.station.shown.value).toBe(false);
  });

  it('asks again when the wallet starts to lack DUST, and on refresh; a stale answer is dropped', async () => {
    const { station, inputs } = setup({ mayLackDust: false });
    await flushPromises();
    inputs.mayLackDust.value = true;
    await flushPromises();
    expect(mocks.status).toHaveBeenCalledTimes(1);
    let release: (value: unknown) => void = () => {};
    mocks.status.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    void station.refresh();
    mocks.status.mockResolvedValueOnce({ available: true, remaining: 1 });
    await station.refresh();
    release({ available: false, remaining: 0, reason: 'STATION_OFF' });
    await flushPromises();
    expect(station.status.value).toEqual({ available: true, remaining: 1 });
  });
});
