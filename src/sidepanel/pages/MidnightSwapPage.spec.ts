// The side panel's swap screens render and move between each other (home, make, status, take review).
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
const MidnightSwapPage = (await import('./MidnightSwapPage.vue')).default;

enableAutoUnmount(afterEach);

const record = {
  offerId: 'cc'.repeat(32), offer: encodeSwapOffer(Uint8Array.from([1, 2, 3])), network: 'Preprod', owner: 'mn_addr_preprod1me',
  gives: [{ tokenType: NIGHT, amount: '1000000' }], wants: [{ tokenType: TOKEN, amount: '200' }],
  createdAt: NOW - 60_000, expiresAt: NOW + 29 * 60_000, inputs: [`${'11'.repeat(32)}#0`], intentHash: 'dd'.repeat(32), status: 'open',
};

function mountPage() {
  return mount(MidnightSwapPage, {
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}

beforeEach(() => {
  worker.calls.length = 0;
  worker.answers = {
    [MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS]: { success: true, records: [record] },
    [MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER]: {
      success: true,
      inspection: { offerId: record.offerId, pay: record.wants, get: record.gives, expiresAt: record.expiresAt, maker: 'mn_addr_preprod1maker' },
    },
  };
});

describe('side panel swap', () => {
  it('home: the two choices and the wallet\'s open offer with its time left', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('midnight.swap.make.title');
    expect(wrapper.text()).toContain('midnight.swap.take.title');
    expect(wrapper.text()).toContain('1 tNIGHT → 200');
    expect(wrapper.find('[data-test="swap-status-open"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="swap-net-badge"]').exists()).toBe(true);
  });

  it('make: the form shows what the wallet can give; Create waits for an amount, an ask and a password', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="swap-choice-make"]').trigger('click');
    expect(wrapper.text()).toContain('midnight.swap.youGive');
    expect(wrapper.text()).toContain('midnight.swap.paidByTaker');
    expect(wrapper.get('[data-test="swap-create"]').attributes('disabled')).toBeDefined();
  });

  it('an open offer opens its status with Show code and Withdraw', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get(`[data-test="swap-offer-${record.offerId.slice(0, 8)}"]`).trigger('click');
    expect(wrapper.find('[data-test="swap-show-code"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="swap-withdraw"]').exists()).toBe(true);
    await wrapper.get('[data-test="swap-show-code"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="swap-qr-single"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="swap-copy"]').exists()).toBe(true);
  });

  it('take: a pasted code is reviewed with what the worker read from it, and the unlisted warning', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="swap-choice-take"]').trigger('click');
    await wrapper.get('[data-test="swap-seg-paste"]').trigger('click');
    await wrapper.get('[data-test="swap-offer-code"]').setValue(record.offer);
    await wrapper.get('[data-test="swap-review-offer"]').trigger('click');
    await flushPromises();
    expect(worker.calls.at(-1)).toMatchObject({ method: MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER, data: { offer: record.offer } });
    expect(wrapper.text()).toContain('midnight.swap.youPay');
    expect(wrapper.text()).toContain('midnight.swap.review.unlisted');
    expect(wrapper.find('[data-test="swap-take"]').exists()).toBe(true);
  });
});
