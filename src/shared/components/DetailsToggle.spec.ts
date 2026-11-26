import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import DetailsToggle from './DetailsToggle.vue';

enableAutoUnmount(afterEach);

const $t = (key: string): string => key;
const global = { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t }) } };

beforeEach(() => {
  localStorage.clear();
});

describe('DetailsToggle', () => {
  it('is a switch named by its visible label, with the Alt hint as its description', () => {
    const wrapper = mount(DetailsToggle, { props: { modelValue: false }, global, attachTo: document.body });
    const button = wrapper.get('button');
    expect(button.attributes('role')).toBe('switch');
    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-checked')).toBe('false');
    expect(document.getElementById(button.attributes('aria-labelledby')!)?.textContent).toBe('common.details');
    expect(document.getElementById(button.attributes('aria-describedby')!)?.textContent).toBe('detailsLayer.peekHint');
    // The visible key hint is decoration; the description says it to a screen reader.
    const kbd = wrapper.get('kbd');
    expect(kbd.text()).toBe('Alt');
    expect(kbd.attributes('aria-hidden')).toBe('true');
  });

  it('announces the remembered state and asks for the opposite on click', async () => {
    const wrapper = mount(DetailsToggle, { props: { modelValue: true }, global });
    expect(wrapper.get('button').attributes('aria-checked')).toBe('true');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('lights the key hint during a peek without moving the switch', async () => {
    const wrapper = mount(DetailsToggle, { props: { modelValue: false, peeking: false }, global });
    expect(wrapper.get('kbd').classes()).not.toContain('details-toggle__key--held');
    await wrapper.setProps({ peeking: true });
    expect(wrapper.get('kbd').classes()).toContain('details-toggle__key--held');
    expect(wrapper.get('button').attributes('aria-checked')).toBe('false');
  });

  it('drives a screen through useDetailsLayer: the switch, and a peek while Alt is held', async () => {
    vi.resetModules();
    const { useDetailsLayer } = await import('@/shared/composables/useDetailsLayer');
    const Screen = defineComponent({
      setup() {
        const { enabled, peeking, visible } = useDetailsLayer('spec.screen');
        return () => h('div', [
          h(DetailsToggle, {
            modelValue: enabled.value,
            peeking: peeking.value,
            'onUpdate:modelValue': (value: boolean) => { enabled.value = value; },
          }),
          visible.value ? h('p', { class: 'technical' }, 'addr1') : null,
        ]);
      },
    });
    const wrapper = mount(Screen, { global });
    expect(wrapper.find('.technical').exists()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', cancelable: true }));
    await nextTick();
    expect(wrapper.find('.technical').exists()).toBe(true);
    expect(wrapper.get('button').attributes('aria-checked')).toBe('false');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', cancelable: true }));
    await nextTick();
    expect(wrapper.find('.technical').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    expect(wrapper.find('.technical').exists()).toBe(true);
    expect(wrapper.get('button').attributes('aria-checked')).toBe('true');

    // Unmounting the screen gives a bare Alt back to the browser.
    wrapper.unmount();
    const alt = new KeyboardEvent('keydown', { key: 'Alt', cancelable: true });
    window.dispatchEvent(alt);
    expect(alt.defaultPrevented).toBe(false);
  });
});
