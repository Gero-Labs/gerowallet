import Vue, { nextTick } from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), fireSuccess: vi.fn() } }));
vi.mock('@/stores/modules/card', () => ({ default: { activatePhysicalCard: vi.fn() } }));

import CardActivationPanelSfc from './CardActivationPanel.vue';
import cardStore from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';

Vue.use(Vuetify);
const CardActivationPanel = CardActivationPanelSfc as unknown as Parameters<typeof mount>[0];
const VALID_PAN = '4111111111111111';

function render() {
  return mount(CardActivationPanel, { vuetify: new Vuetify(), propsData: { orderUuid: 'order-1' } });
}

async function type(wrapper: ReturnType<typeof render>, value: string) {
  const input = wrapper.find('input');
  input.setValue(value);
  await nextTick();
  return input;
}

describe('CardActivationPanel', () => {
  afterEach(() => vi.clearAllMocks());

  it('groups the digits and ignores everything else', async () => {
    const wrapper = render();
    const input = await type(wrapper, '4111-1111 1111x1111');
    expect((input.element as HTMLInputElement).value).toBe('4111 1111 1111 1111');
  });

  it('keeps the button disabled until the number passes the checksum', async () => {
    const wrapper = render();
    await type(wrapper, '4111111111111112');
    const button = wrapper.find('button[type="submit"]');
    expect(button.attributes('disabled')).toBeDefined();
    await type(wrapper, VALID_PAN);
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
  });

  it('sends the digits with the order, clears them and reports activation', async () => {
    vi.mocked(cardStore.activatePhysicalCard).mockResolvedValue('card-1');
    const log = vi.spyOn(console, 'log');
    const wrapper = render();
    await type(wrapper, VALID_PAN);
    await wrapper.find('form').trigger('submit');
    await nextTick();
    await nextTick();
    expect(cardStore.activatePhysicalCard).toHaveBeenCalledWith('order-1', VALID_PAN);
    expect(wrapper.emitted('activated')?.[0]).toEqual(['card-1']);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('');
    expect(snackbar.fireSuccess).toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).not.toContain(VALID_PAN);
  });

  it('keeps the number for a retry when the provider refuses it', async () => {
    vi.mocked(cardStore.activatePhysicalCard).mockRejectedValue(new Error('400'));
    const wrapper = render();
    await type(wrapper, VALID_PAN);
    await wrapper.find('form').trigger('submit');
    await nextTick();
    await nextTick();
    expect(snackbar.setError).toHaveBeenCalledWith('card.activationFailed');
    expect(wrapper.emitted('activated')).toBeUndefined();
  });
});
