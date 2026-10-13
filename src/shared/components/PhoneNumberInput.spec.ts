import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import PhoneNumberInput from './PhoneNumberInput.vue';

enableAutoUnmount(afterEach);
const render = (modelValue = '+12025550100') => mount(PhoneNumberInput, {
  props: { modelValue, label: 'Phone number' },
  global: {
    plugins: [createTestVuetify()], stubs: { flag: true },
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
  },
});

describe('phone number Vue 3 model contract', () => {
  it('reflects later parent model changes in the text field and real country selection', async () => {
    const wrapper = render();
    await flushPromises();
    expect((wrapper.find('input[type="tel"]').element as HTMLInputElement).value).toBe('(202) 555-0100');
    expect(wrapper.find('.v-select__selection').text()).toBe('+1');
    await wrapper.setProps({ modelValue: '+442079460958' });
    await flushPromises();
    expect((wrapper.find('input[type="tel"]').element as HTMLInputElement).value).toBe('020 7946 0958');
    expect(wrapper.find('.v-select__selection').text()).toBe('+44');
  });

  it('emits the E.164 model and parsed change event for native text edits', async () => {
    const wrapper = render('');
    await wrapper.find('input[type="tel"]').setValue('2025550100');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['+12025550100']);
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toMatchObject({
      valid: true, regionCode: 'US', number: { e164: '+12025550100' },
    });
  });

  it('clears the native field when the parent clears its model', async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.setProps({ modelValue: '' });
    expect((wrapper.find('input[type="tel"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['']);
  });
});
