// The dashboard Swap page: make on the left, take and the wallet's offers on the right.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';

const NIGHT = '00'.repeat(32);
const TOKEN = 'ab'.repeat(32);
const NOW = Date.now();

const worker = vi.hoisted(() => ({ calls: [] as Array<{ method?: string }>, answers: {} as Record<string, unknown> }));
vi.mock('@/chrome/messaging', () => ({
  Messaging: {
    sendToBackgroundFromOptions: vi.fn(async (request: { method?: string }) => {
      worker.calls.push(request);
      return { data: worker.answers[request.method ?? ''] ?? { success: false, error: 'SWAP_UNAVAILABLE' } };
    }),
  },
}));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: { chain: 'Midnight', network: 'Preprod', id: 1 }, isLocked: false }),
}));
vi.mock('@/stores/midnightStore', async () => ({
  midnightStore: (await import('vue')).reactive({
    lastSync: 1, sendProgress: null, addresses: { unshielded: 'mn_addr_preprod1me' },
    balances: { dust: 5n * 10n ** 15n },
    utxos: [
      { tokenType: NIGHT, value: 50_000_000n, intentHash: '11'.repeat(32), outputIndex: 0 },
      { tokenType: TOKEN, value: 900n, intentHash: '22'.repeat(32), outputIndex: 0 },
    ],
  }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useMidnightSendHold', async () => {
  const { computed } = await import('vue');
  return { useMidnightSendHold: () => ({ held: computed(() => false), sendTextShort: computed(() => '') }) };
});
vi.mock('@/shared/composables/useRawPrfPopup', () => ({ useRawPrfPopup: () => ({ requestRawPrf: vi.fn(), cancelPopups: vi.fn() }) }));
vi.mock('@/services/midnight-tx.service', () => ({ backgroundError: (error?: string) => new Error(error ?? '') }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ listOpenSwapOffers: async () => null, getSwapTrades: async () => null }) }));
vi.mock('@/shared/components/AnimatedQRCode.vue', () => ({ default: { template: '<div class="animated-qr" />' } }));
vi.mock('@/shared/components/AnimatedQRScanner.vue', () => ({ default: { template: '<div class="scanner" />' } }));
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => undefined) } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const { encodeSwapOffer } = await import('@/chains/midnight/midnightSwapOffer');
const { MessageTypes } = await import('@/models/MessageTypes');
const MidnightSwapDeskPage = (await import('./MidnightSwapDeskPage.vue')).default;

enableAutoUnmount(afterEach);

const record = {
  offerId: 'cc'.repeat(32), offer: encodeSwapOffer(Uint8Array.from([1, 2, 3])), network: 'Preprod', owner: 'mn_addr_preprod1me',
  gives: [{ tokenType: NIGHT, amount: '1000000' }], wants: [{ tokenType: TOKEN, amount: '200' }],
  createdAt: NOW - 60_000, expiresAt: NOW + 29 * 60_000, inputs: [`${'11'.repeat(32)}#0`], intentHash: 'dd'.repeat(32), status: 'open',
};

beforeEach(() => {
  worker.calls.length = 0;
  worker.answers = { [MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS]: { success: true, records: [record] } };
});

describe('dashboard swap page', () => {
  it('shows the make form, the take card and the offers table with row actions', async () => {
    const wrapper = mount(MidnightSwapDeskPage, {
      attachTo: document.body,
      global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('midnight.swap.preprodOnly');
    expect(wrapper.find('[data-test="swap-create"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="swap-desk-paste"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="swap-desk-scan"]').exists()).toBe(true);
    expect(wrapper.find(`[data-test="swap-offer-${record.offerId.slice(0, 8)}"]`).text()).toContain('1 tNIGHT');
    expect(wrapper.find('[data-test="swap-row-withdraw"]').exists()).toBe(true);
    // No open-offers list while Nexus does not serve one.
    expect(wrapper.text()).not.toContain('midnight.swap.open.title');
  });
});
