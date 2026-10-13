import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { VStepperWindow } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';

const mocks = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock('@/api/moonpay-api', () => ({ default: { moonPaySign: mocks.sign } }));
vi.mock('@/utils/assets', () => ({ default: { dollarShieldSvg: '' } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', async () => ({
  walletStore: (await import('vue')).reactive({ loggedWallet: { chain: 'Cardano', baseAddress: 'fixture-address' } }),
}));

import BuyDialog from './BuyDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  // Keep widget loading local: no signed URL or iframe is ever created.
  mocks.sign.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { document.body.innerHTML = ''; });

describe('BuyDialog with the real Vuetify stepper and dialog', () => {
  it.each([
    ['Cardano', 'wallet.buyADA', 'wallet.sellADA'],
    ['Bitcoin', 'wallet.buyBTC', 'wallet.sellBTC'],
  ])('shows %s choices on first open and when reopening after a choice', async (chain, buy, sell) => {
    walletStore.loggedWallet.chain = chain;
    const wrapper = mount(BuyDialog, {
      attachTo: document.body,
      props: { isOpen: false },
      global: {
        plugins: [createTestVuetify()],
        mocks: { $t: (key: string) => key },
      },
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    const choices = () => wrapper.getComponent(VStepperWindow).findAll('button.bs-choice');
    expect(choices().map(button => button.get('.bs-choice__title').text())).toEqual([buy, sell]);
    expect(choices().every(button => button.isVisible())).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();

    await choices()[0]!.trigger('click');
    await flushPromises();
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(wrapper.getComponent(VStepperWindow).props('modelValue')).toBe(2);

    await wrapper.setProps({ isOpen: false });
    await flushPromises();
    await wrapper.setProps({ isOpen: true });
    await flushPromises();
    expect(choices()).toHaveLength(2);
    expect(choices().every(button => button.isVisible())).toBe(true);
    expect(wrapper.getComponent(VStepperWindow).props('modelValue')).toBe(1);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
