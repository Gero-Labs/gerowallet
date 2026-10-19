import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import * as Vue from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { KnownAddress, ShippingAddress } from '@/modules/wallet/utils/cardOrder';

const phone = vi.hoisted(() => ({
  props: ['modelValue', 'disabled'],
  render(this: Vue.ComponentPublicInstance & { modelValue: string; disabled: boolean }) {
    return Vue.h('input', { class: 'phone-stub', value: this.modelValue, disabled: this.disabled });
  },
}));

vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key, locale: 'us' } }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('@/shared/components/PhoneNumberInput.vue', () => ({ default: phone }));

import StepSfc from './ShippingAddressSelectionStep.vue';

const Step = StepSfc as unknown as Parameters<typeof mount>[0];

const czech: ShippingAddress = {
  streetAddress: 'Vnouckova 2007', city: 'Benesov', stateProvince: 'Stredocesky kraj', zipCode: '25601',
  countryCode: 'CZ', phone: '+420601234567',
};

function render(address: ShippingAddress, known?: KnownAddress) {
  return mount(Step, {
    props: { address, known },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
}

const field = (wrapper: ReturnType<typeof render>, label: string) =>
  wrapper.findAll('.v-text-field').find(candidate => candidate.text().includes(label))!.find('input');

const lastAddress = (wrapper: ReturnType<typeof render>) => {
  const events = wrapper.emitted('update:address') as ShippingAddress[][];
  return events[events.length - 1][0];
};

describe('ShippingAddressSelectionStep', () => {
  it('shows only the form, with no "coming soon" choice, when no address is known', () => {
    const wrapper = render({ ...czech, streetAddress: '', city: '' });
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('common.comingSoon');
    expect(wrapper.text()).toContain('card.details.latinHint');
    expect(field(wrapper, 'card.streetAddress').attributes('disabled')).toBeUndefined();
  });

  it('offers the last delivery address with the address itself, and locks its fields', () => {
    const wrapper = render(czech, { source: 'delivery', address: czech });
    expect(wrapper.text()).toContain('card.shipToLastAddress');
    expect(wrapper.text()).toContain('Vnouckova 2007, 25601 Benesov, Stredocesky kraj, Czech');
    expect(field(wrapper, 'card.streetAddress').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.phone-stub').attributes('disabled')).toBeDefined();
  });

  it('leaves the phone editable when the saved home address has none', () => {
    const home = { ...czech, phone: '' };
    const wrapper = render(home, { source: 'residential', address: home });
    expect(wrapper.text()).toContain('card.shipToHomeAddress');
    expect(field(wrapper, 'card.city').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.phone-stub').attributes('disabled')).toBeUndefined();
  });

  it('keeps a known value that Zione would refuse editable', () => {
    const old = { ...czech, streetAddress: 'Vnoučkova 2007,' };
    const wrapper = render(old, { source: 'delivery', address: old });
    expect(field(wrapper, 'card.streetAddress').attributes('disabled')).toBeUndefined();
    expect(field(wrapper, 'card.city').attributes('disabled')).toBeDefined();
  });

  it('clears the address but keeps the phone when the user enters a new one', async () => {
    const wrapper = render(czech, { source: 'delivery', address: czech });
    await wrapper.find('input[value="new"]').trigger('change');
    expect(lastAddress(wrapper)).toEqual({
      streetAddress: '', city: '', stateProvince: '', zipCode: '', countryCode: '', phone: '+420601234567',
    });
  });

  it('converts accents and commas when the user leaves a field', async () => {
    const wrapper = render({ ...czech, streetAddress: 'Vnoučkova 2007,' });
    await field(wrapper, 'card.streetAddress').trigger('blur');
    expect(lastAddress(wrapper).streetAddress).toBe('Vnouckova 2007');
  });

  it('names the characters Zione would refuse', async () => {
    const wrapper = render({ ...czech, streetAddress: 'Flat #5 & more' });
    expect(await (wrapper.vm as unknown as { validate: () => Promise<boolean> }).validate()).toBe(false);
    await Vue.nextTick();
    expect(wrapper.text()).toContain('card.details.textCharacters {"chars":"# &"}');
  });
});
