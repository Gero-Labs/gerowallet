// Issue 1118: the fee-wallet strip told a wallet "No DUST. A send will ask which
// wallet pays." whenever the store's Path-A dustState read zero, which it does for a
// wallet whose DUST comes from a Cardano cNIGHT registration. It now reads the merged
// live balance, and says it only of a zero both paths have reported.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

const live = vi.hoisted(() => ({ dust: null as unknown as { dustBalance: { value: bigint }; settled: { value: boolean } } }));
vi.mock('@/shared/composables/useMidnightDustLive', async () => {
  const { ref } = await import('vue');
  live.dust = { dustBalance: ref(0n), settled: ref(true) };
  return { useMidnightDustLive: () => live.dust };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { id: 1, network: 'Mainnet' } } }));
vi.mock('@/stores/geroStore', () => ({ geroStore: { wallets: {} } }));
vi.mock('@/chains/midnight/midnightSponsorLookup', () => ({ loadSponsorCandidates: async () => ({ candidates: [] }) }));
vi.mock('@/chains/midnight/midnightSponsorLinks', () => ({
  loadSponsorLinks: async () => ({}),
  clearSponsorLink: async () => undefined,
  sponsoredByWallet: () => [],
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import MidnightSponsorStatus from './MidnightSponsorStatus.vue';

async function render() {
  const view = mount(MidnightSponsorStatus, { global: { plugins: [createTestVuetify()] } });
  await flushPromises();
  return view;
}

beforeEach(() => {
  live.dust.dustBalance.value = 0n;
  live.dust.settled.value = true;
});

describe('the fee-wallet strip\'s "No DUST" note', () => {
  it('is not shown on a wallet whose DUST comes from a Cardano cNIGHT registration', async () => {
    live.dust.dustBalance.value = 3_381_912_800n;
    expect((await render()).text()).not.toContain('midnight.sponsor.offNote');
  });

  it('is shown once both paths have reported a zero', async () => {
    expect((await render()).text()).toContain('midnight.sponsor.offNote');
  });

  it('waits for both paths before saying it', async () => {
    live.dust.settled.value = false;
    const view = await render();
    expect(view.text()).not.toContain('midnight.sponsor.offNote');

    live.dust.settled.value = true;
    await flushPromises();
    expect(view.text()).toContain('midnight.sponsor.offNote');
  });
});
