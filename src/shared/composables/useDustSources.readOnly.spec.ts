// A Midnight wallet on a network read-only in GeroWallet (midnightConfig.ts)
// can neither register nor redirect a cNIGHT source: both are writes its Nexus
// routes refuse, so they answer before anything is decrypted or built.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { api, store } = vi.hoisted(() => ({
  api: { buildDustRegistrationTx: vi.fn(), buildDustUpdateTx: vi.fn(), submitCardanoTx: vi.fn() },
  store: { loggedWallet: { id: 50, name: 'Night', chain: 'Midnight', network: 'Preview' } },
}));
vi.mock('@/stores/geroStore', () => ({ geroStore: { wallets: {} } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: store }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { addresses: { dust: 'dust-address' } } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => api }));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ dustAddressToHex: () => 'abcd' }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ CNIGHT_ASSETS: {}, mapDustBuildError: (message: string) => message }));
vi.mock('@/shared/composables/useDustPending', () => ({ clearDustPending: vi.fn(), markDustPending: vi.fn(), reconcileDustPending: vi.fn() }));

import { useDustSources, type DustSource } from './useDustSources';

const source = { key: 's', stakeAddress: 'stake_test1x', baseAddress: 'addr_test1x', paymentKeyHashHex: 'aa', nightBalance: 1n } as unknown as DustSource;

beforeEach(() => vi.clearAllMocks());

describe('cNIGHT sources of a read-only Midnight wallet', () => {
  it('registering or redirecting answers with the reason and touches nothing', async () => {
    const sources = useDustSources();
    const held = { status: 'error', message: 'DUST registration on Midnight Preview isn\'t available in GeroWallet yet.' };
    expect(await sources.registerSource(source, { password: 'x' })).toEqual(held);
    expect(await sources.redirectSource(source, { password: 'x' })).toEqual(held);
    for (const route of Object.values(api)) expect(route).not.toHaveBeenCalled();
  });

  it('a wallet on a network with open writes is not held here', async () => {
    store.loggedWallet = { ...store.loggedWallet, network: 'Preprod' };
    // Past the hold it goes on to the source checks, which this bare source fails.
    const result = await useDustSources().registerSource(source, { password: 'x' })
      .catch((error: Error) => ({ status: 'threw', message: error.message }));
    expect('message' in result ? result.message : '').not.toContain('isn\'t available in GeroWallet');
    store.loggedWallet = { ...store.loggedWallet, network: 'Preview' };
  });
});
