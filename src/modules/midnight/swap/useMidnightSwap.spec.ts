// The pages' side of the swap: worker calls on the options channel, codes in the user's language.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const sent = vi.hoisted(() => ({ calls: [] as Array<{ method?: string; data?: Record<string, unknown> }>, answer: {} as unknown }));
vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: vi.fn(async (request: { method?: string; data?: Record<string, unknown> }) => { sent.calls.push(request); return sent.answer; }) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { chain: 'Midnight', network: 'Preprod', id: 1 } } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { lastSync: 1, utxos: [] } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useRawPrfPopup', () => ({ useRawPrfPopup: () => ({ requestRawPrf: vi.fn(), cancelPopups: vi.fn() }) }));
vi.mock('@/services/midnight-tx.service', () => ({
  backgroundError: (error: string | undefined) => new Error(({
    MIDNIGHT_DUST_COINS_SHORT: 'midnight.errors.dustCoinsShort',
    MIDNIGHT_SEND_SPENDS_OFFERED_COINS: 'midnight.swap.error.sendUsesOffer',
  } as Record<string, string>)[error ?? ''] ?? error ?? ''),
}));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ listOpenSwapOffers: async () => null }) }));

const { useMidnightSwap, swapErrorText, MidnightSwapCallError } = await import('./useMidnightSwap');
const { MessageTypes } = await import('@/models/MessageTypes');

function withSwap(): ReturnType<typeof useMidnightSwap> {
  let swap!: ReturnType<typeof useMidnightSwap>;
  mount(defineComponent({ setup() { swap = useMidnightSwap(); return () => h('div'); } }));
  return swap;
}

beforeEach(() => {
  sent.calls.length = 0;
  sent.answer = { data: { success: true, records: [] } };
});

describe('useMidnightSwap', () => {
  it('asks the worker by method on the options channel', async () => {
    const swap = withSwap();
    await vi.waitFor(() => expect(sent.calls.some(call => call.method === MessageTypes.MIDNIGHT_SWAP_LIST_OFFERS)).toBe(true));
    sent.answer = { data: { success: true, record: { offerId: 'aa'.repeat(32) } } };
    await swap.makeOffer({ give: { tokenType: '00'.repeat(32), amount: '1' }, want: { tokenType: 'ab'.repeat(32), amount: '2' }, ttlMinutes: 30 }, { password: 'pw' });
    expect(sent.calls.at(-1)).toMatchObject({ method: MessageTypes.MIDNIGHT_SWAP_MAKE_OFFER, data: { ttlMinutes: 30, password: 'pw' } });
    expect(swap.offers.value[0].offerId).toBe('aa'.repeat(32));
  });

  it('a refusal comes back as its code and the user\'s sentence', async () => {
    const swap = withSwap();
    sent.answer = { data: { success: false, error: 'SWAP_OFFER_GONE' } };
    const error = await swap.inspectOffer('swapoffer1x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MidnightSwapCallError);
    expect(error).toMatchObject({ code: 'SWAP_OFFER_GONE', message: 'midnight.swap.error.gone' });
  });
});

describe('swapErrorText', () => {
  const t = (key: string) => key;
  it('maps swap codes, the offered-coins refusal and the wallet\'s own codes; anything else is the general error', () => {
    expect(swapErrorText('OFFER_EXPIRED', t)).toBe('midnight.swap.error.expired');
    expect(swapErrorText('MIDNIGHT_SEND_SPENDS_OFFERED_COINS', t)).toBe('midnight.swap.error.sendUsesOffer');
    expect(swapErrorText('MIDNIGHT_DUST_COINS_SHORT', t)).toBe('midnight.errors.dustCoinsShort');
    expect(swapErrorText('DUST synchronization timed out. Please try again shortly.', t)).toBe('midnight.swap.error.dustSlow');
    expect(swapErrorText(undefined, t)).toBe('midnight.swap.error.generic');
  });
});
