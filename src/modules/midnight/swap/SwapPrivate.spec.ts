// The swap screens with private (shielded) legs: the make form sends private
// legs for every token but NIGHT, the take review shows the lock, what stays
// visible, the ~1 minute proof and an estimated expiry, and sends the shown
// terms back unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';

const NIGHT = '00'.repeat(32);
const STK = 'ab'.repeat(32);
const PTK = 'cd'.repeat(32);

const worker = vi.hoisted(() => ({ calls: [] as Array<{ method?: string; data?: Record<string, unknown> }>, answers: {} as Record<string, unknown> }));
vi.mock('@/chrome/messaging', () => ({
  Messaging: {
    sendToBackgroundFromOptions: vi.fn(async (request: { method?: string; data?: Record<string, unknown> }) => {
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
    privateSyncStatus: 'synced',
    balances: { dust: 5n * 10n ** 15n, shieldedTokens: { [STK]: 8_000n, [PTK]: 2_000n } },
    utxos: [{ tokenType: NIGHT, value: 50_000_000n, intentHash: '11'.repeat(32), outputIndex: 0 }],
  }),
}));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }),
}));
vi.mock('@/shared/composables/useMidnightSendHold', async () => {
  const { computed } = await import('vue');
  return { useMidnightSendHold: () => ({ held: computed(() => false), sendTextShort: computed(() => '') }) };
});
vi.mock('@/shared/composables/useRawPrfPopup', () => ({ useRawPrfPopup: () => ({ requestRawPrf: vi.fn(), cancelPopups: vi.fn() }) }));
vi.mock('@/services/midnight-tx.service', () => ({ backgroundError: (error?: string) => new Error(error ?? '') }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ listOpenSwapOffers: async () => null, getSwapTrades: async () => null }) }));

const { MessageTypes } = await import('@/models/MessageTypes');
const { provideMidnightSwap } = await import('./swapContext');
const SwapTakeFlow = (await import('./SwapTakeFlow.vue')).default;
const SwapMakeForm = (await import('./SwapMakeForm.vue')).default;

enableAutoUnmount(afterEach);

/** Mounts `child` under a provider of the swap context, as the pages do. */
function mountWithSwap(child: unknown, props: Record<string, unknown> = {}) {
  const Host = defineComponent({ setup() { provideMidnightSwap(); return () => h(child as never, props); } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}

beforeEach(() => {
  worker.calls.length = 0;
  worker.answers = { [MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS]: { success: true, records: [] } };
});

describe('taking a fully private offer', () => {
  const inspection = {
    offerId: 'ee'.repeat(32),
    pay: [{ tokenType: PTK, amount: '500', shielded: true }],
    get: [{ tokenType: STK, amount: '500', shielded: true }],
    expiresAt: Date.now() + 40 * 60_000,
    expiry: 'root-window',
    maker: null,
    private: true,
  };

  it('shows the lock, that neither side is visible, the minute-long proof and an estimated expiry, and takes the shown terms', async () => {
    worker.answers[MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER] = { success: true, inspection };
    worker.answers[MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER] = { success: true, txHash: 'ab'.repeat(32) };
    const headings: Array<{ title: string; left: string }> = [];
    const wrapper = mountWithSwap(SwapTakeFlow, { offer: 'swapoffer1x', onHeading: (value: { title: string; left: string }) => headings.push(value) });
    await flushPromises();
    expect(wrapper.findAll('.swap-token__lock')).toHaveLength(2);
    const text = wrapper.text();
    expect(text).toContain('midnight.swap.visibleNone');
    expect(text).toContain('midnight.swap.kind.private');
    expect(text).toContain('midnight.swap.privateNoteBoth midnight.swap.provingMinute');
    expect(wrapper.find('[data-test="swap-expiry-estimate"]').text()).toContain('midnight.swap.expiresAbout');
    expect(headings.at(-1)?.left).toContain('midnight.swap.review.leftAbout');
    expect(text).not.toContain('midnight.swap.review.otherWallet');

    await wrapper.find('input[type="password"]').setValue('pw');
    await wrapper.find('[data-test="swap-take"]').trigger('click');
    await flushPromises();
    const take = worker.calls.find(call => call.method === MessageTypes.MIDNIGHT_SWAP_TAKE_OFFER);
    expect(take?.data?.['expect']).toEqual({ pay: inspection.pay, get: inspection.get });
  });

  it('says the worker\'s private refusal in the user\'s language', async () => {
    worker.answers[MessageTypes.MIDNIGHT_SWAP_INSPECT_OFFER] = { success: false, error: 'SWAP_PRIVATE_contract' };
    const wrapper = mountWithSwap(SwapTakeFlow, { offer: 'swapoffer1x' });
    await flushPromises();
    expect(wrapper.text()).toContain('midnight.swap.error.private.contract');
  });
});

describe('making a private offer', () => {
  it('sends a private leg for every token but NIGHT, with the lock and the minute-long proof', async () => {
    const wrapper = mountWithSwap(SwapMakeForm);
    await flushPromises();
    expect(wrapper.text()).toContain('midnight.swap.offerType');
    const privateOption = wrapper.findAll('[role="radio"]').find(option => option.text().includes('midnight.swap.kind.private'));
    await privateOption!.trigger('click');
    await flushPromises();
    // NIGHT given, so only the asked side is private; the expiry choice stays.
    expect(wrapper.text()).toContain('midnight.swap.expiresIn');
    expect(wrapper.text()).toContain('midnight.swap.provingMinute');
    expect(wrapper.findAll('.swap-token__lock')).toHaveLength(1);

    worker.answers[MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER] = { success: false, error: 'SWAP_INSUFFICIENT_FUNDS' };
    const [give, want] = wrapper.findAll('input[inputmode="decimal"]');
    await give.setValue('1');
    await want.setValue('500');
    await wrapper.find('input[type="password"]').setValue('pw');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const make = worker.calls.find(call => call.method === MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER);
    expect(make?.data?.['give']).toEqual({ tokenType: NIGHT, amount: '1000000' });
    expect(make?.data?.['want']).toMatchObject({ amount: '500', shielded: true });
    expect([STK, PTK]).toContain((make?.data?.['want'] as { tokenType: string }).tokenType);
    expect(wrapper.text()).toContain('midnight.swap.error.insufficient');

    // Switched: the private token is given and NIGHT asked; NIGHT stays public.
    await wrapper.find('[aria-label="midnight.swap.switchSides"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.swap-token__lock')).toHaveLength(1);
  });
});
