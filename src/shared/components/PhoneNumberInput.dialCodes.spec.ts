import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import PhoneNumberInput from './PhoneNumberInput.vue';

enableAutoUnmount(afterEach);

const render = (modelValue: string, attach = false) => mount(PhoneNumberInput, {
  props: { modelValue, label: 'Phone number' },
  ...(attach ? { attachTo: document.body } : {}),
  global: {
    plugins: [createTestVuetify()], stubs: { flag: true },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
  },
});

// Several regions share a dial code (+1 US/Canada, +44 UK/Jersey, +61 Australia/Cocos). Rows
// keyed by the dial code collided: Vue warned about duplicate keys and Vuetify about
// "Multiple nodes with the same ID" as soon as the code list opened.
describe('phone country codes', () => {
  it('opens the code list without duplicate row ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const wrapper = render('', true);

    await wrapper.find('.country-code-select .v-field').trigger('mousedown');
    await flushPromises();

    expect(document.body.querySelectorAll('.v-list-item').length).toBeGreaterThan(0);
    const messages = warn.mock.calls.map(call => call.map(String).join(' '));
    expect(messages.filter(message => /Duplicate keys|Multiple nodes with the same ID/.test(message))).toEqual([]);
    warn.mockRestore();
  });

  it('keeps Canada selected rather than another +1 region', async () => {
    const wrapper = render('+14165550123');
    await flushPromises();
    expect((wrapper.vm as unknown as { selectedCountry: { countryCode: string } }).selectedCountry.countryCode).toBe('CA');
    expect(wrapper.find('.v-select__selection').text()).toBe('+1');
  });
});
