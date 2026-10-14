import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';
import ToggleSwitch from './ToggleSwitch.vue';

enableAutoUnmount(afterEach);

describe('ToggleSwitch accessibility', () => {
  it('announces a switch, not a checkbox, with its current state', async () => {
    const wrapper = mount(ToggleSwitch, { props: { modelValue: true }, global: { plugins: [createTestVuetify()] } });
    const input = wrapper.get('input');
    expect(input.attributes('role')).toBe('switch');
    expect((input.element as HTMLInputElement).checked).toBe(true);
    await wrapper.setProps({ modelValue: false });
    expect((input.element as HTMLInputElement).checked).toBe(false);
  });
});
