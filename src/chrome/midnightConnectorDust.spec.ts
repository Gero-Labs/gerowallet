// Issue 1118: the Midnight connector's getDustBalance answered with the store's
// Path-A dustState, which is { cap: 0, balance: 0 } for a wallet whose DUST comes
// from a Cardano cNIGHT registration, so a dApp concluded it could not pay fees.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  dustState: null as unknown,
  accountState: vi.fn(),
  destination: vi.fn(),
  batch: vi.fn(),
  enumerate: vi.fn(),
  networks: [] as string[],
}));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { get dustState() { return env.dustState; } } }));
vi.mock('@/api/midnight-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/midnight-api')>()),
  getMidnightApi: (network: string) => {
    env.networks.push(network);
    return { getDustAccountState: env.accountState, getDustDestination: env.destination, getDustStatusBatch: env.batch };
  },
}));
vi.mock('@/shared/composables/useCardanoStakeEnumeration', () => ({ enumerateCardanoStakeIdentities: env.enumerate }));

import { connectorDustBalance, resetConnectorDustReader } from './midnightConnectorDust';
import { DustDestinationUnsupportedError } from '@/api/midnight-api';

const HOLLOW = {
  dust_balance: '0', dust_generating: '0', dust_cap: '0', night_registered: '0',
  dust_registration_status: 'Unregistered', dust_generation_status: 'empty', dust_time_remaining_seconds: null,
};

beforeEach(() => {
  resetConnectorDustReader();
  env.dustState = { current: 0n, cap: 0n, registrationStatus: 'Unregistered' };
  env.networks = [];
  env.accountState.mockReset().mockResolvedValue(HOLLOW);
  env.destination.mockReset().mockResolvedValue({
    dustAddress: 'mn_dust1me', registered: true, nightBalance: '1', generationRate: '1',
    maxCapacity: '5000000000', currentCapacity: '3381912800', stakes: [],
  });
  env.batch.mockReset().mockResolvedValue([]);
  env.enumerate.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('connectorDustBalance', () => {
  it('answers a cNIGHT-backed wallet with its DUST, which the store reads as zero', async () => {
    expect(await connectorDustBalance('Mainnet', 'mn_addr1me', 'mn_dust1me'))
      .toEqual({ balance: 3_381_912_800n, cap: 5_000_000_000n });
    expect(env.networks).toEqual(['Mainnet']);
    expect(env.accountState).toHaveBeenCalledWith('mn_addr1me');
    expect(env.destination).toHaveBeenCalledWith('mn_dust1me');
  });

  it('answers nothing without both addresses, or while Path B has not answered', async () => {
    expect(await connectorDustBalance('Mainnet', undefined, 'mn_dust1me')).toBeNull();
    expect(await connectorDustBalance('Mainnet', 'mn_addr1me', '')).toBeNull();
    env.destination.mockRejectedValue(new Error('HTTP 503'));
    expect(await connectorDustBalance('Mainnet', 'mn_addr1me', 'mn_dust1me')).toBeNull();
  });

  it('reuses one read for a dApp that asks repeatedly, and reads again for another wallet', async () => {
    await connectorDustBalance('Mainnet', 'mn_addr1me', 'mn_dust1me');
    await connectorDustBalance('Mainnet', 'mn_addr1me', 'mn_dust1me');
    expect(env.destination).toHaveBeenCalledTimes(1);

    await connectorDustBalance('Mainnet', 'mn_addr1other', 'mn_dust1other');
    expect(env.destination).toHaveBeenCalledTimes(2);
  });

  it('asks the Cardano stakes this profile holds on a Nexus without dust/destination', async () => {
    env.destination.mockRejectedValue(new DustDestinationUnsupportedError(404));
    env.enumerate.mockResolvedValue([{ stakeAddress: 'stake1a' }, { stakeAddress: '' }]);
    env.batch.mockResolvedValue([{ cardanoRewardAddress: 'stake1a', dustAddress: 'mn_dust1me', registered: true, currentCapacity: '9', maxCapacity: '10' }]);

    expect(await connectorDustBalance('Preprod', 'mn_addr1me', 'mn_dust1me')).toEqual({ balance: 9n, cap: 10n });
    expect(env.enumerate).toHaveBeenCalledWith('Preprod');
    expect(env.batch).toHaveBeenCalledWith(['stake1a']);
  });
});

describe('the getDustBalance handler', () => {
  const source = readFileSync(join(__dirname, 'background.ts'), 'utf8');
  const start = source.indexOf('\napp.add(MIDNIGHT_METHOD.getDustBalance,');
  const body = source.slice(start, source.indexOf('\napp.add(', start + 10));

  it('answers from the merged balance, never the store\'s Path-A dustState', () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain('connectorDustBalance(');
    expect(body).not.toMatch(/dustState\s*\.\s*(current|cap)/);
  });
});
